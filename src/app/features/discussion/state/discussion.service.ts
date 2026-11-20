import {
  Injectable,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { LEANSCOPE_CONFIG } from '../../../leanscope/leanscope.config';
import { GuideService } from '../../guide/guide.service';
import { castFromSession } from '../model/cast';
import { withPortrait } from '../model/portrait-match';
import {
  castFromSlots,
  personaAnswer,
  personaChoices,
  slotOf,
  withRememberedCast,
  type CastRole,
} from '../model/slots';
import { toTranscript } from '../model/transcript-mapper';
import { initialsOf, type Participant, type Transcript } from '../model/study.model';
import { StudyStore } from './study.store';

/** The cast picked on the timeline: held until the session asks for it, then submitted. */
export interface CastDraft {
  moderator: string | null;
  participants: string[];
}

/** A persona of the session's roster, as the timeline's persona menu lists it. */
export interface RosterEntry {
  guid: string;
  name: string;
  initials: string;
  imageUrl?: string;
}

/**
 * The simulated group discussion: the guide's session (see `GuideService`; its first chapter is the
 * configured choreo, LEANSCOPE_CHOREO_SCENARIO_GUID), shown as a transcript on the timeline.
 *
 * Who takes part:
 * - The study's participants (screener), when the study query delivers them.
 * - In a choreo with input slots (it asks for the moderator and the participants), whoever the
 *   answered slots name, or else whoever the Inventory remembers from an earlier chapter. Until
 *   they are answered, whoever the user picked on the timeline. The
 *   choreo's director (who asks for the inputs) speaks in the chat widget, not on the timeline.
 * - Otherwise, e.g. when a recorded choreo is replayed, whoever speaks in the session, named and
 *   portrayed from the session's persona roster (see `castFromSession`).
 */
@Injectable()
export class DiscussionService {
  private readonly store = inject(StudyStore);
  private readonly agentServerUrl = inject(LEANSCOPE_CONFIG).agentServerUrl;
  private readonly guide = inject(GuideService);
  readonly session = this.guide.session;
  /** A recorded discussion shown instead of a live session (demo or imported file). */
  private readonly recorded = signal<Transcript | null>(null);
  /** Speakers that are not participants, by guid (the moderator). */
  private readonly names = signal<Record<string, string>>({});
  private readonly _moderatorImage = signal<string | null>(null);
  private readonly _moderatorColor = signal<string | null>(null);
  /** Personas that asked for an input: the choreo's director(s). */
  private readonly askers = signal<ReadonlySet<string>>(new Set());

  readonly state = this.session.state;
  readonly pendingQuestion = this.session.pendingQuestion;
  readonly error = this.session.error;
  readonly running = computed(() => this.recorded() === null && this.session.isActive());

  /** The cast slot the session asks for right now, if any. */
  readonly askedCast = computed<CastRole | null>(() => {
    const place = slotOf(this.session.pendingQuestion());
    return place?.kind === 'cast' ? place.role : null;
  });
  /**
   * The cast as the session's answered slots name it, or else as the Inventory remembers it.
   * Equal by content: a new step that changes nothing here must not reset the user's picks
   * (`castDraft` follows this signal).
   */
  private readonly slotCast = computed(
    () => withRememberedCast(castFromSlots(this.session.steps()), this.guide.answers(), this.askedCast()),
    { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  );
  /** The session's choreo has input slots this app knows: the cast comes from them. */
  readonly slotted = computed(
    () =>
      this.recorded() === null &&
      (this.slotCast().slotted || slotOf(this.session.pendingQuestion()) !== null),
  );
  /** The picks on the timeline; follows the answered slots whenever they change. */
  readonly castDraft = linkedSignal<CastDraft>(() => {
    const { moderator, participants } = this.slotCast();
    return { moderator, participants };
  });

  /** The session's personas, minus the director(s), with portraits. */
  readonly roster = computed<RosterEntry[]>(() => {
    const askers = this.askers();
    return this.session
      .actors()
      .filter((a) => !askers.has(a.guid))
      .map((a) => this.entry(a.guid));
  });

  /** Who speaks in the live (or attached) session; null while a recording is shown. */
  private readonly cast = computed(() => {
    if (this.recorded()) return null;
    const known = new Set(this.store.participants().map((p) => p.guid));
    return castFromSession(this.session.steps(), this.session.actors(), known);
  });

  /** The study's participants, or else those of the slots, or else the speakers of the session. */
  readonly participants = computed<Participant[]>(() => {
    const fromStudy = this.store.participants();
    if (fromStudy.length > 0) return fromStudy;
    if (this.slotted()) {
      return this.castDraft().participants.map((guid) => {
        const { initials, name, imageUrl } = this.entry(guid);
        return { guid, name, initials, filled: true, ...(imageUrl ? { imageUrl } : {}) };
      });
    }
    // A participant without an image of its own gets one matched from the public catalog.
    return (this.cast()?.participants ?? []).map((p) => withPortrait(this.agentServerUrl, p));
  });

  /** The moderator's persona guid, in a choreo with slots. */
  private readonly slotModerator = computed(() =>
    this.slotted() ? this.castDraft().moderator : null,
  );

  readonly moderatorName = computed(() => {
    const guid = this.slotModerator();
    if (guid) return this.entry(guid).name;
    if (this.slotted()) return 'Moderation';
    return this.cast()?.moderator?.name ?? Object.values(this.names())[0] ?? 'Moderation';
  });
  readonly moderatorImage = computed(() => {
    const guid = this.slotModerator();
    if (guid) return this.entry(guid).imageUrl ?? null;
    if (this.slotted()) return null;
    return this.cast() ? (this.cast()?.moderator?.imageUrl ?? null) : this._moderatorImage();
  });
  /**
   * The moderator persona's colour (for the role badge). Known for a recording only: a session's
   * roster (`actors` frame) carries no colours.
   */
  readonly moderatorColor = computed(() => (this.recorded() ? this._moderatorColor() : null));

  readonly transcript = computed<Transcript>(() => {
    const recorded = this.recorded();
    if (recorded) return recorded;
    const participants = this.participants();
    if (this.slotted()) {
      const moderator = this.slotModerator();
      return toTranscript(this.session.steps(), {
        participants,
        names: moderator ? { [moderator]: this.moderatorName() } : {},
        speakers: new Set([...(moderator ? [moderator] : []), ...participants.map((p) => p.guid)]),
      });
    }
    const moderator = this.cast()?.moderator;
    return toTranscript(this.session.steps(), {
      participants,
      names: moderator ? { ...this.names(), [moderator.guid]: moderator.name } : this.names(),
    });
  });

  constructor() {
    effect(() => {
      const asker = this.session.pendingQuestion()?.askedBy;
      if (asker && !this.askers().has(asker)) this.askers.update((all) => new Set([...all, asker]));
    });
  }

  start(): Promise<void> {
    this.recorded.set(null);
    this.askers.set(new Set());
    return this.guide.start();
  }

  /**
   * Follows a discussion LeanScope started (run-choreo opens the app with `?sessionToken=`) and
   * opens its start gate: opening the window is the user's "start".
   */
  async attach(sessionToken: string): Promise<void> {
    this.recorded.set(null);
    this.askers.set(new Set());
    await this.guide.attach(sessionToken);
  }

  answer(value: Record<string, unknown>): Promise<boolean> {
    return this.session.submit(value);
  }

  // --- Cast on the timeline ----------------------------------------------------------------------

  /** Whether the user can still pick for this role (the session has not got its answer yet). */
  castEditable(role: CastRole): boolean {
    return this.slotted() && !this.slotCast().answered[role];
  }

  /** The personas the user can add for a role: those offered, minus those already cast. */
  castOptions(role: CastRole): RosterEntry[] {
    const { moderator, participants } = this.castDraft();
    const taken = new Set([...(moderator ? [moderator] : []), ...participants]);
    const question = this.askedCast() === role ? this.session.pendingQuestion() : null;
    const offered = personaChoices(question);
    const options = offered
      ? offered.map((o) => this.entry(o.guid, o.label))
      : this.roster();
    return options.filter((o) => !taken.has(o.guid));
  }

  /**
   * Everyone offered for a role, picked or not: the candidates shown while the session asks.
   * A persona already picked stays listed even when the question doesn't offer it.
   */
  castChoices(role: CastRole): (RosterEntry & { picked: boolean })[] {
    const draft = this.castDraft();
    const picked = role === 'moderator' ? (draft.moderator ? [draft.moderator] : []) : draft.participants;
    const question = this.askedCast() === role ? this.session.pendingQuestion() : null;
    const offered = personaChoices(question);
    const base = offered ? offered.map((o) => this.entry(o.guid, o.label)) : this.roster();
    // The moderator does not take part as a participant.
    const listed = role === 'participants' ? base.filter((o) => o.guid !== draft.moderator) : base;
    const known = new Set(listed.map((o) => o.guid));
    const all = [...listed, ...picked.filter((guid) => !known.has(guid)).map((guid) => this.entry(guid))];
    return all.map((o) => ({ ...o, picked: picked.includes(o.guid) }));
  }

  pickModerator(guid: string): void {
    this.castDraft.update((d) => ({
      moderator: guid,
      participants: d.participants.filter((p) => p !== guid),
    }));
  }

  addParticipant(guid: string): void {
    this.castDraft.update((d) =>
      d.participants.includes(guid) ? d : { ...d, participants: [...d.participants, guid] },
    );
  }

  removeParticipant(guid: string): void {
    this.castDraft.update((d) => ({ ...d, participants: d.participants.filter((p) => p !== guid) }));
  }

  /** Answers the asked cast slot with the picks. */
  async submitCast(role: CastRole): Promise<boolean> {
    const question = this.session.pendingQuestion();
    if (!question || this.askedCast() !== role) return false;
    const draft = this.castDraft();
    const guids = role === 'moderator' ? (draft.moderator ? [draft.moderator] : []) : draft.participants;
    if (guids.length === 0) return false;
    return this.session.submit(personaAnswer(question, guids));
  }

  /** Shows a recorded discussion (with its own times) instead of a live session. */
  showRecorded(
    transcript: Transcript,
    moderator: { guid: string; name: string; imageUrl: string | null; color?: string | null },
  ): void {
    this.guide.stop();
    this.names.set({ [moderator.guid]: moderator.name });
    this._moderatorImage.set(moderator.imageUrl);
    this._moderatorColor.set(moderator.color ?? null);
    this.recorded.set(transcript);
  }

  /** Takes the recording away: the timeline shows the live session again (none yet). */
  clearRecorded(): void {
    this.recorded.set(null);
    this.names.set({});
    this._moderatorImage.set(null);
    this._moderatorColor.set(null);
  }

  /** The recording with its turns assigned to the guide the repository gave it. */
  setRecorded(transcript: Transcript): void {
    if (this.recorded()) this.recorded.set(transcript);
  }

  /** The recording's moderator portrait, once the repository has answered. */
  setModeratorImage(url: string | null): void {
    this._moderatorImage.set(url);
  }

  /** The recording's moderator colour, once the repository has answered. */
  setModeratorColor(color: string | null): void {
    this._moderatorColor.set(color);
  }

  /** Name and portrait of a persona of the roster (or the label the question gives it). */
  private entry(guid: string, label?: string): RosterEntry {
    const actor = this.session.actors().find((a) => a.guid === guid);
    const name = actor?.name.trim() || label || 'Unbekannt';
    const portrayed = withPortrait(this.agentServerUrl, {
      guid,
      name,
      initials: initialsOf(name),
      filled: true,
      ...(actor?.imageUrl ? { imageUrl: actor.imageUrl } : {}),
    });
    return {
      guid,
      name,
      initials: portrayed.initials,
      ...(portrayed.imageUrl ? { imageUrl: portrayed.imageUrl } : {}),
    };
  }
}
