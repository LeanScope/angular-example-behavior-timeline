import type { Step } from '../../../leanscope/agent-server.types';
import type { Clip, Participant, QuestionBadge, Transcript } from './study.model';

/** Speaking rate used to estimate how long a turn takes. The session has no real timestamps. */
export const WORDS_PER_MINUTE = 150;
const MIN_TURN_SECONDS = 2;
const PAUSE_SECONDS = 0.8;

/** `[q_1a2b3c4d]`: the moderator opens a guide question (instructed in "Moderationsschleife"). */
export const QUESTION_TAG = /\[(q_[0-9a-z]+)\]\s*/gi;

export interface TranscriptOptions {
  participants: Participant[];
  /** Names for speakers that are not participants (the moderator), by guid. */
  names?: Record<string, string>;
  /**
   * Only these speakers get clips, when given. A choreo with a director (its primary actor, who
   * asks for the inputs and steers the discussion) passes the moderator and the participants: the
   * director speaks in the chat widget, not on the timeline.
   */
  speakers?: ReadonlySet<string>;
}

/** Seconds a text takes to say. */
export function speakingSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(MIN_TURN_SECONDS, (words / WORDS_PER_MINUTE) * 60);
}

/**
 * Turns the discussion session's steps into clips on a timeline. Steps of the human (the app
 * user) and steps without text are left out; turns follow each other with a short pause. A turn
 * by someone who is not a participant is the moderator's.
 */
export function toTranscript(steps: Step[], options: TranscriptOptions): Transcript {
  const participants = new Map(options.participants.map((p) => [p.guid, p]));
  const clips: Clip[] = [];
  const badges: QuestionBadge[] = [];
  let time = 0;
  let currentQuestion: string | undefined;

  for (const step of steps) {
    const speakerGuid = step.actorGuid ?? step.actorSymbolRef ?? '';
    if (!speakerGuid || speakerGuid === 'human' || step.pending) continue;
    if (options.speakers && !options.speakers.has(speakerGuid)) continue;
    const raw = (step.line ?? '').trim();
    if (!raw || raw.startsWith('{"kind"')) continue;

    const participant = participants.get(speakerGuid);
    const moderator = !participant;
    let text = raw;
    if (moderator) {
      for (const match of raw.matchAll(QUESTION_TAG)) {
        currentQuestion = match[1].toLowerCase();
        badges.push({ questionKey: currentQuestion, start: time });
      }
      text = raw.replace(QUESTION_TAG, '').trim();
      if (!text) continue;
    }

    const duration = speakingSeconds(text);
    const speakerName = participant?.name ?? options.names?.[speakerGuid] ?? 'Moderation';
    const title = summaryTitle(step.title, speakerName);
    clips.push({
      guid: step.guid,
      speakerGuid,
      speakerName,
      moderator,
      text,
      ...(title ? { title } : {}),
      start: time,
      end: time + duration,
      ...(currentQuestion ? { questionKey: currentQuestion } : {}),
    });
    time += duration + PAUSE_SECONDS;
  }

  return {
    clips,
    badges,
    done: doneQuestions(clips, badges, options.participants),
    duration: clips.at(-1)?.end ?? 0,
  };
}

/** Words shown for a turn that has no summary title (yet). */
const FALLBACK_TITLE_WORDS = 4;

/**
 * The step's summary title, or undefined when there is none. The agent server writes the
 * speaker's name into `title` until the summary arrives (and for choreos without summaries), so a
 * title equal to the speaker's name is not a summary.
 */
export function summaryTitle(title: string | null | undefined, speakerName: string): string | undefined {
  const value = title?.trim();
  if (!value || value.toLowerCase() === speakerName.trim().toLowerCase()) return undefined;
  return value;
}

/** What the "Titel" detail level shows: the summary, else the turn's first words. */
export function clipLabel(clip: Pick<Clip, 'title' | 'text'>): string {
  if (clip.title) return clip.title;
  const words = clip.text.trim().split(/\s+/).filter(Boolean);
  return words.length > FALLBACK_TITLE_WORDS ? `${words.slice(0, FALLBACK_TITLE_WORDS).join(' ')} …` : words.join(' ');
}

/**
 * A question is done when every participant has spoken to it and the moderator has moved on to
 * another question. Without participants, leaving the question is enough.
 */
export function doneQuestions(
  clips: Clip[],
  badges: QuestionBadge[],
  participants: Participant[],
): Set<string> {
  const done = new Set<string>();
  badges.forEach((badge, i) => {
    const next = badges.slice(i + 1).find((b) => b.questionKey !== badge.questionKey);
    if (!next) return;
    const spoke = new Set(
      clips
        .filter((c) => !c.moderator && c.questionKey === badge.questionKey)
        .map((c) => c.speakerGuid),
    );
    if (participants.every((p) => spoke.has(p.guid))) done.add(badge.questionKey);
  });
  return done;
}

/** The clip that is heard at `time` (the last one that started), if any. */
export function clipAt(clips: Clip[], time: number): Clip | undefined {
  let found: Clip | undefined;
  for (const clip of clips) {
    if (clip.start > time) break;
    if (time <= clip.end + PAUSE_SECONDS) found = clip;
  }
  return found;
}

/** The last clip that started at or before `time` (clips sorted by start). */
export function lastTurnBy(clips: Clip[], time: number): Clip | undefined {
  let found: Clip | undefined;
  for (const clip of clips) {
    if (clip.start > time) break;
    found = clip;
  }
  return found;
}

/** The moderator's track id, also what selecting the moderator stores (their guid may vary). */
export const MODERATOR_TRACK = 'moderator';
/** The moderator's role badge, on the timeline and in the Steckbrief. */
export const MODERATOR_ROLE = 'Moderator';

/** The track a clip belongs to: the moderator's, else its speaker's guid. */
export function trackOf(clip: Clip): string {
  return clip.moderator ? MODERATOR_TRACK : clip.speakerGuid;
}

/**
 * Where the cursor goes when a persona is clicked: their turn at `time` if they are speaking,
 * else their next turn after it, else (past their last turn) their first one. `track` is a
 * participant's guid or `MODERATOR_TRACK`.
 */
export function nextTurnOf(clips: Clip[], track: string, time: number): Clip | undefined {
  const own = clips.filter((c) => trackOf(c) === track);
  const now = clipAt(clips, time);
  if (now && trackOf(now) === track) return now;
  return own.find((c) => c.start > time) ?? own[0];
}
