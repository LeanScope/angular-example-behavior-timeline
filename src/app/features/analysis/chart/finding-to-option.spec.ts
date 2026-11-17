import type { Finding, FindingChart } from '../finding/finding.types';
import { findingToOption, formatValue } from './finding-to-option';

function finding(chart: FindingChart | null): Finding {
  return {
    v: 1,
    title: 't',
    takeaway: 'k',
    chart,
    population: { description: '', n: null },
    evidence: [],
    sources: [],
  };
}

const BAR: FindingChart = {
  kind: 'bar',
  unit: 'count',
  x: { label: 'Kampagne', categories: ['K1', 'K2'] },
  series: [{ name: 'n', values: [1, 3] }],
};

describe('findingToOption', () => {
  it('returns null without a chart', () => {
    expect(findingToOption(finding(null))).toBeNull();
  });

  it('builds a vertical bar chart for short labels', () => {
    const option = findingToOption(finding(BAR)) as Record<string, any>;
    expect(option['xAxis'].type).toBe('category');
    expect(option['series'][0].data).toEqual([1, 3]);
    expect(option['legend'].show).toBe(false);
  });

  it('turns horizontal for long labels and stacks to 100', () => {
    const option = findingToOption(
      finding({
        ...BAR,
        kind: 'stackedBar100',
        unit: 'percent',
        x: { label: '', categories: ['Regionale Verwurzelung', 'K2'] },
        series: [
          { name: 'a', values: [40, 50] },
          { name: 'b', values: [60, 50] },
        ],
      }),
    ) as Record<string, any>;
    expect(option['yAxis'].type).toBe('category');
    expect(option['xAxis'].max).toBe(100);
    expect(option['series'][0].stack).toBe('total');
  });

  it('maps a pie chart to name/value data', () => {
    const option = findingToOption(finding({ ...BAR, kind: 'pie' })) as Record<string, any>;
    expect(option['series'][0].data).toEqual([
      { name: 'K1', value: 1 },
      { name: 'K2', value: 3 },
    ]);
  });

  it('formats German numbers', () => {
    expect(formatValue(12.5, 'percent')).toBe('12,5 %');
    expect(formatValue(1234, 'count')).toBe('1.234');
  });
});
