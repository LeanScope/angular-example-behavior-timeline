import type { Finding, FindingChart } from '../finding/finding.types';

// Maps a finding's chart data to an ECharts option. No colours here: the 'brand' theme sets them.
// Kept as a plain object type so this file needs no ECharts import (and stays testable).
export type ChartOption = Record<string, unknown>;

const LOCALE = 'de-DE';

export function formatValue(value: number, unit: FindingChart['unit']): string {
  if (unit === 'percent') return `${value.toLocaleString(LOCALE, { maximumFractionDigits: 1 })} %`;
  return value.toLocaleString(LOCALE, { maximumFractionDigits: 0 });
}

/** The option for a finding, or null when it has no chart. */
export function findingToOption(finding: Finding): ChartOption | null {
  const chart = finding.chart;
  if (!chart) return null;
  const fmt = (v: unknown) => (typeof v === 'number' ? formatValue(v, chart.unit) : String(v ?? ''));
  const multi = chart.series.length > 1;

  const base: ChartOption = {
    animationDuration: 600,
    animationDurationUpdate: 500,
    animationEasingUpdate: 'cubicInOut',
    aria: { enabled: true, decal: { show: false } },
    tooltip: { trigger: chart.kind === 'pie' ? 'item' : 'axis', valueFormatter: fmt, confine: true },
    legend:
      multi || chart.kind === 'pie'
        ? { show: true, bottom: 0, type: 'scroll', icon: 'roundRect', itemWidth: 12, itemHeight: 8 }
        : { show: false },
  };

  if (chart.kind === 'pie') {
    const s = chart.series[0];
    return {
      ...base,
      series: [
        {
          type: 'pie',
          radius: ['40%', '68%'],
          itemStyle: { borderWidth: 2, borderColor: 'transparent' },
          label: { formatter: (p: { name: string; value: number }) => `${p.name}\n${fmt(p.value)}` },
          data: chart.x.categories.map((name, i) => ({ name, value: s.values[i] })),
        },
      ],
    };
  }

  if (chart.kind === 'heatmap') {
    const data = chart.series.flatMap((s, y) => s.values.map((v, x) => [x, y, v]));
    const values = data.map((d) => d[2]);
    return {
      ...base,
      tooltip: {
        position: 'top',
        formatter: (p: { value: number[] }) =>
          `${chart.x.categories[p.value[0]]} × ${chart.series[p.value[1]].name}: ${fmt(p.value[2])}`,
      },
      grid: { left: 8, right: 8, top: 8, bottom: 48, containLabel: true },
      xAxis: {
        type: 'category',
        data: chart.x.categories,
        axisLabel: { interval: 0, rotate: chart.x.categories.length > 5 ? 30 : 0 },
      },
      yAxis: { type: 'category', data: chart.series.map((s) => s.name) },
      visualMap: {
        min: Math.min(...values),
        max: Math.max(...values),
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        calculable: false,
      },
      series: [{ type: 'heatmap', data, label: { show: true, formatter: (p: { value: number[] }) => fmt(p.value[2]) } }],
    };
  }

  // Long category labels read better on a horizontal bar chart.
  const horizontal = chart.x.categories.some((c) => c.length > 14);
  const stacked = chart.kind === 'stackedBar100';
  const categoryAxis = {
    type: 'category',
    data: chart.x.categories,
    axisLabel: horizontal ? { width: 160, overflow: 'truncate' } : { interval: 0, hideOverlap: true },
    inverse: horizontal,
  };
  const valueAxis = {
    type: 'value',
    max: stacked ? 100 : undefined,
    minInterval: chart.unit === 'count' ? 1 : undefined,
    axisLabel: { formatter: (v: number) => fmt(v) },
  };

  return {
    ...base,
    // Room for the legend below the axis labels when there are several series.
    grid: { left: 8, right: 16, top: 16, bottom: multi ? 32 : 8, containLabel: true },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series: chart.series.map((s) => ({
      name: s.name,
      type: 'bar',
      data: s.values,
      stack: stacked ? 'total' : undefined,
      barMaxWidth: 36,
      itemStyle: { borderRadius: stacked ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] },
      label: {
        show: !multi,
        position: horizontal ? 'right' : 'top',
        formatter: (p: { value: number }) => fmt(p.value),
      },
      emphasis: { focus: 'series' },
      universalTransition: true,
    })),
  };
}
