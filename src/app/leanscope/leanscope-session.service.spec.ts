import { TestBed } from '@angular/core/testing';
import type { Step } from './agent-server.types';
import { LEANSCOPE_CONFIG, LEANSCOPE_FETCH, type LeanScopeConfig } from './leanscope.config';
import { LeanScopeAuthService } from './leanscope-auth.service';
import { LeanScopeSessionService } from './leanscope-session.service';

const SERVER = 'https://agents.example';
const CONTROLLER = `${SERVER}/api/v1/sessions/tok`;

const config: LeanScopeConfig = {
  agentServerUrl: SERVER,
  choreoScenarioGuid: 'choreo-1',
  locale: 'en',
  repositoryId: '42',
  supabaseUrl: 'https://login.example',
  supabaseAnonKey: 'anon',
};

/** A signed-in user, or (with `null`) nobody. */
const authOf = (jwt: string | null) => ({
  signedIn: () => jwt !== null,
  bearer: async () => {
    if (jwt === null) throw new Error('Not signed in.');
    return jwt;
  },
});

const step = (guid: string, line: string, actorSymbolRef = 'agent', action = 'CREATE'): Step => ({
  action,
  guid,
  scenarioGuid: 'session-1',
  listIndex: null,
  title: null,
  line,
  actorSymbolRef,
  predecessorRefs: null,
  questions: null,
  actions: null,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A fake agent server: answers by method + URL and lets the test push SSE frames. */
function fakeServer() {
  const encoder = new TextEncoder();
  let events!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start: (c) => (events = c) });
  let pending: unknown = { status: 'working' };
  const calls: { method: string; url: string; init?: RequestInit }[] = [];

  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, init });
    if (method === 'POST' && url === `${SERVER}/api/v1/sessions`) {
      return json({
        sessionId: '1',
        sessionScenarioGuid: 'session-1',
        sessionToken: 'tok',
        controllerUrl: CONTROLLER,
        uiUrl: 'https://ui',
        markdown: '',
      });
    }
    if (url === `${CONTROLLER}/history`) return json({ steps: [step('a', 'Hello!')] });
    if (url === `${CONTROLLER}/events`) return new Response(stream, { status: 200 });
    if (url === `${CONTROLLER}/steps/pending`) return json(pending);
    if (method === 'POST' && url === `${CONTROLLER}/submit`)
      return new Response(null, { status: 204 });
    if (method === 'POST' && (url === `${CONTROLLER}/undo` || url === `${CONTROLLER}/redo`))
      return new Response(null, { status: 204 });
    if (method === 'POST' && url === `${CONTROLLER}/speak`) {
      const { stepGuid, requestId } = JSON.parse(String(init?.body)) as { stepGuid: string; requestId?: string };
      if (stepGuid === 'silent') return json({ error: { code: 'voiceless', message: 'no voice' } }, 422);
      return json({ requestId: requestId ?? 'made-up' }, 202);
    }
    if (method === 'DELETE' && url === `${CONTROLLER}/inventory`)
      return json({ cleared: ['offer', 'participants'], deletedFiles: 1, rewindsTo: 'a' });
    if (method === 'DELETE' && url === `${CONTROLLER}/inventory?key=offer&key=a%20b`)
      return json({ error: { code: 'busy', message: 'a turn is running' } }, 409);
    if (method === 'DELETE' && url === `${CONTROLLER}/speak`) return json({ cancelled: true }, 202);
    return new Response('not found', { status: 404 });
  });

  return {
    fetchFn,
    calls,
    setPending: (value: unknown) => (pending = value),
    emit: (event: string, data: unknown) =>
      events.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)),
    close: () => events.close(),
  };
}

function setup(server = fakeServer(), cfg = config, jwt: string | null = 'login-jwt') {
  TestBed.configureTestingModule({
    providers: [
      { provide: LEANSCOPE_CONFIG, useValue: cfg },
      { provide: LeanScopeAuthService, useValue: authOf(jwt) },
      { provide: LEANSCOPE_FETCH, useValue: server.fetchFn },
    ],
  });
  return { server, service: TestBed.inject(LeanScopeSessionService) };
}

describe('LeanScopeSessionService', () => {
  it('creates the session with the login as bearer, the choreo and its repository, and no keys', async () => {
    const { server, service } = setup();
    await service.start();

    const create = server.calls[0];
    expect(create.url).toBe(`${SERVER}/api/v1/sessions`);
    expect((create.init?.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer login-jwt',
    );
    expect(JSON.parse(String(create.init?.body))).toEqual({
      choreoScenarioGuid: 'choreo-1',
      choreoRepositoryId: '42',
      autoStart: true,
      locale: 'en',
    });
    expect(service.session()?.sessionToken).toBe('tok');
    expect(service.steps().map((s) => s.guid)).toEqual(['a']);
    expect(service.state()).toBe('working');
    service.stop();
  });

  it('follows step frames, asks, submits and ends', async () => {
    const { server, service } = setup();
    await service.start();

    server.emit('step', step('a', 'Hello! How are you?', 'agent', 'UPDATE'));
    server.setPending({
      status: 'asking',
      step: { guid: 'h1', question: 'How are you?', fieldKeys: ['message'], required: ['message'] },
    });
    server.emit('step', { ...step('h1', '', 'human'), pending: true });

    await vi.waitFor(() => expect(service.state()).toBe('asking'));
    expect(service.pendingQuestion()?.guid).toBe('h1');
    expect(service.steps().map((s) => [s.guid, s.line])).toEqual([
      ['a', 'Hello! How are you?'],
      ['h1', ''],
    ]);

    server.setPending({ status: 'working' });
    expect(await service.submit({ message: 'Fine' })).toBe(true);
    const submit = server.calls.find((c) => c.url.endsWith('/submit'));
    expect(submit?.init?.body).toBe('{"message":"Fine"}');
    expect(service.state()).toBe('working');
    expect(service.pendingQuestion()).toBeNull();

    server.emit('session_ending', { reason: 'terminal' });
    await vi.waitFor(() => expect(service.state()).toBe('ended'));
    expect(service.endReason()).toBe('terminal');
  });

  it('names the facet a pending question asks for, from its step envelope', async () => {
    const { server, service } = setup();
    await service.start();

    server.setPending({
      status: 'asking',
      step: { guid: 'h2', fieldKeys: ['document'], required: [] },
    });
    server.emit('step', {
      ...step('h2', '', 'human'),
      pending: true,
      questions: JSON.stringify({ type: 'tool_input_schema', toolName: '__facet_doc-facet__' }),
    });

    await vi.waitFor(() => expect(service.pendingQuestion()?.facetGuid).toBe('doc-facet'));
    service.stop();
  });

  it('removes deleted steps and ends when the stream closes', async () => {
    const { server, service } = setup();
    await service.start();
    server.emit('step', step('a', '', 'agent', 'DELETE'));
    await vi.waitFor(() => expect(service.steps()).toEqual([]));
    server.close();
    await vi.waitFor(() => expect(service.state()).toBe('ended'));
  });

  it('explains a rejected token', async () => {
    const server = fakeServer();
    server.fetchFn.mockImplementationOnce(async () =>
      json({ error: { message: 'bad token' } }, 403),
    );
    const { service } = setup(server);
    await service.start();
    expect(service.state()).toBe('error');
    expect(service.error()).toContain('did not accept your login');
    expect(service.error()).toContain('bad token');
  });

  it('does not call the server while configuration is missing', async () => {
    const { server, service } = setup(fakeServer(), { ...config, repositoryId: '' });
    await service.start();
    expect(server.fetchFn).not.toHaveBeenCalled();
    expect(service.state()).toBe('error');
    expect(service.error()).toContain('LEANSCOPE_REPOSITORY_ID');
  });

  it('does not call the server while nobody is signed in', async () => {
    const { server, service } = setup(fakeServer(), config, null);
    await service.start();
    expect(server.fetchFn).not.toHaveBeenCalled();
    expect(service.state()).toBe('error');
    expect(service.error()).toContain('Sign in');
  });

  it('attaches to a session created elsewhere, without login or choreo', async () => {
    const { server, service } = setup(fakeServer(), {
      ...config,
      agentServerUrl: `${SERVER}/`,
      choreoScenarioGuid: '',
      repositoryId: '',
    }, null);
    expect(await service.attach(' tok ')).toBe(true);

    expect(server.calls.some((c) => c.url === `${SERVER}/api/v1/sessions`)).toBe(false);
    expect(service.session()?.controllerUrl).toBe(CONTROLLER);
    expect(service.state()).toBe('waiting');
    expect(service.steps().map((s) => s.line)).toEqual(['Hello!']);

    server.emit('gate', { state: 'open' });
    await vi.waitFor(() => expect(service.state()).toBe('working'));
  });

  it('keeps the persona roster from the actors frame and drops it on stop', async () => {
    const { server, service } = setup();
    await service.start();
    expect(service.actors()).toEqual([]);

    server.emit('actors', {
      actors: [
        { guid: 'p1', name: 'Maren', imageUrl: 'https://img/maren.png' },
        { guid: 'p2', name: 'Tom' },
        { guid: '', name: 'nobody' },
      ],
    });
    await vi.waitFor(() => expect(service.actors().map((a) => a.name)).toEqual(['Maren', 'Tom']));
    expect(service.actors()[0].imageUrl).toBe('https://img/maren.png');

    service.stop();
    expect(service.actors()).toEqual([]);
  });

  it('explains an unknown session token', async () => {
    const { service } = setup();
    expect(await service.attach('unknown')).toBe(false);
    expect(service.state()).toBe('error');
    expect(service.error()).toContain('does not know this session');
  });

  it('runs a published query without a token and returns its data', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return json({ data: { uxmData: { scenarios: [] } } });
    });
    const { service } = setup({ ...fakeServer(), fetchFn } as ReturnType<typeof fakeServer>);

    const data = await service.runQuery('q-1', 'choreo-1', { limit: 3 });

    expect(data).toEqual({ uxmData: { scenarios: [] } });
    expect(calls[0].url).toBe(`${SERVER}/api/v1/queries/q-1`);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      scenarioGuid: 'choreo-1',
      variables: { limit: 3 },
    });
    expect((calls[0].init?.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('throws the GraphQL errors of a published query', async () => {
    const fetchFn = vi.fn(async () => json({ errors: [{ message: 'no such field' }] }));
    const { service } = setup({ ...fakeServer(), fetchFn } as ReturnType<typeof fakeServer>);
    await expect(service.runQuery('q-1', 'choreo-1')).rejects.toThrow('no such field');
  });

  it('uploads a parked file when a step announces it', async () => {
    const { server, service } = setup();
    await service.start();
    const ref = service.parkFile(new File(['x'], 'leitfaden.md'));
    expect(service.uploads()).toEqual([{ ref, name: 'leitfaden.md', status: 'parked' }]);

    server.emit('step', {
      ...step('u1', JSON.stringify({ kind: 'review', data: { files: [{ ref, destination: 'inventory' }] } })),
    });

    await vi.waitFor(() =>
      expect(server.calls.some((c) => c.url.startsWith(`${CONTROLLER}/files?`))).toBe(true),
    );
    // The fake server has no /files route: the failure is reported back to the step.
    await vi.waitFor(() => expect(service.uploads()[0]?.status).toBe('error'));
    service.stop();
    expect(service.uploads()).toEqual([]);
  });

  it('asks for a recorded step to be spoken, and tells a refusal by its reason', async () => {
    const { server, service } = setup();
    await service.start();

    expect(await service.speak('s1', { requestId: 'p-1', mode: 'queue' })).toEqual({ ok: true, requestId: 'p-1' });
    const ask = server.calls.find((c) => c.url === `${CONTROLLER}/speak`)!;
    expect(JSON.parse(String(ask.init?.body))).toEqual({ stepGuid: 's1', requestId: 'p-1', mode: 'queue' });
    expect(await service.speak('s2')).toEqual({ ok: true, requestId: 'made-up' });
    expect(await service.speak('silent')).toEqual({ ok: false, status: 422, reason: 'voiceless' });

    expect(await service.cancelSpeech()).toBe(true);
    expect(server.calls.at(-1)?.method).toBe('DELETE');
    service.stop();
  });

  it('keeps why a failed session ended', async () => {
    const { server, service } = setup();
    await service.start();
    server.emit('session_ending', { reason: 'error', error: { code: 'llm-billing', message: 'no credits' } });
    await vi.waitFor(() => expect(service.state()).toBe('ended'));
    expect(service.endReason()).toBe('error');
    expect(service.error()).toBe('no credits');
  });

  it('cannot speak without a session', async () => {
    const { service } = setup();
    expect(await service.speak('s1')).toEqual({ ok: false, status: 0 });
  });

  it('forgets what the Inventory keeps, for all keys or the named ones', async () => {
    const { service } = setup();
    expect(await service.resetInventory()).toEqual({ ok: false, status: 0 });
    await service.start();

    expect(await service.resetInventory()).toEqual({
      ok: true,
      cleared: ['offer', 'participants'],
      deletedFiles: 1,
      rewindsTo: 'a',
    });
    // The server's refusal comes back with its reason.
    expect(await service.resetInventory(['offer', 'a b'])).toEqual({
      ok: false,
      status: 409,
      code: 'busy',
      message: 'a turn is running',
    });
  });

  it('takes the last turn back and follows the conversation the server names', async () => {
    const { server, service } = setup();
    await service.start();
    server.emit('step', step('b', '{"brief":"x"}', 'human'));
    server.emit('step', step('c', 'Thanks!'));
    server.emit('undo_state', { canUndo: true, canRedo: false });
    await vi.waitFor(() => expect(service.undoState()).toEqual({ canUndo: true, canRedo: false }));
    expect(service.steps().map((s) => s.guid)).toEqual(['a', 'b', 'c']);

    expect(await service.undo()).toBe(true);
    expect(server.calls.some((c) => c.method === 'POST' && c.url === `${CONTROLLER}/undo`)).toBe(true);
    server.emit('branch', { op: 'detach', branchHead: 'b', members: ['b', 'c'], activeChain: ['a'], canUndo: false, canRedo: true });
    await vi.waitFor(() => expect(service.steps().map((s) => s.guid)).toEqual(['a']));
    expect(service.undoState()).toEqual({ canUndo: false, canRedo: true });

    // Redo: the steps come back without being sent again.
    expect(await service.redo()).toBe(true);
    server.emit('branch', { op: 'attach', branchHead: 'b', members: ['b', 'c'], activeChain: ['a', 'b', 'c'], canUndo: true, canRedo: false });
    await vi.waitFor(() => expect(service.steps().map((s) => s.guid)).toEqual(['a', 'b', 'c']));
  });
});
