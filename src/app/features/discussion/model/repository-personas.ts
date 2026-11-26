import type { PersonaNode } from './study-mapper';
import type { Participant, Study } from './study.model';

/** The personas with the given guids, with portrait and profile. Runs on the token's repository. */
export const PERSONAS_BY_GUID = `query PersonasByGuid($repositoryId: Int!, $guids: [String!]!) {
  uxmData(repositoryId: $repositoryId) {
    personas(where: { _guid: { in: $guids } }) {
      guid: _guid
      name
      color: backgroundColor
      quote
      primaryRole_ { role }
      image_ { customSizePublicUrls { m } }
      sociodemographicInfo { key description }
      profile { description }
    }
  }
}`;

/** A row of `PERSONAS_BY_GUID`. */
export interface PersonaRow {
  guid: string;
  name?: string | null;
  color?: string | null;
  quote?: string | null;
  primaryRole_?: { role?: string | null } | null;
  image_?: { customSizePublicUrls?: { m?: string | null } | null } | null;
  sociodemographicInfo?: { key?: string | null; description?: string | null }[] | null;
  profile?: { description?: string | null }[] | null;
}

/** The `sociodemographicInfo` keys that make up the short demographics line, in this order. */
const DEMOGRAPHIC_KEYS = ['Age', 'Gender', 'Profession'];

/**
 * The query's answer as personas. The server maps no fields, so it happens here:
 * portrait = `image_.customSizePublicUrls.m`, role = `primaryRole_.role`, demographics = Age,
 * Gender and Profession joined, profile = the profile paragraphs, and the other keyed
 * `sociodemographicInfo` entries become attributes.
 */
export function toRepositoryPersonas(data: unknown): PersonaNode[] {
  const rows = (data as { uxmData?: { personas?: PersonaRow[] | null } } | null)?.uxmData?.personas ?? [];
  return rows.map((row) => {
    const info = (row.sociodemographicInfo ?? [])
      .map((e) => ({ key: e.key?.trim() ?? '', value: e.description?.trim() ?? '' }))
      .filter((e) => e.key && e.value);
    const demographics = DEMOGRAPHIC_KEYS.flatMap((k) => info.filter((e) => e.key === k).map((e) => e.value));
    const profile = (row.profile ?? []).map((p) => p.description?.trim() ?? '').filter(Boolean);
    return {
      guid: row.guid,
      name: row.name ?? null,
      imageUrl: row.image_?.customSizePublicUrls?.m ?? null,
      role: row.primaryRole_?.role ?? null,
      profile: profile.length ? profile.join('\n\n') : null,
      demographics: demographics.length ? demographics.join(', ') : null,
      color: row.color ?? null,
      attributes: info
        .filter((e) => !DEMOGRAPHIC_KEYS.includes(e.key))
        .map((e) => ({ label: e.key, value: e.value })),
    };
  });
}

/**
 * The study with what the repository knows about its participants: portrait, role, profile,
 * demographics, colour. What the recording says itself wins; the repository fills the gaps.
 * Attributes are merged by label, the recording's first.
 */
export function withRepositoryPersonas(study: Study, personas: readonly PersonaNode[]): Study {
  if (!study.screener || !personas.length) return study;
  const byGuid = new Map(personas.map((p) => [p.guid.toLowerCase(), p]));
  return {
    ...study,
    screener: {
      ...study.screener,
      participants: study.screener.participants.map((p) => merge(p, byGuid.get(p.guid.toLowerCase()))),
    },
  };
}

/** The moderator's colour from the repository, unless the recording names one. */
export function repositoryColorOf(
  guid: string,
  own: string | null,
  personas: readonly PersonaNode[],
): string | null {
  return own || personas.find((p) => p.guid.toLowerCase() === guid.toLowerCase())?.color?.trim() || null;
}

/** The persona's primary role (`primaryRole_.role`) from the repository, if it has one. */
export function repositoryRoleOf(guid: string, personas: readonly PersonaNode[]): string | null {
  return personas.find((p) => p.guid.toLowerCase() === guid.toLowerCase())?.role?.trim() || null;
}

/** The moderator's portrait from the repository, unless the recording names one. */
export function repositoryImageOf(
  guid: string,
  own: string | null,
  personas: readonly PersonaNode[],
): string | null {
  return own || personas.find((p) => p.guid.toLowerCase() === guid.toLowerCase())?.imageUrl?.trim() || null;
}

function merge(p: Participant, r: PersonaNode | undefined): Participant {
  if (!r) return p;
  const fill = (own: string | undefined, theirs: string | null | undefined) => own || theirs?.trim() || undefined;
  const labels = new Set((p.attributes ?? []).map((a) => a.label));
  const attributes = [...(p.attributes ?? []), ...(r.attributes ?? []).filter((a) => !labels.has(a.label))];
  const merged: Participant = { ...p };
  const set = <K extends 'imageUrl' | 'role' | 'profile' | 'demographics' | 'color'>(key: K, value: string | undefined) => {
    if (value) merged[key] = value;
  };
  set('imageUrl', fill(p.imageUrl, r.imageUrl));
  set('role', fill(p.role, r.role));
  set('profile', fill(p.profile, r.profile));
  set('demographics', fill(p.demographics, r.demographics));
  set('color', fill(p.color, r.color));
  if (attributes.length) merged.attributes = attributes;
  return merged;
}
