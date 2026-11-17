import { DestroyRef, Injectable, Injector, computed, inject, signal } from '@angular/core';
import { answerFields } from '../../../leanscope/answer-fields';
import type { LeanScopeSessionService } from '../../../leanscope/leanscope-session.service';
import { APP_ENV } from '../../app-env';
import { StudyStore } from './study.store';
import { createSession, when } from './session-factory';

/** Where a document was dropped. Sent to the worker as a hint, never as a decision. */
export type DropZone = 'study-brief' | 'interview-guide' | 'screener' | 'stimulus';

export const ZONE_LABEL: Record<DropZone, string> = {
  'study-brief': 'Angebot',
  'interview-guide': 'Leitfaden',
  screener: 'Screener',
  stimulus: 'Stimulus',
};

export type IngestState = 'uploading' | 'reading' | 'done' | 'error';

export interface IngestJob {
  id: number;
  zone: DropZone;
  fileNames: string[];
  state: IngestState;
  /** The worker's latest progress line, or the error. */
  message: string;
}

/** The answer key the ingest choreo's upload step may offer for the drop-zone hint. */
const HINT_KEY = 'expectedClass';

/**
 * Reads dropped documents into LeanScope through the "📥 Studienunterlagen einlesen" choreo.
 *
 * Each drop runs one session of that choreo: it asks for the files (a file facet), the files go
 * up through the two-step upload into the choreo's Inventory, and the document worker breaks
 * them down into resources. The worker's progress arrives as `activity`/`worker` frames; each
 * one, and the end of the run, refreshes the study.
 */
@Injectable()
export class IngestService {
  private readonly env = inject(APP_ENV);
  private readonly injector = inject(Injector);
  private readonly store = inject(StudyStore);
  private readonly sessions = new Set<LeanScopeSessionService>();
  private readonly _jobs = signal<IngestJob[]>([]);
  private seq = 0;

  readonly jobs = this._jobs.asReadonly();
  readonly busy = computed(() =>
    this._jobs().some((j) => j.state === 'uploading' || j.state === 'reading'),
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      for (const session of this.sessions) session.stop();
    });
  }

  /** The jobs of one zone, newest first. */
  jobsOf(zone: DropZone): IngestJob[] {
    return this._jobs()
      .filter((j) => j.zone === zone)
      .reverse();
  }

  dismiss(id: number): void {
    this._jobs.update((jobs) => jobs.filter((j) => j.id !== id));
  }

  async drop(zone: DropZone, files: File[]): Promise<void> {
    if (files.length === 0) return;
    const id = ++this.seq;
    this._jobs.update((jobs) => [
      ...jobs,
      { id, zone, fileNames: files.map((f) => f.name), state: 'uploading', message: 'Wird hochgeladen …' },
    ]);
    const update = (patch: Partial<IngestJob>) =>
      this._jobs.update((jobs) => jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)));

    const choreo = this.env.ingestChoreoGuid.trim();
    if (!choreo) {
      update({ state: 'error', message: 'APP_INGEST_CHOREO_GUID fehlt in .env.' });
      return;
    }

    const session = createSession(this.injector);
    this.sessions.add(session);
    const offFrames = session.onFrame((frame) => {
      if (frame.event !== 'activity' && frame.event !== 'worker') return;
      const line = progressLine(frame.data);
      if (line) update({ state: 'reading', message: line });
      void this.store.refresh();
    });

    try {
      await session.start({ choreoScenarioGuid: choreo });
      const state = await when(this.injector, session.state, (s) =>
        ['asking', 'ended', 'error'].includes(s),
      );
      const question = session.pendingQuestion();
      if (state !== 'asking' || !question) {
        throw new Error(session.error() ?? 'Die Choreo hat nicht nach einer Datei gefragt.');
      }

      const fields = answerFields(question);
      const fileField = fields.find((f) => f.kind === 'file');
      if (!fileField) throw new Error('Die Choreo fragt nicht nach einer Datei.');
      const refs = files.map((file) => session.parkFile(file));
      const answer: Record<string, unknown> = {
        [fileField.key]: fileField.multiple ? refs : refs[0],
      };
      if (fields.some((f) => f.key === HINT_KEY)) answer[HINT_KEY] = zone;
      if (!(await session.submit(answer))) throw new Error(session.error() ?? 'Nicht angenommen.');

      update({ state: 'reading', message: 'Wird gelesen …' });
      const end = await when(this.injector, session.state, (s) =>
        ['ended', 'error', 'asking'].includes(s),
      );
      const failed = session.uploads().find((u) => u.status === 'error');
      if (end === 'error' || failed) throw new Error(failed?.error ?? session.error() ?? 'Fehler');
      await this.store.refresh();
      update({ state: 'done', message: 'Eingelesen.' });
    } catch (err) {
      update({ state: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      offFrames();
      session.stop();
      this.sessions.delete(session);
    }
  }
}

/** A worker's activity frame carries what an n8n worker would PATCH: `summary` and/or `text`. */
function progressLine(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const { summary, text } = data as { summary?: unknown; text?: unknown };
  const line = typeof text === 'string' && text ? text : typeof summary === 'string' ? summary : '';
  return line.trim();
}
