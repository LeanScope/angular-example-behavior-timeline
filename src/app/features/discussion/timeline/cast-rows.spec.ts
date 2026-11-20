import { castHint, castRows, type TimelineCast } from './cast-rows';

const persona = (guid: string, picked = false) => ({ guid, name: guid.toUpperCase(), initials: guid[0], picked });

const cast = (patch: Partial<TimelineCast>): TimelineCast => ({
  asked: null,
  question: '',
  editable: { moderator: true, participants: true },
  options: { moderator: [], participants: [] },
  choices: { moderator: [persona('m1'), persona('m2', true)], participants: [persona('p1', true), persona('p2')] },
  ready: false,
  ...patch,
});

describe('castRows', () => {
  it('shows no candidates while the session asks for no role', () => {
    expect(castRows(null)).toEqual([]);
    expect(castRows(cast({}))).toEqual([]);
    expect(castHint(cast({}))).toBeNull();
  });

  it('lists everyone offered for the asked role, picked or not', () => {
    const rows = castRows(cast({ asked: 'participants' }));
    expect(rows.map((r) => [r.id, r.picked, r.role])).toEqual([
      ['p1', true, 'participants'],
      ['p2', false, 'participants'],
    ]);
  });

  it('gives a moderator candidate a track of its own', () => {
    const rows = castRows(cast({ asked: 'moderator' }));
    expect(rows.map((r) => r.id)).toEqual(['candidate:m1', 'candidate:m2']);
    expect(rows.find((r) => r.picked)?.guid).toBe('m2');
  });

  it('says the question in the asked row, or what to do, or that the personas are on their way', () => {
    expect(castHint(cast({ asked: 'moderator', question: ' Wer moderiert? ' }))).toBe('Wer moderiert?');
    expect(castHint(cast({ asked: 'participants' }))).toContain('Teilnehmenden');
    expect(castHint(cast({ asked: 'moderator', choices: { moderator: [], participants: [] } }))).toBe(
      'Personas werden geladen …',
    );
  });
});
