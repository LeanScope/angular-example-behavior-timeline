import {
  DestroyRef,
  Injectable,
  InjectionToken,
  Injector,
  computed,
  inject,
  signal,
} from '@angular/core';
import type { LeanScopeSessionService } from '../../../leanscope/leanscope-session.service';
import { APP_ENV } from '../../app-env';
import { createSession, when } from '../../discussion/state/session-factory';
import type { ParsedAnswer } from '../finding/finding.types';
import { parseAnswer } from '../finding/parse-finding';
import { exchangesFromSteps } from './session-exchanges';

/** The Message facet of the analysis choreo allows this many characters. */
export const MAX_QUESTION = 200;

/** Creates the analysis session (a child-injector instance); replaced in tests. */
export const ANALYSIS_SESSION_FACTORY = new InjectionToken<() => LeanScopeSessionService>(
  'ANALYSIS_SESSION_FACTORY',
  {
    providedIn: 'root',
    factory: () => {
      const injector = inject(Injector);
      return () => createSession(injector);
    },
  },
);

/** What the analysis does while it works on a question, before any tool has reported. */
export const DEFAULT_ACTIVITY = 'Leitfaden lesen, Transkripte durchsuchen, Aussagen zählen';

/** German labels for the repository's MCP tools, so the working card says what happens. */
export function activityLabel(tool?: string, title?: string): string {
  switch (tool) {
    case 'get_server_instructions':
      return 'Repository kennenlernen';
    case 'search_schema':
      return 'Datenstruktur prüfen';
    case 'query_graphql':
      return 'Leitfaden, Personas und Transkripte abfragen';
    case 'get_platform_context':
      return 'Begriffe nachschlagen';
    default:
      return title || tool || 'Arbeitet';
  }
}

/** One question with its parsed answer (null while the analyst works on it). */
export interface AnalysisEntry {
  id: string;
  question: string;
  answer: ParsedAnswer | null;
}

/**
 * The analysis choreo (APP_ANALYSIS_CHOREO_GUID): one session that answers question after question
 * about the study, each answer with a ```finding block. Started the first time the Analyse tab
 * asks for it, stopped with the page.
 */
@Injectable()
export class AnalysisService {
  private readonly injector = inject(Injector);
  private readonly env = inject(APP_ENV);
  private readonly createSession = inject(ANALYSIS_SESSION_FACTORY);
  private readonly session = signal<LeanScopeSessionService | null>(null);
  /**
   * A question sent here that is not yet visible as a step (the server takes a moment), with the
   * number of questions the session held when it was sent.
   */
  private readonly sent = signal<{ question: string; after: number } | null>(null);

  readonly configured = !!this.env.analysisChoreoGuid.trim();
  /** The tool the analysis is using right now (German), or null before the first one. */
  readonly activity = signal<string | null>(null);
  /** When the current question was sent (ms), for the elapsed seconds. */
  readonly since = signal<number | null>(null);
  /** The question in the input field: filled by sample cards and the guide's "Auswerten". */
  readonly draft = signal('');

  readonly state = computed(() => this.session()?.state() ?? 'idle');
  readonly error = computed(() => this.session()?.error() ?? null);
  /** The session waits for the next question. */
  readonly ready = computed(() => this.state() === 'asking');

  private readonly fromSteps = computed<AnalysisEntry[]>(() => {
    const session = this.session();
    if (!session) return [];
    const view = exchangesFromSteps(session.steps(), session.pendingQuestion()?.guid ?? null);
    const entries: AnalysisEntry[] = view.exchanges.map((e) => ({
      id: e.id,
      question: e.question,
      answer: parseAnswer(e.answer ?? ''),
    }));
    if (view.thinking) entries.push({ ...view.thinking, answer: null });
    return entries;
  });

  readonly entries = computed<AnalysisEntry[]>(() => {
    const entries = this.fromSteps();
    const sent = this.sent();
    return sent && entries.length <= sent.after
      ? [...entries, { id: 'sent', question: sent.question, answer: null }]
      : entries;
  });

  /** The analyst is working on a question. */
  readonly busy = computed(() => this.entries().some((e) => !e.answer));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.session()?.stop());
  }

  /** Starts the session once. Safe to call again. */
  start(): void {
    if (this.session() || !this.configured) return;
    const session = this.createSession();
    this.session.set(session);
    session.onFrame((frame) => {
      if (frame.event !== 'tool_activity') return;
      const beat = frame.data as { phase?: string; toolName?: string; title?: string };
      if (beat.phase === 'start') this.activity.set(activityLabel(beat.toolName, beat.title));
    });
    void session.start({ choreoScenarioGuid: this.env.analysisChoreoGuid.trim() });
  }

  /** Sends a question as soon as the session asks for one. */
  async ask(text: string): Promise<boolean> {
    const question = text.trim().slice(0, MAX_QUESTION);
    if (!question || this.busy()) return false;
    this.start();
    const session = this.session();
    if (!session) return false;
    const sent = { question, after: this.fromSteps().length };
    this.sent.set(sent);
    this.activity.set(null);
    this.since.set(Date.now());
    const state = await when(this.injector, session.state, (s) =>
      ['asking', 'ended', 'error'].includes(s),
    );
    const key = session.pendingQuestion()?.fieldKeys[0] ?? 'message';
    const ok = state === 'asking' && (await session.submit({ [key]: question }));
    if (!ok && this.sent() === sent) this.sent.set(null);
    return ok;
  }
}
