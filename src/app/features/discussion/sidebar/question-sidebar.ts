import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DsCodePill, DsIcon, DsSkeleton } from '../../../design-system';
import {
  initialsOf,
  type Guide,
  type GuideBlock,
  type GuideQuestion,
  type Participant,
  type Transcript,
} from '../model/study.model';
import { BrokenImages } from '../shared/broken-images';
import { DiscussionUiState } from '../state/discussion-ui.state';

/**
 * The guide's interview questions (not the research questions), grouped by block and coded with
 * coloured badges, one open at a time. A question every participant has answered is ticked.
 * Opening a question highlights its badges on the timeline; a badge on the timeline scrolls it
 * into view here.
 * One red dot on the chain marks where the timeline is (the hover position while scrubbing, else
 * the cursor): it sits on that moment's question, which is kept in view.
 * Hovering the chain scrubs the other way round: the dot jumps to the asked question nearest the
 * mouse and the timeline shows where it was asked; a click there moves the cursor to it.
 */
@Component({
  selector: 'app-question-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DsCodePill, DsIcon, DsSkeleton],
  template: `
    <div class="head">
      <h2><ds-icon name="book" /> Leitfaden</h2>
      @if (guide(); as g) {
        <span class="count">{{ questionCount() }} Fragen · {{ g.totalMinutes }} min</span>
      }
    </div>

    @if (guide(); as g) {
      <div
        #groups
        class="groups"
        [class.on-chain]="onChain()"
        (mousemove)="chainMove($event)"
        (mouseleave)="chainLeave()"
        (click)="chainClick($event)"
      >
        @for (block of g.blocks; track block.code) {
          <section>
            <h3>
              <span class="pearl" [class.done]="blockDone(block)">{{ block.code }}</span>
              @if (blockDone(block)) {
                <span class="visually-hidden">(erledigt)</span>
              }
              {{ block.title }} <span class="minutes">{{ block.minutes }} min</span>
            </h3>
            <ul>
              @for (q of block.questions; track q.key; let i = $index) {
                @if (q.section && q.section !== block.questions[i - 1]?.section) {
                  <li class="subsection">{{ q.section }}</li>
                }
                <li
                  [class.open]="ui.openQuestionKey() === q.key"
                  [attr.data-question]="q.key"
                  [attr.data-state]="transcript().done.has(q.key) ? 'done' : asked().has(q.key) ? 'asked' : null"
                >
                  <button
                    type="button"
                    class="row"
                    [attr.aria-expanded]="ui.openQuestionKey() === q.key"
                    (click)="ui.toggleQuestion(q.key)"
                  >
                    <span class="label">{{ q.text }}</span>
                    @if (transcript().done.has(q.key)) {
                      <span class="visually-hidden">(alle haben geantwortet)</span>
                    } @else if (asked().has(q.key)) {
                      <span class="visually-hidden">(wird besprochen)</span>
                    }
                    <ds-code-pill [code]="q.code" [tone]="q.tone" />
                  </button>
                  @if (ui.openQuestionKey() === q.key) {
                    <div class="detail">
                      @if (answers(q.key); as list) {
                        @if (list.length) {
                          <p class="meta">{{ list.length }} Beiträge in der Diskussion</p>
                          <ul class="answers">
                            @for (clip of list; track clip.guid) {
                              <li>
                                <span class="avatar" aria-hidden="true">
                                  @if (images.usable(portraits().get(clip.speakerGuid)); as src) {
                                    <img [src]="src" alt="" (error)="images.markBroken(src)" />
                                  } @else {
                                    {{ initials(clip.speakerName) }}
                                  }
                                </span>
                                <p><strong>{{ clip.speakerName }}:</strong> {{ clip.text }}</p>
                              </li>
                            }
                          </ul>
                        } @else {
                          <p class="meta">Noch nicht besprochen.</p>
                        }
                      }
                      @if (analysable()) {
                        <button type="button" class="analyse" (click)="analyse.emit(q)">
                          <ds-icon name="chart" /> Auswerten
                        </button>
                      }
                    </div>
                  }
                </li>
              }
            </ul>
          </section>
        }
        <span #cursor class="cursor" hidden></span>
      </div>
    } @else if (loading()) {
      <ds-skeleton />
    } @else {
      <p class="empty">
        Noch kein Leitfaden. Ziehen Sie ihn (.docx oder .md) auf die Kopfzeile der Zeitleiste.
      </p>
    }
  `,
  styles: `
    :host {
      --chain-x: 0.625rem;
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      min-height: 0;
      padding: var(--space-5) var(--space-4);
      overflow: hidden;
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    h2 {
      display: flex;
      gap: var(--space-2);
      align-items: center;
      margin: 0;
      font-size: var(--text-md);
    }
    .count,
    .meta,
    .minutes {
      color: var(--color-muted);
      font-size: var(--text-xs);
      font-weight: 400;
      letter-spacing: 0;
      text-transform: none;
    }
    .groups {
      position: relative;
      flex: 1;
      overflow: auto;
      min-height: 0;
      margin-right: calc(var(--space-2) * -1);
      padding-right: var(--space-2);
    }
    .groups.on-chain {
      cursor: pointer;
    }
    /* The pearl chain: each section draws its piece of the line, bridging the gap to the next;
       the sticky heading repeats it, since its background covers the section's line. */
    section {
      position: relative;
    }
    section::before,
    h3::before {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: calc(var(--chain-x) - 1px);
      width: 2px;
      background: var(--color-border);
    }
    section:not(:last-child)::before {
      bottom: calc(var(--space-4) * -1);
    }
    section:first-child h3::before {
      top: 50%;
    }
    section:first-child::before {
      top: 0.875rem;
    }
    section:last-child::before {
      bottom: 1.5rem;
    }
    section + section {
      margin-top: var(--space-4);
    }
    h3 {
      position: sticky;
      top: 0;
      z-index: 1;
      display: flex;
      gap: var(--space-2);
      align-items: center;
      margin: 0 0 var(--space-1);
      padding: var(--space-1) 0;
      background: var(--color-bg);
      color: var(--color-muted);
      font-size: var(--text-xs);
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .pearl {
      position: relative;
      z-index: 1;
      display: inline-grid;
      flex: none;
      place-items: center;
      box-sizing: border-box;
      width: 1.25rem;
      height: 1.25rem;
      margin-left: calc(var(--chain-x) - 0.625rem);
      border: 2px solid var(--color-border);
      border-radius: var(--radius-pill);
      background: var(--color-surface);
      color: var(--color-muted);
      font-size: 0.625rem;
      letter-spacing: 0;
      line-height: 1;
    }
    .pearl.done {
      border-color: var(--color-success);
      background: var(--color-success);
      color: var(--color-accent-contrast);
    }
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    h3 + ul > li {
      position: relative;
      margin-left: calc(var(--chain-x) * 2 + var(--space-2));
    }
    /* A small pearl per question, on the chain. */
    h3 + ul > li::before {
      content: '';
      position: absolute;
      top: 1.05rem;
      left: calc(var(--chain-x) * -1 - var(--space-2) - 0.25rem);
      width: 0.5rem;
      height: 0.5rem;
      box-sizing: border-box;
      border: 2px solid var(--color-border);
      border-radius: var(--radius-pill);
      background: var(--color-bg);
    }
    /* A subsection of the block ("1.1. Vorbereitung"): a label above its questions, no pearl. */
    h3 + ul > li.subsection {
      margin-top: var(--space-2);
      padding: var(--space-1) 0 0;
      color: var(--color-muted);
      font-size: var(--text-xs);
      font-weight: 600;
    }
    h3 + ul > li.subsection::before {
      content: none;
    }
    /* Asked: a filled grey pearl. Only the cursor's dot is red. */
    h3 + ul > li[data-state='asked']::before {
      background: var(--color-border);
    }
    h3 + ul > li[data-state='done']::before {
      border-color: var(--color-success);
      background: var(--color-success);
    }
    /* Where the timeline's cursor is: sits on the question's pearl and slides to the next one. */
    .cursor {
      position: absolute;
      top: 1.05rem;
      left: calc(var(--chain-x) - 0.25rem);
      width: 0.5rem;
      height: 0.5rem;
      border-radius: var(--radius-pill);
      background: var(--color-danger);
      box-shadow: 0 0 0 2px var(--color-bg);
      pointer-events: none;
      transition: transform 0.35s ease-in-out;
    }
    @media (prefers-reduced-motion: reduce) {
      .cursor {
        transition: none;
      }
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    li.open {
      border-radius: var(--radius-md);
      background: var(--color-surface);
      box-shadow: var(--elevation-1);
    }
    .row {
      display: flex;
      gap: var(--space-3);
      align-items: center;
      width: 100%;
      padding: var(--space-2);
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--color-text);
      font-size: var(--text-sm);
      text-align: left;
    }
    .row:hover {
      background: var(--color-surface-sunken);
    }
    .label {
      flex: 1;
      min-width: 0;
    }
    li:not(.open) .label {
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .detail {
      display: grid;
      gap: var(--space-2);
      padding: 0 var(--space-3) var(--space-3);
      font-size: var(--text-xs);
    }
    .meta {
      margin: 0;
    }
    .answers {
      display: grid;
      gap: var(--space-2);
    }
    /* The speaker's portrait in front of each answer. */
    .answers li {
      display: flex;
      gap: var(--space-2);
      align-items: flex-start;
    }
    .answers p {
      flex: 1;
      min-width: 0;
      margin: 0;
    }
    .answers .avatar {
      display: inline-grid;
      flex: none;
      place-items: center;
      width: 1.75rem;
      height: 1.75rem;
      border-radius: var(--radius-pill);
      background: var(--color-surface-sunken);
      color: var(--color-text);
      font-size: var(--text-xs);
      font-weight: 700;
      overflow: hidden;
    }
    .answers .avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .analyse {
      display: inline-flex;
      gap: var(--space-2);
      align-items: center;
      align-self: flex-start;
      margin-top: var(--space-2);
      padding: var(--space-1) var(--space-3);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-pill);
      background: var(--color-surface);
      color: var(--color-text);
      font-size: var(--text-xs);
      font-weight: 600;
    }
    .analyse:hover {
      border-color: var(--color-accent);
      color: var(--color-accent);
    }
    .empty {
      margin: 0;
      padding: var(--space-3);
      border: 1px dashed var(--color-border);
      border-radius: var(--radius-md);
      color: var(--color-muted);
      font-size: var(--text-sm);
    }
  `,
})
export class QuestionSidebar {
  readonly guide = input.required<Guide | null>();
  readonly transcript = input.required<Transcript>();
  readonly loading = input(false);
  /** The participants, for the portraits in front of their answers. */
  readonly participants = input<readonly Participant[]>([]);
  /** Shows "Auswerten" under an open question (the Analyse view). */
  readonly analysable = input(false);
  /** "Auswerten" was clicked: ask the analysis about this question. */
  readonly analyse = output<GuideQuestion>();

  protected readonly ui = inject(DiscussionUiState);
  protected readonly images = inject(BrokenImages);
  protected readonly initials = initialsOf;
  /** Portrait URL by participant guid. */
  protected readonly portraits = computed(
    () => new Map(this.participants().map((p) => [p.guid, p.imageUrl] as const)),
  );
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly questionCount = computed(
    () => this.guide()?.blocks.reduce((n, b) => n + b.questions.length, 0) ?? 0,
  );
  protected readonly asked = computed(
    () => new Set(this.transcript().badges.map((b) => b.questionKey)),
  );

  private readonly groups = viewChild<ElementRef<HTMLElement>>('groups');
  private readonly cursor = viewChild<ElementRef<HTMLElement>>('cursor');
  /**
   * The question at the timeline's position (the mouse while scrubbing, else the cursor): the
   * last one the moderator opened before it.
   */
  protected readonly cursorQuestion = computed(() => {
    const time = this.ui.previewTime();
    let key: string | null = null;
    for (const badge of this.transcript().badges) {
      if (badge.start > time) break;
      key = badge.questionKey;
    }
    return key;
  });

  /** When each question was first asked (seconds), for scrubbing along the chain. */
  private readonly askedAt = computed(() => {
    const at = new Map<string, number>();
    for (const badge of this.transcript().badges) {
      if (!at.has(badge.questionKey)) at.set(badge.questionKey, badge.start);
    }
    return at;
  });
  /** The mouse is on the chain (left of the question rows) and scrubs the timeline. */
  protected readonly onChain = signal(false);

  constructor() {
    // The dot follows the timeline's question. Measured after rendering, since opening a question
    // or loading a guide moves the rows.
    let shown: string | null = null;
    afterRenderEffect(() => {
      const key = this.cursorQuestion();
      this.ui.openQuestionKey();
      this.guide();
      const groups = this.groups()?.nativeElement;
      const dot = this.cursor()?.nativeElement;
      if (!groups || !dot) return;
      const row = key ? groups.querySelector<HTMLElement>(`[data-question="${CSS.escape(key)}"]`) : null;
      dot.hidden = !row;
      if (!row) return;
      const top = row.getBoundingClientRect().top - groups.getBoundingClientRect().top + groups.scrollTop;
      dot.style.transform = `translateY(${top}px)`;
      if (key !== shown) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      shown = key;
    });

    // A question opened here, or a badge clicked on the timeline: bring it into view.
    effect(() => this.scrollToQuestion(this.ui.openQuestionKey()));
    effect(() => this.scrollToQuestion(this.ui.revealedQuestion()?.key ?? null));
  }

  private scrollToQuestion(key: string | null): void {
    if (!key) return;
    queueMicrotask(() =>
      this.host.nativeElement
        .querySelector(`[data-question="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    );
  }

  /**
   * On the chain, the asked question nearest the mouse becomes the hover time: the dot moves to
   * it and the timeline scrolls it into view, like scrubbing the timeline moves the dot here.
   */
  protected chainMove(event: MouseEvent): void {
    const time = this.chainTime(event);
    this.onChain.set(time !== null);
    if (time !== null) this.ui.hoverTime.set(time);
    else this.chainLeave();
  }

  protected chainLeave(): void {
    if (this.onChain()) this.ui.hoverTime.set(null);
    this.onChain.set(false);
  }

  /** A click on the chain moves the cursor to the question, like a click on the time axis. */
  protected chainClick(event: MouseEvent): void {
    const time = this.chainTime(event);
    if (time !== null) this.ui.cursorTime.set(time);
  }

  /** The time of the asked question nearest the mouse, or null when it is not on the chain. */
  private chainTime(event: MouseEvent): number | null {
    const groups = this.groups()?.nativeElement;
    if (!groups) return null;
    const rows = groups.querySelectorAll<HTMLElement>('li[data-question]');
    // The chain is the strip left of the question rows.
    if (!rows.length || event.clientX >= rows[0].getBoundingClientRect().left) return null;
    const askedAt = this.askedAt();
    let best: { time: number; distance: number } | null = null;
    for (const row of rows) {
      const time = askedAt.get(row.dataset['question']!);
      if (time === undefined) continue;
      const rect = row.getBoundingClientRect();
      // The question's pearl sits near the top of its row.
      const distance = Math.abs(event.clientY - (rect.top + Math.min(rect.height / 2, 20)));
      if (!best || distance < best.distance) best = { time, distance };
    }
    return best?.time ?? null;
  }

  protected blockDone(block: GuideBlock): boolean {
    const done = this.transcript().done;
    return block.questions.length > 0 && block.questions.every((q) => done.has(q.key));
  }

  protected answers(key: string) {
    return this.transcript().clips.filter((c) => !c.moderator && c.questionKey === key);
  }
}
