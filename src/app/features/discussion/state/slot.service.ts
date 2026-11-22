import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { answerFields } from '../../../leanscope/answer-fields';
import { RepositoryResourcesService } from '../../../leanscope/repository-resources.service';
import { GuideService } from '../../guide/guide.service';
import { placeId, slotOf, type CastRole, type PlaceId, type SlotPlace } from '../model/slots';
import { DiscussionUiState, type DiscussionView } from './discussion-ui.state';
import { DiscussionService } from './discussion.service';
import type { DropZone, IngestJob } from './ingest.service';

/** What a place is called in a message to the user. */
const PLACE_LABEL: Record<PlaceId, string> = {
  'study-brief': 'Das Angebot',
  'interview-guide': 'Der Leitfaden',
  screener: 'Der Screener',
  stimulus: 'Die Stimuli',
  moderator: 'Die Moderation',
  participants: 'Die Teilnehmenden',
  director: 'Die Regieanweisung',
};

/** The `CLAIMS` relationships among facets: who claims whom (claiming → dependent). */
const CLAIMS = `query Claims($repositoryId: Int!, $facets: [String!]!) {
  uxmData(repositoryId: $repositoryId) {
    resourceRelationships(where: { predicate: { eq: CLAIMS }, ownerRef: { in: $facets } }) {
      ownerRef
      resourceRef
    }
  }
}`;

interface ClaimsResult {
  uxmData?: { resourceRelationships?: { ownerRef?: string | null; resourceRef?: string | null }[] | null } | null;
}

/** How long to wait for the session to ask again after an undo (ms), and how often to look. */
const UNDO_WAIT_MS = 8000;
const UNDO_POLL_MS = 60;

/** One slot the session has had its answer to, in the order they were given. */
interface SlotAnswer {
  place: SlotPlace;
  /** The answer's field key and the facet that asked for it. */
  key: string;
  facetGuid: string | null;
  /** The question could be left empty (see `askedOptional`). */
  optional: boolean;
  /** What was given: files (with their status line), personas, or nothing (skipped). */
  given: { kind: 'files'; files: File[]; job: number } | { kind: 'cast'; guids: string[] } | { kind: 'skipped' };
}

/** A removal that can't go ahead: answers that rest on the one to remove. */
export interface BlockedRemoval {
  place: PlaceId;
  /** "Der Leitfaden kann nicht entfernt werden, solange die Moderation darauf beruht." */
  message: string;
  /** What "… auch entfernen" would take away too. */
  dependents: PlaceId[];
}

/**
 * The choreo's input slots, answered where the app has a place for them.
 *
 * When the guide's session asks for a slot the app knows (by its key, see `slots.ts`), the
 * app goes there (the "Studie" view for documents, the timeline for the cast and for the director's
 * instruction) and highlights the place until it is answered. A document dropped on its zone
 * answers the slot; one dropped before the session asks for it is held and goes in as soon as it
 * does, without going there.
 *
 * Going back: `remove()` takes an earlier answer away. The session is undone back to the question
 * that asked for it; the answers given after it are held and go in again by themselves, so only
 * what was removed is asked again (and not even that, if it was optional). An answer other
 * answers rest on (`CLAIMS` between their facets) is not removed while those stand: see `blocked`.
 * The answers are known for this visit only: after a reload the files are no longer at hand.
 */
@Injectable()
export class SlotService {
  private readonly discussion = inject(DiscussionService);
  private readonly ui = inject(DiscussionUiState);
  private readonly router = inject(Router);
  private readonly resources = inject(RepositoryResourcesService);
  private readonly guide = inject(GuideService);
  private readonly session = this.discussion.session;

  /** Files dropped before their slot was asked for, by zone. */
  private readonly held = new Map<DropZone, { files: File[]; job: number }>();
  /** The cast to give again when its role is asked for (after going back). */
  private readonly heldCast = new Map<CastRole, string[]>();
  /** Slots to leave empty again when they are asked for (after going back), by key. */
  private readonly skipAgain = new Set<string>();
  private readonly _jobs = signal<IngestJob[]>([]);
  private readonly _log = signal<SlotAnswer[]>([]);
  private readonly _blocked = signal<BlockedRemoval | null>(null);
  private readonly _rewinding = signal(false);
  /** Who claims whom among the facets asked so far; read once per set of facets. */
  private claims: { facets: string; byOwner: Map<string, string[]> } | null = null;
  /** Job ids apart from the ingest service's, as both lists show side by side. */
  private seq = 1_000_000;

  /** The place of the slot the session asks for right now, if the app has one. */
  readonly asked = computed<SlotPlace | null>(() => slotOf(this.session.pendingQuestion()));
  /** What the session said when it asked, for the highlighted place. */
  readonly askedText = computed(() => {
    const question = this.session.pendingQuestion();
    return this.asked() ? (question?.question?.trim() ?? '') : '';
  });
  /**
   * The asked slot can be left empty: its question names no required field (the facet's
   * `required`). The cast is never optional: a discussion needs its people.
   */
  readonly askedOptional = computed(() => {
    const question = this.session.pendingQuestion();
    if (!question || this.asked()?.kind !== 'zone') return false;
    const required = new Set([...question.required, ...(question.schema?.required ?? [])]);
    return keysOf(question).every((key) => !required.has(key));
  });
  /** Status lines of the documents handed to the session, per zone. */
  readonly jobs = this._jobs.asReadonly();
  /** A removal that waits for the user's word, because other answers rest on it. */
  readonly blocked = this._blocked.asReadonly();
  /** The session is being taken back to an earlier question. */
  readonly rewinding = this._rewinding.asReadonly();
  /** The files the session has, per zone (what a zone shows as its own). */
  readonly handed = computed(() => {
    const byZone = new Map<DropZone, File[]>();
    for (const answer of this._log()) {
      if (answer.place.kind === 'zone' && answer.given.kind === 'files') {
        byZone.set(answer.place.zone, answer.given.files);
      }
    }
    return byZone;
  });

  constructor() {
    // Acts once per question: the pending question is read again after every step, and the user
    // may have moved on to another view meanwhile.
    let handled: string | null = null;
    effect(() => {
      const question = this.session.pendingQuestion();
      const place = this.asked();
      // While going back, the questions on the way are passed over: nothing is given again and
      // no place is visited until the session asks for what was removed.
      const rewinding = this._rewinding();
      untracked(() => {
        this.ui.askedPlace.set(place && !rewinding ? placeId(place) : null);
        if (!question || !place || rewinding || question.guid === handled) return;
        handled = question.guid;
        // What is held for this slot goes in without going there.
        if (place.kind === 'zone' && this.held.has(place.zone)) {
          const { files, job } = this.held.get(place.zone)!;
          this.held.delete(place.zone);
          void this.submitFiles(place.zone, files, job);
          return;
        }
        if (place.kind === 'zone' && this.skipAgain.delete(keysOf(question)[0] ?? '')) {
          void this.skip();
          return;
        }
        if (place.kind === 'cast' && this.heldCast.has(place.role)) {
          const guids = this.heldCast.get(place.role)!;
          this.heldCast.delete(place.role);
          void this.submitCast(place.role, guids);
          return;
        }
        this.go(place.kind === 'zone' ? 'study' : 'discussion');
      });
    });
    // Without a session nothing was answered: a new one starts with an empty log.
    effect(() => {
      if (this.session.session() !== null) return;
      untracked(() => this.forget());
    });
  }

  /** Whether drops go to the session (rather than to the ingest choreo). */
  readonly active = computed(() => this.session.session() !== null);

  jobsOf(zone: DropZone): IngestJob[] {
    return this._jobs()
      .filter((j) => j.zone === zone)
      .reverse();
  }

  /**
   * A status line's ×. The line of a file the session has is its answer: taking it away removes
   * the answer (see `remove`). Any other line is only a message.
   */
  dismiss(id: number): void {
    const answer = this._log().find((a) => a.given.kind === 'files' && a.given.job === id);
    if (answer) {
      void this.remove(answer.place);
      return;
    }
    this.dropJob(id);
  }

  /** Files dropped on a zone: they answer its slot now, or as soon as the session asks for it. */
  drop(zone: DropZone, files: File[]): void {
    if (files.length === 0) return;
    const place = this.asked();
    const asked = place?.kind === 'zone' && place.zone === zone;
    // New files for a slot the session already has: the old answer goes first.
    if (!asked && this.answerOf({ kind: 'zone', zone })) {
      void this.remove({ kind: 'zone', zone }).then((removed) => {
        if (!removed) return;
        const now = this.asked();
        if (now?.kind === 'zone' && now.zone === zone) void this.submitFiles(zone, files, this.addJob(zone, files));
        else this.hold(zone, files);
      });
      return;
    }
    if (asked) {
      const previous = this.held.get(zone);
      if (previous) this.dropJob(previous.job);
      void this.submitFiles(zone, files, this.addJob(zone, files));
    } else {
      this.hold(zone, files);
    }
  }

  /** Goes on without the asked, optional document: an empty answer to its question. */
  async skip(): Promise<boolean> {
    const question = this.session.pendingQuestion();
    const place = this.asked();
    if (!question || !place || !this.askedOptional()) return false;
    if (place.kind === 'zone') {
      const held = this.held.get(place.zone);
      if (held) this.dropJob(held.job);
    }
    const answer = this.answerFor(place, { kind: 'skipped' });
    const ok = await this.session.submit({});
    if (ok) this.note(answer);
    return ok;
  }

  /**
   * Answers the asked cast slot and remembers the answer for going back: with the picks on the
   * timeline, or with `guids` (the cast given before going back).
   */
  async submitCast(role: CastRole, guids?: string[]): Promise<boolean> {
    if (guids) {
      this.discussion.castDraft.update((draft) =>
        role === 'moderator'
          ? { moderator: guids[0] ?? null, participants: draft.participants.filter((p) => p !== guids[0]) }
          : { ...draft, participants: guids },
      );
    }
    const draft = this.discussion.castDraft();
    const given = role === 'moderator' ? (draft.moderator ? [draft.moderator] : []) : draft.participants;
    const answer = this.answerFor({ kind: 'cast', role }, { kind: 'cast', guids: [...given] });
    const ok = await this.discussion.submitCast(role);
    if (ok) this.note(answer);
    return ok;
  }

  /**
   * Takes an earlier answer away and lets the session ask from there again.
   *
   * Blocked (false, see `blocked`) while other answers rest on it, unless `withDependents` takes
   * those away too. Otherwise the session is undone back to the earliest removed question; what
   * was answered after it and is kept goes in again by itself.
   */
  async remove(place: SlotPlace, withDependents = false): Promise<boolean> {
    this._blocked.set(null);
    const log = this._log();
    const answer = this.answerOf(place);
    if (!answer) {
      // Not with the session yet: only held for it.
      if (place.kind === 'zone') {
        const held = this.held.get(place.zone);
        if (held) this.dropJob(held.job);
      }
      return true;
    }
    const dependents = await this.dependentsOf(answer, log);
    if (dependents.length && !withDependents) {
      this._blocked.set({
        place: placeId(place),
        dependents: dependents.map((d) => placeId(d.place)),
        message:
          `${PLACE_LABEL[placeId(place)]} kann nicht entfernt werden, solange ` +
          `${listOf(dependents.map((d) => PLACE_LABEL[placeId(d.place)]))} darauf ` +
          `${dependents.length > 1 ? 'beruhen' : 'beruht'}.`,
      });
      return false;
    }
    const removed = new Set<SlotAnswer>([answer, ...dependents]);
    const from = Math.min(...[...removed].map((a) => log.indexOf(a)));
    const target = log[from];
    // What comes after is given again when asked: kept answers as they were, removed optional
    // ones as skipped. A removed required one is simply asked.
    for (const later of log.slice(from)) {
      if (removed.has(later)) {
        if (later.given.kind === 'files') {
          this.dropJob(later.given.job);
          this.guide.noteFiles(placeId(later.place), null);
        }
        if (later.optional) this.skipAgain.add(later.key);
      } else if (later.given.kind === 'files' && later.place.kind === 'zone') {
        this.held.set(later.place.zone, { files: later.given.files, job: later.given.job });
        this.update(later.given.job, { state: 'reading', message: 'Wird erneut übergeben …' });
      } else if (later.given.kind === 'cast' && later.place.kind === 'cast') {
        this.heldCast.set(later.place.role, later.given.guids);
      } else if (later.given.kind === 'skipped') {
        this.skipAgain.add(later.key);
      }
    }
    this._log.set(log.slice(0, from));
    return this.rewindTo(target, log.length - from);
  }

  /** Takes the blocked removal's dependents away too, then what was to be removed. */
  removeWithDependents(): Promise<boolean> {
    const blocked = this._blocked();
    const answer = blocked && this._log().find((a) => placeId(a.place) === blocked.place);
    return answer ? this.remove(answer.place, true) : Promise.resolve(false);
  }

  dismissBlocked(): void {
    this._blocked.set(null);
  }

  // --- Going back ---------------------------------------------------------------------------------

  /**
   * Undoes the session until it asks for `target` again: one undo per answer given since, each
   * awaited until the session asks anew. Stops early when the session can't go back further.
   */
  private async rewindTo(target: SlotAnswer, presses: number): Promise<boolean> {
    this._rewinding.set(true);
    try {
      for (let i = 0; i < presses + 2; i++) {
        if (this.asksFor(target)) return true;
        const before = this.session.pendingQuestion()?.guid ?? null;
        if (!(await this.session.undo())) break;
        if (!(await this.askedAnew(before))) break;
      }
      return this.asksFor(target);
    } finally {
      // The slot effect takes over from the question reached: it gives again what is held.
      this._rewinding.set(false);
    }
  }

  private asksFor(answer: SlotAnswer): boolean {
    const question = this.session.pendingQuestion();
    return !!question && keysOf(question).includes(answer.key);
  }

  /** Resolves true once the session asks a question other than `before`; false after a while. */
  private askedAnew(before: string | null): Promise<boolean> {
    return new Promise((resolve) => {
      const started = Date.now();
      const look = () => {
        const now = this.session.pendingQuestion()?.guid ?? null;
        if (now && now !== before) return resolve(true);
        if (Date.now() - started > UNDO_WAIT_MS || this.session.session() === null) return resolve(false);
        setTimeout(look, UNDO_POLL_MS);
      };
      look();
    });
  }

  /**
   * The answers that rest on `answer`, directly or through others: those whose facet its facet
   * `CLAIMS`. A skipped slot rests on nothing. Without facets, or when the repository can't be
   * read, nothing is known to depend on anything.
   */
  private async dependentsOf(answer: SlotAnswer, log: SlotAnswer[]): Promise<SlotAnswer[]> {
    if (!answer.facetGuid) return [];
    const claims = await this.claimsAmong(log);
    const claimed = new Set<string>();
    const walk = (facet: string) => {
      for (const dependent of claims.get(facet) ?? []) {
        if (claimed.has(dependent)) continue;
        claimed.add(dependent);
        walk(dependent);
      }
    };
    walk(answer.facetGuid);
    return log.filter(
      (a) => a !== answer && a.given.kind !== 'skipped' && !!a.facetGuid && claimed.has(a.facetGuid),
    );
  }

  private async claimsAmong(log: SlotAnswer[]): Promise<Map<string, string[]>> {
    const facets = [...new Set(log.flatMap((a) => (a.facetGuid ? [a.facetGuid] : [])))].sort();
    const key = facets.join(',');
    if (this.claims?.facets === key) return this.claims.byOwner;
    const byOwner = new Map<string, string[]>();
    if (facets.length && this.resources.available) {
      try {
        const data = await this.resources.query<ClaimsResult>(CLAIMS, { facets });
        for (const rr of data.uxmData?.resourceRelationships ?? []) {
          if (!rr.ownerRef || !rr.resourceRef) continue;
          byOwner.set(rr.ownerRef, [...(byOwner.get(rr.ownerRef) ?? []), rr.resourceRef]);
        }
      } catch {
        return byOwner;
      }
    }
    this.claims = { facets: key, byOwner };
    return byOwner;
  }

  // --- Answers ------------------------------------------------------------------------------------

  private answerOf(place: SlotPlace): SlotAnswer | undefined {
    return this._log().find((a) => placeId(a.place) === placeId(place));
  }

  /** The answer about to be given to the pending question (read before it is submitted). */
  private answerFor(place: SlotPlace, given: SlotAnswer['given']): SlotAnswer {
    const question = this.session.pendingQuestion();
    return {
      place,
      key: (question && keysOf(question)[0]) ?? placeId(place),
      facetGuid: question?.facetGuid ?? null,
      optional: this.askedOptional(),
      given,
    };
  }

  private note(answer: SlotAnswer): void {
    if (answer.given.kind === 'files') {
      this.guide.noteFiles(placeId(answer.place), answer.given.files.map((f) => f.name));
    }
    this._log.update((log) => [...log.filter((a) => placeId(a.place) !== placeId(answer.place)), answer]);
  }

  private forget(): void {
    this._log.set([]);
    this.heldCast.clear();
    this.skipAgain.clear();
    this._blocked.set(null);
    this.claims = null;
  }

  private hold(zone: DropZone, files: File[]): void {
    const previous = this.held.get(zone);
    if (previous) this.dropJob(previous.job);
    const job = this.addJob(zone, files);
    this.held.set(zone, { files, job });
    this.update(job, { state: 'reading', message: 'Wird übergeben, sobald danach gefragt wird.' });
  }

  private async submitFiles(zone: DropZone, files: File[], job: number): Promise<void> {
    const question = this.session.pendingQuestion();
    const field = question && answerFields(question).find((f) => f.kind === 'file');
    if (!field) {
      this.update(job, { state: 'error', message: 'Die Frage nimmt keine Datei an.' });
      return;
    }
    this.update(job, { state: 'uploading', message: 'Wird übergeben …' });
    const given = field.multiple ? files : files.slice(0, 1);
    const answer = this.answerFor({ kind: 'zone', zone }, { kind: 'files', files: given, job });
    const refs = given.map((f) => this.session.parkFile(f));
    const ok = await this.session.submit({ [field.key]: field.multiple ? refs : refs[0] });
    this.update(
      job,
      ok
        ? { state: 'done', message: zone === 'interview-guide' ? 'Übergeben – wird eingelesen …' : 'Übergeben.' }
        : { state: 'error', message: this.session.error() ?? 'Nicht angenommen.' },
    );
    if (ok) this.note(answer);
    else if (this.asked()?.kind === 'zone') this.held.set(zone, { files, job });
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

  /** Takes a status line (and whatever is held under it) away. */
  private dropJob(id: number): void {
    this._jobs.update((jobs) => jobs.filter((j) => j.id !== id));
    for (const [zone, held] of this.held) if (held.job === id) this.held.delete(zone);
  }

  /**
   * Replaces the message of the zone's latest handed-over file, e.g. once the repository has read
   * it in ("12 Fragen eingelesen"). Lines still uploading, held or failed are left as they are.
   */
  noteZone(zone: DropZone, message: string): void {
    const job = this._jobs().filter((j) => j.zone === zone && j.state === 'done').at(-1);
    if (job && job.message !== message) this.update(job.id, { message });
  }

  private update(id: number, patch: Partial<IngestJob>): void {
    this._jobs.update((jobs) => jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }
}

/** The field keys a question asks for. */
function keysOf(question: { fieldKeys: string[]; schema?: { properties?: Record<string, unknown> } }): string[] {
  return question.fieldKeys.length ? question.fieldKeys : Object.keys(question.schema?.properties ?? {});
}

/** "die Moderation und die Teilnehmenden", in running text. */
function listOf(labels: string[]): string {
  const lower = labels.map((label) => label.charAt(0).toLowerCase() + label.slice(1));
  return lower.length > 1 ? `${lower.slice(0, -1).join(', ')} und ${lower[lower.length - 1]}` : (lower[0] ?? '');
}
