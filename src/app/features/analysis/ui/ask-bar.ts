import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import { DsButton, DsIcon } from '../../../design-system';

/**
 * The question field. Enter sends, Shift+Enter makes a new line.
 */
@Component({
  selector: 'app-ask-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DsButton, DsIcon],
  template: `
    <form class="bar" (submit)="$event.preventDefault(); send()">
      <label class="sr-only" for="analysis-question">Ihre Frage an die Studie</label>
      <textarea
        #field
        id="analysis-question"
        rows="1"
        [value]="text()"
        (input)="text.set(field.value)"
        (keydown.enter)="onEnter($event)"
        [attr.maxlength]="max()"
        [disabled]="!enabled()"
        [placeholder]="enabled() ? placeholder() : 'Einen Moment …'"
      ></textarea>
      <span class="count" [class.over]="left() < 20" aria-live="polite">{{ left() }}</span>
      <button ds-button size="icon" type="submit" [disabled]="!canSend()" aria-label="Frage senden">
        <ds-icon name="send" />
      </button>
    </form>
  `,
  styles: `
    .bar {
      display: flex;
      gap: var(--space-2);
      align-items: flex-end;
      padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      box-shadow: var(--elevation-2);
      transition: border-color var(--motion-fast) var(--ease-standard);
    }
    .bar:focus-within {
      border-color: var(--color-accent);
    }
    textarea {
      flex: 1;
      min-height: 2.25rem;
      max-height: 9rem;
      padding: var(--space-2) 0;
      border: 0;
      outline: none;
      background: transparent;
      color: var(--color-text);
      font: inherit;
      resize: none;
      field-sizing: content;
    }
    .count {
      align-self: center;
      color: var(--color-muted);
      font-size: var(--text-xs);
      font-variant-numeric: tabular-nums;
    }
    .count.over {
      color: var(--color-danger);
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
  `,
})
export class AskBar {
  readonly text = model('');
  readonly enabled = input(true);
  readonly max = input(200);
  readonly placeholder = input('Was möchten Sie über die Diskussion wissen?');
  readonly ask = output<string>();

  private readonly injector = inject(Injector);
  private readonly field = viewChild.required<ElementRef<HTMLTextAreaElement>>('field');
  protected readonly left = computed(() => this.max() - this.text().length);
  protected readonly canSend = computed(
    () => this.enabled() && this.text().trim().length > 0 && this.left() >= 0,
  );

  /** Focuses the field after the next render, with the caret at the end of the text. */
  focus(): void {
    afterNextRender(
      () => {
        const el = this.field().nativeElement;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      },
      { injector: this.injector },
    );
  }

  protected onEnter(event: Event): void {
    if ((event as KeyboardEvent).shiftKey) return;
    event.preventDefault();
    this.send();
  }

  protected send(): void {
    if (!this.canSend()) return;
    this.ask.emit(this.text().trim());
    this.text.set('');
  }
}
