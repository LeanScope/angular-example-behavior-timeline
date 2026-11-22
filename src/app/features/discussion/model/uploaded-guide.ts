import { INVENTORY_TYPE_GUID } from './guide-root';
import { toGuide, type ChildNode } from './study-mapper';
import type { Guide } from './study.model';

/**
 * The Leitfaden uploaded into the choreo's `document` slot, as the agent server's hosted
 * interview-guide worker breaks it down:
 *
 *   📋 <file> ─HAS (listIndex)→ question ─IS→ ❔ Interview Question {key q_…}
 *
 * Each question's `line` is the question, its `description` the section heading path. The root's
 * guid follows from the Inventory (`guideRootGuid`), so it is read by guid, not searched for.
 */

/** The resources attached to the choreo, with their types: the one that IS 🍱 Inventory. */
export const CHOREO_INVENTORY = `query ChoreoInventory($repositoryId: Int!, $choreo: String!) {
  uxmData(repositoryId: $repositoryId) {
    scenarios(where: { _guid: { eq: $choreo } }) {
      resourceRelationships_ {
        resource_ {
          guid: _guid
          resourceRelationships_(where: { predicate: { eq: IS } }) { resourceRef }
        }
      }
    }
  }
}`;

/** The guide root with its questions, in `listIndex` order. */
export const GUIDE_GRAPH_BY_ROOT = `query GuideGraphByRoot($repositoryId: Int!, $root: String!) {
  uxmData(repositoryId: $repositoryId) {
    resources(where: { _guid: { eq: $root } }) {
      guid: _guid
      line
      resourceRelationships_(where: { predicate: { eq: HAS } }, orderBy: [{ listIndex: ASC_NUMERIC }]) {
        listIndex
        resource_ {
          guid: _guid
          line
          description
          resourceRelationships_(where: { predicate: { eq: IS } }) {
            parameters_(where: { key: { eq: "key" } }) { value }
          }
        }
      }
    }
  }
}`;

export interface ChoreoInventoryResult {
  uxmData?: {
    scenarios?:
      | {
          resourceRelationships_?:
            | { resource_?: { guid?: string | null; resourceRelationships_?: { resourceRef?: string | null }[] | null } | null }[]
            | null;
        }[]
      | null;
  } | null;
}

interface QuestionRow {
  guid?: string | null;
  line?: string | null;
  description?: string | null;
  resourceRelationships_?: { parameters_?: { value?: string | null }[] | null }[] | null;
}

export interface GuideGraphResult {
  uxmData?: {
    resources?:
      | {
          guid?: string | null;
          line?: string | null;
          resourceRelationships_?: { listIndex?: number | null; resource_?: QuestionRow | null }[] | null;
        }[]
      | null;
  } | null;
}

/** The guid of the choreo's 🍱 Inventory, or null when it has none. */
export function toInventoryGuid(data: ChoreoInventoryResult | null | undefined): string | null {
  const attached = (data?.uxmData?.scenarios ?? []).flatMap((s) => s.resourceRelationships_ ?? []);
  for (const rel of attached) {
    const resource = rel.resource_;
    const isInventory = (resource?.resourceRelationships_ ?? []).some(
      (is) => is.resourceRef?.toLowerCase() === INVENTORY_TYPE_GUID,
    );
    if (resource?.guid && isInventory) return resource.guid;
  }
  return null;
}

/**
 * The uploaded guide, or null when the worker has not written one (yet), or wrote no questions.
 * The blocks and their timing follow from the section headings, as for any guide (`toGuide`).
 */
export function toUploadedGuide(data: GuideGraphResult | null | undefined): Guide | null {
  const root = data?.uxmData?.resources?.[0];
  if (!root?.guid) return null;
  const children: ChildNode[] = (root.resourceRelationships_ ?? []).flatMap((has, i) => {
    const q = has.resource_;
    if (!q?.guid || !q.line?.trim()) return [];
    const key = (q.resourceRelationships_ ?? [])
      .flatMap((is) => is.parameters_ ?? [])
      .map((p) => p.value?.trim())
      .find((v): v is string => !!v);
    return [
      {
        guid: q.guid,
        kind: 'question',
        key: key ?? null,
        line: q.line,
        description: q.description ?? null,
        listIndex: has.listIndex ?? i,
      },
    ];
  });
  if (children.length === 0) return null;
  const guide = toGuide({ guid: root.guid, line: root.line, children });
  return guide.blocks.length ? guide : null;
}
