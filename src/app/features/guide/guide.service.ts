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
import type {
  InventoryFrame,
  InventoryResetOutcome,
  InventoryRow,
} from '../../leanscope/agent-server.types';
import { LEANSCOPE_CONFIG } from '../../leanscope/leanscope.config';
import { LeanScopeSessionService } from '../../leanscope/leanscope-session.service';
import { SupportWidget } from '../../leanscope/ui/support-widget';
import { APP_ENV } from '../app-env';
import { HOST_SLOT_KEYS } from '../discussion/model/slots';
import { guideChoreos, inventoryAnswers, nextChoreo } from './chapters';

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
/** Where the last session is remembered, per repository: ids only, never a token. */
const REMEMBERED_KEY = 'leanscope-guide-session';
/** How often a reset is tried again while the session is busy with a turn, and how long between. */
const RESET_TRIES = 8;
const RESET_WAIT_MS = 1500;

/** The guide's last session in this browser: which choreo it ran, and its own scenario. */
interface RememberedSession {
  choreoScenarioGuid: string;
  sessionScenarioGuid: string;
  /** What the choreos before it were told, by field key (persona guids, file refs). */
  carried?: Record<string, unknown[]>;
  /** The names of the files handed over so far, by the place they were given at. */
  files?: Record<string, string[]>;
}

/**
 * The guide: the persona (e.g. "Thomas") who leads the user through the whole process in the
 * agent server's support widget.
 *
 * It owns one session and runs the guide's choreos (see `chapters.ts`) in it, one after the
 * other: when a choreo reaches its authored end, the next one starts and the widget follows. The
 * choreos share one 🍱 Inventory in the repository, so what one remembered is there for the next;
 * the guide reads it from the session's `inventory` frames.
 *
 * It rejoins rather than restarts: the last session's scenario is remembered in this browser, and
 * `start()` asks the agent server for that session again (a running one is joined at once, a
 * stored one resumed). `restart()` begins anew on purpose.
 *
 * The widget is the guide's voice. It sits at its home position (where the widget puts itself)
 * unless a page anchors it next to the place where the current question is answered.
 */
@Injectable({ providedIn: 'root' })
export class GuideService {
  private readonly document = inject(DOCUMENT);
  private readonly widget = inject(SupportWidget);
  private readonly config = inject(LEANSCOPE_CONFIG);
  readonly session = inject(GUIDE_SESSION_FACTORY)();
  /** The choreos of the guided process, in order. */
  readonly choreos: readonly string[] = guideChoreos(this.config.choreoScenarioGuid, inject(APP_ENV));

  private readonly _choreo = signal<string | null>(null);
  private readonly _inventory = signal<InventoryRow[]>([]);
  /** The theme the app was opened with, for the widget. */
  private readonly theme = signal<{ theme?: string | null; themeMode?: string | null }>({});
  /** A page showing something the guide has no part in (a demo, the player) takes the widget away. */
  private readonly _suppressed = signal(false);
  private anchorFrame = 0;

  /** The choreo the session runs; null without a session, or for one that is none of the guide's. */
  readonly choreo = this._choreo.asReadonly();
  /** What the choreos' shared Inventory remembers, as the session last reported it. */
  readonly inventory = this._inventory.asReadonly();
  /** What the choreos before the running one were told, by field key (see `answers`). */
  private readonly carried = signal<Record<string, unknown[]>>({});
  /**
   * The answers by field key (see `inventoryAnswers`): what the running session reports, on top
   * of what the choreos before it were told. The Inventory only keeps the slots it declares, so
   * without this a later choreo would not know the cast an earlier one was given.
   */
  readonly answers = computed(() => ({ ...this.carried(), ...inventoryAnswers(this._inventory()) }));
  private readonly _files = signal<Record<string, string[]>>({});
  /**
   * The names of the files handed to the guide so far, by the place they were given at. Kept
   * with the remembered session, so a reload still shows what was handed over (the names only:
   * the files themselves are with the session).
   */
  readonly files = this._files.asReadonly();
  /**
   * The running choreo comes after the first: what the first one asked for (the data basis) is
   * settled and can no longer be given or changed.
   */
  readonly pastFirst = computed(() => {
    const choreo = this._choreo();
    return choreo !== null && choreo !== this.choreos[0];
  });

  constructor() {
    this.session.onFrame((frame) => {
      if (frame.event !== 'inventory') return;
      const rows = (frame.data as InventoryFrame | null)?.rows;
      this._inventory.set(Array.isArray(rows) ? rows : []);
    });
    // A choreo that reached its authored end hands over to the next one. Any other end (an
    // error, a stop, a choreo that changed) leaves the guide where it is.
    effect(() => {
      if (this.session.state() !== 'ended' || this.session.endReason() !== 'terminal') return;
      untracked(() => {
        const next = nextChoreo(this.choreos, this._choreo());
        if (!next) return;
        // What this choreo was told goes along to the next one.
        this.carried.set(this.answers());
        this._inventory.set([]);
        void this.run(next);
      });
    });
    // What the guide asks, for whoever looks into the console: which fields a question names
    // decides whether the app has a place for it (see `slots.ts`) or the widget shows its form.
    effect(() => {
      const question = this.session.pendingQuestion();
      if (!question) return;
      console.info('[guide] asks', {
        choreo: this._choreo(),
        fieldKeys: question.fieldKeys,
        required: question.required,
        properties: Object.keys(question.schema?.properties ?? {}),
        facetGuid: question.facetGuid,
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
        hostSlots: HOST_SLOT_KEYS,
      });
    });
  }

  /**
   * Goes on where this browser left off: rejoins the remembered session of the choreo it ran.
   * Without one (or when it can't be had any more), starts the process at its first choreo.
   */
  async start(): Promise<void> {
    const first = this.choreos[0];
    if (!first) {
      // Nothing configured: the session says what is missing.
      this._choreo.set(null);
      return this.session.start();
    }
    const remembered = this.remembered();
    if (remembered && this.choreos.includes(remembered.choreoScenarioGuid)) {
      this.carried.set(remembered.carried ?? {});
      this._files.set(remembered.files ?? {});
      await this.run(remembered.choreoScenarioGuid, remembered.sessionScenarioGuid);
      if (this.session.state() !== 'error') return;
      // That session is gone for good: begin anew.
      this.forget();
      this.carried.set({});
      this._files.set({});
    }
    await this.run(first);
  }

  /** Begins the process anew, at its first choreo, whatever was remembered. */
  restart(): Promise<void> {
    this.forget();
    this._inventory.set([]);
    this.carried.set({});
    this._files.set({});
    return this.start();
  }

  /**
   * Forgets the data basis: what the choreos' shared 🍱 Inventory keeps (the agent server deletes
   * the kept answers and the files only they listed), then begins anew at the first choreo, which
   * asks for everything again. Without a live session one is started first, because the reset is
   * a call on a session. While the session is busy with a turn the reset is tried again for a
   * while. When it fails, nothing changes and the outcome says why.
   */
  async resetData(): Promise<InventoryResetOutcome> {
    if (!this.choreos[0]) return { ok: false, status: 0 };
    if (!this.live()) await this.start();
    let outcome = await this.session.resetInventory();
    for (let tries = 1; !outcome.ok && outcome.status === 409 && outcome.code !== 'unsupported-slot-filling' && tries < RESET_TRIES; tries++) {
      await new Promise((resolve) => setTimeout(resolve, this.resetWaitMs));
      // A choreo may have ended meanwhile and handed over: the reset goes to whichever runs now.
      outcome = await this.session.resetInventory();
    }
    if (outcome.ok) await this.restart();
    return outcome;
  }

  /** Between two tries of a reset; a test shortens it. */
  resetWaitMs = RESET_WAIT_MS;

  /** A session is there to call: started and neither ended nor failed. */
  private live(): boolean {
    const state = this.session.state();
    return !!this.session.session()?.sessionToken && state !== 'ended' && state !== 'error';
  }

  /**
   * Follows a session LeanScope started (`?sessionToken=`) and opens its start gate. When it runs
   * one of the guide's choreos, the guide goes on from there.
   */
  async attach(sessionToken: string): Promise<void> {
    this._choreo.set(null);
    this._inventory.set([]);
    if (!(await this.session.attach(sessionToken))) return;
    const choreo = (await this.session.sessionConfig())?.choreoScenarioGuid;
    if (this.session.session()?.sessionToken === sessionToken.trim()) {
      this._choreo.set(choreo && this.choreos.includes(choreo) ? choreo : null);
    }
    await this.session.begin();
  }

  /**
   * Ends following the session and takes the widget away. The session stays remembered: the next
   * `start()` rejoins it.
   */
  stop(): void {
    this._choreo.set(null);
    this._inventory.set([]);
    this.anchor(null);
    this.session.stop();
  }

  /** Files were handed over at a place (`names`), or taken away again (`null`). */
  noteFiles(place: string, names: string[] | null): void {
    this._files.update((files) => {
      const { [place]: _gone, ...rest } = files;
      return names?.length ? { ...rest, [place]: names } : rest;
    });
    const remembered = this.remembered();
    if (remembered) this.remember({ ...remembered, files: this._files() });
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

  /** Runs a choreo: as the session with this scenario when given (rejoin), else as a new one. */
  private async run(choreo: string, sessionScenarioGuid?: string): Promise<void> {
    this._choreo.set(choreo);
    await this.session.start({
      choreoScenarioGuid: choreo,
      ...(sessionScenarioGuid ? { sessionScenarioGuid } : {}),
    });
    const own = this.session.session()?.sessionScenarioGuid;
    // Only while this is still the choreo being run: a hand-over may have come in between.
    if (own && this._choreo() === choreo) {
      this.remember({
        choreoScenarioGuid: choreo,
        sessionScenarioGuid: own,
        carried: this.carried(),
        files: this._files(),
      });
    }
  }

  private get storageKey(): string {
    return `${REMEMBERED_KEY}:${this.config.repositoryId.trim()}`;
  }

  private remembered(): RememberedSession | null {
    try {
      const stored = this.document.defaultView?.localStorage.getItem(this.storageKey);
      const value = stored ? (JSON.parse(stored) as Partial<RememberedSession>) : null;
      return value?.choreoScenarioGuid && value.sessionScenarioGuid
        ? {
            choreoScenarioGuid: value.choreoScenarioGuid,
            sessionScenarioGuid: value.sessionScenarioGuid,
            carried: value.carried && typeof value.carried === 'object' ? value.carried : {},
            files: value.files && typeof value.files === 'object' ? value.files : {},
          }
        : null;
    } catch {
      return null;
    }
  }

  private remember(session: RememberedSession): void {
    try {
      this.document.defaultView?.localStorage.setItem(this.storageKey, JSON.stringify(session));
    } catch {
      // Private mode or blocked storage: the next visit then starts anew.
    }
  }

  private forget(): void {
    try {
      this.document.defaultView?.localStorage.removeItem(this.storageKey);
    } catch {
      // Nothing was remembered.
    }
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
