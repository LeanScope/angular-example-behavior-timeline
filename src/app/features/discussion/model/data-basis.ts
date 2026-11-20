import type { DropZone } from '../state/ingest.service';

/**
 * The data basis as the repository keeps it: the answers the guide's first choreo stored in its
 * 🍱 Inventory (one `🔤 Input` resource per declared slot, its files as `fileRefs`). This is what
 * outlives the session, so it is what a reload, or the next choreo, shows.
 */

/** The choreo's Inventory answers: each Input with its parameters (the answer) and its files. */
export const DATA_BASIS = `query DataBasis($repositoryId: Int!, $choreo: String!) {
  uxmData(repositoryId: $repositoryId) {
    scenarios(where: { _guid: { eq: $choreo } }) {
      resourceRelationships_ {
        resource_ {
          resourceRelationships_(where: { predicate: { eq: HAS } }) {
            resource_ {
              guid: _guid
              fileRefs
              parameters { key value }
            }
          }
        }
      }
    }
  }
}`;

/** Name and type of the files an answer holds. */
export const DATA_BASIS_FILES = `query DataBasisFiles($repositoryId: Int!, $guids: [String!]!) {
  uxmData(repositoryId: $repositoryId) {
    files(where: { _guid: { in: $guids } }) {
      guid: _guid
      name
      mimeType
    }
  }
}`;

interface InputRow {
  guid?: string | null;
  fileRefs?: (string | null)[] | null;
  parameters?: { key?: string | null; value?: string | null }[] | null;
}

export interface DataBasisResult {
  uxmData?: {
    scenarios?:
      | {
          resourceRelationships_?:
            | { resource_?: { resourceRelationships_?: { resource_?: InputRow | null }[] | null } | null }[]
            | null;
        }[]
      | null;
  } | null;
}

export interface DataBasisFilesResult {
  uxmData?: { files?: { guid?: string | null; name?: string | null; mimeType?: string | null }[] | null } | null;
}

/** A file of the data basis: read through the Input resource that holds it. */
export interface BasisFile {
  resourceRef: string;
  fileRef: string;
  name: string;
  mimeType: string;
}

/** The documents the data basis holds, by the zone they were handed over at. */
export type DataBasis = Partial<Record<DropZone, BasisFile[]>>;

/** The zone of a document slot, by its field key. */
const ZONE_OF_KEY: Record<string, DropZone> = {
  brief: 'study-brief',
  document: 'interview-guide',
  screener: 'screener',
  stimuli: 'stimulus',
};

/** The file refs of the stored answers, by zone (names and types follow from `withFileNames`). */
export function toDataBasis(data: DataBasisResult): DataBasis {
  const basis: DataBasis = {};
  const inputs = (data.uxmData?.scenarios ?? [])
    .flatMap((scenario) => scenario.resourceRelationships_ ?? [])
    .flatMap((attached) => attached.resource_?.resourceRelationships_ ?? [])
    .flatMap((held) => (held.resource_ ? [held.resource_] : []));
  for (const input of inputs) {
    // A list answer's parameters are `<key>[<index>]`; a single one's is the key itself.
    const key = (input.parameters ?? []).map((p) => (p.key ?? '').replace(/\[.*$/, '')).find((k) => k in ZONE_OF_KEY);
    const files = (input.fileRefs ?? []).filter((ref): ref is string => !!ref);
    if (!key || !input.guid || files.length === 0) continue;
    basis[ZONE_OF_KEY[key]] = files.map((fileRef) => ({
      resourceRef: input.guid!,
      fileRef,
      name: '',
      mimeType: '',
    }));
  }
  return basis;
}

/** Every file ref of a data basis. */
export function basisFileRefs(basis: DataBasis): string[] {
  return Object.values(basis).flatMap((files) => (files ?? []).map((f) => f.fileRef));
}

/** The data basis with each file's name and type filled in. */
export function withFileNames(basis: DataBasis, data: DataBasisFilesResult): DataBasis {
  const known = new Map((data.uxmData?.files ?? []).map((f) => [f.guid ?? '', f]));
  const named: DataBasis = {};
  for (const [zone, files] of Object.entries(basis) as [DropZone, BasisFile[]][]) {
    named[zone] = files.map((file) => {
      const found = known.get(file.fileRef);
      return { ...file, name: found?.name?.trim() || 'Datei', mimeType: found?.mimeType?.trim() ?? '' };
    });
  }
  return named;
}
