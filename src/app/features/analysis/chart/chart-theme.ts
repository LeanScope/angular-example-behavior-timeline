// Builds the ECharts theme from the design tokens, so charts follow the active brand (and the
// dark player theme). Charts never set colours themselves: they use this theme.

export interface ChartTheme {
  color: string[];
  backgroundColor: string;
  textStyle: { fontFamily: string; color: string };
  legend: { textStyle: { color: string } };
  categoryAxis: AxisTheme;
  valueAxis: AxisTheme;
  tooltip: { backgroundColor: string; borderColor: string; textStyle: { color: string } };
  visualMap: { inRange: { color: string[] } };
}

interface AxisTheme {
  axisLine: { lineStyle: { color: string } };
  axisTick: { show: boolean };
  axisLabel: { color: string };
  splitLine: { lineStyle: { color: string } };
}

/** Reads a token. `toColor` turns any CSS colour (e.g. oklch) into one ECharts can blend. */
export function buildChartTheme(
  read: (token: string) => string,
  toColor: (css: string) => string = (css) => css,
): ChartTheme {
  const c = (token: string) => toColor(read(token).trim());
  const label = c('--chart-label');
  const grid = c('--chart-grid');
  const axis: AxisTheme = {
    axisLine: { lineStyle: { color: grid } },
    axisTick: { show: false },
    axisLabel: { color: label },
    splitLine: { lineStyle: { color: grid } },
  };
  return {
    color: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => c(`--chart-${i}`)),
    backgroundColor: 'transparent',
    textStyle: { fontFamily: read('--font-sans').trim(), color: c('--color-text') },
    legend: { textStyle: { color: label } },
    categoryAxis: axis,
    valueAxis: axis,
    tooltip: {
      backgroundColor: c('--color-surface'),
      borderColor: c('--color-border'),
      textStyle: { color: c('--color-text') },
    },
    visualMap: { inRange: { color: [c('--color-accent-soft'), c('--color-accent')] } },
  };
}

/** Resolves any CSS colour to rgb() with a 1×1 canvas. Falls back to the input (e.g. in tests). */
export function cssColorToRgb(css: string): string {
  if (typeof document === 'undefined' || !css) return css;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  } catch {
    return css;
  }
  if (!ctx) return css;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`; // brand-ok: probe output
}
