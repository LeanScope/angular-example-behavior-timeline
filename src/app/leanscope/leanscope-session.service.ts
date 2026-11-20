import { Injectable, computed, inject, signal } from '@angular/core';
import type {
  ActorRef,
  ActorsFrame,
  EndReason,
  GateFrame,
  HistoryResponse,
  PendingQuestion,
  PendingStep,
  SessionConfig,
  SessionEndingFrame,
  SessionRequest,
  SessionResponse,
  SpeakMode,
  SpeakResult,
  SseFrame,
  Step,
} from './agent-server.types';
import { LEANSCOPE_CONFIG, LEANSCOPE_FETCH, missingConfig } from './leanscope.config';
import { LeanScopeAuthService } from './leanscope-auth.service';
import { facetGuidOf } from './facet-guid';
import { PendingUploads, type UploadState } from './pending-uploads';
import { readSseFrames } from './sse-parser';

/**
 * Where a session is:
 * - `idle`: none started yet (or stopped).
 * - `connecting`: being created.
 * - `waiting`: created with `autoStart: false`; waits for `begin()`.
 * - `working`: the agents are at it.
 * - `asking`: waits for the user's answer (see `pendingQuestion`).
 * - `ended`: over (see `endReason`).
 * - `error`: couldn't be created or lost its connection (see `error`).
 */
export type SessionState =
  'idle' | 'connecting' | 'waiting' | 'working' | 'asking' | 'ended' | 'error';

/**
 * Runs one LeanScope choreo session against the Agent Server and exposes it as signals.
 *
 *   start()  → POST /api/v1/sessions (Bearer: the signed-in user's login), then GET …/history and GET …/events (SSE)
 *   attach() → the same for a session created elsewhere (`?sessionToken=` from run-choreo)
 *   step frames update `steps`; after each one, GET …/steps/pending updates `pendingQuestion`
 *   the actors frame updates `actors` (who the personas of the repository are)
 *   submit() → POST …/submit with the answer
 *   parkFile() → a `pending://` ref for a file answer; the bytes follow when the engine asks
 *   setTts()   → POST …/tts: persona turns arrive as `tts_audio` frames (read them with onFrame)
 *   continue() → POST …/continue: releases a transition a choreo without autoTransition parked
 *   speak()    → POST …/speak: a step of a recorded conversation, spoken in its persona's voice
 *   cancelSpeech() → DELETE …/speak: supersedes everything speak() asked for
 *   sessionConfig() → GET …/config: which choreo the session runs (e.g. one it was attached to)
 *   runQuery() → POST /api/v1/queries/<guid>, a query an author published in LeanScope
 *
 * Use this service rather than calling the API from components.
 */
@Injectable({ providedIn: 'root' })
export class LeanScopeSessionService {
  private readonly config = inject(LEANSCOPE_CONFIG);
  private readonly fetch = inject(LEANSCOPE_FETCH);
  private readonly auth = inject(LeanScopeAuthService);

  private readonly _state = signal<SessionState>('idle');
  private readonly _steps = signal<Step[]>([]);
  private readonly _pendingQuestion = signal<PendingQuestion | null>(null);
  private readonly _session = signal<SessionResponse | null>(null);
  private readonly _error = signal<string | null>(null);
  private readonly _endReason = signal<EndReason | null>(null);
  private readonly _uploads = signal<Record<string, UploadState>>({});
  private readonly _actors = signal<ActorRef[]>([]);
  private readonly pending = new PendingUploads(this.fetch, (state) =>
    this._uploads.update((all) => ({ ...all, [state.ref]: state })),
  );

  readonly state = this._state.asReadonly();
  /** The conversation so far, in order. */
  readonly steps = this._steps.asReadonly();
  /** What the session asks the user right now, when `state` is `asking`. */
  readonly pendingQuestion = this._pendingQuestion.asReadonly();
  readonly session = this._session.asReadonly();
  readonly error = this._error.asReadonly();
  readonly endReason = this._endReason.asReadonly();
  /**
   * The repository's personas (guid, name, portrait), from the session's `actors` frame. Steps
   * name their speaker by guid only; this is how to show a name and a face for it.
   */
  readonly actors = this._actors.asReadonly();
  /** File answers of this session by `pending://` ref: parked, uploading, done or failed. */
  readonly uploads = computed(() => Object.values(this._uploads()));
  readonly isActive = computed(() =>
    ['connecting', 'waiting', 'working', 'asking'].includes(this._state()),
  );

  /** Every SSE frame, also those this service ignores (`inventory`, `tool_activity`, …). */
  private readonly frameListeners = new Set<(frame: SseFrame) => void>();

  private abort: AbortController | null = null;
  /** Bumped on every start/stop, so answers to an older session's requests are dropped. */
  private run = 0;
  private refreshing: Promise<void> | null = null;
  private refreshAgain = false;

  /** Creates a session for the configured choreo and follows it. Stops a running one first. */
  async start(overrides: Partial<SessionRequest> = {}): Promise<void> {
    this.stop();
    const run = this.run;
    const missing = missingConfig(this.config);
    if (missing.length > 0) {
      this.fail(`Missing configuration: ${missing.join('; ')}.`);
      return;
    }

    this._state.set('connecting');
    let bearer: string;
    try {
      bearer = await this.auth.bearer();
    } catch (err) {
      if (run === this.run) this.fail(`Sign in to LeanScope first. ${messageOf(err)}`);
      return;
    }
    if (run !== this.run) return;
    const request: SessionRequest = {
      choreoScenarioGuid: this.config.choreoScenarioGuid.trim(),
      choreoRepositoryId: this.config.repositoryId.trim(),
      autoStart: true,
      ...(this.config.locale ? { locale: this.config.locale } : {}),
      ...overrides,
    };

    try {
      const res = await this.fetch(
        `${this.config.agentServerUrl.replace(/\/+$/, '')}/api/v1/sessions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${bearer}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
        },
      );
      if (run !== this.run) return;
      if (!res.ok) {
        this.fail(await createErrorMessage(res));
        return;
      }
      const session = (await res.json()) as SessionResponse;
      if (run !== this.run) return;
      this._session.set(session);
      this._state.set(request.autoStart === false ? 'waiting' : 'working');

      await this.loadHistory(run);
      this.follow(run);
      void this.refreshPending();
    } catch (err) {
      if (run === this.run) this.fail(`Could not reach the agent server: ${messageOf(err)}`);
    }
  }

  /**
   * Follows a session someone else created, e.g. the agent server's `run-choreo` plugin when
   * LeanScope opens this app at its `uiBaseUrl` with `?sessionToken=…`. Needs no login and no
   * choreo guid: the token in the controller URL authorizes every session route.
   * Resolves `true` when the session was found.
   */
  async attach(sessionToken: string): Promise<boolean> {
    this.stop();
    const run = this.run;
    const token = sessionToken.trim();
    const server = this.config.agentServerUrl.trim().replace(/\/+$/, '');
    if (!token || !server) {
      this.fail(token ? 'Missing configuration: agentServerUrl.' : 'Missing session token.');
      return false;
    }

    this._session.set({
      sessionId: '',
      sessionScenarioGuid: '',
      sessionToken: token,
      controllerUrl: `${server}/api/v1/sessions/${encodeURIComponent(token)}`,
      uiUrl: '',
      markdown: '',
    });
    this._state.set('waiting');

    await this.loadHistory(run);
    if (run !== this.run || this._state() === 'error') return false;
    this.follow(run);
    void this.refreshPending();
    return true;
  }

  /** Opens the start gate of a session created with `autoStart: false`. */
  async begin(): Promise<void> {
    const res = await this.call('/start', { method: 'POST' });
    if (res && !res.ok) this._error.set(`Could not start the session (${res.status}).`);
  }

  /**
   * Turns the session's voice on or off (`POST …/tts`). While on, every finished persona turn
   * arrives as `tts_audio` frames (see `onFrame`), spoken with the persona's voice.
   */
  async setTts(active: boolean): Promise<boolean> {
    const res = await this.call('/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    });
    return !!res?.ok;
  }

  /**
   * Releases a parked transition (`POST …/continue`). A choreo with `autoTransition: false` parks
   * before each automatic step and says so in a `parked` frame.
   */
  async continue(): Promise<boolean> {
    const res = await this.call('/continue', { method: 'POST' });
    return !!res?.ok;
  }

  /**
   * Has the session speak a step of a recorded `Conversation` scenario of the choreo's
   * repository in its persona's voice (`POST …/speak`), in any order and whether `setTts` is on
   * or not. The audio arrives as `tts_audio` / `tts_audio_end` frames with the request's
   * `requestId` (see `onFrame`). Nothing is written to the repository.
   */
  async speak(
    stepGuid: string,
    options: { requestId?: string; mode?: SpeakMode } = {},
  ): Promise<SpeakResult> {
    const res = await this.call('/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepGuid, ...options }),
    });
    if (!res) return { ok: false, status: 0 };
    const body = (await res.json().catch(() => null)) as {
      requestId?: string;
      error?: { code?: string };
    } | null;
    if (res.ok) return { ok: true, requestId: body?.requestId ?? options.requestId ?? '' };
    return { ok: false, status: res.status, reason: body?.error?.code };
  }

  /** Supersedes everything `speak()` asked for, queued or in flight (`DELETE …/speak`). */
  async cancelSpeech(): Promise<boolean> {
    const res = await this.call('/speak', { method: 'DELETE' });
    return !!res?.ok;
  }

  /** Which choreo the session runs and where it records (`GET …/config`); null when unknown. */
  async sessionConfig(): Promise<SessionConfig | null> {
    const res = await this.call('/config');
    if (!res?.ok) return null;
    return (await res.json().catch(() => null)) as SessionConfig | null;
  }

  /** Answers the pending question. `answer` matches `pendingQuestion().schema`. */
  async submit(answer: Record<string, unknown>): Promise<boolean> {
    const res = await this.call('/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(answer),
    });
    if (!res) return false;
    if (res.status === 204 || res.ok) {
      this._error.set(null);
      this._pendingQuestion.set(null);
      if (this._state() === 'asking') this._state.set('working');
      void this.refreshPending();
      return true;
    }
    if (res.status === 409) {
      this._error.set('That question is no longer open.');
      void this.refreshPending();
    } else if (res.status === 503) {
      this._error.set('The session has not started yet. Try again in a moment.');
    } else {
      this._error.set(`Your answer was not accepted (${res.status}): ${await errorText(res)}`);
    }
    return false;
  }

  /**
   * Parks `file` for a file field (`format: "data-url"`) and returns the `pending://` ref to put
   * into the answer. After `submit()`, the engine announces the ref in a step and this service
   * uploads the bytes (durably when the engine asks for it, see pending-uploads.ts).
   */
  parkFile(file: File): string {
    return this.pending.park(file);
  }

  /**
   * Runs a query an author PUBLISHED in LeanScope (a ❓ Repository Query resource), by its guid.
   * `scenarioGuid` names a choreo of the repository to read; the server adds the repository and
   * the token, so the browser never names either. Returns the GraphQL `data`; throws on errors.
   */
  async runQuery<T = unknown>(
    queryGuid: string,
    scenarioGuid: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const res = await this.fetch(
      `${this.config.agentServerUrl.replace(/\/+$/, '')}/api/v1/queries/${encodeURIComponent(queryGuid)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioGuid, variables }),
      },
    );
    if (!res.ok) throw new Error(`The query was not run (${res.status}): ${await errorText(res)}`);
    const body = (await res.json()) as { data?: T; errors?: { message?: string }[] };
    if (body.errors?.length) {
      throw new Error(body.errors.map((e) => e.message ?? 'unknown error').join('; '));
    }
    return body.data as T;
  }

  /** Stops following the session. The session itself keeps running on the server until it ends. */
  stop(): void {
    this.run++;
    this.abort?.abort();
    this.abort = null;
    this.refreshing = null;
    this.refreshAgain = false;
    this._state.set('idle');
    this._steps.set([]);
    this._pendingQuestion.set(null);
    this._session.set(null);
    this._error.set(null);
    this._endReason.set(null);
    this._uploads.set({});
    this._actors.set([]);
    this.pending.clear();
  }

  /** Calls `listener` with every SSE frame. Returns a function that removes it. */
  onFrame(listener: (frame: SseFrame) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  private async loadHistory(run: number): Promise<void> {
    const res = await this.call('/history');
    if (run !== this.run) return;
    if (res?.status === 404 || res?.status === 410) {
      this.fail(
        res.status === 404
          ? 'The agent server does not know this session (wrong session token or agent server).'
          : 'This session has already ended.',
      );
      return;
    }
    if (!res?.ok) return;
    const history = (await res.json()) as HistoryResponse;
    if (run !== this.run) return;
    for (const step of history.steps ?? []) this.upsertStep(step);
  }

  /** Reads `GET …/events` in the background until the stream ends or `stop()` aborts it. */
  private follow(run: number): void {
    const session = this._session();
    if (!session) return;
    const abort = new AbortController();
    this.abort = abort;

    void (async () => {
      try {
        const res = await this.fetch(`${session.controllerUrl}/events`, {
          headers: { Accept: 'text/event-stream' },
          signal: abort.signal,
        });
        if (!res.ok || !res.body) throw new Error(`events stream answered ${res.status}`);
        for await (const frame of readSseFrames(res.body)) {
          if (run !== this.run) return;
          this.handleFrame(frame);
        }
        // The server closes the stream when the session is over.
        if (run === this.run && this._state() !== 'ended')
          this.end(this._endReason() ?? 'terminal');
      } catch (err) {
        if (abort.signal.aborted || run !== this.run) return;
        if (this._state() !== 'ended')
          this.fail(`Lost the connection to the session: ${messageOf(err)}`);
      }
    })();
  }

  private handleFrame(frame: SseFrame): void {
    for (const listener of this.frameListeners) listener(frame);
    switch (frame.event) {
      case 'step':
        this.upsertStep(frame.data as Step);
        void this.refreshPending();
        break;
      case 'gate': {
        const { state } = frame.data as GateFrame;
        if (state === 'waiting' && this._state() === 'working') this._state.set('waiting');
        if (state === 'open' && this._state() === 'waiting') this._state.set('working');
        break;
      }
      case 'actors': {
        const actors = (frame.data as ActorsFrame | null)?.actors;
        if (Array.isArray(actors)) this._actors.set(actors.filter((a) => a?.guid && a.name));
        break;
      }
      case 'session_ending': {
        const { reason, error } = frame.data as SessionEndingFrame;
        if (error?.message) this._error.set(error.message);
        this.end(reason);
        break;
      }
      case 'error':
        this._error.set(
          (frame.data as { message?: string })?.message ?? 'The session reported an error.',
        );
        break;
    }
  }

  /** Step frames carry the step's full current state, so a frame replaces the step with its guid. */
  private upsertStep(step: Step): void {
    this._steps.update((steps) => {
      const index = steps.findIndex((s) => s.guid === step.guid);
      if (step.action === 'DELETE')
        return index === -1 ? steps : steps.filter((_, i) => i !== index);
      if (index === -1) return [...steps, step];
      const next = [...steps];
      next[index] = step;
      return next;
    });
    const session = this._session();
    if (session && step.action !== 'DELETE') this.pending.drive(step, session.controllerUrl);
  }

  /** Asks `GET …/steps/pending` what the session waits for. Calls never overlap. */
  private refreshPending(): Promise<void> {
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    const run = this.run;
    this.refreshing = (async () => {
      do {
        this.refreshAgain = false;
        const res = await this.call('/steps/pending');
        if (!res?.ok || run !== this.run) return;
        const pending = (await res.json()) as PendingStep;
        if (run !== this.run || this._state() === 'ended' || this._state() === 'error') return;
        if (pending.status === 'asking' && pending.step) {
          this._pendingQuestion.set(this.withFacetGuid(pending.step));
          this._state.set('asking');
        } else if (pending.status === 'ended') {
          this.end(pending.endReason ?? 'terminal');
        } else {
          this._pendingQuestion.set(null);
          if (this._state() === 'asking') this._state.set('working');
        }
      } while (this.refreshAgain && run === this.run);
    })()
      .catch(() => undefined)
      .finally(() => {
        if (run !== this.run) return;
        this.refreshing = null;
        // A frame that arrived after the last read but before this point asked for one more.
        if (this.refreshAgain) void this.refreshPending();
      });
    return this.refreshing;
  }

  /** The question with the facet guid of its step's `questions` envelope, unless the server sent one. */
  private withFacetGuid(question: PendingQuestion): PendingQuestion {
    if (question.facetGuid) return question;
    const step = this._steps().find((s) => s.guid === question.guid);
    const facetGuid = facetGuidOf(step?.questions);
    return facetGuid ? { ...question, facetGuid } : question;
  }

  /** A request to the session's own routes (`…/sessions/<token><path>`); null without a session. */
  private async call(path: string, init: RequestInit = {}): Promise<Response | null> {
    const session = this._session();
    if (!session) return null;
    try {
      return await this.fetch(`${session.controllerUrl}${path}`, init);
    } catch (err) {
      this._error.set(`Could not reach the session: ${messageOf(err)}`);
      return null;
    }
  }

  private end(reason: EndReason): void {
    this._endReason.set(reason);
    this._pendingQuestion.set(null);
    this._state.set('ended');
    this.abort?.abort();
  }

  private fail(message: string): void {
    this._error.set(message);
    this._state.set('error');
    this.abort?.abort();
  }
}

async function createErrorMessage(res: Response): Promise<string> {
  const detail = await errorText(res);
  switch (res.status) {
    case 401:
    case 403:
      return `LeanScope did not accept your login for this repository (${res.status}). Sign in again, or check LEANSCOPE_REPOSITORY_ID in .env. ${detail}`;
    case 404:
      return `The choreo was not found (404). Check LEANSCOPE_CHOREO_SCENARIO_GUID in .env. ${detail}`;
    case 422:
      return `The agent server does not run this session on its own keys (422): your login does not reach repository LEANSCOPE_REPOSITORY_ID. ${detail}`;
    default:
      return `Could not create the session (${res.status}). ${detail}`;
  }
}

async function errorText(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    // The server's error envelope is `{ error: { message } }`.
    const body = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    return message ?? body.message ?? text;
  } catch {
    return text.slice(0, 300);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
