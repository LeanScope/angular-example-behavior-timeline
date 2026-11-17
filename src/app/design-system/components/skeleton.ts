import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Shimmering placeholder lines while something loads. */
@Component({
  selector: 'ds-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@for (w of widths(); track $index) {
    <span class="line" [style.width.%]="w"></span>
  }`,
  styles: `
    :host {
      display: grid;
      gap: var(--space-2);
    }
    .line {
      display: block;
      height: 0.8rem;
      border-radius: var(--radius-sm);
      background: linear-gradient(90deg, var(--color-surface-sunken) 0%, var(--color-border) 50%, var(--color-surface-sunken) 100%);
      background-size: 200% 100%;
      animation: shimmer 1.4s linear infinite;
    }
    @keyframes shimmer {
      from {
        background-position: 100% 0;
      }
      to {
        background-position: -100% 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .line {
        animation: none;
      }
    }
  `,
})
export class DsSkeleton {
  readonly widths = input([92, 78, 85, 60]);
}
