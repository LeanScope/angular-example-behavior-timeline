import type {
  AnswerPropertySchema,
  PendingQuestion,
  Step,
} from '../../../leanscope/agent-server.types';
import type { DropZone } from '../state/ingest.service';

/** Who the cast slots fill. */
export type CastRole = 'moderator' | 'participants';

/**
 * Where an input slot of the guide's choreos is answered in this app: a drop zone of the
 * "Studie" view, a track head of the timeline, or the timeline's director track (the instruction
 * for the next turn).
 */
export type SlotPlace =
  | { kind: 'zone'; zone: DropZone }
  | { kind: 'cast'; role: CastRole }
  | { kind: 'director' };

/** The place's id, as `DiscussionUiState.askedPlace` holds it. */
export type PlaceId = DropZone | CastRole | 'director';

export const placeId = (place: SlotPlace): PlaceId =>
  place.kind === 'zone' ? place.zone : place.kind === 'cast' ? place.role : 'director';

/** The field key of a director instruction (the facet "Instruction"). */
export const INSTRUCTION_KEY = 'innerVoice';

/**
 * The slots this app has a place for, by their key: the field key of the answer, as the facet's
 * `key` (or the override on its relationship) names it. Not by facet guid: one facet (e.g.
 * "Document" or "LeanScope Entity Ref") can back several slots with different key overrides, so
 * only the key tells them apart. Keys are unique within the choreos this app is built for.
 */
const SLOTS: Record<string, SlotPlace> = {
  brief: { kind: 'zone', zone: 'study-brief' },
  document: { kind: 'zone', zone: 'interview-guide' },
  screener: { kind: 'zone', zone: 'screener' },
  stimuli: { kind: 'zone', zone: 'stimulus' },
  moderator: { kind: 'cast', role: 'moderator' },
  participants: { kind: 'cast', role: 'participants' },
};

/**
 * The place of a form with these keys, or null: a single-field form by its key, and the director's
 * form (speaker, instruction, …) by its instruction field, whatever else it asks for.
 */
function placeOfKeys(keys: string[]): SlotPlace | null {
  if (keys.includes(INSTRUCTION_KEY)) return { kind: 'director' };
  return keys.length === 1 ? (SLOTS[keys[0]] ?? null) : null;
}

/** The place of the slot a question asks for, or null when the app has none for it. */
export function slotOf(question: PendingQuestion | null): SlotPlace | null {
  if (!question) return null;
  return placeOfKeys(
    question.fieldKeys.length ? question.fieldKeys : Object.keys(question.schema?.properties ?? {}),
  );
}

/**
 * The place of a recorded step's slot: from the form it asked (its `questions` envelope), so a
 * step counts as soon as it asks, before it is answered.
 */
function placeOfStep(step: Step): SlotPlace | null {
  if (!step.questions?.includes('tool_input_schema')) return null;
  try {
    const envelope = JSON.parse(step.questions) as {
      type?: unknown;
      schema?: { properties?: Record<string, unknown> };
    };
    if (envelope.type !== 'tool_input_schema') return null;
    return placeOfKeys(Object.keys(envelope.schema?.properties ?? {}));
  } catch {
    return null;
  }
}

// --- Cast slots --------------------------------------------------------------------------------

/** A persona the user can pick for a cast slot. */
export interface PersonaChoice {
  guid: string;
  label?: string;
}

/** The field of a cast question and the shape of one picked persona in it. */
interface PersonaField {
  key: string;
  multiple: boolean;
  /** The key of the persona guid when one pick is an object (an entity ref), else null. */
  guidKey: string | null;
  leaf: AnswerPropertySchema;
}

function personaField(question: PendingQuestion): PersonaField | null {
  const properties = question.schema?.properties ?? {};
  const key = question.fieldKeys[0] ?? Object.keys(properties)[0];
  const property = key ? properties[key] : undefined;
  if (!key || !property) return null;
  const multiple = property.type === 'array' && !!property.items;
  const leaf = (multiple ? property.items : property) as AnswerPropertySchema;
  const nested = leaf['properties'] as Record<string, AnswerPropertySchema> | undefined;
  const guidKey =
    leaf.type === 'object' && nested
      ? (Object.entries(nested).find(([k, p]) => p.format === 'uuid' || k === '_guid')?.[0] ?? null)
      : null;
  return { key, multiple, guidKey, leaf };
}

/** The personas a cast question offers, when its schema lists them (else any persona). */
export function personaChoices(question: PendingQuestion | null): PersonaChoice[] | null {
  const field = question && personaField(question);
  if (!field) return null;
  const leaf = field.guidKey
    ? (field.leaf['properties'] as Record<string, AnswerPropertySchema>)[field.guidKey]
    : field.leaf;
  if (Array.isArray(leaf.enum)) return leaf.enum.map((v) => ({ guid: String(v) }));
  const options = leaf.oneOf ?? leaf.anyOf;
  if (Array.isArray(options) && options.length && options.every((o) => 'const' in o)) {
    return options.map((o) => ({ guid: String(o.const), ...(o.title ? { label: o.title } : {}) }));
  }
  return null;
}

/** The answer that names these personas, shaped as the cast question's schema wants it. */
export function personaAnswer(question: PendingQuestion, guids: string[]): Record<string, unknown> {
  const field = personaField(question);
  if (!field) throw new Error('Die Frage nennt kein Feld für die Personas.');
  const one = (guid: string) => (field.guidKey ? { [field.guidKey]: guid } : guid);
  return { [field.key]: field.multiple ? guids.map(one) : one(guids[0] ?? '') };
}

// --- Cast from the answered slots --------------------------------------------------------------

/** The cast as the session's answered slots name it. */
export interface SlotCast {
  /** True once the session asked for any slot this app knows: the cast comes from the slots. */
  slotted: boolean;
  moderator: string | null;
  participants: string[];
  answered: Record<CastRole, boolean>;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Every guid in an answer value, in order (strings, arrays and entity-ref objects). A string may
 * hold the guid as JSON (the Inventory stores `"\"<guid>\""`), so guids are found inside it.
 */
function guidsIn(value: unknown): string[] {
  if (typeof value === 'string') return value.match(UUID) ?? [];
  if (Array.isArray(value)) return value.flatMap(guidsIn);
  if (value && typeof value === 'object') return Object.values(value).flatMap(guidsIn);
  return [];
}

/**
 * The moderator and the participants as the session's answered cast slots name them. Anyone else
 * who speaks directs the choreo (its primary actor) and gets no track.
 */
export function castFromSlots(steps: Step[]): SlotCast {
  const cast: SlotCast = {
    slotted: false,
    moderator: null,
    participants: [],
    answered: { moderator: false, participants: false },
  };
  for (const step of steps) {
    const line = (step.line ?? '').trim();
    let answer: Record<string, unknown> | null = null;
    if (!step.pending && line.startsWith('{')) {
      try {
        answer = JSON.parse(line) as Record<string, unknown>;
      } catch {
        answer = null;
      }
    }
    // The form the step asked names the slot; else (a bare leaf schema) the answer's own key.
    const place =
      placeOfStep(step) ??
      (answer && step.questions?.includes('tool_input_schema') ? placeOfKeys(Object.keys(answer)) : null);
    if (!place) continue;
    cast.slotted = true;
    if (place.kind !== 'cast' || !answer) continue;
    const guids = guidsIn(answer);
    cast.answered[place.role] = true;
    if (place.role === 'moderator') cast.moderator = guids[0] ?? null;
    else cast.participants = [...new Set(guids)];
  }
  return cast;
}

/**
 * The cast with the roles the session's own steps don't answer taken from the Inventory's
 * remembered answers (`moderator`, `participants`): a later chapter of the guide asks for neither
 * again. A role the session asks for right now (`asked`) stays open, whatever is remembered.
 */
export function withRememberedCast(
  cast: SlotCast,
  answers: Record<string, unknown[]>,
  asked: CastRole | null,
): SlotCast {
  const moderator = guidsIn(answers['moderator'])[0] ?? null;
  const participants = [...new Set(guidsIn(answers['participants']))];
  const fill = (role: CastRole, known: boolean) => known && !cast.answered[role] && asked !== role;
  const fillModerator = fill('moderator', moderator !== null);
  const fillParticipants = fill('participants', participants.length > 0);
  if (!fillModerator && !fillParticipants) return cast;
  return {
    slotted: true,
    moderator: fillModerator ? moderator : cast.moderator,
    participants: fillParticipants ? participants : cast.participants,
    answered: {
      moderator: cast.answered.moderator || fillModerator,
      participants: cast.answered.participants || fillParticipants,
    },
  };
}
