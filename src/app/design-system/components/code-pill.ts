import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * A small tag for a variable code (A1, B6, …). `tone` picks one of the section colours
 * (--section-1 … --section-8); 0 is neutral, for codes the catalog doesn't know.
 */
@Component({
  selector: 'ds-code-pill',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `{{ code() }}`,
  host: {
    '[style.--pill-bg]': 'bg()',
    '[style.--pill-ink]': 'ink()',
    '[attr.title]': 'title() || null',
  },
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      flex: none;
      padding: 0.0625rem var(--space-2);
      border-radius: var(--radius-pill);
      background: var(--pill-bg);
      color: var(--pill-ink);
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      font-weight: 600;
      line-height: 1.5;
      letter-spacing: 0.02em;
      white-space: nowrap;
    }
  `,
})
export class DsCodePill {
  readonly code = input.required<string>();
  readonly tone = input(0);
  readonly title = input('');

  private readonly slot = computed(() => {
    const t = Math.trunc(this.tone());
    return t >= 1 && t <= 8 ? t : 0;
  });
  protected readonly bg = computed(() => `var(--section-${this.slot()}-bg)`);
  protected readonly ink = computed(() => `var(--section-${this.slot()}-ink)`);
}
