import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { DsIcon } from '../../../design-system';
import type { Guide, Participant, StudyBrief } from '../../discussion/model/study.model';
import { AnalysisService, MAX_QUESTION } from '../state/analysis.service';
import { AnswerCard } from './answer-card';
import { AskBar } from './ask-bar';
import { ExampleCards } from './example-cards';
import { examplesFor } from './examples';

/**
 * The "Analyse" view: ask the study's repository (guide, stimuli, personas, transcripts) a
 * question and get the answer as a chart with the quotes behind it.
 */
@Component({
  selector: 'app-analysis-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AnswerCard, AskBar, DsIcon, ExampleCards],
  template: `
    <div #stream class="stream">
      <div class="column">
        @if (!analysis.configured) {
          <p class="hint" role="status">
            <ds-icon name="info" />
            Für die Analyse fehlt noch APP_ANALYSIS_CHOREO_GUID in .env (die Analyse-Choreo der Studie).
          </p>
        } @else if (analysis.entries().length === 0) {
          <section class="welcome">
            <h2><ds-icon name="chart" /> Fragen an die Studie</h2>
            <p>
              Die Analyse liest den Leitfaden, die Stimuli, die Personas und die Transkripte im
              Repository und antwortet mit einem Diagramm und den Zitaten dahinter. Klicken Sie eine Frage an
              oder schreiben Sie eine eigene.
            </p>
            <app-example-cards [examples]="examples()" (pick)="fill($event)" />
          </section>
        } @else {
          @for (entry of analysis.entries(); track entry.id) {
            <app-answer-card [entry]="entry" [participants]="participants()" [tones]="tones()" />
          }
        }
        @if (analysis.error(); as error) {
          <p class="hint error" role="alert"><ds-icon name="info" /> {{ error }}</p>
        }
      </div>
    </div>

    @if (analysis.configured) {
      <div class="dock">
        <div class="column">
          @if (analysis.entries().length) {
            <details class="drawer">
              <summary><ds-icon name="spark" /> Beispielfragen</summary>
              <app-example-cards [examples]="examples()" [small]="true" (pick)="fill($event)" />
            </details>
          }
          <app-ask-bar
            [(text)]="analysis.draft"
            [max]="max"
            [enabled]="!analysis.busy()"
            (ask)="send($event)"
          />
        </div>
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
    }
    .stream {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: var(--space-6) var(--space-5);
    }
    .column {
      display: grid;
      gap: var(--space-5);
      width: 100%;
      max-width: 60rem;
      margin: 0 auto;
    }
    .welcome {
      display: grid;
      gap: var(--space-4);
    }
    .welcome h2 {
      display: flex;
      gap: var(--space-2);
      align-items: center;
      margin: 0;
      font-size: var(--text-xl);
    }
    .welcome p {
      margin: 0;
      max-width: 44rem;
      color: var(--color-muted);
    }
    .hint {
      display: flex;
      gap: var(--space-2);
      align-items: center;
      margin: 0;
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-md);
      background: var(--color-accent-soft);
      font-size: var(--text-sm);
    }
    .hint.error {
      background: color-mix(in oklch, var(--color-danger) 12%, var(--color-surface));
      color: var(--color-danger);
    }
    .dock {
      flex: none;
      padding: var(--space-3) var(--space-5) var(--space-5);
    }
    .dock .column {
      gap: var(--space-3);
    }
    .drawer summary {
      display: inline-flex;
      gap: var(--space-2);
      align-items: center;
      color: var(--color-muted);
      font-size: var(--text-xs);
      font-weight: 600;
      cursor: pointer;
    }
    .drawer[open] summary {
      margin-bottom: var(--space-2);
    }
    .drawer app-example-cards {
      max-height: 12rem;
      overflow: auto;
    }
  `,
})
export class AnalysisView {
  readonly brief = input<StudyBrief | null | undefined>(null);
  readonly guide = input<Guide | null>(null);
  readonly participants = input<readonly Participant[]>([]);

  protected readonly analysis = inject(AnalysisService);
  protected readonly max = MAX_QUESTION;
  protected readonly examples = computed(() => examplesFor(this.brief()));
  /** Code pill tone by guide question code. */
  protected readonly tones = computed(
    () =>
      new Map(
        (this.guide()?.blocks ?? []).flatMap((b) => b.questions.map((q) => [q.code.toUpperCase(), q.tone] as const)),
      ),
  );
  private readonly askBar = viewChild(AskBar);
  private readonly stream = viewChild<ElementRef<HTMLElement>>('stream');

  constructor() {
    this.analysis.start();
    // New questions and answers scroll into view.
    let count = 0;
    afterRenderEffect(() => {
      const entries = this.analysis.entries();
      const answered = entries.filter((e) => e.answer).length;
      const el = this.stream()?.nativeElement;
      const next = entries.length + answered;
      if (el && next !== count) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      count = next;
    });
  }

  /** Puts a question into the field (a sample card, or the guide's "Auswerten"). */
  fill(text: string): void {
    this.analysis.draft.set(text.slice(0, MAX_QUESTION));
    this.askBar()?.focus();
  }

  protected send(text: string): void {
    void this.analysis.ask(text);
  }
}
