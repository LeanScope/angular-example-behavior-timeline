import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type DsStatusState = 'demo' | 'ready' | 'thinking' | 'error' | 'idle';

/**
 * A status light with its label ("● Demo"). On small screens only the light shows; the label
 * stays for screen readers and in the tooltip.
 */
@Component({
  selector: 'ds-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="label">{{ label() }}</span>`,
  host: {
    role: 'status',
    '[attr.data-state]': 'state()',
    '[attr.title]': 'title() || label()',
  },
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      gap: var(--space-2);
      align-items: center;
      color: var(--color-muted);
      font-size: var(--text-xs);
      font-weight: 600;
      white-space: nowrap;
    }
    :host::before {
      content: '';
      width: 0.5rem;
      height: 0.5rem;
      border-radius: var(--radius-pill);
      background: var(--color-muted);
    }
    :host([data-state='ready'])::before {
      background: var(--color-success);
    }
    :host([data-state='thinking'])::before {
      background: var(--color-accent);
      animation: pulse 1s var(--ease-standard) infinite alternate;
    }
    :host([data-state='error'])::before {
      background: var(--color-danger);
    }
    :host([data-state='demo'])::before {
      background: var(--color-warning);
    }
    @media (max-width: 36rem) {
      .label {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
      }
    }
    @keyframes pulse {
      from {
        opacity: 0.4;
      }
      to {
        opacity: 1;
      }
    }
  `,
})
export class DsStatus {
  readonly state = input.required<DsStatusState>();
  readonly label = input.required<string>();
  /** A longer explanation for the tooltip (default: the label). */
  readonly title = input<string | null>(null);
}
