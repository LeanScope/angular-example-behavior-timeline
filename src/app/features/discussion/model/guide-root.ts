/**
 * Where the agent server's hosted 📋 interview-guide worker writes an uploaded Leitfaden: a root
 * resource whose guid is derived from the choreo's 🍱 Inventory and the field key the document is
 * kept under, so every session uploading into the same slot lands on the same root.
 *
 * Mirrors `stableGuid` (`leanscope-agent-server/src/shared/graphql/stable-guid.ts`) and
 * `guideRootGuid` (`src/workers/interview-guide/interview-guide-graph.ts`) byte for byte: the
 * first 128 bits of SHA-1("<kind>:<ref>"), with version 5 and the RFC 4122 variant set.
 */

/** The 🍱 Inventory type: the scenario-attached resource that IS it is the choreo's Inventory. */
export const INVENTORY_TYPE_GUID = '4b9b0347-8cfa-4cb2-a185-7516ab10f566';

/** The field key the Leitfaden is uploaded under (the `document` slot). */
export const GUIDE_FIELD_KEY = 'document';

export async function stableGuid(kind: string, ref: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${kind}:${ref}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes));
  const h = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `5${h.slice(13, 16)}`,
    ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + h.slice(18, 20),
    h.slice(20, 32),
  ].join('-');
}

/** The guid of the guide root the worker writes for this Inventory and field key. */
export function guideRootGuid(inventoryGuid: string, fieldKey = GUIDE_FIELD_KEY): Promise<string> {
  return stableGuid('guide-root', `${inventoryGuid}:${fieldKey}`);
}
