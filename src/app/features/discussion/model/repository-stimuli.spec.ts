import { TestBed } from '@angular/core/testing';
import { LEANSCOPE_CONFIG, LEANSCOPE_FETCH, type LeanScopeConfig } from '../../../leanscope/leanscope.config';
import { LeanScopeAuthService } from '../../../leanscope/leanscope-auth.service';
import { RepositoryResourcesService } from '../../../leanscope/repository-resources.service';
import { loadRepositoryStimuli } from './repository-stimuli';
import { fromWebVtt } from './vtt-import';

const SERVER = 'https://agents.example';

/** As the server's export writes it: top-level `fileResources`, no `study`, no `mimeType`. */
const EXPORT = `WEBVTT
Runde

NOTE
\`\`\`yaml
title: Runde
timing: recorded
fileResources:
  - key: r_1
    name: "Stimulus material: Übersicht.png"
    resourceRef: Res-1
    fileRef: File-1
    start: 00:00:01.000
    end: 00:00:04.000
  - key: r_2
    name: "Stimulus material: Kampagne1.png"
    resourceRef: res-2
    fileRef: file-2
    start: 00:00:04.000
    end: 00:00:06.000
  - key: r_3
    name: "Stimulus material: Übersicht.png"
    resourceRef: res-1
    fileRef: file-1
    start: 00:00:05.000
    end: 00:00:08.000
actors:
  Maren:
    actorRef: mod-1
    moderator: true
  Ernst (19%):
    actorRef: p-ernst
\`\`\`

1
00:00:00.000 --> 00:00:02.000
<v Maren>Willkommen.

2
00:00:02.000 --> 00:00:08.000
<v Ernst (19%)>Danke.
`;

function setup(respond: (url: string) => Response) {
  const calls: { url: string; authorization?: string }[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), authorization: (init?.headers as Record<string, string>)?.['Authorization'] });
    return respond(String(input));
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: LEANSCOPE_CONFIG, useValue: { agentServerUrl: SERVER, repositoryId: '42' } as LeanScopeConfig },
      { provide: LeanScopeAuthService, useValue: { signedIn: () => true, bearer: async () => 'login-jwt' } },
      { provide: LEANSCOPE_FETCH, useValue: fetchFn },
    ],
  });
  const resources = TestBed.inject(RepositoryResourcesService);
  return { calls, read: (resource: string, file: string) => resources.file(resource, file) };
}

// The server sends the file's own MIME type as `Content-Type`; the blob takes it from there.
const png = () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } });

describe('loadRepositoryStimuli', () => {
  let n = 0;
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  beforeEach(() => {
    // jsdom has no object URLs.
    n = 0;
    URL.createObjectURL = () => `blob:test/${++n}`;
    URL.revokeObjectURL = () => undefined;
  });
  afterEach(() => {
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
  });

  it("takes a stimulus's MIME type from its file when the manifest gives none", async () => {
    const { files } = fromWebVtt(EXPORT);
    expect(files.map((s) => s.mimeType)).toEqual(['', '', '']);
    const { calls, read } = setup(png);

    const loaded = await loadRepositoryStimuli(files, read);

    expect(loaded.map((s) => [s.guid, s.mimeType, s.url])).toEqual([
      ['r_1', 'image/png', 'blob:test/1'],
      ['r_2', 'image/png', 'blob:test/2'],
      ['r_3', 'image/png', 'blob:test/1'],
    ]);
    // A file that comes back later is fetched once, through its resource, with the token.
    expect(calls).toEqual([
      { url: `${SERVER}/api/v1/resources/Res-1/files/File-1?repositoryId=42`, authorization: 'Bearer login-jwt' },
      { url: `${SERVER}/api/v1/resources/res-2/files/file-2?repositoryId=42`, authorization: 'Bearer login-jwt' },
    ]);
  });

  it('keeps the MIME type a hand-written file states', async () => {
    const { files } = fromWebVtt(EXPORT);
    const { read } = setup(png);
    const loaded = await loadRepositoryStimuli([{ ...files[0], mimeType: 'image/jpeg' }], read);
    expect(loaded[0].mimeType).toBe('image/jpeg');
  });

  it('leaves out the stimuli whose file did not load', async () => {
    const { files } = fromWebVtt(EXPORT);
    const { read } = setup((url) => (url.includes('res-2') ? new Response('gone', { status: 404 }) : png()));
    const loaded = await loadRepositoryStimuli(files, read);
    expect(loaded.map((s) => s.guid)).toEqual(['r_1', 'r_3']);
  });
});
