import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DsIcon } from '../../../design-system';
import type { Example } from './examples';

/**
 * Sample questions as cards; a click puts the question into the input.
 */
@Component({
  selector: 'app-example-cards',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DsIcon],
  template: `
    @for (e of examples(); track e.text) {
      <button type="button" class="card" [class.small]="small()" (click)="pick.emit(e.text)">
        <ds-icon [name]="e.icon" /> <span>{{ e.text }}</span>
      </button>
    }
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
      gap: var(--space-3);
    }
    .card {
      display: flex;
      gap: var(--space-3);
      align-items: flex-start;
      padding: var(--space-4);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      color: var(--color-text);
      font-size: var(--text-sm);
      text-align: left;
      transition:
        transform var(--motion-fast) var(--ease-standard),
        box-shadow var(--motion-fast) var(--ease-standard),
        border-color var(--motion-fast) var(--ease-standard);
    }
    .card.small {
      padding: var(--space-2) var(--space-3);
      font-size: var(--text-xs);
    }
    .card ds-icon {
      flex: none;
      color: var(--color-accent);
    }
    .card:hover {
      border-color: var(--color-accent);
      box-shadow: var(--elevation-2);
      transform: translateY(-2px);
    }
    @media (prefers-reduced-motion: reduce) {
      .card {
        transition: none;
      }
      .card:hover {
        transform: none;
      }
    }
  `,
})
export class ExampleCards {
  readonly examples = input.required<Example[]>();
  /** The compact variant above the input, once there are answers. */
  readonly small = input(false);
  readonly pick = output<string>();
}
