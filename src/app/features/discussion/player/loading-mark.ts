import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LoadingLine } from '../../analysis/ui/loading-line/loading-line';

/**
 * A busy sign: the brand's busy line (`busyLine` in its brand.json) beats on an accent disc while
 * the disc sends out ripples. Decorative: whoever shows it says what is going on.
 */
@Component({
  selector: 'app-loading-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LoadingLine],
  template: `
    <svg class="mark" viewBox="-12.06 -12.77 77 77" aria-hidden="true" focusable="false">
      <circle class="ring" cx="26.44" cy="25.63" r="25.33" />
      <circle class="ring echo" cx="26.44" cy="25.63" r="25.33" />
      <circle class="disc" cx="26.44" cy="25.63" r="25.33" />
    </svg>
    <!-- Laid over the disc and clipped to it. -->
    <span class="line"><app-loading-line /></span>
  `,
  styles: `
    :host {
      --beat: 1.6s;
      position: relative;
      display: block;
      width: 3rem;
      aspect-ratio: 1;
    }
    .mark {
      display: block;
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .mark * {
      transform-box: view-box;
    }
    .disc {
      fill: var(--color-accent);
    }
    /* The disc's box within the 77-unit viewBox: from 13.17 to 63.83 units on both axes. */
    .line {
      position: absolute;
      inset: 17.1%;
      display: grid;
      place-items: center;
      overflow: hidden;
      border-radius: 50%;
      color: var(--color-accent-contrast);
    }
    .line app-loading-line {
      --loading-line-height: auto;
      width: 90%;
    }
    /* Ripples start behind the disc and grow out from under it. */
    .ring {
      fill: none;
      stroke: var(--color-accent);
      opacity: 0;
      transform-origin: 26.44px 25.63px;
      animation: ring var(--beat) cubic-bezier(0.25, 0.5, 0.4, 1) calc(var(--beat) * -0.08) infinite;
    }
    .echo {
      animation-name: echo;
    }
    @keyframes ring {
      0% {
        opacity: 0.5;
        transform: scale(0.8);
        stroke-width: 4.8;
      }
      100% {
        opacity: 0;
        transform: scale(1.5);
        stroke-width: 1.2;
      }
    }
    @keyframes echo {
      0%,
      40% {
        opacity: 0.3;
        transform: scale(0.8);
        stroke-width: 3.6;
      }
      100% {
        opacity: 0;
        transform: scale(1.4);
        stroke-width: 0.9;
      }
    }
    @keyframes breathe {
      50% {
        opacity: 0.6;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .ring {
        display: none;
      }
      .line {
        animation: breathe 3s ease-in-out infinite;
      }
    }
  `,
})
export class LoadingMark {}
