import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { BrandService } from '../../../../design-system/brand.service';
import { buildLoadingLineShape, type LoadingLineShape } from './loading-line-shape';

/** One morph per line: every busy indicator of a brand shares it. */
const shapes = new Map<string, LoadingLineShape>();

/**
 * Decorative inline loading indicator: the brand's busy line (`busyLine` in its brand.json, e.g.
 * a line from its logo) as an open line in the current text color. It rests, then a wave
 * flattens and regrows it from left to right. Without a busy line it takes no space.
 */
@Component({
  selector: 'app-loading-line',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.aspect-ratio]': 'aspectRatio()', '[class.empty]': '!shape()' },
  template: `
    @if (shape(); as shape) {
      <svg [attr.viewBox]="shape.viewBox" aria-hidden="true" focusable="false">
        <path
          [attr.d]="shape.rest"
          [attr.stroke-width]="shape.strokeWidth"
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          @if (!reducedMotion()) {
            <animate
              attributeName="d"
              dur="1.6s"
              repeatCount="indefinite"
              calcMode="linear"
              [attr.keyTimes]="shape.keyTimes"
              [attr.values]="shape.values"
            />
          }
        </path>
      </svg>
    }
  `,
  styles: `
    :host {
      display: inline-block;
      flex: none;
      height: var(--loading-line-height, 0.85em);
      vertical-align: middle;
    }
    :host(.empty) {
      display: none;
    }

    svg {
      display: block;
      width: 100%;
      height: 100%;
      overflow: visible;
    }
  `,
})
export class LoadingLine {
  private readonly busyLine = inject(BrandService).busyLine;
  protected readonly shape = computed(() => {
    const line = this.busyLine();
    if (!line) return null;
    const key = `${line.strokeWidth} ${line.path}`;
    let shape = shapes.get(key);
    if (!shape) {
      try {
        shape = buildLoadingLineShape(line.path, line.strokeWidth);
      } catch {
        return null;
      }
      shapes.set(key, shape);
    }
    return shape;
  });
  protected readonly aspectRatio = computed(() => {
    const shape = this.shape();
    if (!shape) return null;
    const [, , width, height] = shape.viewBox.split(' ').map(Number);
    return `${width} / ${height}`;
  });
  /** SMIL morphs ignore CSS media queries, so the template drops the morph when reduced motion is requested. */
  protected readonly reducedMotion = signal(false);

  constructor() {
    const query = inject(DOCUMENT).defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    this.reducedMotion.set(query.matches);
    const update = (event: MediaQueryListEvent) => this.reducedMotion.set(event.matches);
    query.addEventListener('change', update);
    inject(DestroyRef).onDestroy(() => query.removeEventListener('change', update));
  }
}
