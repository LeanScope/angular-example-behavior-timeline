import { Injectable, inject } from '@angular/core';
import { LEANSCOPE_CONFIG, LEANSCOPE_FETCH } from './leanscope.config';
import { LeanScopeAuthService } from './leanscope-auth.service';

/**
 * Reads the configured repository (LEANSCOPE_REPOSITORY_ID) as the signed-in user, without a
 * session. Every call carries the login JWT as Bearer and `?repositoryId=<id>`, because a login
 * names no repository (see the agent server's tasks/todo-login-jwt-repository-reads.md):
 *
 *   query(document, variables)  → POST /api/v1/queries               (Bearer)
 *                                 The caller's own read query, run against that
 *                                 repository. It declares `$repositoryId: Int!`; the server
 *                                 fills it in. Only `query` operations run. Returns the GraphQL
 *                                 `data` as is; the caller maps the fields.
 *   file(resource, file)        → GET /api/v1/resources/<resourceGuid>/files/<fileGuid>
 *                                 (Bearer) → a blob URL and the file's MIME type (the
 *                                 response's `Content-Type`). A file is reached through the
 *                                 resource that lists it in its `fileRefs`.
 *   fileUrl(resource, file)     → the same, the blob URL only.
 *
 * Unlike `LeanScopeSessionService.runQuery` (a published query, by guid), this needs no session
 * of the choreo to have run on the server.
 *
 * Private files can't be an `<img src>` (an image request sends no Bearer), so a file is fetched
 * with it and handed out as a blob URL. Revoke it with `URL.revokeObjectURL` when it is
 * no longer shown.
 */
/** A fetched file: a blob URL to show it, and its own MIME type ('' when the server names none). */
export interface RepositoryFile {
  url: string;
  mimeType: string;
}

@Injectable({ providedIn: 'root' })
export class RepositoryResourcesService {
  private readonly config = inject(LEANSCOPE_CONFIG);
  private readonly fetch = inject(LEANSCOPE_FETCH);
  private readonly auth = inject(LeanScopeAuthService);

  /** True when a user is signed in and a repository is configured, so the reads can be tried. */
  get available(): boolean {
    return this.auth.signedIn() && !!this.config.repositoryId?.trim() && !!this.config.agentServerUrl.trim();
  }

  async query<T = unknown>(document: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await this.call('queries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: document, variables }),
    });
    const body = (await res.json()) as { data?: T; errors?: { message?: string }[] };
    if (body.errors?.length) throw new Error(body.errors.map((e) => e.message ?? 'unknown error').join('; '));
    return body.data as T;
  }

  async file(resourceGuid: string, fileGuid: string): Promise<RepositoryFile> {
    const res = await this.call(
      `resources/${encodeURIComponent(resourceGuid.trim())}/files/${encodeURIComponent(fileGuid.trim())}`,
    );
    const blob = await res.blob();
    // "image/png; charset=…" → "image/png"
    return { url: URL.createObjectURL(blob), mimeType: blob.type.split(';')[0].trim().toLowerCase() };
  }

  async fileUrl(resourceGuid: string, fileGuid: string): Promise<string> {
    return (await this.file(resourceGuid, fileGuid)).url;
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const base = this.config.agentServerUrl.replace(/\/+$/, '');
    const bearer = await this.auth.bearer();
    const repository = encodeURIComponent(this.config.repositoryId.trim());
    const res = await this.fetch(`${base}/api/v1/${path}?repositoryId=${repository}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${bearer}` },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`The repository did not answer (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }
    return res;
  }
}
