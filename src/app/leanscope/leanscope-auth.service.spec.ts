import { TestBed } from '@angular/core/testing';
import { LEANSCOPE_CONFIG, LEANSCOPE_FETCH, type LeanScopeConfig } from './leanscope.config';
import { LeanScopeAuthService } from './leanscope-auth.service';

const LOGIN = 'https://login.example';

const config: LeanScopeConfig = {
  agentServerUrl: 'https://agents.example',
  choreoScenarioGuid: 'choreo-1',
  repositoryId: '42',
  supabaseUrl: `${LOGIN}/`,
  supabaseAnonKey: 'anon',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function setup(respond: (url: string, body: Record<string, string>) => Response, cfg = config) {
  const calls: { url: string; apikey?: string; body: Record<string, string> }[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, string>) : {};
    calls.push({ url: String(input), apikey: (init?.headers as Record<string, string>)?.['apikey'], body });
    return respond(String(input), body);
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: LEANSCOPE_CONFIG, useValue: cfg },
      { provide: LEANSCOPE_FETCH, useValue: fetchFn },
    ],
  });
  return { calls, auth: TestBed.inject(LeanScopeAuthService) };
}

const tokens = (name: string, expiresIn = 3600) =>
  json({ access_token: `jwt-${name}`, refresh_token: `refresh-${name}`, expires_in: expiresIn, user: { email: 'a@b.de' } });

describe('LeanScopeAuthService', () => {
  beforeEach(() => sessionStorage.clear());

  it('signs in with e-mail and password and hands out the login as bearer', async () => {
    const { auth, calls } = setup(() => tokens('1'));
    expect(auth.signedIn()).toBe(false);

    await auth.signIn(' a@b.de ', 'pw');

    expect(calls[0]).toEqual({
      url: `${LOGIN}/auth/v1/token?grant_type=password`,
      apikey: 'anon',
      body: { email: 'a@b.de', password: 'pw' },
    });
    expect(auth.signedIn()).toBe(true);
    expect(auth.email()).toBe('a@b.de');
    expect(await auth.bearer()).toBe('jwt-1');
    expect(calls.length).toBe(1);
  });

  it('says why a sign-in failed and stays signed out', async () => {
    const { auth } = setup(() => json({ error_description: 'Invalid login credentials' }, 400));
    await expect(auth.signIn('a@b.de', 'wrong')).rejects.toThrow('Invalid login credentials');
    expect(auth.signedIn()).toBe(false);
  });

  it('renews a login that is about to run out, once for parallel callers', async () => {
    const { auth, calls } = setup((url) => tokens(url.includes('refresh_token') ? '2' : '1', url.includes('refresh_token') ? 3600 : 30));
    await auth.signIn('a@b.de', 'pw');

    expect(await Promise.all([auth.bearer(), auth.bearer()])).toEqual(['jwt-2', 'jwt-2']);
    expect(calls.map((c) => c.url)).toEqual([
      `${LOGIN}/auth/v1/token?grant_type=password`,
      `${LOGIN}/auth/v1/token?grant_type=refresh_token`,
    ]);
    expect(calls[1].body).toEqual({ refresh_token: 'refresh-1' });
  });

  it('signs out when the login can no longer be renewed', async () => {
    const { auth } = setup((url) => (url.includes('refresh_token') ? json({ msg: 'Invalid Refresh Token' }, 400) : tokens('1', 30)));
    await auth.signIn('a@b.de', 'pw');
    await expect(auth.bearer()).rejects.toThrow('Invalid Refresh Token');
    expect(auth.signedIn()).toBe(false);
  });

  it('keeps the login over a reload and forgets it on sign-out', async () => {
    const first = setup(() => tokens('1'));
    await first.auth.signIn('a@b.de', 'pw');
    TestBed.resetTestingModule();

    const { auth } = setup(() => json({}));
    expect(auth.signedIn()).toBe(true);
    auth.signOut();
    expect(auth.signedIn()).toBe(false);
    expect(sessionStorage.length).toBe(0);
    await expect(auth.bearer()).rejects.toThrow('Not signed in');
  });

  it('does not call anything while the login is not configured', async () => {
    const { auth, calls } = setup(() => tokens('1'), { ...config, supabaseUrl: '' });
    expect(auth.configured).toBe(false);
    await expect(auth.signIn('a@b.de', 'pw')).rejects.toThrow('LEANSCOPE_SUPABASE_URL');
    expect(calls.length).toBe(0);
  });
});
