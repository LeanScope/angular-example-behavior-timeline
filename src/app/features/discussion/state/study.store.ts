import { Injectable, computed, inject, signal } from '@angular/core';
import { LeanScopeSessionService } from '../../../leanscope/leanscope-session.service';
import { LEANSCOPE_CONFIG } from '../../../leanscope/leanscope.config';
import { APP_ENV } from '../../app-env';
import { withPortrait } from '../model/portrait-match';
import { toStudy, type StudyQueryResult } from '../model/study-mapper';
import { EMPTY_STUDY, type Study, type Stimulus } from '../model/study.model';

const PLACEMENTS_KEY = 'discussion.stimulus-placements';

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
      stimuli: study.stimuli.map((s) => ({ ...s, ...placed[s.guid] })),
    };
  });
  readonly participants = computed(() => this.study().screener?.participants ?? []);
  readonly guide = computed(() => this.study().guide);
  readonly questions = computed(() => this.guide()?.blocks.flatMap((b) => b.questions) ?? []);

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
