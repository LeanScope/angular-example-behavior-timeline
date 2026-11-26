import type { ActorRef, Step } from '../../../leanscope/agent-server.types';
import { spokenTextOf } from './step-line';
import { initialsOf, type Participant } from './study.model';

/** The moderator of a session, as the timeline and the Steckbrief show it. */
export interface CastModerator {
  guid: string;
  name: string;
  imageUrl: string | null;
}

/** Who speaks in a session: the moderator and the participants, in order of their first turn. */
export interface Cast {
  moderator: CastModerator | null;
  participants: Participant[];
}

/**
 * Who speaks in a session, from its steps and the repository's persona roster (`actors` frame).
 * Used when no study (screener) names the participants, e.g. when a recorded choreo is replayed.
 *
 * - Speakers are the step actors in order of their first turn. Steps of the human (the app user),
 *   pending steps and steps without text don't count, as in `toTranscript`.
 * - The moderator is the first speaker who is not in `known` (the study's participants, if any):
 *   the moderator opens a discussion. Everyone else who speaks is a participant.
 * - Name and portrait come from the roster. A speaker missing from it is named by the step's title.
 */
export function castFromSession(
  steps: Step[],
  actors: ActorRef[],
  known: ReadonlySet<string> = new Set(),
): Cast {
  const roster = new Map(actors.map((a) => [a.guid, a]));
  const seen = new Set<string>();
  let moderator: CastModerator | null = null;
  const participants: Participant[] = [];

  for (const step of steps) {
    const guid = step.actorGuid ?? step.actorSymbolRef ?? '';
    if (!guid || guid === 'human' || step.pending || seen.has(guid)) continue;
    if (!spokenTextOf(step.line)) continue;
    seen.add(guid);

    const actor = roster.get(guid);
    const name = actor?.name.trim() || step.title?.trim() || 'Unbekannt';
    if (!moderator && !known.has(guid)) {
      moderator = { guid, name, imageUrl: actor?.imageUrl ?? null };
      continue;
    }
    if (known.has(guid)) continue;
    participants.push({
      guid,
      name,
      initials: initialsOf(name),
      filled: true,
      ...(actor?.imageUrl ? { imageUrl: actor.imageUrl } : {}),
    });
  }

  return { moderator, participants };
}
