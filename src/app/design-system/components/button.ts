import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** `<button ds-button variant="secondary">` — all looks come from tokens. */
@Component({
  selector: 'button[ds-button], a[ds-button]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: { class: 'ds-button', '[attr.data-variant]': 'variant()', '[attr.data-size]': 'size()' },
  styles: `
    :host {
      --button-bg: var(--color-accent);
      --button-fg: var(--color-accent-contrast);
      --button-bg-hover: var(--color-accent-hover);
      --button-border: transparent;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      min-height: 2.5rem;
      padding: 0 var(--space-4);
      border: 1px solid var(--button-border);
      border-radius: var(--radius-sm);
      background: var(--button-bg);
      color: var(--button-fg);
      font: inherit;
      font-weight: 600;
      font-size: var(--text-sm);
      text-decoration: none;
      white-space: nowrap;
      cursor: pointer;
      transition:
        background var(--motion-fast) var(--ease-standard),
        transform var(--motion-fast) var(--ease-standard),
        box-shadow var(--motion-fast) var(--ease-standard);
    }
    :host(:hover:not(:disabled)) {
      background: var(--button-bg-hover);
    }
    :host(:active:not(:disabled)) {
      transform: scale(0.97);
    }
    :host(:disabled) {
      opacity: 0.45;
      cursor: default;
    }
    :host([data-variant='secondary']) {
      --button-bg: var(--color-surface);
      --button-fg: var(--color-text);
      --button-bg-hover: var(--color-surface-sunken);
      --button-border: var(--color-border);
    }
    :host([data-variant='ghost']) {
      --button-bg: transparent;
      --button-fg: var(--color-text);
      --button-bg-hover: var(--color-surface-sunken);
    }
    :host([data-variant='danger']) {
      --button-bg: var(--color-danger);
      --button-bg-hover: var(--color-danger);
    }
    :host([data-size='sm']) {
      min-height: 2rem;
      padding: 0 var(--space-3);
      font-size: var(--text-xs);
    }
    :host([data-size='icon']) {
      min-height: 2.25rem;
      width: 2.25rem;
      padding: 0;
    }
  `,
})
export class DsButton {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<'md' | 'sm' | 'icon'>('md');
}
