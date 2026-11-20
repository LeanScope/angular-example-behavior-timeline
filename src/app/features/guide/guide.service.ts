import {
  DOCUMENT,
  Injectable,
  InjectionToken,
  Injector,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import type { InventoryFrame, InventoryRow } from '../../leanscope/agent-server.types';
import { LEANSCOPE_CONFIG } from '../../leanscope/leanscope.config';
import { LeanScopeSessionService } from '../../leanscope/leanscope-session.service';
import { SupportWidget } from '../../leanscope/ui/support-widget';
import { APP_ENV } from '../app-env';
import { chaptersOf, inventoryAnswers, nextChapter, type Chapter } from './chapters';

/** Makes the guide's session; a test provides its own. */
export const GUIDE_SESSION_FACTORY = new InjectionToken<() => LeanScopeSessionService>(
  'GUIDE_SESSION_FACTORY',
  {
    providedIn: 'root',
    factory: () => {
      const parent = inject(Injector);
      return () =>
        Injector.create({ providers: [LeanScopeSessionService], parent }).get(LeanScopeSessionService);
    },
  },
);

/** How many frames an anchor's element may take to render before the widget stays at home. */
const ANCHOR_FRAMES = 30;

/**
 * The guide: the persona (e.g. "Thomas") who leads the user through the whole process in the
 * agent server's support widget.
 *
 * It owns one session and runs the chapters (see `chapters.ts`) in it, one choreo after the
 * other: when a chapter's choreo reaches its authored end, the next one starts and the widget
 * follows. The chapters share one 🍱 Inventory in the repository, so what one remembered is there
 * for the next; the guide reads it from the session's `inventory` frames.
 *
 * The widget is the guide's voice. It sits at its home position (where the widget puts itself)
 * unless a page anchors it next to the place where the current question is answered.
 */
@Injectable({ providedIn: 'root' })
export class GuideService {
  private readonly document = inject(DOCUMENT);
  private readonly widget = inject(SupportWidget);
  readonly session = inject(GUIDE_SESSION_FACTORY)();
  readonly chapters: readonly Chapter[] = chaptersOf(
    inject(LEANSCOPE_CONFIG).choreoScenarioGuid,
    inject(APP_ENV),
  );

  private readonly _chapter = signal<Chapter | null>(null);
  private readonly _inventory = signal<InventoryRow[]>([]);
  /** The theme the app was opened with, for the widget. */
  private readonly theme = signal<{ theme?: string | null; themeMode?: string | null }>({});
  /** A page showing something the guide has no part in (a demo, the player) takes the widget away. */
  private readonly _suppressed = signal(false);
  private anchorFrame = 0;

  /** The chapter the session runs; null without a session, or for one that is no chapter. */
  readonly chapter = this._chapter.asReadonly();
  /** What the chapters' shared Inventory remembers, as the session last reported it. */
  readonly inventory = this._inventory.asReadonly();
  /** The remembered answers by field key (see `inventoryAnswers`). */
  readonly answers = computed(() => inventoryAnswers(this._inventory()));

  constructor() {
    this.session.onFrame((frame) => {
      if (frame.event !== 'inventory') return;
      const rows = (frame.data as InventoryFrame | null)?.rows;
      this._inventory.set(Array.isArray(rows) ? rows : []);
    });
    // A chapter that reached its authored end hands over to the next one. Any other end (an
    // error, a stop, a choreo that changed) leaves the guide where it is.
    effect(() => {
      if (this.session.state() !== 'ended' || this.session.endReason() !== 'terminal') return;
      untracked(() => {
        const next = nextChapter(this.chapters, this._chapter());
        if (next) void this.run(next);
      });
    });
    effect(() => {
      const session = this.session.session();
      if (!session?.sessionToken || this._suppressed()) return this.widget.hide();
      // The theme the app was opened with; for a session of its own, the one in its uiUrl.
      const fromUi = urlParams(session.uiUrl);
      const { theme, themeMode } = this.theme();
      this.widget.show(session.sessionToken, {
        theme: theme ?? fromUi.get('theme'),
        themeMode: themeMode ?? fromUi.get('themeMode'),
        hostSlots: this._chapter()?.hostSlots ?? [],
      });
    });
  }

  /** Starts the process at its first chapter. */
  start(): Promise<void> {
    const first = this.chapters[0];
    if (first) return this.run(first);
    // Nothing configured: the session says what is missing.
    this._chapter.set(null);
    return this.session.start();
  }

  /**
   * Follows a session LeanScope started (`?sessionToken=`) and opens its start gate. When it runs
   * one of the chapters' choreos, the guide goes on from there.
   */
  async attach(sessionToken: string): Promise<void> {
    this._chapter.set(null);
    this._inventory.set([]);
    if (!(await this.session.attach(sessionToken))) return;
    const choreo = (await this.session.sessionConfig())?.choreoScenarioGuid;
    if (this.session.session()?.sessionToken === sessionToken.trim()) {
      this._chapter.set(this.chapters.find((c) => c.choreoGuid === choreo) ?? null);
    }
    await this.session.begin();
  }

  /** Ends following the session and takes the widget away. */
  stop(): void {
    this._chapter.set(null);
    this._inventory.set([]);
    this.anchor(null);
    this.session.stop();
  }

  /** The theme LeanScope opened the app with (`?theme=`, `?themeMode=`). */
  setTheme(theme: string | null | undefined, themeMode: string | null | undefined): void {
    this.theme.set({ theme, themeMode });
  }

  /** Hides the widget while a page shows something the guide has no part in. */
  suppress(suppressed: boolean): void {
    this._suppressed.set(suppressed);
  }

  /**
   * Puts the minimized widget next to the element `selector` finds: the place where the current
   * question is answered. `null` sends it back to its home position, which is also where it
   * stays when the element doesn't turn up (it may render a few frames after a view change).
   */
  anchor(selector: string | null): void {
    const win = this.document.defaultView;
    win?.cancelAnimationFrame(this.anchorFrame);
    if (!selector) return this.widget.anchorTo(null);
    let frames = 0;
    const find = () => {
      const element = this.document.querySelector<HTMLElement>(selector);
      if (element) this.widget.anchorTo(element);
      else if (win && ++frames < ANCHOR_FRAMES) this.anchorFrame = win.requestAnimationFrame(find);
      else this.widget.anchorTo(null);
    };
    find();
  }

  private run(chapter: Chapter): Promise<void> {
    this._chapter.set(chapter);
    return this.session.start({ choreoScenarioGuid: chapter.choreoGuid });
  }
}

/** The query parameters of a URL, empty for none or an invalid one. */
function urlParams(url: string | undefined): URLSearchParams {
  try {
    return new URL(url ?? '').searchParams;
  } catch {
    return new URLSearchParams();
  }
}
