import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DsButton, DsIcon, DsSkeleton } from '../../../design-system';
import type { RecordingEntry } from '../model/repository-recording';

/**
 * Lists the recorded discussions of the connected repository to open one. The page loads the
 * list (`RECORDINGS`) and hands it in; `null` means it is still being read.
 */
@Component({
  selector: 'app-recording-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DsButton, DsIcon, DsSkeleton],
  host: { '(document:keydown.escape)': 'closed.emit()' },
  template: `
    <div class="backdrop" (click)="closed.emit()"></div>
    <section class="panel" role="dialog" aria-modal="true" aria-labelledby="recording-picker-title">
      <header>
        <h2 id="recording-picker-title">Aufzeichnung aus LeanScope öffnen</h2>
        <button ds-button variant="ghost" size="icon" type="button" aria-label="Schließen" (click)="closed.emit()">
          <ds-icon name="close" />
        </button>
      </header>
      @if (error(); as message) {
        <p class="note" role="alert">{{ message }}</p>
      } @else if (recordings(); as list) {
        @if (list.length) {
          <ul>
            @for (recording of list; track recording.guid) {
              <li>
                <button
                  type="button"
                  [class.current]="recording.guid === current()"
                  [attr.aria-current]="recording.guid === current() ? 'true' : null"
                  (click)="picked.emit(recording.guid)"
                >
                  <ds-icon name="message" /> <span>{{ recording.title }}</span>
                </button>
              </li>
            }
          </ul>
        } @else {
          <p class="note">In diesem Repository gibt es keine aufgezeichnete Diskussion.</p>
        }
      } @else {
        <div class="loading" aria-busy="true" aria-label="Aufzeichnungen werden geladen">
          <ds-skeleton /> <ds-skeleton /> <ds-skeleton />
        </div>
      }
    </section>
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 40;
      display: grid;
      place-items: center;
      padding: var(--space-5);
    }
    .backdrop {
      position: absolute;
      inset: 0;
      background: color-mix(in oklab, var(--color-text) 40%, transparent);
    }
    .panel {
      position: relative;
      display: grid;
      gap: var(--space-3);
      width: min(32rem, 100%);
      max-height: min(32rem, 100%);
      padding: var(--space-4);
      overflow: auto;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      color: var(--color-text);
      box-shadow: var(--elevation-3);
    }
    header {
      display: flex;
      gap: var(--space-3);
      align-items: center;
      justify-content: space-between;
    }
    h2 {
      margin: 0;
      font-size: var(--text-md, 1rem);
    }
    ul {
      display: grid;
      gap: var(--space-1);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li button {
      display: flex;
      gap: var(--space-2);
      align-items: center;
      width: 100%;
      padding: var(--space-2) var(--space-3);
      border: 0;
      border-radius: var(--radius-sm);
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: var(--text-sm);
      text-align: left;
      cursor: pointer;
    }
    li button:hover,
    li button.current {
      background: var(--color-surface-sunken);
    }
    li button.current {
      font-weight: 600;
    }
    .note {
      margin: 0;
      font-size: var(--text-sm);
    }
    .loading {
      display: grid;
      gap: var(--space-2);
    }
  `,
})
export class RecordingPicker {
  /** The recordings to offer; `null` while they are being read. */
  readonly recordings = input<RecordingEntry[] | null>(null);
  /** Why the list could not be read. */
  readonly error = input<string | null>(null);
  /** The guid of the recording shown right now. */
  readonly current = input<string | undefined>();

  readonly picked = output<string>();
  readonly closed = output<void>();
}
