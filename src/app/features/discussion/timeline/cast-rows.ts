import type { CastRole } from '../model/slots';
import type { RosterEntry } from '../state/discussion.service';

/** A persona offered for a cast role, and whether the user has picked it. */
export interface CastChoice extends RosterEntry {
  picked: boolean;
}

/**
 * The cast as the timeline lets the user pick it, in a choreo that asks for its moderator and
 * participants (see `DiscussionService`). Null: the cast is not the user's to pick.
 */
export interface TimelineCast {
  /** The cast slot the session asks for right now. */
  asked: CastRole | null;
  /** What the session said when it asked. */
  question: string;
  /** Roles the user can still change (the session has not got its answer yet). */
  editable: Record<CastRole, boolean>;
  /** The personas the ▾ menu offers per role (before the session asks). */
  options: Record<CastRole, RosterEntry[]>;
  /** Everyone offered per role, picked or not: the rows shown while the session asks. */
  choices: Record<CastRole, CastChoice[]>;
  /** Whether "Übernehmen" has something to send for the asked role. */
  ready: boolean;
}

/** One candidate row in the timeline's head column, while the session asks for a role. */
export interface CastRow extends CastChoice {
  /** The row's track id. A moderator candidate gets one of its own (it may also take part). */
  id: string;
  role: CastRole;
}

/** Track id of a moderator candidate. */
export const candidateId = (guid: string) => `candidate:${guid}`;

/**
 * The candidate rows to show: every persona offered for the role the session asks for, each to
 * tick or untick. Once the role is answered there are none; what was picked stays as its track.
 */
export function castRows(cast: TimelineCast | null): CastRow[] {
  const role = cast?.asked;
  if (!cast || !role) return [];
  return cast.choices[role].map((choice) => ({
    ...choice,
    role,
    id: role === 'moderator' ? candidateId(choice.guid) : choice.guid,
  }));
}

/** What the asked role's row says: the session's question, or what to do. */
export function castHint(cast: TimelineCast | null): string | null {
  const role = cast?.asked;
  if (!cast || !role) return null;
  if (cast.choices[role].length === 0) return 'Personas werden geladen …';
  return (
    cast.question.trim() ||
    (role === 'moderator'
      ? 'Wählen Sie die Moderation und bestätigen Sie mit „Übernehmen“.'
      : 'Wählen Sie die Teilnehmenden und bestätigen Sie mit „Übernehmen“.')
  );
}
