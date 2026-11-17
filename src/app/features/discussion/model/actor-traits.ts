import type { ParticipantAttribute } from './study.model';

/**
 * An actor's trait in a `.vtt`, named by guids: the value a resource's parameter has on the
 * owner's relationship to that resource. The owner isn't always the actor (a segment hangs on the
 * persona's user role). `value` is the recorded snapshot; a later edit in LeanScope doesn't
 * rewrite the recording. Labels are only YAML comments, never read.
 */
export interface VttParameter {
  ownerRef: string;
  resourceRef: string;
  parameterRef: string;
  value: string;
}

/** "Is the moderator": the Group Role resource's `type` parameter is `Moderator`. */
export const MODERATOR_TRAIT = {
  resourceRef: '7d595441-1788-4c9a-a588-771f2b7a916a', // Group Role
  parameterRef: '99fb64ba-0d1d-4d8a-9634-b7fab68b8379', // type
  value: 'Moderator',
};

/**
 * Which of the given personas the repository makes the moderator: their relationship to the
 * Group Role resource with `type` = `Moderator`. Read when the `.vtt` itself names none, so a
 * recording that carries only `actorRef`s still finds its moderator. Runs on the token's repository.
 */
export const MODERATORS_BY_GUID = `query ModeratorsByGuid($repositoryId: Int!, $guids: [String!]!) {
  uxmData(repositoryId: $repositoryId) {
    resourceRelationships(where: {
      ownerRef: { in: $guids }
      resourceRef: { eq: "${MODERATOR_TRAIT.resourceRef}" }
      parameterOverrides: { any: { parameterRef: { eq: "${MODERATOR_TRAIT.parameterRef}" } } }
    }) {
      ownerRef
      parameterOverrides { parameterRef value }
    }
  }
}`;

/** The owner guids (lower-case) of `MODERATORS_BY_GUID`'s rows whose `type` is `Moderator`. */
export function toModeratorRefs(data: unknown): string[] {
  type Row = { ownerRef?: string | null; parameterOverrides?: { parameterRef?: string | null; value?: unknown }[] | null };
  const rows = (data as { uxmData?: { resourceRelationships?: Row[] | null } } | null)?.uxmData?.resourceRelationships ?? [];
  const refs = rows
    .filter((row) =>
      (row.parameterOverrides ?? []).some(
        (o) =>
          o.parameterRef?.toLowerCase() === MODERATOR_TRAIT.parameterRef &&
          String(o.value ?? '').trim().toLowerCase() === MODERATOR_TRAIT.value.toLowerCase(),
      ),
    )
    .map((row) => row.ownerRef?.trim().toLowerCase() ?? '')
    .filter(Boolean);
  return [...new Set(refs)];
}

/** Traits shown as an attribute in the Steckbrief, by their parameter. */
const ATTRIBUTE_TRAITS = [
  {
    resourceRef: 'bd0db97a-0584-47fc-8621-984dbd103882', // Segment
    parameterRef: '837576b3-1d20-4010-812f-7cc223753819', // sharePercentage
    label: 'segmentSharePercentage',
  },
];

/** The actor's well-formed parameters; anything else in the list is ignored. */
export function parametersOf(raw: unknown): VttParameter[] {
  if (!Array.isArray(raw)) return [];
  const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
  return raw.flatMap((p: Record<string, unknown> | null) => {
    if (!p || typeof p !== 'object') return [];
    const parameter = {
      ownerRef: text(p['ownerRef']).toLowerCase(),
      resourceRef: text(p['resourceRef']).toLowerCase(),
      parameterRef: text(p['parameterRef']).toLowerCase(),
      value: text(p['value']),
    };
    return parameter.resourceRef && parameter.parameterRef ? [parameter] : [];
  });
}

/** True for the moderator's Group Role, or the older `moderator: true`. */
export function isModerator(actor: { moderator?: boolean; parameters?: unknown }): boolean {
  return (
    actor.moderator === true ||
    parametersOf(actor.parameters).some(
      (p) =>
        p.resourceRef === MODERATOR_TRAIT.resourceRef &&
        p.parameterRef === MODERATOR_TRAIT.parameterRef &&
        p.value.toLowerCase() === MODERATOR_TRAIT.value.toLowerCase(),
    )
  );
}

/** The traits the Steckbrief shows, e.g. the segment's share. */
export function traitAttributes(parameters: readonly VttParameter[]): ParticipantAttribute[] {
  return ATTRIBUTE_TRAITS.flatMap((trait) =>
    parameters
      .filter((p) => p.resourceRef === trait.resourceRef && p.parameterRef === trait.parameterRef && p.value)
      .slice(0, 1)
      .map((p) => ({ label: trait.label, value: p.value })),
  );
}
