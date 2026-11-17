import type { Step } from './agent-server.types';
import {
  PendingUploads,
  announcedUploads,
  makePendingRef,
  parsePendingRef,
  type UploadState,
} from './pending-uploads';

const CONTROLLER = 'https://agents.example/api/v1/sessions/tok';

const reviewStep = (guid: string, files: unknown[]): Step => ({
  action: 'UPDATE',
  guid,
  scenarioGuid: 'session-1',
  listIndex: null,
  title: null,
  line: JSON.stringify({ kind: 'review', data: { files } }),
  actorSymbolRef: 'agent',
  predecessorRefs: null,
  questions: null,
  actions: null,
});

function server(upload: (url: string) => Response) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      method: init?.method ?? 'GET',
      url,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    });
    if (url.includes('/upload-event')) return new Response(null, { status: 202 });
    if (url.includes('/files?')) return upload(url);
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe('pending refs', () => {
  it('round-trips a file name with spaces and umlauts', () => {
    const ref = makePendingRef('abc', 'Leitfaden Gruppe 1 – Kühe.docx');
    expect(ref).toBe('pending://abc/Leitfaden%20Gruppe%201%20%E2%80%93%20K%C3%BChe.docx');
    expect(parsePendingRef(ref)).toEqual({ id: 'abc', filename: 'Leitfaden Gruppe 1 – Kühe.docx' });
    expect(parsePendingRef('https://x')).toBeNull();
  });

  it('reads the announced rows from a review line only', () => {
    const ref = makePendingRef('a', 'x.md');
    expect(announcedUploads(reviewStep('s', [{ ref, destination: 'inventory' }, { ref: 'nope' }])))
      .toEqual([{ stepGuid: 's', ref, destination: 'inventory' }]);
    expect(announcedUploads({ ...reviewStep('s', []), line: 'Hallo {' })).toEqual([]);
    expect(announcedUploads({ ...reviewStep('s', []), line: '{"kind":"other"}' })).toEqual([]);
  });
});

describe('PendingUploads', () => {
  it('uploads a parked file the engine announces, durably, and reports it once', async () => {
    const { fetchFn, calls } = server(() =>
      new Response(JSON.stringify({ key: 'k', url: '/api/v1/files/leanscope/g1' }), { status: 201 }),
    );
    const states: UploadState[] = [];
    const uploads = new PendingUploads(fetchFn, (s) => states.push(s));
    const ref = uploads.park(new File(['# Leitfaden'], 'leitfaden.md', { type: 'text/markdown' }));

    const step = reviewStep('up1', [{ ref, destination: 'inventory' }]);
    await Promise.all(uploads.drive(step, CONTROLLER));
    // The step updates again (progress): nothing is uploaded twice.
    expect(uploads.drive(step, CONTROLLER)).toEqual([]);

    const upload = calls.find((c) => c.url.includes('/files?'));
    const query = new URL(upload!.url).searchParams;
    expect(query.get('ref')).toBe(ref);
    expect(query.get('destination')).toBe('inventory');
    expect(upload!.body).toBeInstanceOf(FormData);

    const events = calls.filter((c) => c.url === `${CONTROLLER}/steps/up1/upload-event`);
    expect(events.map((e) => e.body)).toEqual([
      { ref, pct: 0 },
      { ref, url: '/api/v1/files/leanscope/g1' },
    ]);
    expect(states.map((s) => s.status)).toEqual(['parked', 'uploading', 'done']);
  });

  it('ignores refs it did not park and reports a failed upload', async () => {
    const { fetchFn, calls } = server(() =>
      new Response(JSON.stringify({ error: { message: 'too big' } }), { status: 413 }),
    );
    const states: UploadState[] = [];
    const uploads = new PendingUploads(fetchFn, (s) => states.push(s));
    const ref = uploads.park(new File(['x'], 'screener.xlsx'));

    const step = reviewStep('up1', [{ ref }, { ref: makePendingRef('foreign', 'other.md') }]);
    await Promise.all(uploads.drive(step, CONTROLLER));

    expect(calls.filter((c) => c.url.includes('/files?'))).toHaveLength(1);
    expect(new URL(calls.find((c) => c.url.includes('/files?'))!.url).searchParams.has('destination')).toBe(false);
    expect(calls.at(-1)?.body).toEqual({ ref, error: 'too big' });
    expect(states.at(-1)).toMatchObject({ status: 'error', error: 'too big' });
  });
});
