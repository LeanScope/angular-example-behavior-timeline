import { parseAnswer } from './parse-finding';

const FINDING = {
  v: 1,
  title: 'Lieblingskampagne',
  takeaway: 'Die zweite Linie gewinnt.',
  chart: {
    kind: 'bar',
    unit: 'count',
    x: { label: 'Kampagne', categories: ['K1', 'K2', 'K3'] },
    series: [{ name: 'Teilnehmende', values: [2, 4, 0] }],
  },
  population: { description: '6 Teilnehmende', n: 6 },
  evidence: [{ speaker: 'Max', questionCode: 'D2', quote: 'Die zweite hat die meiste Wirkung.' }],
  sources: ['Discussion Guide'],
};

describe('parseAnswer', () => {
  it('splits text and a tagged finding block', () => {
    const line = 'Kurz gesagt: K2.\n\n```finding\n' + JSON.stringify(FINDING) + '\n```';
    const parsed = parseAnswer(line);
    expect(parsed.text).toBe('Kurz gesagt: K2.');
    expect(parsed.problem).toBeNull();
    expect(parsed.finding?.chart?.series[0].values).toEqual([2, 4, 0]);
    expect(parsed.finding?.evidence[0].questionCode).toBe('D2');
  });

  it('accepts an untagged block with trailing commas and no closing fence', () => {
    const json = JSON.stringify(FINDING).replace('"sources"', '"x_extra":[1,],"sources"');
    const parsed = parseAnswer('Text\n```\n' + json);
    expect(parsed.finding?.title).toBe('Lieblingskampagne');
  });

  it('drops series whose length does not match the categories and falls back on the kind', () => {
    const raw = {
      ...FINDING,
      chart: {
        ...FINDING.chart,
        kind: 'radar',
        series: [
          { name: 'a', values: [1, 2, 3] },
          { name: 'b', values: [1] },
        ],
      },
    };
    const parsed = parseAnswer('```finding\n' + JSON.stringify(raw) + '\n```');
    expect(parsed.finding?.chart?.series.map((s) => s.name)).toEqual(['a']);
    expect(parsed.finding?.chart?.kind).toBe('bar');
  });

  it('never throws on broken JSON', () => {
    const parsed = parseAnswer('Antwort\n```finding\n{ nope\n```');
    expect(parsed.finding).toBeNull();
    expect(parsed.text).toBe('Antwort');
    expect(parsed.problem).toContain('JSON');
  });

  it('returns the whole text when there is no block', () => {
    expect(parseAnswer(' Nur Text ')).toEqual({ text: 'Nur Text', finding: null, problem: null });
  });
});
