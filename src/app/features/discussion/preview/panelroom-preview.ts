import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  signal,
  type Signal,
  viewChild,
} from '@angular/core';
import { DsCodePill } from '../../../design-system';
import { clipAt, MODERATOR_TRACK } from '../model/transcript-mapper';
import type { Guide, Participant, Stimulus, Transcript } from '../model/study.model';
import { BrokenImages } from '../shared/broken-images';
import { DiscussionUiState } from '../state/discussion-ui.state';
import { clockLabel } from '../timeline/time-format';
import { SpeakerRipples } from './speaker-ripples';

/**
 * The "Panelroom" at the timeline's hover position (else the cursor), like the viewer of a video
 * editor. A fixed frame marks who speaks: the round of seats rolls sideways until the speaker sits
 * in it, and what they say hangs below. The moderator sits first, so while they speak the area left
 * of the frame is free and shows the current stimulus large; once a participant answers, the seats
 * before them roll into that area and the stimulus shrinks below them. The open question is only
 * named by its code in the top right corner, since the moderator words it anyway.
 */
@Component({
  selector: 'app-panelroom-preview',
  host: {
    '[class.static]': '!interactive()',
    '[style.--bubble-lines]': 'bubbleLines()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DsCodePill, SpeakerRipples],
  template: `
    <div class="room" [class.moderating]="focus() === 0">
      @if (question(); as q) {
        <ds-code-pill class="code" [code]="q.code" [tone]="q.tone" [title]="q.text" />
      }

      <div class="left">
        <figure class="stimulus" [class.small]="focus() !== 0" [class.empty]="!stimulus()">
          @if (stimulus(); as s) {
            @if (s.mimeType.startsWith('image/')) {
              <!-- No caption: name and credit only as a tooltip, so the image gets all the room. -->
              <img [src]="s.url" [alt]="s.name" [title]="s.credit ? s.name + ' · ' + s.credit : s.name" />
            }
          }
        </figure>
      </div>

      <div class="seats" aria-label="Runde">
        <!-- The strip slides so that the speaker's seat lands in the fixed frame. -->
        <div class="track" [style.--focus]="focus()">
          <!-- Each seat stands on a glossy floor: the wrapper draws its mirror image below. -->
          <span
            class="seat-wrap"
            [class.has-image]="!!moderatorImage()"
            [style.--src]="cssUrl(moderatorImage())"
          >
            <button
              type="button"
              class="seat moderator"
              [class.selected]="ui.selectedParticipant() === moderatorTrack"
              [title]="moderatorName()"
              [attr.aria-pressed]="ui.selectedParticipant() === moderatorTrack"
              [attr.tabindex]="interactive() ? null : -1"
              (click)="ui.togglePersona(moderatorTrack, transcript().clips)"
            >
              @if (moderatorImage(); as src) {
                <img [src]="src" alt="" />
              } @else {
                MO
              }
            </button>
          </span>
          @for (p of participants(); track p.guid) {
            <span class="seat-wrap" [class.has-image]="!!images.usable(p.imageUrl)" [style.--src]="cssUrl(images.usable(p.imageUrl))">
              <button
                type="button"
                class="seat"
                [class.stub]="!p.filled"
                [class.selected]="ui.selectedParticipant() === p.guid"
                [title]="p.name"
                [attr.aria-pressed]="ui.selectedParticipant() === p.guid"
                [attr.tabindex]="interactive() ? null : -1"
                (click)="ui.togglePersona(p.guid, transcript().clips)"
              >
                @if (images.usable(p.imageUrl); as src) {
                  <img [src]="src" alt="" (error)="images.markBroken(src)" />
                } @else {
                  {{ p.initials }}
                }
              </button>
            </span>
          }
        </div>
        <span class="frame" [class.live]="!!speaking()" [style.--persona-color]="speakerColor()" aria-hidden="true">
          <!-- Rings grow out from under the portrait, like the busy mark (app-loading-mark). -->
          @if (speaking()) {
            <app-speaker-ripples [voiceLevel]="voiceLevel()" />
          }
        </span>
      </div>

      <div class="now" [class.talking]="!!speaking()" aria-live="polite">
        <!-- Every slot is always there, so the card keeps its height while the content changes. -->
        <p class="speaker">
          <span class="name">{{ speaking()?.speakerName ?? '' }}</span>
          <span class="clock">{{ clock() }}</span>
          @if (truncated()) {
            <span class="cut" title="Ganzer Text: Clip in der Zeitleiste anklicken, dann hier mit der Maus scrollen.">
              Text gekürzt
            </span>
          }
        </p>
        @if (speaking(); as clip) {
          <!-- Long turns shrink to fit; what still doesn't fit is cut and scrolls on hover. -->
          <p #bubble class="line bubble">{{ clip.text }}</p>
        } @else {
          <p class="line">
            {{ transcript().clips.length ? 'Gerade spricht niemand.' : 'Die Diskussion hat noch nicht begonnen.' }}
          </p>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      --seat: 2.75rem;
      --seat-gap: 0.75rem;
      /* Room above the seat for the frame, below it for the mirror image. */
      --seats-pad-top: 0.75rem;
      --seats-pad-bottom: 1.25rem;
      --roll: 450ms;
    }
    .room {
      position: relative;
      display: grid;
      /* Left: stimulus and the seats before the speaker. Right: frame, speaker and bubble. */
      grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
      grid-template-rows: auto auto;
      column-gap: var(--space-5);
      row-gap: var(--space-1);
      padding: var(--space-4) var(--space-5);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      box-shadow: var(--elevation-1);
    }
    .code {
      position: absolute;
      top: var(--space-3);
      right: var(--space-4);
      z-index: 3;
    }

    /* The seats span both columns but start in the right one, at the frame. */
    .seats {
      grid-column: 1 / -1;
      grid-row: 1;
      display: grid;
      grid-template-columns: subgrid;
      padding: var(--seats-pad-top) 0 var(--seats-pad-bottom);
      overflow: hidden;
      --fade: linear-gradient(to right, transparent, black 1.5rem, black calc(100% - 4rem), transparent);
      mask-image: var(--fade);
    }
    .track,
    .frame {
      grid-column: 2;
      grid-row: 1;
      justify-self: start;
    }
    .track {
      display: flex;
      gap: var(--seat-gap);
      width: max-content;
      transform: translateX(calc(var(--focus, 0) * -1 * (var(--seat) + var(--seat-gap))));
      transition: transform var(--roll) var(--ease-standard);
    }
    /* The fixed frame every speaker rolls into: a red ring inside the portrait while someone speaks,
       from which rings ripple outwards, turning from red into the speaker's colour as they fade. */
    .frame {
      position: relative;
      z-index: 1;
      --frame-border: 3px;
      box-sizing: border-box;
      width: var(--seat);
      height: var(--seat);
      border: var(--frame-border) solid transparent;
      border-radius: var(--radius-pill);
      pointer-events: none;
    }
    .frame.live {
      border-color: var(--color-accent);
    }


    .seat-wrap {
      position: relative;
      display: inline-flex;
    }
    /* Mirror image: the portrait flipped below the seat, fading out. */
    .seat-wrap.has-image::after {
      content: '';
      position: absolute;
      top: calc(100% + 2px);
      left: 0;
      width: 100%;
      aspect-ratio: 1;
      border-radius: var(--radius-pill);
      background: var(--src) center / cover no-repeat;
      opacity: 0.3;
      transform: scaleY(-1);
      mask-image: linear-gradient(to top, black, transparent 40%);
      pointer-events: none;
    }
    .seat {
      position: relative;
      display: inline-grid;
      place-items: center;
      width: var(--seat);
      height: var(--seat);
      padding: 0;
      border-radius: var(--radius-pill);
      background: var(--color-surface-sunken);
      color: var(--color-text);
      font-size: var(--text-xs);
      font-weight: 700;
      overflow: hidden;
    }
    .seat img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .seat.moderator {
      background: var(--color-accent);
      color: var(--color-accent-contrast);
    }
    .seat.stub {
      background: var(--color-surface-sunken);
      color: var(--color-muted);
    }
    /* Selected: a dark grey ring outside, as on the track heads. */
    .seat.selected {
      outline: 2px solid var(--color-muted);
      outline-offset: 2px;
    }
    /* Nothing to select (player mode): the seats are portraits only. */
    :host(.static) .seat {
      pointer-events: none;
      cursor: default;
    }
    :host(.static) .seat.selected {
      outline: none;
    }

    /* Left area: the stimulus, large while the moderator speaks, small below the seats otherwise. */
    .left {
      position: relative;
      pointer-events: none;
      grid-column: 1;
      grid-row: 1 / -1;
    }
    /* No caption. The image's bottom edge always sits on the bubble's lower edge and it takes the
       whole width of the left area, so switching sizes only moves the top edge (animated, no jump). Large (moderator
       speaks): up to the full height of the left area, kept clear of the speaker's portrait and
       bubble. Small (a participant speaks): the seats roll into the top of the left area, so the
       image's top edge moves below them. */
    .stimulus {
      position: absolute;
      top: 0;
      bottom: 0;
      right: var(--space-4);
      z-index: 2;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      align-items: flex-end;
      width: calc(100% - var(--space-4));
      margin: 0;
      transition: all var(--roll) var(--ease-standard);
    }
    .stimulus img {
      max-width: 100%;
      max-height: 100%;
      min-height: 0;
      object-fit: contain;
      border-radius: var(--radius-md);
      background: var(--color-surface-sunken);
      pointer-events: auto;
      transition: inherit;
    }
    .stimulus.small {
      top: calc(var(--seats-pad-top) + var(--seat) + var(--seats-pad-bottom));
    }
    .stimulus.small img {
      border-radius: var(--radius-sm);
    }
    /* Leaving display: none restarts the animation: each new stimulus flies in from the left. */
    .stimulus:not(.empty) {
      animation: fly-in 700ms cubic-bezier(0.22, 1, 0.36, 1) both;
    }
    .stimulus.empty {
      display: none;
    }
    @keyframes fly-in {
      from {
        opacity: 0;
        transform: translateX(-100%);
      }
      60% {
        opacity: 1;
      }
    }

    /* The bubble hangs from the speaker in the frame: its left edge starts below the portrait's
       centre, where the pointer's tip sits. Name and clock stand right of the pointer. */
    .now {
      --tail-w: 2rem;
      /* How far the tip reaches up into the mirror image below the portrait. */
      --tail-reach: 0.5rem;
      position: relative;
      grid-column: 2;
      grid-row: 2;
      display: grid;
      gap: var(--space-1);
      min-width: 0;
      margin-left: calc(var(--seat) / 2);
    }
    .now.talking::before {
      content: '';
      position: absolute;
      left: 0;
      top: calc(-1 * var(--tail-reach));
      width: var(--tail-w);
      /* Down to the bubble's top edge, one pixel into it so no seam shows. */
      height: calc(var(--tail-reach) + 1.5em + var(--space-1) + 1px);
      background: var(--color-surface-sunken);
      clip-path: polygon(0 0, 100% 100%, 0 100%);
    }
    .speaker {
      display: flex;
      gap: var(--space-2);
      align-items: baseline;
      min-width: 0;
      /* A fixed height, so the pointer always meets the bubble. */
      height: 1.5em;
      margin: 0;
      font-weight: 700;
      line-height: 1.5;
    }
    .now.talking .speaker {
      padding-left: calc(var(--tail-w) + var(--space-2));
    }
    .name {
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .clock {
      flex: none;
      color: var(--color-muted);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      font-weight: 400;
    }
    .cut {
      flex: none;
      margin-left: auto;
      padding: 0 var(--space-2);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-pill);
      color: var(--color-muted);
      font-size: var(--text-xs);
      font-weight: 400;
      cursor: help;
    }
    /* A fixed height (three lines at the base size, more in player mode), so the card never jumps. */
    .line {
      color: var(--color-muted);
      box-sizing: content-box;
      height: calc(var(--bubble-lines, 3) * 1.5 * var(--text-md));
      margin: 0;
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-md);
      line-height: 1.5;
      overflow: hidden;
    }
    /* Still too long at the smallest size: cut with an ellipsis, scrollable once reached. */
    .line.clamped {
      display: -webkit-box;
      -webkit-line-clamp: var(--lines, 3);
      -webkit-box-orient: vertical;
      cursor: ns-resize;
    }
    .line.clamped:hover,
    .line.clamped:focus-visible {
      display: block;
      overflow-y: auto;
    }
    /* What is said under the red line, as a bubble like on the timeline. */
    .line.bubble {
      background: var(--color-surface-sunken);
      color: var(--color-text);
      /* The pointer grows out of this corner. */
      border-top-left-radius: 0;
    }
    @media (prefers-reduced-motion: reduce) {
      .track,
      .stimulus,
      .stimulus img {
        transition: none;
      }
      .stimulus:not(.empty) {
        animation: none;
      }
    }
  `,
})
export class PanelroomPreview {
  readonly participants = input.required<Participant[]>();
  readonly transcript = input.required<Transcript>();
  readonly guide = input.required<Guide | null>();
  readonly stimuli = input.required<Stimulus[]>();
  readonly moderatorName = input('Moderation');
  readonly moderatorImage = input<string | null>(null);
  readonly moderatorColor = input<string | null>(null);
  /** How many lines (at the base size) the speech bubble is high. More in player mode. */
  readonly bubbleLines = input(3);
  /** A click on a seat selects that persona. Off in player mode, where nothing is to select. */
  readonly interactive = input(true);
  /**
   * The loudness of the voice being heard (0 to 1), as a signal so it can change every frame
   * without a new render. With it the speaker's rings beat with the voice; without, they beat evenly.
   */
  readonly voiceLevel = input<Signal<number> | null>(null);

  protected readonly ui = inject(DiscussionUiState);
  protected readonly images = inject(BrokenImages);
  protected readonly moderatorTrack = MODERATOR_TRACK;
  private readonly time = computed(() => this.ui.previewTime());

  private readonly bubble = viewChild<ElementRef<HTMLElement>>('bubble');
  private readonly width = signal(0);
  /** The speaker's turn doesn't fit the bubble even at the smallest size. */
  protected readonly truncated = signal(false);

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(([entry]) => this.width.set(Math.round(entry.contentRect.width)));
      observer.observe(host);
      inject(DestroyRef).onDestroy(() => observer.disconnect());
    }
    // Refit whenever the text or the width changes.
    afterRenderEffect(() => {
      this.speaking();
      this.width();
      this.bubbleLines();
      const el = this.bubble()?.nativeElement;
      this.truncated.set(el ? fitText(el) : false);
    });
  }

  /** A portrait as a CSS `url()` for the mirror image (quotes escaped). */
  protected cssUrl(src: string | null | undefined): string | null {
    return src ? `url("${src.replace(/["\\]/g, '\\$&')}")` : null;
  }

  protected readonly clock = computed(() => clockLabel(this.time()));
  protected readonly speaking = computed(() => clipAt(this.transcript().clips, this.time()));
  /** The seat in the frame: 0 is the moderator (also while nobody speaks), then the participants. */
  protected readonly focus = computed(() => {
    const clip = this.speaking();
    if (!clip || clip.moderator) return 0;
    return this.participants().findIndex((p) => p.guid === clip.speakerGuid) + 1;
  });
  /** The speaker's own colour for the rings around the frame; without one it is the accent. */
  protected readonly speakerColor = computed(() => {
    const clip = this.speaking();
    if (!clip) return null;
    if (clip.moderator) return this.moderatorColor();
    return this.participants().find((p) => p.guid === clip.speakerGuid)?.color ?? null;
  });
  protected readonly question = computed(() => {
    const key = this.speaking()?.questionKey;
    return key ? this.guide()?.blocks.flatMap((b) => b.questions).find((q) => q.key === key) : undefined;
  });
  protected readonly stimulus = computed(() =>
    this.stimuli().find((s) => s.start <= this.time() && this.time() <= s.end),
  );
}

/** Font sizes the bubble tries, largest first. */
const FIT_SIZES = ['var(--text-md)', 'var(--text-sm)', 'var(--text-xs)'];

/**
 * Shrinks the bubble's text until it fits its fixed height. Returns true when even the smallest
 * size overflows: the bubble then gets the `clamped` class (ellipsis, scrollable on hover).
 */
function fitText(el: HTMLElement): boolean {
  el.classList.remove('clamped');
  el.removeAttribute('tabindex');
  for (const size of FIT_SIZES) {
    el.style.fontSize = size;
    if (el.scrollHeight <= el.clientHeight + 1) return false;
  }
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
  if (lineHeight > 0) el.style.setProperty('--lines', String(Math.max(1, Math.floor(el.clientHeight / lineHeight))));
  el.classList.add('clamped');
  el.tabIndex = 0;
  return true;
}
