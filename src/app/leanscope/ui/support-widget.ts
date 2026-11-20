import { DOCUMENT, Injectable, inject } from '@angular/core';
import { LEANSCOPE_CONFIG } from '../leanscope.config';

/** The loader's path on the agent server's UI, and the title of the iframe it creates. */
const LOADER_PATH = '/embed/support-embed.js';
const IFRAME_TITLE = 'Support widget';
/** Gap between an anchor element and the minimized widget (px). */
const ANCHOR_GAP = 12;

/** Display parameters of the server's UI that the widget takes over from the app's own URL. */
export interface SupportWidgetParams {
  /** The theme guid LeanScope opened the app with (`?theme=`), e.g. the choreo's theme. */
  theme?: string | null;
  /** `?themeMode=`, e.g. `follow`. */
  themeMode?: string | null;
  /**
   * Field keys the app answers in a place of its own (`?hostSlots=`): for a question that asks
   * for exactly one of them, the widget shows a pointer to the app instead of its form.
   */
  hostSlots?: readonly string[];
}

/** The widget's own geometry, as it tells the loader (`lsa/support/geometry`). */
interface Geometry {
  state: 'minimized' | 'modal' | 'fullscreen';
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The agent server's support widget: the session's chat in a small window the user can collapse,
 * drag and resize, on top of the app (an iframe of the server's own UI with `appShell=widget`).
 *
 * The loader installs once per page and cannot be removed again, so a later session reuses its
 * iframe: `show()` points it at the new session, `hide()` takes it off the page until then.
 * Without `agentUiUrl` in the configuration there is no widget, and `available` is false.
 *
 * `anchorTo()` puts the minimized widget next to an element, e.g. the place where the session's
 * current question is answered. The widget cannot be told where to sit yet, so for now the app
 * moves the loader's iframe while the widget is minimized (the widget still draws itself in its
 * box). It also posts `lsa/support/anchor`, for a widget that will place itself; once it does, the
 * iframe move can go.
 */
@Injectable({ providedIn: 'root' })
export class SupportWidget {
  private readonly document = inject(DOCUMENT);
  private readonly origin = (inject(LEANSCOPE_CONFIG).agentUiUrl ?? '').trim().replace(/\/+$/, '');
  private shownSrc = '';
  private anchor: HTMLElement | null = null;
  private geometry: Geometry | null = null;
  private listening = false;
  private readonly reposition = () => this.place();

  /** Whether the app can show the widget at all. */
  readonly available = this.origin !== '';

  /** Shows the chat of the session with this token, in the theme the app was opened with. */
  show(sessionToken: string, params: SupportWidgetParams = {}): void {
    if (!this.available) return;
    const query = new URLSearchParams({ sessionToken });
    if (params.theme) query.set('theme', params.theme);
    if (params.themeMode) query.set('themeMode', params.themeMode);
    if (params.hostSlots?.length) query.set('hostSlots', params.hostSlots.join(','));
    query.set('appShell', 'widget');
    const src = `${this.origin}/?${query}`;
    if (src === this.shownSrc) return;
    this.shownSrc = src;
    this.listen();
    if (this.iframe()) return this.sync();
    if (this.document.querySelector(`script[src="${this.origin}${LOADER_PATH}"]`)) return;
    const script = this.document.createElement('script');
    script.src = `${this.origin}${LOADER_PATH}`;
    script.async = true;
    script.dataset['src'] = src;
    script.dataset['allow'] = 'microphone';
    // The session may have changed (or ended) while the loader was on its way.
    script.addEventListener('load', () => this.sync());
    this.document.body.appendChild(script);
  }

  /** Takes the widget off the page (until the next `show()`). */
  hide(): void {
    this.shownSrc = '';
    this.anchorTo(null);
    this.sync();
  }

  /** Puts the minimized widget next to `element`; null gives it its own place back. */
  anchorTo(element: HTMLElement | null): void {
    if (element === this.anchor) return;
    this.anchor = element;
    const win = this.document.defaultView;
    if (element) {
      win?.addEventListener('scroll', this.reposition, true);
      win?.addEventListener('resize', this.reposition);
    } else {
      win?.removeEventListener('scroll', this.reposition, true);
      win?.removeEventListener('resize', this.reposition);
    }
    this.post();
    this.place();
  }

  /** Brings the loader's iframe in line with what should be shown. */
  private sync(): void {
    const iframe = this.iframe();
    if (!iframe) return;
    iframe.style.display = this.shownSrc ? '' : 'none';
    const src = this.shownSrc || 'about:blank';
    if (iframe.src !== src) iframe.src = src;
  }

  /**
   * Follows the widget's geometry messages. Registered after the loader's own listener, so a
   * move made here comes after the loader has applied the widget's geometry.
   */
  private listen(): void {
    const win = this.document.defaultView;
    if (this.listening || !win) return;
    this.listening = true;
    win.addEventListener('message', (event: MessageEvent) => {
      const iframe = this.iframe();
      if (!iframe || event.source !== iframe.contentWindow || event.origin !== this.origin) return;
      const data = event.data as { type?: unknown } & Partial<Geometry>;
      if (data?.type === 'lsa/support/ready') this.post();
      if (data?.type !== 'lsa/support/geometry') return;
      this.geometry = data as Geometry;
      this.place();
    });
  }

  /** Moves the minimized widget next to the anchor, or back to where the widget put itself. */
  private place(): void {
    const iframe = this.iframe();
    const geometry = this.geometry;
    const win = this.document.defaultView;
    if (!iframe || !geometry || !win || geometry.state !== 'minimized') return;
    if (!this.anchor?.isConnected) {
      iframe.style.left = `${geometry.left}px`;
      iframe.style.top = `${geometry.top}px`;
      return;
    }
    const rect = this.anchor.getBoundingClientRect();
    const clamp = (value: number, max: number) => Math.min(Math.max(0, value), Math.max(0, max));
    const right = rect.right + ANCHOR_GAP;
    let left: number;
    let top: number;
    if (right + geometry.width <= win.innerWidth) {
      // Beside the anchor, at its middle.
      left = right;
      top = clamp(rect.top + rect.height / 2 - geometry.height / 2, win.innerHeight - geometry.height);
    } else {
      // No room beside it: above its right end (else below), never on top of its neighbour.
      left = clamp(rect.right - geometry.width, win.innerWidth - geometry.width);
      const above = rect.top - ANCHOR_GAP - geometry.height;
      top = above >= 0 ? above : clamp(rect.bottom + ANCHOR_GAP, win.innerHeight - geometry.height);
    }
    iframe.style.left = `${left}px`;
    iframe.style.top = `${top}px`;
  }

  /** Tells the widget where its anchor is (`lsa/support/anchor`; ignored by today's widget). */
  private post(): void {
    const target = this.iframe()?.contentWindow;
    if (!target || !this.origin) return;
    const rect = this.anchor?.getBoundingClientRect();
    try {
      target.postMessage(
        {
          type: 'lsa/support/anchor',
          rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
        },
        this.origin,
      );
    } catch {
      // The widget is navigating; the next anchor change sends again.
    }
  }

  private iframe(): HTMLIFrameElement | null {
    return this.document.querySelector<HTMLIFrameElement>(`iframe[title="${IFRAME_TITLE}"]`);
  }
}
