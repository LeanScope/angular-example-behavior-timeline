import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import type { DsStatusState } from '../../design-system';

/** One step of the breadcrumb after "Home". */
export interface Crumb {
  label: string;
  /** Router link; the last crumb is the current page and needs none. */
  link?: string;
}

/** The page's status light at the right end of the shell's header ("● Demo"). */
export interface ShellStatus {
  state: DsStatusState;
  label: string;
  /** A longer explanation for the tooltip. */
  title?: string | null;
}

/**
 * What pages tell the app shell (the breadcrumb, the status light), and whether there is a shell at all.
 *
 * Pages only ever write here, so they work the same with or without the shell: embedded in
 * another app's iframe, nobody reads it. This is the one thing a page knows about the shell.
 */
@Injectable({ providedIn: 'root' })
export class ShellContext {
  private readonly doc = inject(DOCUMENT);

  /**
   * Embedded mode: the host app brings its own frame, so the shell steps aside. On when the app
   * runs inside an iframe, or with `?embedded` in the start URL (for trying it out standalone).
   * Decided once at startup, so in-app navigation cannot lose it.
   */
  readonly embedded = isEmbedded(this.doc);

  readonly crumbs = signal<Crumb[]>([]);
  /** Shown at the right end of the header; a page clears it when it goes. */
  readonly status = signal<ShellStatus | null>(null);
}

function isEmbedded(doc: Document): boolean {
  const params = new URLSearchParams(doc.location?.search ?? '');
  if (params.has('embedded')) return params.get('embedded') !== 'false';
  try {
    const win = doc.defaultView;
    return !!win && win.self !== win.top;
  } catch {
    // A cross-origin parent denies access to `top`: that alone says we are framed.
    return true;
  }
}
