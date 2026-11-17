import type { Step } from './agent-server.types';

/**
 * Browser side of the agent server's two-step file upload (leanscope-agent-server
 * docs/two-step-document-flow.md, mirrored from its ui/src/components/PendingUploadDriver.tsx).
 *
 * 1. Picking a file PARKS it here; the answer carries only `pending://<id>/<filename>`.
 * 2. After the answer is submitted, the engine waits and writes a review line into a step:
 *    `{ "kind": "review", "data": { "files": [{ "ref": "pending://…", "destination"?: "inventory" }] } }`.
 * 3. For each row whose ref is parked here, the bytes go to `POST {controllerUrl}/files?ref=…`
 *    (with `destination=inventory` when the engine asked for it), and the outcome is reported
 *    to `POST {controllerUrl}/steps/<stepGuid>/upload-event`. The engine then continues.
 *
 * Only this flow can store a file durably (in LeanScope, readable by workers and later sessions):
 * the server accepts `destination=inventory` only for a ref the engine announced.
 */

export type UploadStatus = 'parked' | 'uploading' | 'done' | 'error';

export interface UploadState {
  ref: string;
  name: string;
  status: UploadStatus;
  /** The stored file's URL, once `done`. */
  url?: string;
  error?: string;
}

const PREFIX = 'pending://';

export function makePendingRef(id: string, filename: string): string {
  return `${PREFIX}${id}/${encodeURIComponent(filename)}`;
}

export function parsePendingRef(value: unknown): { id: string; filename: string } | null {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return null;
  const rest = value.slice(PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return { id: rest, filename: 'document' };
  return { id: rest.slice(0, slash), filename: decodeURIComponent(rest.slice(slash + 1)) };
}

/** One file row the engine announced in a step's review line. */
export interface AnnouncedUpload {
  stepGuid: string;
  ref: string;
  destination?: 'inventory';
}

/**
 * The file rows in a step's review line. Reading JSON out of `line` is the server's own
 * convention for review lines (its UI does the same, `parseReviewLine`); anything that is not
 * such a line yields nothing.
 */
export function announcedUploads(step: Step): AnnouncedUpload[] {
  if (!step.line || step.line[0] !== '{') return [];
  try {
    const parsed = JSON.parse(step.line) as { kind?: unknown; data?: { files?: unknown } };
    if (parsed?.kind !== 'review' || !Array.isArray(parsed.data?.files)) return [];
    return parsed.data.files.flatMap((row: unknown) => {
      const { ref, destination } = (row ?? {}) as { ref?: unknown; destination?: unknown };
      if (typeof ref !== 'string' || !parsePendingRef(ref)) return [];
      return [
        {
          stepGuid: step.guid,
          ref,
          ...(destination === 'inventory' ? { destination: 'inventory' as const } : {}),
        },
      ];
    });
  } catch {
    return [];
  }
}

/** Parked files of one session, and the transfer of the ones the engine asks for. */
export class PendingUploads {
  private readonly files = new Map<string, File>();
  private readonly handled = new Set<string>();
  private seq = 0;

  constructor(
    private readonly fetchFn: typeof fetch,
    private readonly onChange: (state: UploadState) => void,
  ) {}

  /** Parks `file` and returns the ref to put into the answer. */
  park(file: File): string {
    const id = `${Date.now().toString(36)}-${(this.seq++).toString(36)}`;
    this.files.set(id, file);
    const ref = makePendingRef(id, file.name);
    this.onChange({ ref, name: file.name, status: 'parked' });
    return ref;
  }

  /** Uploads every parked file a step announces. A row is handled once, however often the step updates. */
  drive(step: Step, controllerUrl: string): Promise<void>[] {
    return announcedUploads(step).flatMap((row) => {
      const parsed = parsePendingRef(row.ref);
      const file = parsed ? this.files.get(parsed.id) : undefined;
      const key = `${row.stepGuid}:${row.ref}`;
      if (!file || this.handled.has(key)) return [];
      this.handled.add(key);
      return [this.upload(controllerUrl, row, file)];
    });
  }

  clear(): void {
    this.files.clear();
    this.handled.clear();
  }

  private async upload(controllerUrl: string, row: AnnouncedUpload, file: File): Promise<void> {
    const report = (event: { pct?: number; url?: string; error?: string }) =>
      this.fetchFn(`${controllerUrl}/steps/${encodeURIComponent(row.stepGuid)}/upload-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: row.ref, ...event }),
      }).catch(() => undefined);

    this.onChange({ ref: row.ref, name: file.name, status: 'uploading' });
    await report({ pct: 0 });
    try {
      const query = new URLSearchParams({ ref: row.ref });
      if (row.destination) query.set('destination', row.destination);
      const body = new FormData();
      body.append('file', file, file.name);
      const res = await this.fetchFn(`${controllerUrl}/files?${query}`, { method: 'POST', body });
      const stored = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: { message?: string };
      };
      if (!res.ok || !stored.url) {
        throw new Error(stored.error?.message ?? `upload failed (${res.status})`);
      }
      await report({ url: stored.url });
      const parsed = parsePendingRef(row.ref);
      if (parsed) this.files.delete(parsed.id);
      this.onChange({ ref: row.ref, name: file.name, status: 'done', url: stored.url });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await report({ error: message });
      this.onChange({ ref: row.ref, name: file.name, status: 'error', error: message });
    }
  }
}
