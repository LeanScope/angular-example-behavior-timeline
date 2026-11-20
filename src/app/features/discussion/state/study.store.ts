import { Injectable, computed, inject, signal } from '@angular/core';
import { LeanScopeSessionService } from '../../../leanscope/leanscope-session.service';
import { LEANSCOPE_CONFIG } from '../../../leanscope/leanscope.config';
import { APP_ENV } from '../../app-env';
import { withPortrait } from '../model/portrait-match';
import { toStudy, type StudyQueryResult } from '../model/study-mapper';
import { EMPTY_STUDY, type Study, type Stimulus } from '../model/study.model';

const PLACEMENTS_KEY = 'discussion.stimulus-placements';
/** How long a handed-over stimulus sits on the track until the user places it. */
const HANDED_SECONDS = 30;

/**
 * The study as LeanScope holds it: read through the published query "Studie der Choreo" and
 * refreshed whenever the document worker reports progress. Stimulus placements on the timeline
 * are the user's and live in this browser.
 */
@Injectable()
export class StudyStore {
  private readonly env = inject(APP_ENV);
  private readonly agentServerUrl = inject(LEANSCOPE_CONFIG).agentServerUrl;
  // runQuery needs no session of its own: it only uses the server's URL.
  private readonly client = inject(LeanScopeSessionService);

  private readonly _study = signal<Study>(EMPTY_STUDY);
  /** Stimuli handed to the guide's session in this visit (see `showHanded`). */
  private readonly handed = signal<Stimulus[]>([]);
  /** Stimuli of the data basis as the repository keeps it (see `showKept`). */
  private readonly kept = signal<Stimulus[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly placements = signal<Record<string, { start: number; end: number }>>(
    readPlacements(),
  );
  private refreshing: Promise<void> | null = null;
  private refreshAgain = false;

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly study = computed<Study>(() => {
    const study = this._study();
    const placed = this.placements();
    return {
      ...study,
      // A participant without an image of its own gets one matched from the public catalog.
      screener: study.screener && {
        ...study.screener,
        participants: study.screener.participants.map((p) => withPortrait(this.agentServerUrl, p)),
      },
      stimuli: [...study.stimuli, ...(this.handed().length ? this.handed() : this.kept())].map((s) => ({ ...s, ...placed[s.guid] })),
    };
  });
  readonly participants = computed(() => this.study().screener?.participants ?? []);
  readonly guide = computed(() => this.study().guide);
  readonly questions = computed(() => this.guide()?.blocks.flatMap((b) => b.questions) ?? []);

  /**
   * Shows the stimuli handed to the guide's session, straight from the files (the repository
   * does not have them as a study yet). An empty list takes them away again.
   */
  showHanded(files: readonly File[]): void {
    if (files.length === 0 && this.handed().length === 0) return;
    this.handed().forEach((s) => URL.revokeObjectURL(s.url));
    this.handed.set(
      files.map((file, i) => ({
        guid: `handed:${i}:${file.name}`,
        name: file.name.replace(/\.[^.]+$/, ''),
        url: URL.createObjectURL(file),
        mimeType: file.type || 'application/octet-stream',
        start: i * HANDED_SECONDS,
        end: (i + 1) * HANDED_SECONDS,
      })),
    );
  }

  /**
   * Shows the stimuli the repository keeps as the data basis (already read, each with its `url`).
   * They stand in whenever no file handed over in this visit is at hand, e.g. after a reload.
   */
  showKept(stimuli: Stimulus[]): void {
    const still = new Set(stimuli.map((s) => s.url));
    this.kept().forEach((s) => {
      if (!still.has(s.url)) URL.revokeObjectURL(s.url);
    });
    this.kept.set(stimuli);
  }

  /** Shows a given study instead of the repository's (demo mode). */
  load(study: Study): void {
    this._study.set(study);
  }

  /** Reads the study again. Calls never overlap; one more follows if asked for meanwhile. */
  refresh(): Promise<void> {
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    const { studyQueryGuid, ingestChoreoGuid } = this.env;
    if (!studyQueryGuid.trim() || !ingestChoreoGuid.trim()) return Promise.resolve();
    this._loading.set(true);
    this.refreshing = (async () => {
      do {
        this.refreshAgain = false;
        try {
          const data = await this.client.runQuery<StudyQueryResult>(
            studyQueryGuid.trim(),
            ingestChoreoGuid.trim(),
          );
          this._study.set(toStudy(data));
          this._error.set(null);
        } catch (err) {
          this._error.set(err instanceof Error ? err.message : String(err));
        }
      } while (this.refreshAgain);
    })().finally(() => {
      this.refreshing = null;
      this._loading.set(false);
    });
    return this.refreshing;
  }

  placeStimulus(stimulus: Pick<Stimulus, 'guid' | 'start' | 'end'>): void {
    this.placements.update((all) => {
      const next = { ...all, [stimulus.guid]: { start: stimulus.start, end: stimulus.end } };
      writePlacements(next);
      return next;
    });
  }
}

function readPlacements(): Record<string, { start: number; end: number }> {
  try {
    return JSON.parse(localStorage.getItem(PLACEMENTS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writePlacements(value: Record<string, { start: number; end: number }>): void {
  try {
    localStorage.setItem(PLACEMENTS_KEY, JSON.stringify(value));
  } catch {
    // Private mode or blocked storage: placements then last for this visit only.
  }
}
