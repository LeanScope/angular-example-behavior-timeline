import { ChangeDetectionStrategy, Component, effect, input, signal, type Signal } from '@angular/core';
import { VoiceOnsets } from './voice-onsets';

/** A ring sent out by the voice: `amp` is how loud the syllable was (0 to 1). */
interface Ripple {
  id: number;
  amp: number;
  echo: boolean;
}
/** More rings than this at once only blur into each other. */
const MAX_RIPPLES = 12;

/**
 * The rings of the busy mark (app-loading-mark) around a speaker's portrait: they grow out from under it,
 * thin out and fade, turning from red into the speaker's colour (`--persona-color`) on the way.
 * Without a voice they beat evenly; with one, every syllable sends out a ring and its echo, as big
 * and strong as the syllable is loud. Place it in the portrait's frame; it takes the size of `--seat`
 * and steps over the frame's `--frame-border`.
 */
@Component({
  selector: 'app-speaker-ripples',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: `
    @if (voiceLevel()) {
      @for (r of ripples(); track r.id) {
        <span class="ring" [class.echo]="r.echo" [style.--amp]="r.amp" (animationend)="drop(r.id)"></span>
      }
    } @else {
      <span class="ring beat"></span>
      <span class="ring beat echo"></span>
    }
  `,
  styles: `
    /* Room around the portrait for the rings; the portrait masks them, so they seem to come from
       behind it. */
    :host {
      --ring-room: 0.75rem;
      --beat: 1.6s;
      position: absolute;
      /* Over the portrait, beyond the frame's own border. */
      inset: calc(-1 * var(--ring-room) - var(--frame-border, 0px));
      pointer-events: none;
      mask-image: radial-gradient(circle closest-side, transparent calc(var(--seat) / 2), black calc(var(--seat) / 2));
    }
    .ring {
      position: absolute;
      inset: var(--ring-room);
      box-sizing: border-box;
      border: solid var(--color-accent);
      border-radius: 50%;
      opacity: 0;
      animation: ring var(--beat) cubic-bezier(0.25, 0.5, 0.4, 1) forwards;
    }
    .ring.echo {
      animation-name: echo;
    }
    /* The busy mark's ripples start slightly ahead of its beat. */
    .ring.beat {
      animation-delay: calc(var(--beat) * -0.08);
      animation-iteration-count: infinite;
    }
    /* Strokes as in the busy mark (4.8 → 1.2 and 3.6 → 0.9 on a disc of 50.66), here as a share of
       the seat. Size and strength follow --amp, the loudness of the syllable (1 without a voice). */
    @keyframes ring {
      0% {
        opacity: calc(0.35 + 0.5 * var(--amp, 1));
        transform: scale(0.8);
        border-width: calc(var(--seat) * 0.095);
        border-color: var(--color-accent);
      }
      60% {
        border-color: var(--persona-color, var(--color-accent));
      }
      100% {
        opacity: 0;
        transform: scale(calc(1 + 0.5 * var(--amp, 1)));
        border-width: calc(var(--seat) * 0.024);
        border-color: var(--persona-color, var(--color-accent));
      }
    }
    @keyframes echo {
      0%,
      40% {
        opacity: calc(0.2 + 0.35 * var(--amp, 1));
        transform: scale(0.8);
        border-width: calc(var(--seat) * 0.071);
        border-color: var(--color-accent);
      }
      76% {
        border-color: var(--persona-color, var(--color-accent));
      }
      100% {
        opacity: 0;
        transform: scale(calc(1 + 0.4 * var(--amp, 1)));
        border-width: calc(var(--seat) * 0.018);
        border-color: var(--persona-color, var(--color-accent));
      }
    }
    @media (prefers-reduced-motion: reduce) {
      :host {
        display: none;
      }
    }
  `,
})
export class SpeakerRipples {
  /**
   * The loudness of the voice being heard (0 to 1), as a signal so it can change every frame
   * without a new render. Without one the rings beat evenly.
   */
  readonly voiceLevel = input<Signal<number> | null>(null);

  /** The rings the voice has sent out and that are still on their way. */
  protected readonly ripples = signal<Ripple[]>([]);
  private readonly onsets = new VoiceOnsets();
  private nextId = 0;

  constructor() {
    effect(() => {
      const amp = this.onsets.feed(this.voiceLevel()?.() ?? 0, performance.now());
      if (amp === null) return;
      const id = this.nextId;
      this.nextId += 2;
      this.ripples.update((all) => [
        ...all.slice(-(MAX_RIPPLES - 2)),
        { id, amp, echo: false },
        { id: id + 1, amp, echo: true },
      ]);
    });
  }

  /** A ring has faded out. */
  protected drop(id: number): void {
    this.ripples.update((all) => all.filter((r) => r.id !== id));
  }
}
