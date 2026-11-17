import type { Participant } from './study.model';

/** Longest query sent to the catalog; the role and demographics come first, so they stay. */
const MAX_QUERY_LENGTH = 240;

/**
 * A URL that answers with a portrait matching the participant, picked by meaning from the agent
 * server's public catalog (`GET /api/v1/resources/public/match?kind=image&q=…`, a 302 to the
 * image). Undefined when the participant says nothing to match on (a stub with a name only).
 */
export function portraitMatchUrl(agentServerUrl: string, p: Participant): string | undefined {
  const base = agentServerUrl.trim().replace(/\/+$/, '');
  const q = [p.role, p.demographics, p.profile]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join('; ')
    .slice(0, MAX_QUERY_LENGTH)
    .trim();
  if (!base || !q) return undefined;
  return `${base}/api/v1/resources/public/match?kind=image&q=${encodeURIComponent(`Portrait: ${q}`)}`;
}

/** The participant with a matched portrait when it has no image of its own. */
export function withPortrait(agentServerUrl: string, p: Participant): Participant {
  if (p.imageUrl) return p;
  const imageUrl = portraitMatchUrl(agentServerUrl, p);
  return imageUrl ? { ...p, imageUrl } : p;
}
