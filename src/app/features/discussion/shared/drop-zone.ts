import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DsIcon } from '../../../design-system';
import { LoadingLine } from '../../analysis/ui/loading-line/loading-line';
import type { IngestJob } from '../state/ingest.service';
import { canPickPerPlace, pickFiles } from './file-picker';

/**
 * A place to drop (or pick) documents, with the jobs that read them in. Which kind of document
 * is expected is a hint for the user and, through the zone, for the document worker.
 *
 * `asked` highlights the zone while the session asks for its document, and scrolls it into view.
 * The question itself shows in the chat widget's handle, next to the zone (see `SupportWidget`).
 *
 * `locked` takes no documents: `'read-only'` shows what something else filled it with (a
 * recording), `'disabled'` is a zone that has no say right now. `skippable` offers "Überspringen"
 * while the zone is asked for a document the session can do without. `busy` says what is being read
 * into the zone, with the brand's busy line, in place of the hint.
 *
 * `pickerId` gives the zone a file dialog of its own: it opens in the folder its last document was
 * picked from (see `pickFiles`; Chromium only, elsewhere the zones share the browser's folder).
 */
@Component({
  selector: 'app-drop-zone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DsIcon, LoadingLine],
  host: {
    '[class.over]': 'over()',
    '[class.read-only]': "locked() === 'read-only'",
    '[class.disabled]': "locked() === 'disabled'",
    '[class.asked]': 'asked() !== null',
    '(dragover)': 'dragOver($event)',
    '(dragleave)': 'over.set(false)',
    '(drop)': 'drop($event)',
  },
  template: `
    <label class="target" [attr.aria-description]="asked() || null">
      <ds-icon name="download" />
      <span class="text">
        <strong>{{ title() }}</strong>
        @if (busy(); as activity) {
          <span class="hint busy" role="status"><app-loading-line /> {{ activity }} …</span>
        } @else {
          <span class="hint">{{ hint() }}</span>
        }
      </span>
      <!-- What the zone already holds (e.g. the stimuli's thumbnails), under icon and title. -->
      <ng-content />
      <input
        type="file"
        [attr.accept]="accept()"
        [multiple]="multiple()"
        [disabled]="locked() !== null"
        (click)="open($event)"
        (change)="pick($event)"
      />
      <!-- Inside the zone: what was handed over, and the way past a document that is optional. -->
      @if (jobs().length || (asked() !== null && skippable())) {
        <span class="inside" (click)="$event.preventDefault()">
          @for (job of jobs(); track job.id) {
            <span class="job" [attr.data-state]="job.state" role="status">
              <span class="files">{{ job.fileNames.join(', ') }}</span>
              <span class="message">{{ job.message }}</span>
              @if ((job.state === 'done' && locked() === null && !job.fixed) || job.state === 'error') {
                <button type="button" class="dismiss" aria-label="Meldung schließen" (click)="dismiss.emit(job.id)">
                  <ds-icon name="close" />
                </button>
              }
            </span>
          }
          @if (asked() !== null && skippable()) {
            <button type="button" class="skip" (click)="skip.emit()">Überspringen</button>
          }
        </span>
      }
    </label>
  `,
  styles: `
    :host {
      display: grid;
      /* The target fills the zone's height (zones in a row are equally high). */
      grid-template-rows: 1fr;
      /* A long file name wraps instead of widening the zone beyond its grid cell. */
      min-width: 0;
    }
    .target {
      /* The containing block of the hidden file input: without it, the input is placed relative
         to the page and stretches it beyond the scrolling area (the whole layout scrolls away). */
      position: relative;
      display: flex;
      gap: var(--space-3);
      /* The icon sits by the title, whether the hint takes one line or two. */
      align-items: flex-start;
      /* Projected content takes a full row of its own (see the zone's users). */
      flex-wrap: wrap;
      padding: var(--space-4);
      border: 1px dashed var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      color: var(--color-muted);
      cursor: pointer;
      transition: border-color var(--motion-fast) var(--ease-standard);
    }
    :host(.over) .target,
    .target:hover {
      border-color: var(--color-accent);
      color: var(--color-text);
    }
    :host(.over) .target {
      background: var(--color-accent-soft);
    }
    /* Filled by something else, or without a say: no hover, nothing to pick. */
    :host(.read-only) .target,
    :host(.disabled) .target {
      border-color: var(--color-border);
      color: var(--color-muted);
      cursor: default;
    }
    :host(.disabled) .target {
      background: transparent;
      opacity: 0.6;
    }
    /* What is being read in, as the analysis says what it is doing. */
    .hint.busy {
      display: flex;
      gap: var(--space-2);
      align-items: center;
      align-self: start;
      color: var(--color-accent);
      font-weight: 600;
    }
    :host(.asked) .target {
      border: 2px solid var(--color-accent);
      background: var(--color-accent-soft);
      color: var(--color-text);
      animation: ask 2.4s ease-in-out infinite;

      @media (prefers-reduced-motion: reduce) {
        animation: none;
      }
    }
    /* A soft halo that grows out of the edge, from transparent to the accent, and fades back. */
    @keyframes ask {
      0%,
      100% {
        box-shadow: 0 0 0 0 color-mix(in oklch, var(--color-accent) 0%, transparent);
      }
      50% {
        box-shadow: 0 0 1rem 0.2rem color-mix(in oklch, var(--color-accent) 22%, transparent);
      }
    }
    .text {
      display: grid;
      /* A long file name in the hint wraps instead of widening the zone over its neighbour. */
      grid-template-columns: minmax(0, 1fr);
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
      font-size: var(--text-sm);
    }
    /* Every hint reserves two lines, so zones side by side keep one height. */
    .hint {
      min-height: 2lh;
    }
    strong {
      color: var(--color-text);
    }
    input {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
    }
    .target:focus-within {
      outline: 2px solid var(--color-focus);
      outline-offset: 2px;
    }
    /* A full row at the zone's foot. A click here is not a click on the file picker. */
    .inside {
      display: grid;
      flex-basis: 100%;
      gap: var(--space-2);
      min-width: 0;
      cursor: default;
    }
    .skip {
      justify-self: start;
      padding: var(--space-1) var(--space-3);
      border: 1px solid var(--color-accent);
      border-radius: var(--radius-pill);
      background: var(--color-surface);
      color: var(--color-accent);
      font: inherit;
      font-size: var(--text-sm);
      font-weight: 600;
      cursor: pointer;
    }
    .job {
      display: flex;
      /* In a narrow zone the message goes under the file name instead of being squeezed. */
      flex-wrap: wrap;
      gap: var(--space-1) var(--space-2);
      align-items: center;
      margin: 0;
      padding: var(--space-1) var(--space-3);
      border-radius: var(--radius-sm);
      background: var(--color-surface-sunken);
      color: var(--color-text);
      font-size: var(--text-xs);
    }
    .job[data-state='error'] {
      color: var(--color-danger);
    }
    .job[data-state='done'] .message {
      color: var(--color-success);
    }
    .job[data-state='uploading'] .message::before,
    .job[data-state='reading'] .message::before {
      content: '';
      display: inline-block;
      width: 0.5rem;
      height: 0.5rem;
      margin-right: var(--space-1);
      border-radius: var(--radius-pill);
      background: var(--color-accent);
      animation: pulse 0.9s var(--ease-standard) infinite alternate;
    }
    .files {
      flex: 1 1 auto;
      min-width: 0;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .message {
      flex: 1 1 12rem;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .dismiss {
      display: inline-flex;
      padding: 0;
      background: transparent;
      color: inherit;
    }
    @keyframes pulse {
      from {
        opacity: 0.3;
      }
      to {
        opacity: 1;
      }
    }
  `,
})
export class DropZone {
  readonly title = input.required<string>();
  readonly hint = input('');
  readonly accept = input<string | null>(null);
  readonly multiple = input(false);
  readonly jobs = input<IngestJob[]>([]);
  /** Takes no documents: shown as filled by something else, or as switched off. */
  readonly locked = input<'read-only' | 'disabled' | null>(null);
  /** What is being read into the zone right now ("Stimuli werden geladen"), instead of the hint. */
  readonly busy = input<string | null>(null);
  /** What the session said when asking for this zone's document; null when it doesn't ask. */
  readonly asked = input<string | null>(null);
  /** The asked document is optional: the zone offers to go on without it. */
  readonly skippable = input(false);
  /** The zone's own file dialog, which remembers its folder; null uses the shared one. */
  readonly pickerId = input<string | null>(null);
  readonly files = output<File[]>();
  readonly dismiss = output<number>();
  readonly skip = output<void>();

  protected readonly over = signal(false);

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    effect(() => {
      if (this.asked() === null) return;
      queueMicrotask(() => host.scrollIntoView?.({ block: 'center', behavior: 'smooth' }));
    });
  }

  protected dragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    if (this.locked() === null) this.over.set(true);
  }

  protected drop(event: DragEvent): void {
    event.preventDefault();
    this.over.set(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length && this.locked() === null) this.files.emit(files);
  }

  /** Set once the zone's own dialog failed here: the file input opens from then on. */
  private sharedPicker = false;

  /**
   * A click on the zone (or Enter/Space on its input) opens the zone's own dialog instead of the
   * shared one, where the browser has it.
   */
  protected open(event: MouseEvent): void {
    const id = this.pickerId();
    if (!id || this.sharedPicker || !canPickPerPlace()) return;
    event.preventDefault();
    const input = event.target as HTMLInputElement;
    void pickFiles(id, { accept: this.accept(), multiple: this.multiple() }).then((files) => {
      if (files === 'unsupported') {
        this.sharedPicker = true;
        input.click();
      } else if (files.length && this.locked() === null) {
        this.files.emit(files);
      }
    });
  }

  protected pick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length) this.files.emit(files);
  }
}
