import type { Step } from '../../../leanscope/agent-server.types';
import type { Participant } from './study.model';
import { clipAt, clipLabel, MODERATOR_TRACK, nextTurnOf, speakingSeconds, summaryTitle, toTranscript } from './transcript-mapper';

const step = (guid: string, actor: string, line: string, extra: Partial<Step> = {}): Step => ({
  action: 'CREATE',
  guid,
  scenarioGuid: 'session',
  listIndex: null,
  title: null,
  line,
  actorSymbolRef: actor,
  predecessorRefs: null,
  questions: null,
  actions: null,
  ...extra,
});

const participants: Participant[] = [
  { guid: 'p1', name: 'Inge Paulsen', initials: 'IP', filled: true },
  { guid: 'p2', name: 'Kevin Alders', initials: 'KA', filled: true },
];

describe('toTranscript', () => {
  it('places turns one after another, tags questions and strips the tags', () => {
    const t = toTranscript(
      [
        step('m1', 'mod', '[q_aa] Wie verreisen Sie am liebsten?'),
        step('h', 'human', 'ignored'),
        step('a1', 'p1', 'Mit dem Schiff, ganz klar.'),
        step('a2', 'p2', 'Mit dem Zug.'),
        step('m2', 'mod', '[q_bb] Und was erwarten Sie an Bord?'),
        step('a3', 'p1', 'Ruhe.'),
        step('w', 'p2', '', { pending: true }),
      ],
      { participants, names: { mod: 'Maren' } },
    );

    expect(t.clips.map((c) => [c.guid, c.speakerName, c.moderator, c.questionKey])).toEqual([
      ['m1', 'Maren', true, 'q_aa'],
      ['a1', 'Inge Paulsen', false, 'q_aa'],
      ['a2', 'Kevin Alders', false, 'q_aa'],
      ['m2', 'Maren', true, 'q_bb'],
      ['a3', 'Inge Paulsen', false, 'q_bb'],
    ]);
    expect(t.clips[0].text).toBe('Wie verreisen Sie am liebsten?');
    expect(t.clips[1].start).toBeGreaterThan(t.clips[0].end);
    expect(t.badges.map((b) => b.questionKey)).toEqual(['q_aa', 'q_bb']);
    expect(t.badges[1].start).toBe(t.clips[3].start);
    // q_aa: both answered and the moderator moved on. q_bb: Kevin has not spoken yet.
    expect([...t.done]).toEqual(['q_aa']);
    expect(t.duration).toBe(t.clips.at(-1)?.end);
  });

  it('leaves out speakers outside `speakers` (the director)', () => {
    const t = toTranscript(
      [
        step('d1', 'director', 'Ich simuliere nun eine Gruppendiskussion.'),
        step('m1', 'mod', 'Willkommen!'),
        step('a1', 'p1', 'Hallo.'),
      ],
      { participants, names: { mod: 'Maren' }, speakers: new Set(['mod', 'p1', 'p2']) },
    );
    expect(t.clips.map((c) => c.guid)).toEqual(['m1', 'a1']);
    expect(t.clips[0].start).toBe(0);
  });

  it('takes the summary title from the step, not the speaker name the server writes first', () => {
    const t = toTranscript(
      [
        step('m1', 'mod', '[q_aa] Wie verreisen Sie am liebsten?', { title: 'Reisevorlieben' }),
        step('a1', 'p1', 'Mit dem Schiff, ganz klar.', { title: '😍 Schiff, ganz klar' }),
        step('a2', 'p2', 'Mit dem Zug.', { title: 'Kevin Alders' }),
        step('a3', 'p1', 'Ruhe.', { title: '  ' }),
      ],
      { participants, names: { mod: 'Maren' } },
    );
    expect(t.clips.map((c) => c.title)).toEqual(['Reisevorlieben', '😍 Schiff, ganz klar', undefined, undefined]);
  });

  it('labels a turn by its title, else by its first four words', () => {
    expect(clipLabel({ title: '😟 Preis zu hoch', text: 'Das ist mir zu teuer.' })).toBe('😟 Preis zu hoch');
    expect(clipLabel({ text: 'Das ist mir viel zu teuer.' })).toBe('Das ist mir viel …');
    expect(clipLabel({ text: 'Zu teuer.' })).toBe('Zu teuer.');
    expect(summaryTitle('Maren', 'maren')).toBeUndefined();
  });

  it('estimates speaking time from the word count, with a minimum', () => {
    expect(speakingSeconds('Ja.')).toBe(2);
    expect(speakingSeconds(Array(150).fill('Wort').join(' '))).toBe(60);
  });

  it('finds the clip heard at a time', () => {
    const t = toTranscript([step('a1', 'p1', 'Eins.'), step('a2', 'p2', 'Zwei.')], { participants });
    expect(clipAt(t.clips, 0)?.guid).toBe('a1');
    expect(clipAt(t.clips, t.clips[1].start + 0.1)?.guid).toBe('a2');
    expect(clipAt(t.clips, 999)).toBeUndefined();
  });

  it('finds the turn a persona click jumps to', () => {
    const t = toTranscript(
      [step('a1', 'p1', 'Eins.'), step('a2', 'p2', 'Zwei.'), step('a3', 'p1', 'Drei.')],
      { participants },
    );
    const [a1, a2, a3] = t.clips;
    // Speaking at the cursor: stays on that turn.
    expect(nextTurnOf(t.clips, 'p1', a1.start + 0.1)?.guid).toBe('a1');
    // Someone else speaking: the persona's next turn.
    expect(nextTurnOf(t.clips, 'p1', a2.start + 0.1)?.guid).toBe('a3');
    // Past the last turn: back to the first.
    expect(nextTurnOf(t.clips, 'p2', a3.end + 10)?.guid).toBe('a2');
    expect(nextTurnOf(t.clips, 'nobody', 0)).toBeUndefined();
  });

  it('finds the turn of the moderator by their track', () => {
    const t = toTranscript([step('a1', 'p1', 'Eins.'), step('m1', 'mod', 'Danke. Und weiter?')], { participants });
    expect(nextTurnOf(t.clips, MODERATOR_TRACK, 0)?.guid).toBe('m1');
  });
});
