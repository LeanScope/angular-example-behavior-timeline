import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { DsCodePill, DsIcon, DsMarkdown, DsSkeleton } from '../../../design-system';
import { initialsOf, type Participant } from '../../discussion/model/study.model';
import { BrokenImages } from '../../discussion/shared/broken-images';
import { ChartComponent } from '../chart/chart.component';
import { AnalysisService, DEFAULT_ACTIVITY, type AnalysisEntry } from '../state/analysis.service';
import { LoadingLine } from './loading-line/loading-line';

/** One question with the analyst's answer: takeaway, chart, short text and the quotes behind it. */
@Component({
  selector: 'app-answer-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChartComponent, DsCodePill, DsIcon, DsMarkdown, DsSkeleton, LoadingLine],
  template: `
    @if (entry().answer; as answer) {
      <p class="question"><ds-icon name="message" /> {{ entry().question }}</p>
      <article class="card">
        @if (answer.finding; as f) {
          <header>
            <h3>{{ f.title }}</h3>
            <p class="takeaway">{{ f.takeaway }}</p>
          </header>
          @if (f.chart) {
            <app-chart [finding]="f" />
            @if (f.chart.x.label) {
              <p class="axis">{{ f.chart.x.label }}</p>
            }
          }
        }
        @if (answer.text) {
          <ds-markdown class="text" [text]="answer.text" />
        }
        @if (answer.problem) {
          <p class="problem">{{ answer.problem }}</p>
        }
        @if (answer.finding; as f) {
          @if (f.evidence.length) {
            <ul class="evidence" aria-label="Zitate">
              @for (e of f.evidence; track $index) {
                <li>
                  <span class="avatar" aria-hidden="true">
                    @if (images.usable(portraitOf(e.speaker)); as src) {
                      <img [src]="src" alt="" (error)="images.markBroken(src)" />
                    } @else {
                      {{ initials(e.speaker || '?') }}
                    }
                  </span>
                  <blockquote>
                    „{{ e.quote }}“
                    <footer>
                      {{ e.speaker }}
                      @if (e.questionCode) {
                        <ds-code-pill [code]="e.questionCode" [tone]="toneOf(e.questionCode)" />
                      }
                    </footer>
                  </blockquote>
                </li>
              }
            </ul>
          }
          <footer class="meta">
            @if (f.population.description || f.population.n !== null) {
              <span>
                <ds-icon name="users" />
                {{ f.population.description || 'Basis' }}
                @if (f.population.n !== null) {
                  (n = {{ f.population.n }})
                }
              </span>
            }
            @if (f.sources.length) {
              <span><ds-icon name="database" /> {{ f.sources.join(' · ') }}</span>
            }
          </footer>
        }
      </article>
    } @else {
      <article class="thinking" aria-busy="true" aria-live="polite">
        <p class="q"><ds-icon name="spark" /> {{ entry().question }}</p>
        <p class="activity">
          <app-loading-line /> {{ analysis.activity() ?? defaultActivity }} …
          <span class="elapsed">{{ elapsed() }} s</span>
        </p>
        <ds-skeleton />
      </article>
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: var(--space-2);
    }
    .question {
      display: flex;
      gap: var(--space-2);
      align-items: flex-start;
      justify-self: end;
      max-width: 80%;
      margin: 0;
      padding: var(--space-2) var(--space-4);
      border-radius: var(--radius-lg);
      background: var(--color-surface-sunken);
      font-size: var(--text-sm);
      font-weight: 600;
    }
    .question ds-icon {
      flex: none;
      color: var(--color-muted);
    }
    .card {
      display: grid;
      gap: var(--space-3);
      padding: var(--space-5);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      box-shadow: var(--elevation-1);
    }
    h3 {
      margin: 0;
      color: var(--color-muted);
      font-size: var(--text-xs);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .takeaway {
      margin: var(--space-1) 0 0;
      font-size: var(--text-lg);
      font-weight: 600;
    }
    .axis {
      margin: calc(var(--space-2) * -1) 0 0;
      color: var(--color-muted);
      font-size: var(--text-xs);
      text-align: center;
    }
    .text {
      font-size: var(--text-sm);
    }
    .thinking {
      display: grid;
      gap: var(--space-3);
      padding: var(--space-5);
      border: 1px dashed var(--color-border);
      border-radius: var(--radius-lg);
    }
    .thinking .q {
      display: flex;
      gap: var(--space-2);
      align-items: center;
      margin: 0;
      color: var(--color-muted);
      font-size: var(--text-sm);
    }
    .activity {
      display: flex;
      gap: var(--space-2);
      align-items: center;
      margin: 0;
      color: var(--color-accent);
      font-size: var(--text-sm);
      font-weight: 600;
    }
    .elapsed {
      margin-left: auto;
      color: var(--color-muted);
      font-variant-numeric: tabular-nums;
      font-weight: 400;
    }
    .problem {
      display: flex;
      gap: var(--space-2);
      align-items: center;
      margin: 0;
      color: var(--color-muted);
      font-size: var(--text-sm);
    }
    .evidence {
      display: grid;
      gap: var(--space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .evidence li {
      display: flex;
      gap: var(--space-3);
      align-items: flex-start;
    }
    .avatar {
      display: grid;
      flex: none;
      place-items: center;
      width: 2rem;
      height: 2rem;
      overflow: hidden;
      border-radius: 50%;
      background: var(--color-surface-sunken);
      color: var(--color-muted);
      font-size: var(--text-xs);
      font-weight: 600;
    }
    .avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    blockquote {
      margin: 0;
      font-size: var(--text-sm);
      font-style: italic;
    }
    blockquote footer {
      display: flex;
      gap: var(--space-2);
      align-items: center;
      margin-top: var(--space-1);
      color: var(--color-muted);
      font-size: var(--text-xs);
      font-style: normal;
      font-weight: 600;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-5);
      padding-top: var(--space-3);
      border-top: 1px solid var(--color-border);
      color: var(--color-muted);
      font-size: var(--text-xs);
    }
    .meta span {
      display: inline-flex;
      gap: var(--space-1);
      align-items: center;
    }
  `,
})
export class AnswerCard {
  readonly entry = input.required<AnalysisEntry>();
  /** The participants, for portraits next to their quotes. */
  readonly participants = input<readonly Participant[]>([]);
  /** Code pill tone by guide question code ("D2" → its block's tone). */
  readonly tones = input<ReadonlyMap<string, number>>(new Map());

  protected readonly images = inject(BrokenImages);
  protected readonly analysis = inject(AnalysisService);
  protected readonly defaultActivity = DEFAULT_ACTIVITY;
  private readonly now = signal(Date.now());
  /** Seconds since the question was sent, while the analysis works on it. */
  protected readonly elapsed = computed(() => {
    const since = this.analysis.since();
    return since === null ? 0 : Math.max(0, Math.round((this.now() - since) / 1000));
  });

  constructor() {
    const timer = setInterval(() => {
      if (!this.entry().answer) this.now.set(Date.now());
    }, 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
  protected readonly initials = initialsOf;
  private readonly byName = computed(
    () => new Map(this.participants().map((p) => [p.name.trim().toLowerCase(), p.imageUrl] as const)),
  );

  /** The portrait of a speaker the analyst names (by full or first name). */
  protected portraitOf(speaker: string): string | undefined {
    const name = speaker.trim().toLowerCase();
    if (!name) return undefined;
    const exact = this.byName().get(name);
    if (exact) return exact;
    const first = name.split(/\s+/)[0];
    for (const [key, url] of this.byName()) if (key.split(/\s+/)[0] === first) return url;
    return undefined;
  }

  protected toneOf(code: string): number {
    return this.tones().get(code.toUpperCase()) ?? 0;
  }
}
