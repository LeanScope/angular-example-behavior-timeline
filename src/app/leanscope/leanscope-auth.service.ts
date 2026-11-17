import { Injectable, computed, inject, signal } from '@angular/core';
import { LEANSCOPE_CONFIG, LEANSCOPE_FETCH } from './leanscope.config';

/** A signed-in LeanScope user. `accessToken` is the login JWT the agent server takes as Bearer. */
interface AuthSession {
  email: string;
  accessToken: string;
  refreshToken: string;
  /** When `accessToken` runs out, in ms since the epoch. */
  expiresAt: number;
}

const STORAGE_KEY = 'leanscope.auth';
/** Renew a token that runs out within this time, so a request never carries a dying one. */
const RENEW_BEFORE_MS = 60_000;

/**
 * The LeanScope login (Supabase email/password, the same one https://app.leanscope.ai/ uses).
 *
 *   signIn(email, password) → POST <supabaseUrl>/auth/v1/token?grant_type=password
 *   bearer()                → the login JWT for `Authorization: Bearer …`, renewed when it is
 *                             about to run out (…?grant_type=refresh_token)
 *   signOut()               → forgets the login, here and at Supabase
 *
 * The agent server runs a session on its own LLM keys when the signed-in user reaches the
 * repository, so the app holds no secret: the URL and the anon key are public values.
 *
 * The login lives in `sessionStorage`: it survives a reload and ends with the tab.
 */
@Injectable({ providedIn: 'root' })
export class LeanScopeAuthService {
  private readonly config = inject(LEANSCOPE_CONFIG);
  private readonly fetch = inject(LEANSCOPE_FETCH);

  private readonly _session = signal<AuthSession | null>(readStored());
  private renewing: Promise<AuthSession> | null = null;

  readonly signedIn = computed(() => this._session() !== null);
  /** The signed-in user's e-mail address, or ''. */
  readonly email = computed(() => this._session()?.email ?? '');

  /** True when the login is configured (LEANSCOPE_SUPABASE_URL and LEANSCOPE_SUPABASE_ANON_KEY). */
  get configured(): boolean {
    return !!this.config.supabaseUrl?.trim() && !!this.config.supabaseAnonKey?.trim();
  }

  /** Signs in. Throws an `Error` with a message for the user when it fails. */
  async signIn(email: string, password: string): Promise<void> {
    this.store(await this.token('password', { email: email.trim(), password }));
  }

  /** The login JWT, renewed if needed. Throws when nobody is signed in or the login ran out. */
  async bearer(): Promise<string> {
    const session = this._session();
    if (!session) throw new Error('Not signed in.');
    if (session.expiresAt - Date.now() > RENEW_BEFORE_MS) return session.accessToken;
    return (await this.renew(session)).accessToken;
  }

  signOut(): void {
    const session = this._session();
    this.store(null);
    if (!session || !this.configured) return;
    // Best effort: also ends the login at Supabase, so the refresh token is worth nothing.
    void this.fetch(`${this.base()}/logout`, {
      method: 'POST',
      headers: { apikey: this.config.supabaseAnonKey!.trim(), Authorization: `Bearer ${session.accessToken}` },
    }).catch(() => undefined);
  }

  /** One renewal at a time: a used refresh token is not accepted twice. */
  private renew(session: AuthSession): Promise<AuthSession> {
    this.renewing ??= this.token('refresh_token', { refresh_token: session.refreshToken })
      .then((renewed) => {
        this.store(renewed);
        return renewed;
      })
      .catch((err: unknown) => {
        this.store(null);
        throw err;
      })
      .finally(() => (this.renewing = null));
    return this.renewing;
  }

  private async token(grant: 'password' | 'refresh_token', body: Record<string, string>): Promise<AuthSession> {
    if (!this.configured) {
      throw new Error('Missing configuration: LEANSCOPE_SUPABASE_URL and LEANSCOPE_SUPABASE_ANON_KEY in .env.');
    }
    let res: Response;
    try {
      res = await this.fetch(`${this.base()}/token?grant_type=${grant}`, {
        method: 'POST',
        headers: { apikey: this.config.supabaseAnonKey!.trim(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('Could not reach the LeanScope login.');
    }
    const answer = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      user?: { email?: string };
      error_description?: string;
      msg?: string;
    };
    if (!res.ok || !answer.access_token || !answer.refresh_token) {
      throw new Error(answer.error_description ?? answer.msg ?? `Sign-in failed (${res.status}).`);
    }
    return {
      email: answer.user?.email ?? body['email'] ?? this._session()?.email ?? '',
      accessToken: answer.access_token,
      refreshToken: answer.refresh_token,
      expiresAt: Date.now() + (answer.expires_in ?? 3600) * 1000,
    };
  }

  private base(): string {
    return `${this.config.supabaseUrl!.trim().replace(/\/+$/, '')}/auth/v1`;
  }

  private store(session: AuthSession | null): void {
    this._session.set(session);
    try {
      if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // No storage (private mode, blocked): the login then lasts until the next reload.
    }
  }
}

function readStored(): AuthSession | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<AuthSession> | null;
    return stored?.accessToken && stored.refreshToken && typeof stored.expiresAt === 'number'
      ? { email: stored.email ?? '', accessToken: stored.accessToken, refreshToken: stored.refreshToken, expiresAt: stored.expiresAt }
      : null;
  } catch {
    return null;
  }
}
