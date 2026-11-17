import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, input } from '@angular/core';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

/** Renders the agent's Markdown (sanitized). Used for the readable part of an answer. */
@Component({
  selector: 'ds-markdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<div class="ds-md" [innerHTML]="html()"></div>',
  // The HTML comes in via innerHTML, which emulated encapsulation can't reach: styles are global
  // but scoped by the .ds-md class.
  encapsulation: ViewEncapsulation.None,
  styles: `
    .ds-md {
      overflow-wrap: anywhere;
      font-size: var(--text-sm);
    }
    .ds-md :is(p, ul, ol) {
      margin: 0 0 var(--space-3);
    }
    .ds-md :last-child {
      margin-bottom: 0;
    }
    .ds-md table {
      width: 100%;
      margin: var(--space-3) 0;
      border-collapse: collapse;
      font-variant-numeric: tabular-nums;
    }
    .ds-md :is(th, td) {
      padding: var(--space-1) var(--space-2);
      border-bottom: 1px solid var(--color-border);
      text-align: left;
    }
    .ds-md th {
      color: var(--color-muted);
      font-weight: 600;
    }
    .ds-md code {
      padding: 0 var(--space-1);
      border-radius: var(--radius-sm);
      background: var(--color-surface-sunken);
    }
    .ds-md pre {
      overflow: auto;
      padding: var(--space-3);
      border-radius: var(--radius-sm);
      background: var(--color-surface-sunken);
    }
  `,
})
export class DsMarkdown {
  readonly text = input.required<string>();
  protected readonly html = computed(() =>
    DOMPurify.sanitize(marked.parse(this.text(), { async: false, gfm: true, breaks: false }) as string),
  );
}
