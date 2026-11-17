import { toGuide, toParticipant, toStudy, type DocumentRoot } from './study-mapper';

const guideRoot: DocumentRoot = {
  guid: 'root',
  line: 'Leitfaden Flusskreuzfahrt.docx',
  children: [
    { guid: '3', key: 'q_3', line: 'Was erwarten Sie?', description: 'Leitfaden > Block B – Erwartungen (20 min)', listIndex: 2 },
    { guid: '1', key: 'q_1', line: 'Stellen Sie sich bitte vor.', description: 'Leitfaden > Block A: Einstieg (10 min)', listIndex: 0 },
    { guid: '2', key: 'q_2', line: 'Wie verreisen Sie gern?', description: 'Leitfaden > Block A: Einstieg (10 min)', listIndex: 1 },
    { guid: '4', key: 'q_4', line: 'Was nehmen Sie mit?', description: 'Abschluss', listIndex: 3 },
  ],
};

describe('toGuide', () => {
  it('groups questions into blocks in listIndex order, with codes, tones and minutes', () => {
    const guide = toGuide(guideRoot);
    expect(guide.title).toBe('Leitfaden Flusskreuzfahrt');
    expect(guide.blocks.map((b) => [b.code, b.title, b.minutes, b.tone])).toEqual([
      ['A', 'Einstieg', 10, 1],
      ['B', 'Erwartungen', 20, 2],
      // No minutes in the heading: an even share of what the default length leaves.
      ['C', 'Abschluss', 60, 3],
    ]);
    expect(guide.blocks[0].questions.map((q) => [q.code, q.key, q.text])).toEqual([
      ['A1', 'q_1', 'Stellen Sie sich bitte vor.'],
      ['A2', 'q_2', 'Wie verreisen Sie gern?'],
    ]);
    expect(guide.totalMinutes).toBe(90);
  });
});

describe('toStudy', () => {
  it('maps brief, screener, participants and stimuli, and tolerates missing parts', () => {
    const study = toStudy({
      brief: {
        guid: 'b',
        line: 'Angebot.pdf',
        children: [
          { guid: 'g1', kind: 'goal', line: 'Konzept schärfen', listIndex: 0 },
          { guid: 'r1', kind: 'researchQuestion', key: 'rq_1', line: 'Was zieht Erstbucher an?', listIndex: 1 },
        ],
      },
      screener: {
        guid: 's',
        line: 'Screener.xlsx',
        children: [{ guid: 'c1', kind: 'criterion', line: 'Alter 30–65', listIndex: 0 }],
        participants: [
          { guid: 'p1', name: 'Inge Paulsen', profile: 'Pensionierte Lehrerin', ocean: { openness: 0.8, conscientiousness: 0.7, extraversion: 0.4, agreeableness: 0.9, neuroticism: 1.4 } },
          { guid: 'p2', name: '' },
        ],
      },
      stimuli: [{ guid: 'f1', name: 'konzept.png', url: '/api/v1/files/leanscope/f1', mimeType: 'image/png' }, { guid: 'f2' }],
    });

    expect(study.guide).toBeNull();
    expect(study.brief).toEqual({
      title: 'Angebot',
      goals: [{ key: 'g1', text: 'Konzept schärfen' }],
      researchQuestions: [{ key: 'rq_1', text: 'Was zieht Erstbucher an?' }],
    });
    expect(study.screener?.criteria).toEqual([{ key: 'c1', text: 'Alter 30–65' }]);
    expect(study.screener?.participants.map((p) => [p.name, p.initials, p.filled])).toEqual([
      ['Inge Paulsen', 'IP', true],
      ['Teilnehmende 2', 'T2', false],
    ]);
    expect(study.screener?.participants[0].ocean?.neuroticism).toBe(1);
    expect(study.stimuli).toEqual([
      { guid: 'f1', name: 'konzept.png', url: '/api/v1/files/leanscope/f1', mimeType: 'image/png', start: 0, end: 180 },
    ]);
    expect(toStudy(null)).toEqual({ guide: null, brief: null, screener: null, stimuli: [] });
  });

  it('keeps OCEAN only when all five values are there', () => {
    expect(toParticipant({ guid: 'p', name: 'A B', profile: 'x', ocean: { openness: 0.5 } }).ocean).toBeUndefined();
  });

  it('keeps the persona colour when there is one', () => {
    expect(toParticipant({ guid: 'p', name: 'A', color: ' #e05a2b ' }).color).toBe('#e05a2b');
    expect(toParticipant({ guid: 'p', name: 'A', color: '' }).color).toBeUndefined();
  });

  it('keeps attributes in order and drops empty ones', () => {
    const attributes = [
      { label: ' Grundhaltung ', value: 'pragmatisch' },
      { label: 'Leer', value: ' ' },
      { label: 'Politische Orientierung', value: 'Mitte' },
    ];
    expect(toParticipant({ guid: 'p', name: 'A', attributes }).attributes).toEqual([
      { label: 'Grundhaltung', value: 'pragmatisch' },
      { label: 'Politische Orientierung', value: 'Mitte' },
    ]);
    expect(toParticipant({ guid: 'p', name: 'A' }).attributes).toBeUndefined();
  });
});
