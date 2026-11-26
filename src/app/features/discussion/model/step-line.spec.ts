import { spokenTextOf } from './step-line';

describe('spokenTextOf', () => {
  it('reads plain text as itself', () => {
    expect(spokenTextOf('  Ja, ich klicke auf „Weiter“.  ')).toBe('Ja, ich klicke auf „Weiter“.');
  });

  it('reads a review envelope without a note as nothing', () => {
    expect(spokenTextOf(JSON.stringify({ kind: 'review', schema: {}, data: { a: 1 } }))).toBe('');
  });

  it('reads a review envelope with a note as the note', () => {
    expect(spokenTextOf(JSON.stringify({ kind: 'review', data: {}, note: ' Welche Rolle? ' }))).toBe('Welche Rolle?');
  });

  it('reads any other envelope as nothing, spaced JSON too', () => {
    expect(spokenTextOf('{ "kind": "handoff", "scenarioGuid": "x" }')).toBe('');
  });

  it('keeps JSON without a kind and text that only looks like JSON', () => {
    expect(spokenTextOf('{"a":1}')).toBe('{"a":1}');
    expect(spokenTextOf('{not json')).toBe('{not json');
    expect(spokenTextOf(null)).toBe('');
  });
});
