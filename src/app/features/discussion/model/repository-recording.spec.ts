import { guideFromMarkdown } from './guide-markdown';
import { matchQuestions } from './question-match';
import {
  RECORDING_BY_GUID,
  RECORDING_RESOURCES,
  RECORDING_STEPS,
  INTERVIEW_GUIDE_TYPE,
  RecordingError,
  fromScenarioSteps,
  loadRecording,
  toRecordings,
  topicQuestions,
  type RecordingResourceRow,
  type RecordingStepRow,
} from './repository-recording';
import { speakingSeconds } from './transcript-mapper';

const MAREN = 'f3cc44e7-44c6-42cf-b83b-c18e5df291fe';
const ERNST = 'f8f2f40a-a7b0-4aa3-96fb-e6809c63c62e';
const KARL = 'df3e4071-845c-466a-956c-54cfca96c20e';
const NAME: Record<string, string> = { [MAREN]: 'Maren', [ERNST]: 'Ernst', [KARL]: 'Karl' };
const OVERVIEW = 'b71f5c1b-96db-4f24-8578-4db2eed59a0a';
const CAMPAIGN_1 = '8af35d01-8ab3-441d-8b51-e54b84006283';
const TOPIC = '03400c79-7310-4776-a837-22ea217c08bb';

const RESOURCES: RecordingResourceRow[] = [
  { guid: OVERVIEW, line: 'Stimulus material: Übersicht.png', fileRefs: ['file-overview'] },
  { guid: CAMPAIGN_1, line: 'Stimulus material: Kampagne1.png', fileRefs: ['file-k1'] },
  { guid: TOPIC, line: 'Erster Eindruck', description: 'Was fällt Ihnen als Erstes auf? Wohin geht Ihr Blick zuerst?\n', fileRefs: [] },
];

interface Turn {
  guid: string;
  actor: string;
  line?: string;
  seconds?: number;
  has?: string[];
}

/** A linear chain in the given order, returned shuffled: the order must come from the refs. */
function chain(turns: Turn[]): RecordingStepRow[] {
  const rows = turns.map((t, i): RecordingStepRow => ({
    guid: t.guid,
    title: NAME[t.actor] ?? t.actor,
    line: t.line ?? `Beitrag ${t.guid}`,
    actorSymbolRef: t.actor,
    listIndex: null,
    predecessorRefs: i ? [turns[i - 1].guid] : [],
    successorRefs: i < turns.length - 1 ? [turns[i + 1].guid] : [],
    activeSuccessorRef: i < turns.length - 1 ? turns[i + 1].guid : null,
    duration: t.seconds === undefined ? null : { time: { hour: 0, minute: Math.floor(t.seconds / 60), second: t.seconds % 60 } },
    resourceRelationships_: (t.has ?? []).map((resourceRef) => ({ predicate: 'HAS', resourceRef })),
  }));
  return [...rows].reverse();
}

const SCENARIO = { guid: '5df7377e', title: 'Stadtwerke Lindenau 1' };

describe('toRecordings', () => {
  it('offers the conversations that are no session record, by title', () => {
    const data = {
      uxmData: {
        scenarios: [
          { guid: 's-2', title: 'Lindenau 2', customId: null },
          { guid: 's-x', title: 'Session 2026-11-16 12:19:53', customId: 'session_cY9MTwHt' },
          { guid: 's-1', title: 'Lindenau 1' },
          { guid: 's-0', title: ' ' },
        ],
      },
    };
    expect(toRecordings(data)).toEqual([
      { guid: 's-1', title: 'Lindenau 1' },
      { guid: 's-2', title: 'Lindenau 2' },
      { guid: 's-0', title: 's-0' },
    ]);
    expect(toRecordings(null)).toEqual([]);
  });
});

describe('fromScenarioSteps', () => {
  it('puts the turns on the clock by the lengths of the steps, in chain order', () => {
    const recording = fromScenarioSteps({
      scenario: SCENARIO,
      steps: chain([
        { guid: 'a', actor: MAREN, seconds: 26 },
        { guid: 'b', actor: ERNST, seconds: 80 },
        { guid: 'c', actor: KARL, seconds: 18 },
      ]),
    });
    expect(recording.title).toBe('Stadtwerke Lindenau 1');
    expect(recording.transcript.clips.map((c) => [c.guid, c.stepGuid, c.speakerName, c.start, c.end])).toEqual([
      ['a', 'a', 'Maren', 0, 26],
      ['b', 'b', 'Ernst', 26, 106],
      ['c', 'c', 'Karl', 106, 124],
    ]);
    expect(recording.transcript.duration).toBe(124);
    expect(recording.transcript.scenarioGuid).toBe('5df7377e');
    expect(recording.personaRefs).toEqual([MAREN, ERNST, KARL]);
  });

  it('follows the active successor at a fork', () => {
    const steps = chain([
      { guid: 'a', actor: MAREN, seconds: 5 },
      { guid: 'b', actor: ERNST, seconds: 5 },
    ]);
    const a = steps.find((s) => s.guid === 'a')!;
    a.successorRefs = ['x', 'b'];
    steps.push({ guid: 'x', actorSymbolRef: KARL, title: 'Karl', line: 'Verworfen', predecessorRefs: ['a'] });
    const recording = fromScenarioSteps({ scenario: SCENARIO, steps });
    expect(recording.transcript.clips.map((c) => c.guid)).toEqual(['a', 'b']);
  });

  it('takes the steps in creation order when the chain cannot be walked', () => {
    const steps: RecordingStepRow[] = [
      { guid: 'b', actorSymbolRef: ERNST, title: 'Ernst', line: 'Zwei', listIndex: 2 },
      { guid: 'a', actorSymbolRef: MAREN, title: 'Maren', line: 'Eins', listIndex: 1 },
    ];
    expect(fromScenarioSteps({ scenario: SCENARIO, steps }).transcript.clips.map((c) => c.text)).toEqual(['Eins', 'Zwei']);
  });

  it('estimates a turn without a length, and keeps the time of a step that is no turn', () => {
    const text = 'Ich achte eigentlich nur darauf, ob irgendwo etwas mit Preis steht.';
    const recording = fromScenarioSteps({
      scenario: SCENARIO,
      steps: chain([
        { guid: 'a', actor: MAREN, seconds: 10 },
        { guid: 'h', actor: 'human', seconds: 7 },
        { guid: 'u', actor: 'https://example.org/portrait.png', line: 'Aus einer Session' },
        { guid: 'e', actor: MAREN, line: ' ', seconds: 3 },
        { guid: 'b', actor: ERNST, line: text },
      ]),
    });
    expect(recording.transcript.clips.map((c) => [c.guid, c.start])).toEqual([
      ['a', 0],
      ['b', 20],
    ]);
    expect(recording.transcript.clips[1].end).toBeCloseTo(20 + speakingSeconds(text));
  });

  it('makes the persona with the Group Role the moderator, else the first speaker', () => {
    const steps = chain([
      { guid: 'a', actor: ERNST, seconds: 5 },
      { guid: 'b', actor: MAREN, seconds: 5 },
    ]);
    const named = fromScenarioSteps({ scenario: SCENARIO, steps, moderatorRefs: [MAREN.toUpperCase()] });
    expect(named.moderator).toEqual({ guid: MAREN, name: 'Maren', imageUrl: null, color: null });
    expect(named.transcript.clips.map((c) => c.moderator)).toEqual([false, true]);
    expect(named.study.screener?.participants.map((p) => [p.name, p.initials, p.filled])).toEqual([['Ernst', 'ER', true]]);

    const unnamed = fromScenarioSteps({ scenario: SCENARIO, steps });
    expect(unnamed.moderator.name).toBe('Ernst');
    expect(unnamed.study.screener?.participants.map((p) => p.name)).toEqual(['Maren']);
  });

  it('shows a file resource for the span of turns that have it, bridging turns that show nothing', () => {
    const recording = fromScenarioSteps({
      scenario: SCENARIO,
      resources: RESOURCES,
      steps: chain([
        { guid: 'a', actor: MAREN, seconds: 10 },
        { guid: 'b', actor: MAREN, seconds: 10, has: [OVERVIEW, TOPIC] },
        { guid: 'c', actor: ERNST, seconds: 10 },
        { guid: 'd', actor: KARL, seconds: 10, has: [OVERVIEW] },
        { guid: 'e', actor: MAREN, seconds: 10, has: [CAMPAIGN_1] },
        { guid: 'f', actor: ERNST, seconds: 10, has: [TOPIC] },
        { guid: 'g', actor: MAREN, seconds: 10, has: [OVERVIEW] },
      ]),
    });
    expect(recording.files.map((s) => [s.guid, s.name, s.resourceRef, s.fileRef, s.start, s.end])).toEqual([
      ['r_1', 'Stimulus material: Übersicht.png', OVERVIEW, 'file-overview', 10, 40],
      ['r_2', 'Stimulus material: Kampagne1.png', CAMPAIGN_1, 'file-k1', 40, 50],
      ['r_3', 'Stimulus material: Übersicht.png', OVERVIEW, 'file-overview', 60, 70],
    ]);
    expect(recording.study.stimuli).toEqual([]);
    expect([...recording.topics]).toEqual([
      ['b', ['Was fällt Ihnen als Erstes auf? Wohin geht Ihr Blick zuerst?']],
      ['f', ['Was fällt Ihnen als Erstes auf? Wohin geht Ihr Blick zuerst?']],
    ]);
  });

  it('names the guide the scenario attaches as its source', () => {
    const recording = fromScenarioSteps({
      scenario: {
        ...SCENARIO,
        summary: ' Vier Kundinnen und Kunden ',
        resourceRelationships_: [
          { resource_: { guid: 'prompt', line: 'Moderator prompt', resourceRelationships_: [] } },
          {
            resource_: {
              guid: 'ac34fe04',
              line: 'Discussion Guide',
              description: ' ## A. Einstieg\n- Wie geht es Ihnen? ',
              fileRefs: [],
              resourceRelationships_: [{ predicate: 'IS', resourceRef: INTERVIEW_GUIDE_TYPE }],
            },
          },
        ],
      },
      steps: chain([{ guid: 'a', actor: MAREN, seconds: 5 }]),
    });
    expect(recording.sources).toEqual([
      { key: 's_1', name: 'Discussion Guide', resourceRef: 'ac34fe04', text: '## A. Einstieg\n- Wie geht es Ihnen?' },
    ]);
    expect(recording.description).toBe('Vier Kundinnen und Kunden');
  });

  it('refuses a scenario without a spoken turn', () => {
    const steps = chain([{ guid: 'a', actor: 'system' }]);
    expect(() => fromScenarioSteps({ scenario: SCENARIO, steps })).toThrowError(RecordingError);
  });
});

describe('topicQuestions', () => {
  const guide = guideFromMarkdown(
    'Leitfaden',
    `## D. Kampagne 1
- Was fällt Ihnen als Erstes auf? Wohin geht Ihr Blick zuerst?, Kampagne1.png
- Wie glaubwürdig finden Sie die Aussagen?, Kampagne1.png
## E. Kampagne 2
- Was fällt Ihnen als Erstes auf? Wohin geht Ihr Blick zuerst?, Kampagne2.png`,
  );
  const [d1, d2, e1] = guide.blocks.flatMap((b) => b.questions.map((q) => q.key));

  it('finds the guide questions a topic lists, by their text', () => {
    const allowed = topicQuestions(
      new Map([
        ['a', ['Was fällt Ihnen als Erstes auf? Wohin geht Ihr Blick zuerst?']],
        ['b', ['- wie glaubwürdig finden Sie die Aussagen?, Kampagne1.png', 'Nicht im Leitfaden']],
        ['c', ['Nicht im Leitfaden']],
      ]),
      guide,
    );
    expect([...allowed].map(([clip, keys]) => [clip, [...keys]])).toEqual([
      ['a', [d1, e1]],
      ['b', [d2]],
    ]);
  });

  it('lets a moderator turn open only a question of its topic', () => {
    const recording = fromScenarioSteps({
      scenario: SCENARIO,
      resources: [
        ...RESOURCES,
        { guid: 'topic-2', line: 'Glaubwürdigkeit', description: 'Wie glaubwürdig finden Sie die Aussagen?' },
      ],
      steps: chain([
        { guid: 'a', actor: MAREN, seconds: 10, line: 'Schaut bitte einmal auf die Folie.', has: [CAMPAIGN_1, TOPIC] },
        { guid: 'b', actor: ERNST, seconds: 10, line: 'Das Sparschwein.', has: [CAMPAIGN_1, TOPIC] },
        { guid: 'c', actor: MAREN, seconds: 10, line: 'Und nimmt man ihnen das ab?', has: [CAMPAIGN_1, 'topic-2'] },
      ]),
    });
    const matched = matchQuestions(recording.transcript, guide, recording.files, topicQuestions(recording.topics, guide));
    expect(matched.clips.map((c) => c.questionKey)).toEqual([d1, d1, d2]);
    expect(matched.badges).toEqual([
      { questionKey: d1, start: 0 },
      { questionKey: d2, start: 20 },
    ]);
    expect(matched.scenarioGuid).toBe('5df7377e');
  });
});

describe('loadRecording', () => {
  it('reads the scenario, the steps in pages, the resources they name and the moderator', async () => {
    const turns: Turn[] = Array.from({ length: 201 }, (_, i) => ({
      guid: `step-${String(i).padStart(3, '0')}`,
      actor: i % 2 ? ERNST : MAREN,
      seconds: 2,
      ...(i === 1 ? { has: [OVERVIEW] } : {}),
    }));
    const steps = chain(turns);
    const calls: { document: string; variables?: Record<string, unknown> }[] = [];
    const query = async (document: string, variables?: Record<string, unknown>) => {
      calls.push({ document, variables });
      if (document === RECORDING_BY_GUID) return { uxmData: { scenarios: [SCENARIO] } };
      if (document === RECORDING_STEPS) {
        const offset = variables!['offset'] as number;
        return { uxmData: { scenarioSteps: steps.slice(offset, offset + (variables!['limit'] as number)) } };
      }
      if (document === RECORDING_RESOURCES) return { uxmData: { resources: RESOURCES } };
      throw new Error('unexpected query');
    };
    const asked: string[][] = [];
    const recording = await loadRecording('5df7377e', query, async (refs) => {
      asked.push(refs);
      return [ERNST];
    });

    expect(calls.filter((c) => c.document === RECORDING_STEPS).map((c) => c.variables!['offset'])).toEqual([0, 200]);
    expect(calls.find((c) => c.document === RECORDING_RESOURCES)?.variables).toEqual({ guids: [OVERVIEW] });
    expect(asked.map((refs) => [...refs].sort())).toEqual([[ERNST, MAREN].sort()]);
    expect(recording.transcript.clips.length).toBe(201);
    expect(recording.transcript.duration).toBe(402);
    expect(recording.moderator.name).toBe('Ernst');
    expect(recording.files.map((s) => [s.start, s.end])).toEqual([[2, 4]]);
  });

  it('says so when the repository has no such scenario', async () => {
    const query = async (document: string) =>
      document === RECORDING_BY_GUID ? { uxmData: { scenarios: [] } } : { uxmData: { scenarioSteps: [] } };
    await expect(loadRecording('nope', query)).rejects.toThrowError(RecordingError);
  });
});
