import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { answerFields } from '../../../leanscope/answer-fields';
import { placeId, slotOf, type SlotPlace } from '../model/slots';
import { DiscussionUiState, type DiscussionView } from './discussion-ui.state';
import { DiscussionService } from './discussion.service';
import type { DropZone, IngestJob } from './ingest.service';

/**
 * The choreo's input slots, answered where the app has a place for them.
 *
 * When the discussion session asks for a slot the app knows (by facet guid, see `slots.ts`), the
 * app goes there (the "Studie" view for documents, the timeline for the cast) and highlights the
 * place until it is answered. A document dropped on its zone answers the slot; one dropped before
 * the session asks for it is held and goes in as soon as it does, without going there.
 */
@Injectable()
export class SlotService {
  private readonly discussion = inject(DiscussionService);
  private readonly ui = inject(DiscussionUiState);
  private readonly router = inject(Router);
  private readonly session = this.discussion.session;

  /** Files dropped before their slot was asked for, by zone. */
  private readonly held = new Map<DropZone, { files: File[]; job: number }>();
  private readonly _jobs = signal<IngestJob[]>([]);
  /** Job ids apart from the ingest service's, as both lists show side by side. */
  private seq = 1_000_000;

  /** The place of the slot the session asks for right now, if the app has one. */
  readonly asked = computed<SlotPlace | null>(() => slotOf(this.session.pendingQuestion()));
  /** What the session said when it asked, for the highlighted place. */
  readonly askedText = computed(() => {
    const question = this.session.pendingQuestion();
    return this.asked() ? (question?.question?.trim() ?? '') : '';
  });
  /** Status lines of the documents handed to the session, per zone. */
  readonly jobs = this._jobs.asReadonly();

  constructor() {
    // Acts once per question: the pending question is read again after every step, and the user
    // may have moved on to another view meanwhile.
    let handled: string | null = null;
    effect(() => {
      const question = this.session.pendingQuestion();
      const place = this.asked();
      untracked(() => {
        this.ui.askedPlace.set(place ? placeId(place) : null);
        if (!question || !place || question.guid === handled) return;
        handled = question.guid;
        if (place.kind === 'zone' && this.held.has(place.zone)) {
          const { files, job } = this.held.get(place.zone)!;
          this.held.delete(place.zone);
          void this.submitFiles(place.zone, files, job);
          return;
        }
        this.go(place.kind === 'zone' ? 'study' : 'discussion');
      });
    });
  }

  /** Whether drops go to the session (rather than to the ingest choreo). */
  readonly active = computed(() => this.session.session() !== null);

  jobsOf(zone: DropZone): IngestJob[] {
    return this._jobs()
      .filter((j) => j.zone === zone)
      .reverse();
  }

  dismiss(id: number): void {
    this._jobs.update((jobs) => jobs.filter((j) => j.id !== id));
    for (const [zone, held] of this.held) if (held.job === id) this.held.delete(zone);
  }

  /** Files dropped on a zone: they answer its slot now, or as soon as the session asks for it. */
  drop(zone: DropZone, files: File[]): void {
    if (files.length === 0) return;
    const place = this.asked();
    const previous = this.held.get(zone);
    if (previous) this.dismiss(previous.job);
    const job = this.addJob(zone, files);
    if (place?.kind === 'zone' && place.zone === zone) {
      void this.submitFiles(zone, files, job);
    } else {
      this.held.set(zone, { files, job });
      this.update(job, { state: 'reading', message: 'Wird übergeben, sobald danach gefragt wird.' });
    }
  }

  private async submitFiles(zone: DropZone, files: File[], job: number): Promise<void> {
    const question = this.session.pendingQuestion();
    const field = question && answerFields(question).find((f) => f.kind === 'file');
    if (!field) {
      this.update(job, { state: 'error', message: 'Die Frage nimmt keine Datei an.' });
      return;
    }
    this.update(job, { state: 'uploading', message: 'Wird übergeben …' });
    const refs = (field.multiple ? files : files.slice(0, 1)).map((f) => this.session.parkFile(f));
    const ok = await this.session.submit({ [field.key]: field.multiple ? refs : refs[0] });
    this.update(
      job,
      ok
        ? { state: 'done', message: 'Übergeben.' }
        : { state: 'error', message: this.session.error() ?? 'Nicht angenommen.' },
    );
    if (!ok && this.asked()?.kind === 'zone') this.held.set(zone, { files, job });
  }

  private go(view: DiscussionView): void {
    void this.router.navigate([], {
      queryParams: { view: view === 'study' ? null : view },
      queryParamsHandling: 'merge',
    });
  }

  private addJob(zone: DropZone, files: File[]): number {
    const id = ++this.seq;
    this._jobs.update((jobs) => [
      ...jobs,
      { id, zone, fileNames: files.map((f) => f.name), state: 'uploading', message: '' },
    ]);
    return id;
  }

  private update(id: number, patch: Partial<IngestJob>): void {
    this._jobs.update((jobs) => jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }
}
