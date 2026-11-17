import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { DsIcon } from '../../../design-system';
import { blockAt, type PlacedBlock } from '../model/arrangement';
import { initialsOf, type Clip, type Participant, type Transcript } from '../model/study.model';
import { lastTurnBy } from '../model/transcript-mapper';
import { BrokenImages } from '../shared/broken-images';
import { DiscussionUiState } from '../state/discussion-ui.state';
import { clockLabel } from '../timeline/time-format';
import { LoadingMark } from './loading-mark';
import { PlayerService } from './player.service';

/**
 * The bottom of player mode: Play/Pause, and the whole guide as one row of sections, shrunk to
 * the width, with the red cursor on it. The mouse over the row shows a second, light cursor with
 * what happens there (time, section, who says what); a click jumps there. While a voice is being
 * prepared, the button is the animated busy mark (a click still pauses).
 */
@Component({
  selector: 'app-player-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DsIcon, LoadingMark],
  template: `
    <button
      type="button"
      class="toggle"
      [class.busy]="busy()"
      [title]="label()"
      [attr.aria-label]="label()"
      (click)="player.toggle()"
    >
      @if (busy()) {
        <app-loading-mark />
      } @else {
        <ds-icon [name]="player.playing() ? 'pause' : 'play'" />
      }
    </button>

    <div class="main">
      <div
        class="sections"
        role="slider"
        tabindex="0"
        aria-label="Position in der Diskussion"
        aria-valuemin="0"
        [attr.aria-valuemax]="round(length())"
        [attr.aria-valuenow]="round(ui.cursorTime())"
        [attr.aria-valuetext]="current()?.title ?? null"
        (click)="player.seek(timeAt($event))"
        (mousemove)="hoverTime.set(timeAt($event))"
        (mouseleave)="hoverTime.set(null)"
        (keydown.arrowLeft)="player.seek(ui.cursorTime() - 10)"
        (keydown.arrowRight)="player.seek(ui.cursorTime() + 10)"
      >
        @for (block of blocks(); track block.code) {
          <span
            class="section"
            [class.current]="block.code === current()?.code"
            [class.planned]="block.planned"
            [style.left.%]="percent(block.start)"
            [style.width.%]="percent(block.end - block.start)"
            [style.--tone-bg]="'var(--section-' + block.tone + '-bg)'"
            [style.--tone-ink]="'var(--section-' + block.tone + '-ink)'"
          >
            <b>{{ block.code }}</b> {{ block.title }}
          </span>
        }
        <span class="cursor" [style.left.%]="percent(ui.cursorTime())"></span>
        @if (hover(); as at) {
          <span class="cursor hover" [style.left.%]="percent(at.time)"></span>
          <div class="tip" role="tooltip" [style.--at]="percent(at.time) + '%'">
            <p class="where">
              <span class="clock">{{ at.clock }}</span>
              @if (at.block; as block) {
                <b>{{ block.code }}</b> {{ block.title }}
              }
            </p>
            @if (at.clip; as clip) {
              <div class="turn">
                <span class="avatar" aria-hidden="true">
                  @if (images.usable(portraitOf(clip)); as src) {
                    <img [src]="src" alt="" (error)="images.markBroken(src)" />
                  } @else {
                    {{ initials(clip.speakerName) }}
                  }
                </span>
                <p class="what"><b>{{ clip.speakerName }}:</b> {{ clip.text }}</p>
              </div>
            }
          </div>
        }
      </div>

      <p class="section-name" aria-live="polite">
        @if (current(); as block) {
          <span><b>{{ block.code }}</b> {{ block.title }}</span>
        }
        @if (player.error(); as error) {
          <span class="error" role="alert">{{ error }}</span>
        }
      </p>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      gap: var(--space-5);
      align-items: flex-start;
    }
    .toggle {
      display: inline-grid;
      flex: none;
      place-items: center;
      width: 3rem;
      height: 3rem;
      /* Centred on the row of sections. */
      margin-top: -0.5rem;
      padding: 0;
      border-radius: var(--radius-pill);
      background: var(--color-accent);
      color: var(--color-accent-contrast);
      font-size: 1.25rem;
    }
    .toggle:hover {
      background: var(--color-accent-hover);
    }
    /* Busy: the emblem is the button; its ripples reach beyond it. */
    .toggle.busy,
    .toggle.busy:hover {
      background: transparent;
      overflow: visible;
    }
    .toggle ds-icon {
      /* Filled, like the timeline's Play button. */
      --icon-fill: currentColor;
    }
    .toggle app-loading-mark {
      width: 4.5rem;
      pointer-events: none;
    }
    .main {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--space-2);
      min-width: 0;
    }
    .sections {
      position: relative;
      height: 2rem;
      border-radius: var(--radius-sm);
      background: var(--color-surface-sunken);
      cursor: pointer;
    }
    .section {
      position: absolute;
      top: 0;
      bottom: 0;
      box-sizing: border-box;
      padding: 0 var(--space-2);
      border-right: 2px solid var(--color-bg);
      border-radius: var(--radius-sm);
      background: var(--tone-bg);
      color: var(--tone-ink);
      font-size: var(--text-xs);
      line-height: 2rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      opacity: 0.6;
      transition: opacity var(--motion-base) var(--ease-standard);
    }
    .section.planned {
      opacity: 0.3;
    }
    .section.current {
      opacity: 1;
    }
    .cursor {
      position: absolute;
      top: calc(var(--space-1) * -1);
      bottom: calc(var(--space-1) * -1);
      width: 2px;
      background: var(--color-accent);
      pointer-events: none;
      transform: translateX(-50%);
      transition: left var(--motion-base) linear;
    }
    /* Where the mouse is: follows it at once. */
    .cursor.hover {
      background: var(--color-text);
      transition: none;
    }
    .tip {
      --width: 25rem;
      position: absolute;
      bottom: calc(100% + var(--space-3));
      /* Centred on the mouse, kept inside the row. */
      left: clamp(0px, calc(var(--at) - var(--width) / 2), calc(100% - var(--width)));
      z-index: 1;
      box-sizing: border-box;
      width: var(--width);
      max-width: 100%;
      padding: var(--space-2) var(--space-3);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      box-shadow: var(--elevation-2);
      color: var(--color-text);
      font-size: var(--text-sm);
      line-height: 1.4;
      pointer-events: none;
    }
    p {
      margin: 0;
    }
    .where {
      color: var(--color-muted);
      font-size: var(--text-xs);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .clock {
      margin-right: var(--space-2);
      font-variant-numeric: tabular-nums;
    }
    .turn {
      display: flex;
      gap: var(--space-3);
      align-items: center;
      margin-top: var(--space-1);
    }
    /* As tall as the three lines of the turn beside it. */
    .avatar {
      display: inline-grid;
      flex: none;
      place-items: center;
      width: 3.75rem;
      height: 3.75rem;
      border-radius: var(--radius-pill);
      background: var(--color-surface-sunken);
      color: var(--color-text);
      font-size: var(--text-sm);
      font-weight: 700;
      overflow: hidden;
    }
    .avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .what {
      flex: 1;
      min-width: 0;
      display: -webkit-box;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
      line-clamp: 3;
    }
    .section-name {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1) var(--space-4);
      align-items: baseline;
      min-height: 1.5em;
      color: var(--color-muted);
      font-size: var(--text-sm);
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .error {
      color: var(--color-danger);
      font-weight: 400;
      letter-spacing: 0;
      text-transform: none;
    }
  `,
})
export class PlayerStrip {
  readonly blocks = input.required<PlacedBlock[]>();
  readonly transcript = input.required<Transcript>();
  /** The participants, for the portrait in the tooltip. */
  readonly participants = input<Participant[]>([]);
  /** The moderator's portrait, if any. */
  readonly moderatorImage = input<string | null>(null);

  protected readonly ui = inject(DiscussionUiState);
  protected readonly player = inject(PlayerService);
  /** Where the mouse is on the row (seconds), or null outside it. */
  protected readonly hoverTime = signal<number | null>(null);
  protected readonly images = inject(BrokenImages);
  protected readonly initials = initialsOf;
  /** Portrait URL by participant guid. */
  private readonly portraits = computed(
    () => new Map(this.participants().map((p) => [p.guid, p.imageUrl] as const)),
  );

  /** Seconds the row stands for: the discussion and all sections, also those not reached yet. */
  protected readonly length = computed(() =>
    Math.max(1, this.transcript().duration, ...this.blocks().map((b) => b.end)),
  );
  protected readonly current = computed(() => blockAt(this.blocks(), this.ui.cursorTime()));
  /** A voice is being prepared: the emblem takes the button's place. */
  protected readonly busy = computed(() => this.player.state() === 'preparing');
  protected readonly label = computed(() => {
    if (!this.player.playing()) return 'Abspielen';
    if (!this.busy()) return 'Pause';
    return 'Die Stimme wird vorbereitet (Pause)';
  });
  /** What happens where the mouse is. */
  protected readonly hover = computed(() => {
    const time = this.hoverTime();
    if (time === null) return null;
    const clip = lastTurnBy(this.transcript().clips, time);
    return { time, clock: clockLabel(time), block: blockAt(this.blocks(), time), clip: clip ?? null };
  });
  protected readonly round = Math.round;

  protected portraitOf(clip: Clip): string | null | undefined {
    return clip.moderator ? this.moderatorImage() : this.portraits().get(clip.speakerGuid);
  }

  protected percent(seconds: number): number {
    return Math.min(100, Math.max(0, (seconds / this.length()) * 100));
  }

  protected timeAt(event: MouseEvent): number {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return box.width > 0 ? Math.max(0, ((event.clientX - box.left) / box.width) * this.length()) : 0;
  }
}
