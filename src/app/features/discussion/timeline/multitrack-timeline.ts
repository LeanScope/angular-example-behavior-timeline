import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DataSet } from 'vis-data/peer';
import {
  Timeline,
  type TimelineGroup,
  type TimelineItem,
  type TimelineOptions,
} from 'vis-timeline/peer';
import { DsButton, DsIcon, iconSvg, inkOn } from '../../../design-system';
import type { PlacedBlock } from '../model/arrangement';
import type { CastRole } from '../model/slots';
import type { RosterEntry } from '../state/discussion.service';
import type { Clip, Study, Stimulus, Transcript } from '../model/study.model';
import { clipAt, clipLabel, MODERATOR_ROLE, MODERATOR_TRACK, trackOf } from '../model/transcript-mapper';
import type { DropZone } from '../state/ingest.service';
import { DETAIL_LEVELS, DiscussionUiState, type DetailLevel } from '../state/discussion-ui.state';
import { castHint, castRows, type CastRow, type TimelineCast } from './cast-rows';
import { clipSpans } from './clip-span';

export type { TimelineCast } from './cast-rows';
import { clockLabel } from './time-format';

/** Track ids that are not participants. */
const GUIDE = 'guide';
const QUESTIONS = 'questions';
const STIMULI = 'stimuli';
const MODERATOR = MODERATOR_TRACK;
/** The head of the participants: picks personas for the cast, holds the screener hint. */
const PARTICIPANTS_HEAD = 'participants-head';

/** A cast action in a track head (handled by one listener on the canvas, see `castAction`). */
type CastAction = 'menu-moderator' | 'menu-participants' | 'remove' | 'submit' | 'toggle';

/** vis-timeline works in dates; this timeline in seconds from the start (date 0). */
const ms = (seconds: number) => new Date(Math.round(seconds * 1000));
const seconds = (date: Date | number | string | undefined) =>
  date === undefined ? 0 : new Date(date).valueOf() / 1000;

/** The window before anything is there to show. */
const EMPTY_LENGTH_SECONDS = 10 * 60;
const MIN_LENGTH_SECONDS = 60;
/** Within this distance of the left/right edge (px) the timeline scrolls along with the mouse. */
const EDGE_PX = 48;
/** Share of the visible window scrolled per frame at the very edge. */
const EDGE_SPEED = 0.012;
/**
 * Below this width (px) the timeline is narrow: the track heads shrink to avatars and icons (names
 * and roles move to tooltips) and the clips fall back to their titles.
 */
const NARROW_PX = 56 * 16;

/**
 * The multitrack timeline (vis-timeline + vis-data, each Apache-2.0 OR MIT; the peer build): the guide's blocks as the
 * arrangement track, the question badges, the stimuli and one track per speaker.
 *
 * Dropping files onto it reads them in: the track under the pointer says what kind of document
 * is expected (header → guide, stimuli track → images/PDFs, speaker tracks → screener), which the
 * worker gets as a hint.
 */
@Component({
  selector: 'app-multitrack-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [DsButton, DsIcon],
  templateUrl: './multitrack-timeline.html',
  // Styles: _multitrack-timeline.scss, loaded globally from src/styles.scss (vis-timeline renders
  // its own DOM, and the theme is larger than a component style budget).
  host: {
    '[attr.data-detail]': 'ui.detailLevel()',
    '[attr.data-drop]': 'dropZone()',
    '[attr.data-pan]': 'panning() ? "" : null',
    '[attr.data-narrow]': 'narrow() ? "" : null',
    '(dragover)': 'dragOver($event)',
    '(dragleave)': 'dragLeave($event)',
    '(drop)': 'drop($event)',
    '(document:click)': 'closeMenu($event)',
    '(document:keydown.escape)': 'menuOpen.set(false); castMenu.set(null)',
    '(document:keydown)': 'keyDown($event)',
    '(document:keyup)': 'keyUp($event)',
    '(window:blur)': 'panning.set(false)',
  },
})
export class MultitrackTimeline {
  readonly study = input.required<Study>();
  readonly transcript = input.required<Transcript>();
  readonly blocks = input.required<PlacedBlock[]>();
  /** Name of the moderator's track. */
  readonly moderatorName = input('Moderation');
  readonly moderatorImage = input<string | null>(null);
  /** The moderator persona's colour, for the role badge's outline. */
  readonly moderatorColor = input<string | null>(null);

  readonly dropped = output<{ zone: DropZone; files: File[] }>();
  readonly stimulusMoved = output<Pick<Stimulus, 'guid' | 'start' | 'end'>>();
  readonly exportVtt = output<void>();
  readonly importVtt = output<void>();
  /** "Aufzeichnung aus LeanScope öffnen…": pick a recording of the connected repository. */
  readonly openRecording = output<void>();
  /** What the red Play button says, e.g. "Diskussion starten". */
  readonly playLabel = input('Diskussion starten');
  /** The Play button is off, e.g. while a discussion runs or the setup is incomplete. */
  readonly playDisabled = input(false);
  /** The red Play button: starts the discussion, or plays it once there is something to hear. */
  readonly play = output<void>();
  /** "Diskussion neu starten" in the ⋮ menu is off, e.g. for a recording or while one runs. */
  readonly restartDisabled = input(false);
  /** "Diskussion neu starten" in the ⋮ menu. */
  readonly restart = output<void>();
  /** The cast the user can pick here, if any. */
  readonly cast = input<TimelineCast | null>(null);
  /** Nothing takes a document any more (a recording, or the data basis is settled): no drop hints. */
  readonly dropsClosed = input(false);
  /** A persona picked: from a track head's ▾ menu, or ticked in its candidate row. */
  readonly castPick = output<{ role: CastRole; guid: string }>();
  /** A participant row's ×, or its candidate row unticked. */
  readonly castRemove = output<string>();
  /** "Übernehmen": the picks answer the asked cast slot. */
  readonly castSubmit = output<CastRole>();

  protected readonly ui = inject(DiscussionUiState);
  protected readonly levels = DETAIL_LEVELS;
  protected readonly dropZone = signal<DropZone | null>(null);
  protected readonly menuOpen = signal(false);
  /** The open ▾ persona menu of a track head, placed under its button (px within the host). */
  protected readonly castMenu = signal<{ role: CastRole; top: number; left: number } | null>(null);
  protected readonly castMenuOptions = computed(() => {
    const menu = this.castMenu();
    return menu ? (this.cast()?.options[menu.role] ?? []) : [];
  });
  /** Space held over the timeline: drag pans (hand cursor), clicks don't move the cursor. */
  protected readonly panning = signal(false);
  /** Too little width for the track heads' names and for full clip texts. */
  protected readonly narrow = signal(false);
  private edgeFrame = 0;
  private edgeDirection = 0;
  private lastPointerX = 0;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly canvas = viewChild.required<ElementRef<HTMLElement>>('canvas');

  private timeline: Timeline | null = null;
  private readonly items = new DataSet<TimelineItem>();
  private readonly groups = new DataSet<TimelineGroup>();
  private fittedLength = 0;

  /** The clip under the red line (the cursor, or the mouse while it is over the tracks). */
  private readonly activeClip = computed(() => clipAt(this.transcript().clips, this.ui.previewTime())?.guid ?? null);
  /** The track of the clip under the red line: its avatar gets the red inner ring. */
  private readonly activeTrack = computed(() => {
    const guid = this.activeClip();
    const clip = this.transcript().clips.find((c) => c.guid === guid);
    return clip ? trackOf(clip) : null;
  });

  /** The timeline's length: the plan or the discussion, whichever is longer. */
  private readonly length = computed(() => {
    const end = Math.max(
      0,
      this.transcript().duration,
      ...this.blocks().map((b) => b.end),
      ...this.study().stimuli.map((s) => s.end),
    );
    return end === 0 ? EMPTY_LENGTH_SECONDS : Math.max(MIN_LENGTH_SECONDS, end);
  });

  constructor() {
    // Also measures again on every size change: created while the view is still being laid out
    // (e.g. after switching from "Studie"), vis-timeline would otherwise keep a height of 0.
    const resize = new ResizeObserver(([entry]) => {
      this.narrow.set(entry.contentRect.width < NARROW_PX);
      this.timeline?.redraw();
    });
    afterNextRender(() => {
      resize.observe(this.host.nativeElement);
      this.create();
    });
    inject(DestroyRef).onDestroy(() => {
      resize.disconnect();
      cancelAnimationFrame(this.edgeFrame);
      this.timeline?.destroy();
    });

    // Narrow: the clips jump to their titles; back to the level before once there is room again,
    // unless the user picked another level meanwhile.
    let levelBefore: DetailLevel | null = null;
    effect(() => {
      const narrow = this.narrow();
      untracked(() => {
        if (narrow && this.ui.detailLevel() !== 0) {
          levelBefore = this.ui.detailLevel();
          this.ui.detailLevel.set(0);
        } else if (!narrow && levelBefore !== null) {
          if (this.ui.detailLevel() === 0) this.ui.detailLevel.set(levelBefore);
          levelBefore = null;
        }
      });
    });

    effect(() => sync(this.groups, this.buildGroups()));
    effect(() => sync(this.items, this.buildItems()));
    // The speaker's avatar under the red line: toggled on the label element, so the groups (and
    // their portraits) are not rebuilt on every turn. A rebuild sets it from the start.
    effect(() => {
      const track = this.activeTrack();
      for (const head of this.host.nativeElement.querySelectorAll<HTMLElement>('.speaker-head[data-track]')) {
        head.classList.toggle('speaking', head.dataset['track'] === track);
      }
    });
    // The bubble under the red line turns red. Only the two clips that change are updated: this
    // runs on every mouse move across a turn boundary.
    let shown: string | null = null;
    effect(() => {
      const active = this.activeClip();
      const changed = [shown, active].filter((g, i, all): g is string => !!g && all.indexOf(g) === i);
      shown = active;
      untracked(() => {
        const clips = this.transcript().clips;
        const updates = changed
          .map((guid) => clips.find((c) => c.guid === guid))
          .filter((c): c is Clip => !!c && this.items.get(`clip:${c.guid}`) !== null)
          .map((c) => ({ id: `clip:${c.guid}`, className: this.clipClass(c, active) }));
        if (updates.length) this.items.update(updates as never);
      });
    });
    // Fits again when the discussion outgrows the window, or when the content arrives after the
    // timeline was fitted to the empty placeholder (e.g. a recording loaded from a file).
    effect(() => {
      const length = this.length();
      if (!this.timeline) return;
      const placeholder = this.fittedLength === EMPTY_LENGTH_SECONDS && length !== EMPTY_LENGTH_SECONDS;
      if (placeholder || length > this.fittedLength * 1.2) this.fit();
    });
    effect(() => {
      this.ui.detailLevel();
      this.narrow();
      // Track heights come from CSS; let vis-timeline measure them again.
      queueMicrotask(() => this.timeline?.redraw());
    });
    // The red line follows the mouse while it is over the timeline, then returns to the cursor.
    effect(() => {
      const time = this.ui.previewTime();
      this.timeline?.setCustomTime(ms(time), 'cursor');
    });
    // A hover time while the mouse is elsewhere comes from scrubbing the sidebar's chain: scroll it
    // into view (with some air to the edges), keeping the zoom.
    effect(() => {
      const time = this.ui.hoverTime();
      const timeline = this.timeline;
      if (time === null || !timeline || this.canvas().nativeElement.matches(':hover')) return;
      const { start, end } = timeline.getWindow();
      const margin = (end.valueOf() - start.valueOf()) * 0.1;
      const at = ms(time).valueOf();
      if (at < start.valueOf() + margin || at > end.valueOf() - margin) {
        timeline.moveTo(ms(time), { animation: { duration: 300, easingFunction: 'easeInOutQuad' } });
      }
    });
  }

  protected zoom(direction: 1 | -1): void {
    if (direction > 0) this.timeline?.zoomIn(0.5);
    else this.timeline?.zoomOut(0.5);
  }

  protected fit(): void {
    this.fittedLength = this.length();
    this.timeline?.setWindow(ms(0), ms(this.fittedLength * 1.02), { animation: false });
  }

  protected keyDown(event: KeyboardEvent): void {
    const over = this.canvas().nativeElement.matches(':hover');
    if (event.code !== 'Space' || !over || isTyping(event.target)) return;
    event.preventDefault(); // no page scroll
    this.panning.set(true);
  }

  protected keyUp(event: KeyboardEvent): void {
    if (event.code !== 'Space' || !this.panning()) return;
    event.preventDefault(); // a focused button must not fire on release
    this.panning.set(false);
  }

  protected closeMenu(event: Event): void {
    const target = event.target as Element | null;
    if (this.castMenu() && !target?.closest?.('.cast-menu, [data-cast-action]')) this.castMenu.set(null);
    if (!this.menuOpen()) return;
    const anchor = this.host.nativeElement.querySelector('.menu-anchor');
    if (!anchor?.contains(event.target as Node)) this.menuOpen.set(false);
  }

  protected pickFromMenu(guid: string): void {
    const menu = this.castMenu();
    if (!menu) return;
    this.castPick.emit({ role: menu.role, guid });
    // The moderator is one persona; participants are picked one after another.
    if (menu.role === 'moderator' || this.castMenuOptions().length <= 1) this.castMenu.set(null);
  }

  /** A click on a cast button in a track head (the heads are vis-timeline DOM, not a template). */
  private castAction(event: MouseEvent): void {
    const button = (event.target as Element | null)?.closest?.<HTMLElement>('[data-cast-action]');
    if (!button) return;
    event.stopPropagation();
    event.preventDefault();
    const action = button.dataset['castAction'] as CastAction;
    if (action === 'remove') {
      this.castRemove.emit(button.dataset['guid'] ?? '');
    } else if (action === 'submit') {
      const asked = this.cast()?.asked;
      if (asked) this.castSubmit.emit(asked);
    } else if (action === 'toggle') {
      const guid = button.dataset['guid'] ?? '';
      const role = button.dataset['role'] as CastRole;
      // The moderator is one persona: ticking another replaces it. A participant ticks on and off.
      if (role === 'participants' && button.dataset['picked'] === 'true') this.castRemove.emit(guid);
      else this.castPick.emit({ role, guid });
    } else {
      const role: CastRole = action === 'menu-moderator' ? 'moderator' : 'participants';
      if (this.castMenu()?.role === role) return this.castMenu.set(null);
      const host = this.host.nativeElement.getBoundingClientRect();
      const rect = button.getBoundingClientRect();
      this.castMenu.set({ role, top: rect.bottom - host.top + 4, left: rect.left - host.left });
    }
  }

  protected setDetail(level: number): void {
    this.ui.detailLevel.set(level as DetailLevel);
  }

  // --- Drop target ---------------------------------------------------------------------------

  protected dragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    this.dropZone.set(this.zoneAt(event));
  }

  protected dragLeave(event: DragEvent): void {
    const host = event.currentTarget as HTMLElement;
    if (!host.contains(event.relatedTarget as Node | null)) this.dropZone.set(null);
  }

  protected drop(event: DragEvent): void {
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    const zone = this.zoneAt(event);
    this.dropZone.set(null);
    this.dropped.emit({ zone, files });
  }

  /** What the track under the pointer expects. Above the tracks (the axis) is the header. */
  private zoneAt(event: Event): DropZone {
    const group = this.timeline?.getEventProperties(event).group as string | null | undefined;
    if (group === STIMULI) return 'stimulus';
    if (!group || group === GUIDE || group === QUESTIONS) {
      return group || this.isAboveTracks(event) ? 'interview-guide' : 'screener';
    }
    return 'screener';
  }

  private isAboveTracks(event: Event): boolean {
    const what = this.timeline?.getEventProperties(event).what;
    return what === 'axis';
  }

  // --- vis-timeline ----------------------------------------------------------------------------

  private create(): void {
    const options: TimelineOptions = {
      start: ms(0),
      end: ms(this.length()),
      // Fills the canvas; the rows scroll inside it under the fixed axis and track heads.
      height: '100%',
      // Set explicitly: without `rtl`, vis-timeline hides its root until a redraw after its first
      // range change (reported 200 ms late). With nothing redrawing then, the timeline stayed
      // blank until the window was resized.
      rtl: false,
      min: ms(-30),
      max: ms(this.length() * 3),
      zoomMin: 15_000,
      zoomMax: 6 * 3600_000,
      orientation: { axis: 'top', item: 'top' },
      stack: false,
      align: 'left',
      showCurrentTime: false,
      showMajorLabels: false,
      groupOrder: 'order',
      verticalScroll: true,
      zoomKey: 'ctrlKey',
      horizontalScroll: true,
      // The wheel scrolls the rows; with Shift (or sideways on a trackpad) it moves in time.
      horizontalScrollKey: 'shiftKey',
      margin: { item: { horizontal: 0, vertical: 4 }, axis: 4 },
      format: { minorLabels: (date: Date) => clockLabel(seconds(date)) },
      editable: false,
      selectable: true,
      // 'cap' keeps the tooltip inside the timeline; the CSS wraps long texts so it can.
      tooltip: { followMouse: true, delay: 300, overflowMethod: 'cap' },
      onMove: (item, callback) => {
        const guid = String(item.id).slice('stimulus:'.length);
        const start = Math.max(0, seconds(item.start));
        const end = Math.max(start + 5, seconds(item.end));
        this.stimulusMoved.emit({ guid, start, end });
        callback({ ...item, start: ms(start), end: ms(end) });
      },
    };
    // vis-timeline types its DataSet parameters with its own `DataItem`; a `DataSet<TimelineItem>`
    // is the same object at runtime, the typings just don't line up.
    const timeline = new Timeline(
      this.canvas().nativeElement,
      this.items as never,
      this.groups as never,
      options,
    );
    timeline.addCustomTime(ms(this.ui.cursorTime()), 'cursor');
    timeline.setCustomTimeTitle('Cursor', 'cursor');

    timeline.on('timechange', (props: { id: string; time: Date }) => {
      if (props.id === 'cursor') this.ui.cursorTime.set(Math.max(0, seconds(props.time)));
    });
    timeline.on('mouseMove', (props: { time?: Date; what?: string | null }) => {
      // Over the track heads the line stays on the cursor, so a click there shows where it jumped.
      const overTracks = props.time && props.what && props.what !== 'group-label';
      this.ui.hoverTime.set(overTracks ? Math.max(0, seconds(props.time!)) : null);
    });
    timeline.on('click', (props: { what?: string; group?: string; item?: string; time?: Date; event?: Event }) => {
      if ((props.event?.target as Element | null)?.closest?.('[data-cast-action]')) return;
      if (props.what === 'group-label' && props.group) this.selectTrack(String(props.group));
      else if ((props.what === 'axis' || props.what === 'background') && props.time && !this.panning()) {
        this.ui.cursorTime.set(Math.max(0, seconds(props.time)));
      }
    });
    timeline.on('select', (props: { items: string[] }) => this.selectItem(props.items[0]));
    // vis-timeline has no sticky rows: after every redraw the guide, question and stimuli tracks
    // are shifted down by the scroll offset (--pin, see the SCSS), so they stay at the top while
    // the speaker tracks scroll beneath them.
    const host = this.host.nativeElement;
    timeline.on('changed', () => {
      const scrolled = -(timeline as unknown as { _getScrollTop(): number })._getScrollTop();
      host.style.setProperty('--pin', `${Math.max(0, scrolled)}px`);
      // The zoom strip sits in the corner above the track heads, as high as the time axis.
      const axis = host.querySelector<HTMLElement>('.vis-panel.vis-top');
      if (axis) host.style.setProperty('--axis-height', `${axis.offsetHeight}px`);
      keepPinnedVisible(timeline);
    });
    const canvas = this.canvas().nativeElement;
    // Capture: the cast buttons answer before vis-timeline sees the click.
    canvas.addEventListener('click', (event) => this.castAction(event), true);
    // A candidate row is a tick box without being a button: Enter and Space tick it too.
    canvas.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = (event.target as Element | null)?.closest?.<HTMLElement>('[data-cast-action="toggle"]');
      if (!row) return;
      event.preventDefault();
      event.stopPropagation();
      row.click();
    }, true);
    canvas.addEventListener('mouseleave', () => {
      this.stopEdgeScroll();
      this.ui.hoverTime.set(null);
    });
    canvas.addEventListener('mousemove', (event) => this.edgeScroll(event));
    canvas.addEventListener('mousedown', () => this.stopEdgeScroll());

    this.timeline = timeline;
    this.fit();
  }

  // --- Scrolling along at the edges -------------------------------------------------------------

  /** Near the left/right edge of the tracks, the timeline scrolls with the mouse. */
  private edgeScroll(event: MouseEvent): void {
    const center = this.centerPanel();
    if (!center || event.buttons) return this.stopEdgeScroll();
    const rect = center.getBoundingClientRect();
    const x = event.clientX - rect.left;
    this.lastPointerX = event.clientX;
    const inRows = event.clientY >= rect.top && event.clientY <= rect.bottom;
    const direction = !inRows || x < 0 || x > rect.width ? 0 : x < EDGE_PX ? -1 : x > rect.width - EDGE_PX ? 1 : 0;
    // Speed grows towards the edge.
    this.edgeDirection = direction * (direction < 0 ? 1 - x / EDGE_PX : 1 - (rect.width - x) / EDGE_PX);
    if (direction === 0) return this.stopEdgeScroll();
    if (!this.edgeFrame) this.edgeFrame = requestAnimationFrame(() => this.edgeStep());
  }

  private edgeStep(): void {
    this.edgeFrame = 0;
    const timeline = this.timeline;
    const center = this.centerPanel();
    if (!timeline || !center || this.edgeDirection === 0) return;
    const { start, end } = timeline.getWindow();
    const from = start.valueOf();
    const range = end.valueOf() - from;
    // Edge scrolling stays within the discussion (a little air on both sides); dragging can go further.
    const lowest = Math.min(from, -0.02 * this.length() * 1000);
    const highest = Math.max(from, this.length() * 1.02 * 1000 - range);
    const step = range * EDGE_SPEED * Math.max(0.2, Math.min(1, Math.abs(this.edgeDirection))) * Math.sign(this.edgeDirection);
    const next = Math.min(highest, Math.max(lowest, from + step));
    if (next === from) return;
    timeline.setWindow(new Date(next), new Date(next + range), { animation: false });
    // The red line stays under the mouse while the content moves.
    const rect = center.getBoundingClientRect();
    const after = timeline.getWindow();
    const time = after.start.valueOf() + ((this.lastPointerX - rect.left) / rect.width) * (after.end.valueOf() - after.start.valueOf());
    this.ui.hoverTime.set(Math.max(0, time / 1000));
    if (after.start.valueOf() !== from) this.edgeFrame = requestAnimationFrame(() => this.edgeStep());
  }

  private stopEdgeScroll(): void {
    this.edgeDirection = 0;
    cancelAnimationFrame(this.edgeFrame);
    this.edgeFrame = 0;
  }

  private centerPanel(): HTMLElement | null {
    return this.canvas().nativeElement.querySelector('.vis-panel.vis-center');
  }

  private selectTrack(group: string): void {
    // A candidate row is ticked, not selected: its click belongs to `castAction`.
    if (castRows(this.cast()).some((row) => row.id === group)) return;
    if (group !== GUIDE && group !== QUESTIONS && group !== STIMULI && group !== PARTICIPANTS_HEAD) {
      this.ui.togglePersona(group, this.transcript().clips);
    }
  }

  private selectItem(id: string | undefined): void {
    if (!id) return;
    const [kind, ref] = splitId(id);
    if (kind === 'badge') {
      this.ui.revealQuestion(ref);
    } else if (kind === 'clip') {
      const clip = this.transcript().clips.find((c) => c.guid === ref);
      if (clip) {
        this.ui.cursorTime.set(clip.start);
        this.ui.selectPersona(trackOf(clip));
        if (clip.questionKey) this.ui.openQuestionKey.set(clip.questionKey);
      }
    }
  }

  // --- Model → DataSets ------------------------------------------------------------------------

  private buildGroups(): TimelineGroup[] {
    const participants = this.study().screener?.participants ?? [];
    const selected = this.ui.selectedParticipant();
    const active = untracked(this.activeTrack);
    const cast = this.cast();
    const asked = this.ui.askedPlace();
    const moderatorHead = speakerHead(MODERATOR, this.moderatorName(), 'MO', true, true, this.moderatorImage(), MODERATOR_ROLE, active, this.moderatorColor() ?? undefined);
    const participantsHead = label('Teilnehmende', 'users');
    // Before the session asks, a ▾ menu picks ahead. While it asks, everyone offered is listed
    // as a row to tick, and "Übernehmen" in the head answers.
    if (cast?.editable.moderator && cast.asked !== 'moderator') {
      moderatorHead.append(castButton('menu-moderator', 'Moderation wählen', 'chevron-down'));
    }
    if (cast?.editable.participants && cast.asked !== 'participants') {
      participantsHead.append(castButton('menu-participants', 'Teilnehmende hinzufügen', 'chevron-down'));
    }
    if (cast?.asked) {
      const submit = castButton('submit', 'Übernehmen', 'check', 'Übernehmen');
      submit.toggleAttribute('disabled', !cast.ready);
      (cast.asked === 'moderator' ? moderatorHead : participantsHead).append(submit);
    }
    const groups: TimelineGroup[] = [
      { id: GUIDE, order: 0, content: label('Leitfaden', 'book'), className: 'track-guide' },
      { id: QUESTIONS, order: 1, content: label('Fragen', 'list'), className: 'track-questions' },
      { id: STIMULI, order: 2, content: label('Stimuli', 'layers'), className: 'track-stimuli' },
      {
        id: MODERATOR,
        order: 3,
        content: moderatorHead,
        className:
          'track-speaker track-moderator' +
          (selected === MODERATOR ? ' selected' : '') +
          (asked === 'moderator' ? ' asked' : ''),
      },
      {
        id: PARTICIPANTS_HEAD,
        order: 9,
        content: participantsHead,
        className: 'track-hint track-participants' + (asked === 'participants' ? ' asked' : ''),
      },
    ];
    const candidates = castRows(cast);
    candidates.forEach((row, i) => {
      groups.push({
        id: row.id,
        // Moderator candidates sit right under the moderator, participants under their head.
        order: row.role === 'moderator' ? 3 + (i + 1) / 1000 : 10 + i,
        content: candidateHead(row, active),
        className: 'track-speaker track-candidate' + (row.picked ? ' picked' : ''),
      });
    });
    // While the participants are asked for, their candidate rows stand in for the tracks.
    if (cast?.asked === 'participants') return groups;
    participants.forEach((p, i) => {
      const head = speakerHead(p.guid, p.name, p.initials, p.filled, false, p.imageUrl, p.role, active, p.color);
      if (cast?.editable.participants) head.append(castButton('remove', `${p.name} entfernen`, 'close', '', p.guid));
      groups.push({
        id: p.guid,
        order: 10 + i,
        content: head,
        className:
          'track-speaker' + (p.filled ? '' : ' track-stub') + (p.guid === selected ? ' selected' : ''),
      });
    });
    return groups;
  }

  private buildItems(): TimelineItem[] {
    const study = this.study();
    const transcript = this.transcript();
    const openQuestion = this.ui.openQuestionKey();
    const selected = this.ui.selectedParticipant();
    const questions = new Map(
      (study.guide?.blocks ?? []).flatMap((b) => b.questions.map((q) => [q.key, q])),
    );
    const length = this.length();
    const items: TimelineItem[] = [];

    for (const block of this.blocks()) {
      items.push({
        id: `block:${block.code}`,
        group: GUIDE,
        type: 'range',
        start: ms(block.start),
        end: ms(block.end),
        content: blockLabel(block),
        title: `${block.code} ${block.title} · ${block.minutes} min${block.planned ? ' (geplant)' : ''}`,
        className: `block tone-${block.tone}` + (block.planned ? ' planned' : '') + (block.done ? ' done' : ''),
        selectable: false,
        // 'auto': once the block starts left of the view, its label sticks to the left edge.
        align: 'auto',
      });
    }
    const open = !this.dropsClosed();
    if (open && !study.guide) items.push(hint(GUIDE, length, 'Leitfaden (.docx, .md) oder Aufzeichnung (.vtt) hier ablegen'));

    transcript.badges.forEach((badge, i) => {
      const question = questions.get(badge.questionKey);
      items.push({
        id: `badge:${badge.questionKey}:${i}`,
        group: QUESTIONS,
        // A range up to the next question, so that 'auto' keeps the pill at the left edge while
        // the question runs, like a guide block's label. Only the pill is drawn.
        type: 'range',
        start: ms(badge.start),
        end: ms(Math.max(transcript.badges[i + 1]?.start ?? length, badge.start + 1)),
        align: 'auto',
        editable: false,
        content: text('span', question?.code ?? '?', 'pill'),
        title: question?.text ?? badge.questionKey,
        className:
          `badge tone-${question?.tone ?? 0}` +
          (badge.questionKey === openQuestion ? ' active' : '') +
          (transcript.done.has(badge.questionKey) ? ' done' : ''),
      });
    });

    for (const stimulus of study.stimuli) {
      items.push({
        id: `stimulus:${stimulus.guid}`,
        group: STIMULI,
        type: 'range',
        start: ms(stimulus.start),
        end: ms(stimulus.end),
        content: stimulusContent(stimulus),
        title: stimulus.name,
        className: 'stimulus',
        // 'auto': thumbnail and name stick to the left edge while the stimulus runs, also zoomed in.
        align: 'auto',
        editable: { updateTime: true, updateGroup: false, remove: false },
      });
    }
    if (open && study.stimuli.length === 0) items.push(hint(STIMULI, length, 'Bilder oder PDFs hierher ziehen'));
    // The asked cast row says the session's question; else the participants' row takes a screener.
    const cast = this.cast();
    const question = castHint(cast);
    if (question && cast?.asked) {
      items.push(hint(cast.asked === 'moderator' ? MODERATOR : PARTICIPANTS_HEAD, length, question));
    } else if (open && !study.screener?.participants.length) {
      items.push(hint(PARTICIPANTS_HEAD, length, 'Screener (.xlsx, .docx) hier ablegen'));
    }

    const active = untracked(this.activeClip);
    const spans = clipSpans(transcript.clips, length);
    for (const clip of transcript.clips) {
      // The item runs to the speaker's next turn so the text can use the room; only the spoken
      // part (--solid) is filled.
      const spanEnd = spans.get(clip.guid) ?? clip.end;
      const solid = spanEnd > clip.start ? ((clip.end - clip.start) / (spanEnd - clip.start)) * 100 : 100;
      items.push({
        id: `clip:${clip.guid}`,
        group: trackOf(clip),
        type: 'range',
        start: ms(clip.start),
        end: ms(spanEnd),
        style: `--solid: ${solid.toFixed(2)}%`,
        content: clipContent(clipLabel(clip), clip.text),
        title: `${clip.speakerName}: ${clip.text}`,
        className: this.clipClass(clip, active, selected, openQuestion),
      });
    }
    return items;
  }

  private clipClass(
    clip: Clip,
    active: string | null,
    selected = untracked(this.ui.selectedParticipant),
    openQuestion = untracked(this.ui.openQuestionKey),
  ): string {
    return (
      'clip' +
      (clip.moderator ? ' moderator' : '') +
      (trackOf(clip) === selected ? ' selected' : '') +
      (clip.questionKey && clip.questionKey === openQuestion ? ' in-question' : '') +
      (clip.guid === active ? ' active' : '')
    );
  }
}

/** The tracks that stay at the top while the speaker tracks scroll (see `--pin`). */
const PINNED = [GUIDE, QUESTIONS, STIMULI];

/** vis-timeline internals: a track decides by its scroll position whether to draw its items. */
interface VisGroup {
  _isGroupVisible(...args: unknown[]): boolean;
  pinned?: true;
}

/**
 * vis-timeline stops drawing the items of a track once it has scrolled out of view. The pinned
 * tracks never are (CSS moves them back), so they always count as visible. vis keeps a track's
 * object as long as its id stays, so this runs once per track (checked after every redraw).
 */
function keepPinnedVisible(timeline: Timeline): void {
  const groups = (timeline as unknown as { itemSet?: { groups?: Record<string, VisGroup> } }).itemSet?.groups;
  for (const id of PINNED) {
    const group = groups?.[id];
    if (group && !group.pinned) {
      group.pinned = true;
      group._isGroupVisible = () => true;
    }
  }
}

/** Replaces a DataSet's content with `next`, updating in place what stays. */
function sync<T extends { id: string | number }>(set: DataSet<T>, next: T[]): void {
  const keep = new Set<string | number>(next.map((n) => n.id));
  const gone = set.getIds().filter((id: string | number) => !keep.has(id));
  if (gone.length) set.remove(gone);
  set.update(next as never);
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

function splitId(id: string): [string, string] {
  const [kind, ...rest] = id.split(':');
  return [kind, rest[0] ?? ''];
}

function text(tag: string, value: string, className = ''): HTMLElement {
  const el = document.createElement(tag);
  el.textContent = value;
  if (className) el.className = className;
  return el;
}

function label(name: string, icon: string): HTMLElement {
  // The icon stands in for the name when the timeline is narrow.
  const el = document.createElement('span');
  el.className = 'track-label';
  el.title = name;
  const glyph = iconSvg(icon);
  glyph.classList.add('track-icon');
  el.append(glyph, text('span', name, 'track-name'));
  return el;
}

/** A small button in a track head (▾ menu, ×, Übernehmen), handled by `castAction`. */
function castButton(action: CastAction, title: string, icon: string, caption = '', guid = ''): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `cast-action cast-${action}`;
  button.dataset['castAction'] = action;
  if (guid) button.dataset['guid'] = guid;
  button.title = title;
  button.setAttribute('aria-label', title);
  if (action.startsWith('menu-')) button.setAttribute('aria-haspopup', 'menu');
  button.append(iconSvg(icon));
  if (caption) button.append(text('span', caption));
  return button;
}

/** A candidate's row: the whole head ticks it on or off (handled by `castAction`). */
function candidateHead(row: CastRow, activeTrack: string | null | undefined): HTMLElement {
  const head = speakerHead(row.id, row.name, row.initials, true, false, row.imageUrl, undefined, activeTrack);
  head.classList.add('candidate');
  head.dataset['castAction'] = 'toggle';
  head.dataset['guid'] = row.guid;
  head.dataset['role'] = row.role;
  head.dataset['picked'] = String(row.picked);
  head.setAttribute('role', row.role === 'moderator' ? 'radio' : 'checkbox');
  head.setAttribute('aria-checked', String(row.picked));
  head.tabIndex = 0;
  head.title = row.picked ? `${row.name} – gewählt` : `${row.name} wählen`;
  const mark = document.createElement('span');
  mark.className = 'candidate-mark';
  if (row.picked) mark.append(iconSvg('check'));
  head.append(mark);
  return head;
}

function speakerHead(
  track: string,
  name: string,
  initials: string,
  filled: boolean,
  moderator: boolean,
  imageUrl?: string | null,
  role?: string,
  activeTrack?: string | null,
  color?: string,
): HTMLElement {
  const el = document.createElement('span');
  el.className =
    'speaker-head' + (moderator ? ' moderator' : '') + (filled ? '' : ' stub') + (track === activeTrack ? ' speaking' : '');
  el.dataset['track'] = track;
  // The persona's colour for the selection ring around the avatar.
  if (color) el.style.setProperty('--persona-color', color);
  // Narrow timelines show only the avatar: name and role are in the tooltip.
  el.title = role ? `${name} · ${role}` : name;
  const avatar = text('span', imageUrl ? '' : initials, 'avatar');
  if (imageUrl) {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = '';
    img.loading = 'lazy';
    // A failed image (e.g. a catalog match URL the server can't answer yet) shows the initials.
    img.addEventListener('error', () => {
      img.remove();
      avatar.textContent = initials;
    });
    avatar.append(img);
  }
  el.append(avatar, text('span', filled ? name : `${name} …`, 'speaker-name'));
  if (role) {
    const badge = text('span', role, 'role-badge');
    badge.title = role;
    // The persona's colour outlines its badge (and fills it on hover); without one the default stays.
    if (color) {
      badge.style.setProperty('--role-color', color);
      badge.style.setProperty('--role-ink', inkOn(color));
    }
    el.append(badge);
  }
  return el;
}

/**
 * A clip's title, its text and its hit area. The detail level decides which of title and text
 * shows. The item runs on to the speaker's next turn, but only the spoken part (the bubble) takes
 * the pointer: the overflowing text lets it through.
 */
function clipContent(title: string, value: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'clip-content';
  el.append(text('span', '', 'clip-hit'), clipTitle(title), text('span', value, 'clip-text'));
  return el;
}

/** A title's leading emoji (with variation selectors and joined sequences such as 👩‍💻). */
const LEADING_EMOJI = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*️?)\s*/u;

/**
 * The title, with its leading emoji in a span of its own: the clip's text is painted through
 * `background-clip: text`, which would flatten a colour emoji to a one-colour silhouette.
 */
function clipTitle(title: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'clip-title';
  const emoji = LEADING_EMOJI.exec(title);
  if (emoji) el.append(text('span', emoji[1], 'clip-emoji'));
  el.append(emoji ? title.slice(emoji[0].length) : title);
  return el;
}

/** Like the sidebar's block headings: the letter in a pearl (green when done), title, minutes. */
function blockLabel(block: PlacedBlock): HTMLElement {
  const el = document.createElement('span');
  el.className = 'block-label';
  const pearl = text('span', block.code, block.done ? 'pearl done' : 'pearl');
  if (block.done) pearl.setAttribute('aria-label', `${block.code}, erledigt`);
  el.append(
    pearl,
    text('span', block.title, 'block-title'),
    text('span', `${block.minutes} min`, 'block-minutes'),
  );
  return el;
}

function stimulusContent(stimulus: Stimulus): HTMLElement {
  const el = document.createElement('span');
  el.className = 'stimulus-content';
  if (stimulus.mimeType.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = stimulus.url;
    img.alt = '';
    img.loading = 'lazy';
    el.append(img);
  } else {
    el.append(text('span', 'PDF', 'stimulus-kind'));
  }
  el.append(text('span', stimulus.name, 'stimulus-name'));
  return el;
}

function hint(group: string, length: number, message: string): TimelineItem {
  return {
    id: `hint:${group}`,
    group,
    type: 'background',
    start: ms(0),
    end: ms(length),
    content: text('span', message, 'drop-hint'),
    className: 'hint',
  };
}
