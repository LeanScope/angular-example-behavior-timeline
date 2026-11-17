import { DestroyRef, inject, signal, type Signal } from '@angular/core';

/**
 * Whether a CSS media query matches, as a signal. Call it in an injection context. Without
 * `matchMedia` (tests, server) it never matches.
 */
export function mediaQuery(query: string): Signal<boolean> {
  const list = typeof matchMedia === 'function' ? matchMedia(query) : null;
  const matches = signal(list?.matches ?? false);
  if (list) {
    const listener = (event: MediaQueryListEvent) => matches.set(event.matches);
    list.addEventListener('change', listener);
    inject(DestroyRef).onDestroy(() => list.removeEventListener('change', listener));
  }
  return matches.asReadonly();
}

/** Too little width (or portrait): the sidebars fold away and can't be unfolded. */
export const COMPACT_QUERY = '(max-width: 52rem), (orientation: portrait)';
/** Too little width for the Panelroom preview: it and its toggle are gone. */
export const NO_PREVIEW_QUERY = '(max-width: 52rem)';
/** Little height: the Panelroom preview starts folded away (the user can still unfold it). */
export const SHORT_QUERY = '(max-height: 50rem)';
/** The user asked the system for less motion. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
