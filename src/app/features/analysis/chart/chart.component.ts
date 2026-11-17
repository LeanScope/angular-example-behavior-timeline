import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { BarChart, HeatmapChart, PieChart } from 'echarts/charts';
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { UniversalTransition } from 'echarts/features';
import { SVGRenderer } from 'echarts/renderers';
import type { Finding } from '../finding/finding.types';
import { buildChartTheme, cssColorToRgb } from './chart-theme';
import { findingToOption } from './finding-to-option';

echarts.use([
  BarChart,
  PieChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  AriaComponent,
  UniversalTransition,
  SVGRenderer,
]);

let themeCount = 0;

/**
 * Renders a finding's chart with ECharts (SVG). The colours come from the design tokens at the
 * chart's place in the page, read once when the chart is first drawn.
 */
@Component({
  selector: 'app-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
  host: { role: 'img', '[attr.aria-label]': 'finding().title' },
  styles: `
    :host {
      display: block;
      width: 100%;
      height: 18rem;
    }
  `,
})
export class ChartComponent {
  readonly finding = input.required<Finding>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly destroyRef = inject(DestroyRef);
  private readonly ready = signal(false);
  private chart?: echarts.ECharts;

  constructor() {
    afterNextRender(() => {
      const resize = new ResizeObserver(() => this.chart?.resize({ animation: { duration: 200 } }));
      resize.observe(this.host);
      this.destroyRef.onDestroy(() => {
        resize.disconnect();
        this.chart?.dispose();
      });
      this.ready.set(true);
    });

    effect(() => {
      const option = findingToOption(this.finding());
      if (!this.ready() || !option) return;
      if (!this.chart) {
        const style = getComputedStyle(this.host);
        const theme = `brand-${++themeCount}`;
        echarts.registerTheme(
          theme,
          buildChartTheme((token) => style.getPropertyValue(token), cssColorToRgb),
        );
        this.chart = echarts.init(this.host, theme, { renderer: 'svg' });
      }
      // Replace series so removed ones disappear.
      this.chart.setOption(option, {
        notMerge: false,
        replaceMerge: ['series', 'xAxis', 'yAxis', 'visualMap'],
        lazyUpdate: true,
      });
    });
  }
}
