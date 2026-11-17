import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DsButton, DsIcon } from '../../../design-system';
import { LoadingLine } from '../../analysis/ui/loading-line/loading-line';
import type { RecordingEntry } from '../model/repository-recording';
import type { Stimulus, Study } from '../model/study.model';
import type { DropZone as Zone, IngestJob } from '../state/ingest.service';
import { DropZone } from '../shared/drop-zone';

const DOCUMENTS = '.md,.markdown,.docx,.xlsx,text/markdown,.vtt,text/vtt';
const STIMULI = 'image/*,application/pdf';

/**
 * The study's goals and research questions (one card each), and the places to drop all study documents.
 */
@Component({
  selector: 'app-study-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DsButton, DsIcon, DropZone, LoadingLine],
  template: `
    <div class="intro">
      <h1>Was möchten Sie herausfinden?</h1>
      <p>
        Legen Sie das Angebot zur Studie ab. Ziele und Forschungsfragen werden daraus gelesen und
        stehen der ganzen Simulation zur Verfügung.
      </p>
    </div>

    <app-drop-zone
      title="Angebot ablegen"
      hint="Word oder Markdown – Ziele und Forschungsfragen werden herausgelesen"
      [accept]="documents"
      [jobs]="jobsOf()('study-brief')"
      [asked]="askedFor('study-brief')"
      (files)="dropped.emit({ zone: 'study-brief', files: $event })"
      (dismiss)="dismiss.emit($event)"
    />

    @if (study().brief; as brief) {
      @if (brief.researchQuestions.length) {
        <h2>Forschungsfragen</h2>
        <div class="cards">
          @for (rq of brief.researchQuestions; track rq.key) {
            <article class="card">
              <ds-icon name="spark" />
              <p>{{ rq.text }}</p>
            </article>
          }
        </div>
      }
      @if (brief.goals.length) {
        <h2>Ziele</h2>
        <ul class="goals">
          @for (goal of brief.goals; track goal.key) {
            <li>{{ goal.text }}</li>
          }
        </ul>
      }
    }

    <h2>Weitere Unterlagen</h2>
    <div class="zones">
      @if (recordings() !== undefined) {
        <div class="recording">
          <ds-icon name="database" />
          <span class="text">
            <strong id="recording-title">Aufzeichnung</strong>
            @if (loadingRecording()) {
              <span class="hint busy" role="status"><app-loading-line /> Aufzeichnung wird gelesen …</span>
            } @else {
              <span class="hint">
                @if (recordingsError(); as error) {
                  {{ error }}
                } @else if (!recordings()) {
                  Aufzeichnungen werden geladen …
                } @else if (!recordings()!.length) {
                  Im verbundenen Repository gibt es keine aufgezeichnete Diskussion.
                } @else if (chosen()) {
                  Leitfaden, Stimuli und Teilnehmende kommen aus dieser Aufzeichnung
                } @else {
                  Eine aufgezeichnete Diskussion aus dem verbundenen Repository
                }
              </span>
            }
          </span>
          @if (recordings()?.length) {
            <span class="choice">
              <select aria-labelledby="recording-title" (change)="pick($event)">
                <option value="" [selected]="!chosen()">Keine Aufzeichnung</option>
                @for (recording of recordings(); track recording.guid) {
                  <option [value]="recording.guid" [selected]="recording.guid === chosen()">
                    {{ recording.title }}
                  </option>
                }
              </select>
              @if (chosen()) {
                <button
                  ds-button
                  variant="ghost"
                  size="icon"
                  type="button"
                  title="Aufzeichnung entfernen"
                  aria-label="Aufzeichnung entfernen"
                  (click)="recordingCleared.emit()"
                >
                  <ds-icon name="close" />
                </button>
              }
            </span>
          }
        </div>
      }
      <app-drop-zone
        title="Leitfaden"
        [hint]="
          study().guide
            ? (fromRecording() ? 'Aus der Aufzeichnung: ' : 'Eingelesen: ') + study().guide!.title
            : fromRecording()
              ? 'Die Aufzeichnung nennt keinen Leitfaden'
              : 'Word oder Markdown – oder eine Aufzeichnung (.vtt)'
        "
        [locked]="fromRecording() ? 'read-only' : null"
        [busy]="loadingRecording() && !study().guide ? 'Leitfaden wird gelesen' : null"
        [accept]="documents"
        [jobs]="jobsOf()('interview-guide')"
        [asked]="askedFor('interview-guide')"
        (files)="dropped.emit({ zone: 'interview-guide', files: $event })"
        (dismiss)="dismiss.emit($event)"
      />
      <app-drop-zone
        class="screener"
        [class.minimized]="fromRecording()"
        [attr.inert]="fromRecording() ? '' : null"
        [attr.aria-hidden]="fromRecording() ? 'true' : null"
        title="Screener"
        [hint]="
          fromRecording()
            ? 'Nicht nötig: Die Teilnehmenden stehen mit der Aufzeichnung fest'
            : study().screener
              ? 'Eingelesen: ' + study().screener!.title
              : 'Excel oder Word, wie er ist'
        "
        [locked]="fromRecording() ? 'disabled' : null"
        [accept]="documents"
        [jobs]="jobsOf()('screener')"
        [asked]="askedFor('screener')"
        (files)="dropped.emit({ zone: 'screener', files: $event })"
        (dismiss)="dismiss.emit($event)"
      />
      <app-drop-zone
        class="wide"
        title="Stimuli"
        [hint]="
          files().length
            ? files().length + (fromRecording() ? ' aus der Aufzeichnung' : ' eingebunden')
            : fromRecording()
              ? 'Die Aufzeichnung zeigt keine Stimuli'
              : 'Bilder, Screenshots oder PDFs'
        "
        [locked]="fromRecording() ? 'read-only' : null"
        [busy]="loadingRecording() ? 'Stimuli werden geladen' : null"
        [accept]="stimuli"
        [multiple]="true"
        [jobs]="jobsOf()('stimulus')"
        [asked]="askedFor('stimulus')"
        (files)="dropped.emit({ zone: 'stimulus', files: $event })"
        (dismiss)="dismiss.emit($event)"
      >
        @if (files().length) {
          <span class="thumbs">
            @for (stimulus of files(); track stimulus.guid) {
              @if (stimulus.mimeType.startsWith('image/')) {
                <img [src]="stimulus.url" [alt]="stimulus.name" [title]="stimulus.name" loading="lazy" />
              } @else {
                <span class="file" [title]="stimulus.name">{{ stimulus.name }}</span>
              }
            }
          </span>
        }
      </app-drop-zone>
    </div>
  `,
  styles: `
    :host {
      display: grid;
      gap: var(--space-5);
      max-width: 60rem;
      margin-inline: auto;
      padding: var(--space-8) var(--space-5);
    }
    h1 {
      margin: 0 0 var(--space-2);
      font-size: var(--text-xl);
    }
    h2 {
      margin: var(--space-3) 0 0;
      font-size: var(--text-md);
    }
    .intro p {
      margin: 0;
      color: var(--color-muted);
      font-size: var(--text-lg);
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
      gap: var(--space-4);
    }
    .card {
      display: flex;
      gap: var(--space-3);
      align-items: flex-start;
      padding: var(--space-5);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      color: var(--color-accent);
    }
    .card p {
      margin: 0;
      color: var(--color-text);
    }
    .goals {
      margin: 0;
      padding-left: var(--space-5);
      color: var(--color-text);
    }
    /*
      One row of cards, equally wide and high, and the stimuli in a row of their own. A flex row
      (not a grid) so a card can give its width away smoothly: with a recording the screener has
      no say, folds away, and the other cards grow into its place.
    */
    .zones {
      --zone-gap: var(--space-4);
      display: flex;
      flex-wrap: wrap;
      gap: var(--zone-gap);
      align-items: stretch;
    }
    .zones > * {
      flex: 1 1 0;
      min-width: 0;
    }
    .zones > .wide {
      flex: 0 0 100%;
    }
    .zones > .screener {
      transition:
        flex-grow var(--motion-slow, 320ms) var(--ease-standard),
        margin var(--motion-slow, 320ms) var(--ease-standard),
        opacity var(--motion-fast) var(--ease-standard),
        visibility 0s;
    }
    .zones > .screener.minimized {
      flex-grow: 0;
      /* Takes its gap along, so the row closes completely. */
      margin-inline-start: calc(-1 * var(--zone-gap));
      overflow: hidden;
      opacity: 0;
      visibility: hidden;
      /* Its text keeps its lines while the card narrows, so the row's height stays. */
      white-space: nowrap;
      transition-delay: 0s, 0s, 0s, var(--motion-slow, 320ms);
    }
    @media (prefers-reduced-motion: reduce) {
      .zones > .screener {
        transition: none;
      }
    }
    /* Narrow: the cards one below the other. */
    @media (max-width: 44rem) {
      .zones > * {
        flex-basis: 100%;
      }
      .zones > .screener.minimized {
        display: none;
      }
    }
    /* The recording to show: a card like the zones, with the list to choose from. */
    .recording {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
      align-items: flex-start;
      min-width: 0;
      padding: var(--space-4);
      border: 1px dashed var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      color: var(--color-muted);
    }
    .recording .text {
      display: grid;
      flex: 1;
      gap: var(--space-1);
      min-width: 0;
    }
    .recording strong {
      color: var(--color-text);
    }
    .recording .text {
      font-size: var(--text-sm);
    }
    .recording .hint {
      min-height: 2lh;
    }
    .recording .hint.busy {
      display: flex;
      gap: var(--space-2);
      align-items: center;
      align-self: start;
      color: var(--color-accent);
      font-weight: 600;
    }
    .recording .choice {
      display: flex;
      flex: 0 0 100%;
      gap: var(--space-2);
      align-items: center;
      min-width: 0;
    }
    .recording select {
      flex: 1;
      min-width: 0;
      min-height: 2.5rem;
      padding: 0 var(--space-3);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      background: var(--color-surface);
      color: var(--color-text);
      font: inherit;
      font-size: var(--text-sm);
    }
    /* The stimuli side by side under the title, as many per row as fit. */
    .thumbs {
      display: grid;
      flex: 0 0 100%;
      grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
      gap: var(--space-3);
      align-items: start;
    }
    .thumbs img {
      display: block;
      width: 100%;
      height: auto;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
    }
    .thumbs .file {
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-sm);
      background: var(--color-surface-sunken);
      color: var(--color-text);
      overflow-wrap: anywhere;
    }
  `,
})
export class StudyView {
  readonly study = input.required<Study>();
  readonly jobsOf = input.required<(zone: Zone) => IngestJob[]>();
  /** The zone whose document the session asks for right now, and what it said. */
  readonly asked = input<{ zone: Zone; text: string } | null>(null);
  /**
   * The recorded discussions of the connected repository to choose from: `null` while they are
   * read, `undefined` when no repository is connected (the card is then left out).
   */
  readonly recordings = input<RecordingEntry[] | null | undefined>(undefined);
  readonly recordingsError = input<string | null>(null);
  /** The scenario guid of the recording shown, if it is one from the repository. */
  readonly currentRecording = input<string | undefined>();
  /** The scenario guid of the recording being read right now, with what it brings along. */
  readonly loadingRecording = input<string | null>(null);
  /** What the list shows as chosen: the one being read, else the one shown. */
  protected readonly chosen = computed(() => this.loadingRecording() ?? this.currentRecording());
  readonly dropped = output<{ zone: Zone; files: File[] }>();
  readonly dismiss = output<number>();
  readonly recordingPicked = output<string>();
  /** "Keine Aufzeichnung": the recording is taken away again, with all it brought. */
  readonly recordingCleared = output<void>();
  /**
   * A recording is shown (or on its way): guide and stimuli are its own and cannot be replaced,
   * and a screener has no say, as its participants are given.
   */
  protected readonly fromRecording = computed(() => !!this.chosen());

  /**
   * The study's stimulus files, each once. On the timeline a file can be placed several times
   * (a recording shows the overview again later): here it is one document.
   */
  protected readonly files = computed(() => {
    const seen = new Set<string>();
    return this.study().stimuli.filter((s: Stimulus) => {
      const id = (s.resourceRef && s.fileRef ? `${s.resourceRef}/${s.fileRef}` : s.url || s.guid).toLowerCase();
      return !seen.has(id) && !!seen.add(id);
    });
  });

  protected pick(event: Event): void {
    const guid = (event.target as HTMLSelectElement).value;
    if (guid) this.recordingPicked.emit(guid);
    else this.recordingCleared.emit();
  }

  protected askedFor(zone: Zone): string | null {
    const asked = this.asked();
    return asked?.zone === zone ? asked.text : null;
  }

  protected readonly documents = DOCUMENTS;
  protected readonly stimuli = STIMULI;
}
