import { guideFromMarkdown } from './guide-markdown';
import type { Guide } from './study.model';

/** The resources with the given guids, with their text. Runs on the token's repository. */
export const GUIDE_BY_GUID = `query GuideByGuid($repositoryId: Int!, $guids: [String!]!) {
  uxmData(repositoryId: $repositoryId) {
    resources(where: { _guid: { in: $guids } }) {
      guid: _guid
      line
      description
    }
  }
}`;

/** A row of `GUIDE_BY_GUID`. */
export interface GuideRow {
  guid: string;
  line?: string | null;
  description?: string | null;
}

/**
 * The guide a recording names under `sources`: the first of them whose resource has a text. An
 * `📋 Interview Guide` resource holds its questions as markdown in its `description`
 * (`guideFromMarkdown`). A guide kept as an uploaded file, or as child resources, is not read:
 * such a source gives no guide.
 */
export function toRepositoryGuide(data: unknown, sources: readonly { resourceRef: string; name?: string }[]): Guide | null {
  const rows = (data as { uxmData?: { resources?: GuideRow[] | null } } | null)?.uxmData?.resources ?? [];
  const byGuid = new Map(rows.map((r) => [r.guid.toLowerCase(), r]));
  for (const source of sources) {
    const row = byGuid.get(source.resourceRef.toLowerCase());
    if (!row?.description?.trim()) continue;
    const guide = guideFromMarkdown(source.name?.trim() || row.line?.trim() || 'Leitfaden', row.description);
    if (guide.blocks.length) return guide;
  }
  return null;
}

/**
 * The guide from the sources' own `text`, without a query: a recording read from its repository
 * brings its guide's text along (`RECORDING_BY_GUID`). Null when no source has one with questions.
 */
export function guideFromSources(
  sources: readonly { resourceRef: string; name?: string; text?: string }[],
): Guide | null {
  const resources = sources.map((s) => ({ guid: s.resourceRef, line: s.name, description: s.text }));
  return toRepositoryGuide({ uxmData: { resources } }, sources);
}
