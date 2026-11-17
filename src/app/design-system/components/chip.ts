import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DsIcon } from './icon';

/** A filter / tag chip. With `removable`, it shows an × that emits `removed`. */
@Component({
  selector: 'ds-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DsIcon],
  template: `
    <span class="label"><ng-content /></span>
    @if (removable()) {
      <button type="button" class="remove" [attr.aria-label]="'Entfernen: ' + removeLabel()" (click)="removed.emit()">
        <ds-icon name="close" />
      </button>
    }
  `,
  host: { '[attr.data-tone]': 'tone()' },
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      max-width: 100%;
      padding: var(--space-1) var(--space-3);
      border-radius: var(--radius-pill);
      background: var(--color-accent-soft);
      color: var(--color-accent-hover);
      font-size: var(--text-xs);
      font-weight: 600;
      line-height: 1.4;
    }
    :host([data-tone='neutral']) {
      background: var(--color-surface-sunken);
      color: var(--color-muted);
    }
    .label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .remove {
      display: inline-grid;
      place-items: center;
      width: 1.1rem;
      height: 1.1rem;
      margin-right: calc(var(--space-1) * -1);
      padding: 0;
      border-radius: var(--radius-pill);
      background: transparent;
      color: inherit;
    }
    .remove:hover {
      background: color-mix(in oklch, currentColor 15%, transparent);
    }
  `,
})
export class DsChip {
  readonly removable = input(false);
  readonly removeLabel = input('');
  readonly tone = input<'accent' | 'neutral'>('accent');
  readonly removed = output<void>();
}
