import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { DsButton, DsIcon, DsStatus, type DsStatusState } from '../../design-system';
import { LEANSCOPE_CONFIG, missingConfig } from '../../leanscope/leanscope.config';
import { RepositoryResourcesService } from '../../leanscope/repository-resources.service';
import { SupportWidget } from '../../leanscope/ui/support-widget';
import { GuideService } from '../guide/guide.service';
import { APP_ENV, missingAppEnv } from '../app-env';
import { AnalysisService, MAX_QUESTION } from '../analysis/state/analysis.service';
import { AnalysisView } from '../analysis/ui/analysis-view';
import { ShellContext, type ShellStatus } from '../shell/shell-context';
import { arrangeBlocks } from './model/arrangement';
import { EMPTY_STUDY, type GuideQuestion, type Stimulus, type Study } from './model/study.model';
import { toSelfContainedVtt } from './model/vtt-export';
import { fromWebVtt, vttCast, type ImportedDiscussion } from './model/vtt-import';
import { MODERATORS_BY_GUID, toModeratorRefs } from './model/actor-traits';
import { loadRepositoryStimuli } from './model/repository-stimuli';
import {
  DATA_BASIS,
  DATA_BASIS_FILES,
  basisFileRefs,
  toDataBasis,
  withFileNames,
  type DataBasis,
  type DataBasisFilesResult,
  type DataBasisResult,
} from './model/data-basis';
import { GUIDE_BY_GUID, guideFromSources, toRepositoryGuide } from './model/repository-guide';
import { matchQuestions } from './model/question-match';
import { RECORDINGS, loadRecording, toRecordings, topicQuestions, type RecordingEntry } from './model/repository-recording';
import { RecordingPicker } from './ui/recording-picker';
import {
  PERSONAS_BY_GUID,
  repositoryColorOf,
  repositoryImageOf,
  toRepositoryPersonas,
  withRepositoryPersonas,
} from './model/repository-personas';
import { DiscussionQuestion } from './discussion-question';
import { PersonaDetail } from './detail/persona-detail';
import { PlayerService } from './player/player.service';
import { PlayerStrip } from './player/player-strip';
import { SpeechQueue } from './player/speech-queue';
import { PanelroomPreview } from './preview/panelroom-preview';
import { QuestionSidebar } from './sidebar/question-sidebar';
import { DiscussionUiState, type DiscussionView } from './state/discussion-ui.state';
import { DiscussionService } from './state/discussion.service';
import { IngestService, ZONE_LABEL, type DropZone, type IngestJob } from './state/ingest.service';
import { SlotService } from './state/slot.service';
import { StudyStore } from './state/study.store';
import { StudyView } from './study/study-view';
import { MultitrackTimeline, type TimelineCast } from './timeline/multitrack-timeline';
import type { CastRole } from './model/slots';
import { DEMO_FILES, demoNameOf } from './demo';

/**
 * The Panelroom preview at zoom 1, roughly: its width, its height without the speech bubble, and
 * the height of one bubble line. Player mode scales it up to the width and gives the height left
 * to the bubble, so long turns need no scrolling.
 */
const PREVIEW_WIDTH_REM = 48;
const PREVIEW_FRAME_REM = 9.75;
const BUBBLE_LINE_REM = 1.5;
/** The bubble's lines outside player mode, and the fewest and most in it. */
const BUBBLE_LINES = 3;
const PLAYER_BUBBLE_LINES = { min: 5, max: 14 };

/** The element of the place the session asks for: a drop zone's target or a timeline track head. */
const ASKED_PLACE = 'app-drop-zone.asked .target, app-multitrack-timeline .vis-label.asked';

const NO_FILES: File[] = [];
/** The id of a status line that only recalls a file handed over before a reload. */
const REMEMBERED_JOB = -1;

const STATUS_LABEL: Record<DsStatusState, string> = {
  demo: 'Demo',
  thinking: 'Arbeitet …',
  ready: 'Bereit',
  error: 'Fehler',
  idle: 'Keine Unterlagen',
};

/**
 * The MVP's one screen: the study's documents ("Studie") and the simulated group discussion
 * ("Diskussion") as a multitrack timeline with the guide in the sidebar.
 *
 * `?demo` (or `?demo=wahlplakate`) shows a recorded discussion from a self-contained WebVTT in
 * `public/demo/`, so the screen can be tried before the ingest choreo and the study query exist in
 * the repository. "Transkript importieren" shows any such file the same way.
 */
@Component({
  selector: 'app-discussion-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AnalysisView,
    DsButton,
    DsIcon,
    DsStatus,
    DiscussionQuestion,
    MultitrackTimeline,
    PanelroomPreview,
    PersonaDetail,
    PlayerStrip,
    QuestionSidebar,
    RecordingPicker,
    StudyView,
  ],
  providers: [
    StudyStore,
    IngestService,
    DiscussionService,
    DiscussionUiState,
    SlotService,
    SpeechQueue,
    PlayerService,
    AnalysisService,
  ],
  host: {
    '[class.player-mode]': 'player.open()',
    '[attr.data-theme]': "player.open() ? 'dark' : null",
    '(document:keydown.escape)': 'closePlayer()',
  },
  templateUrl: './discussion-page.html',
  styleUrl: './discussion-page.scss',
})
export class DiscussionPage implements OnInit {
  /** `?view=study|discussion|analysis`; without it the app opens in the study view. */
  readonly view = input<DiscussionView | undefined>();
  /** `?demo` or `?demo=<name>` (see DEMO_FILES) */
  readonly demo = input<string | undefined>();
  /**
   * `?sessionToken=<token>`: LeanScope (agent server plugin `run-choreo`, with the theme's
   * `uiBaseUrl` pointing here) already created the discussion session; follow that one.
   */
  readonly sessionToken = input<string | undefined>();
  /**
   * `?recording=<scenario guid>`: a recorded discussion of the connected repository (a
   * `Conversation` scenario), read from its steps. No `.vtt` is involved.
   */
  readonly recordingRef = input<string | undefined>(undefined, { alias: 'recording' });
  /** `?theme=` and `?themeMode=` from LeanScope: the chat widget is shown in the same theme. */
  readonly theme = input<string | undefined>();
  readonly themeMode = input<string | undefined>();

  private readonly router = inject(Router);
  private readonly config = inject(LEANSCOPE_CONFIG);
  private readonly env = inject(APP_ENV);
  protected readonly store = inject(StudyStore);
  protected readonly ingest = inject(IngestService);
  protected readonly discussion = inject(DiscussionService);
  protected readonly ui = inject(DiscussionUiState);
  protected readonly slots = inject(SlotService);
  protected readonly player = inject(PlayerService);
  private readonly injector = inject(Injector);
  private readonly previewFold = viewChild<ElementRef<HTMLElement>>('previewFold');
  private readonly widget = inject(SupportWidget);
  protected readonly guide = inject(GuideService);
  protected readonly resources = inject(RepositoryResourcesService);
  /** Blob URLs of the shown recording's repository files, revoked when another one loads. */
  private fileUrls: string[] = [];
  /** Bumped per recording, so a slow repository answer never lands on the next one. */
  private recording = 0;
  /** The recording's guide is being read from its repository. */
  protected readonly guideLoading = signal(false);
  /** The picker of the repository's recordings: open, its list (`null` while read), its error. */
  protected readonly pickerOpen = signal(false);
  protected readonly recordings = signal<RecordingEntry[] | null>(null);
  protected readonly recordingsError = signal<string | null>(null);
  /** The scenario guid of the repository recording shown, if it is one. */
  protected readonly shownRecording = computed(() => this.transcript().scenarioGuid);
  /** The repository recording being read (its steps, then its personas, guide and stimuli). */
  protected readonly loadingRecording = signal<string | null>(null);
  /** Bumped per repository recording asked for, so a slow one never replaces a later choice. */
  private opening = 0;

  /**
   * The demo to show: `?demo[=<name>]`, else the one `npm run demo <name>` built for (APP_DEMO),
   * unless a session is to be followed.
   */
  private readonly demoName = computed(() =>
    demoNameOf({
      asked: this.demo(),
      built: this.env.demo,
      sessionToken: this.sessionToken(),
      recording: this.recordingRef(),
    }),
  );
  protected readonly isDemo = computed(() => this.demoName() !== undefined);
  /** Title of the recording shown instead of a live session (demo or imported file), if any. */
  protected readonly recordedTitle = signal<string | null>(null);
  /** A recording is shown: nothing is read in or started. */
  protected readonly recorded = computed(
    () => this.isDemo() || this.recordedTitle() !== null || !!this.recordingRef()?.trim(),
  );
  protected readonly currentView = computed<DiscussionView>(() => {
    const view = this.view();
    return view === 'discussion' || view === 'analysis' ? view : 'study';
  });
  /** The views with the guide in a sidebar on the left. */
  protected readonly withGuide = computed(() => this.currentView() !== 'study');
  private readonly analysisView = viewChild(AnalysisView);
  /** Follows a session LeanScope started; the app's own configuration is not needed for it. */
  protected readonly attached = computed(() => !this.isDemo() && !!this.sessionToken()?.trim());
  /** What a discussion of its own needs. The study (APP_* values) is optional. */
  protected readonly missing = computed(() =>
    this.recorded() || this.attached() ? [] : missingConfig(this.config),
  );
  /**
   * The ingest choreo (APP_INGEST_CHOREO_GUID, APP_STUDY_QUERY_GUID) reads documents into the
   * repository. Without it, documents go to the discussion's input slots: they are handed over
   * when the session asks for them (held until then, also before the session runs).
   */
  private readonly ingestReady = computed(() => missingAppEnv(this.env).length === 0);
  protected readonly notice = signal<string | null>(null);

  protected readonly study = this.store.study;
  /**
   * The study as the discussion shows it: when no screener names the participants, the speakers
   * of the session take their place (e.g. when a recorded choreo is replayed).
   */
  protected readonly discussionStudy = computed<Study>(() => {
    const study = this.study();
    if (study.screener?.participants.length) return study;
    const participants = this.discussion.participants();
    return participants.length
      ? { ...study, screener: { title: '', criteria: [], ...study.screener, participants } }
      : study;
  });
  protected readonly transcript = this.discussion.transcript;
  protected readonly blocks = computed(() => arrangeBlocks(this.store.guide(), this.transcript()));
  protected readonly selected = computed(() =>
    this.discussion.participants().find((p) => p.guid === this.ui.selectedParticipant()),
  );
  private readonly state = computed<DsStatusState>(() => {
    if (this.recorded()) return 'demo';
    if (this.discussion.state() === 'error' || this.store.error()) return 'error';
    if (this.discussion.running() || this.ingest.busy() || this.store.loading()) return 'thinking';
    return this.study().guide || this.transcript().clips.length ? 'ready' : 'idle';
  });
  protected readonly status = computed<ShellStatus & { title: string | null }>(() => {
    const state = this.state();
    return {
      state,
      label: STATUS_LABEL[state],
      title:
        state === 'demo'
          ? `Aufzeichnung${this.recordedTitle() ? ` „${this.recordedTitle()}“` : ''}: nichts wird eingelesen oder gestartet.`
          : null,
    };
  });
  protected readonly shell = inject(ShellContext);
  protected readonly jobsOf = (zone: DropZone): IngestJob[] => {
    const live = [...this.slots.jobsOf(zone), ...this.ingest.jobsOf(zone)];
    if (live.length) return live;
    // Else what the data basis holds: as the repository keeps it, or (until that is read, or for
    // a slot it does not keep) as this browser remembers it was handed over.
    const names = this.recorded()
      ? undefined
      : (this.basis()[zone]?.map((f) => f.name) ?? this.guide.files()[zone]);
    return names?.length
      ? [{ id: REMEMBERED_JOB, zone, fileNames: names, state: 'done', message: 'Übergeben.' }]
      : [];
  };
  /** The status lines of all documents, read in or handed to the session. */
  protected readonly jobs = computed(() => [...this.ingest.jobs(), ...this.slots.jobs()]);
  /** The zone whose document the session asks for, for the "Studie" view to highlight. */
  protected readonly askedZone = computed(() => {
    const place = this.slots.asked();
    return place?.kind === 'zone'
      ? { zone: place.zone, text: this.slots.askedText(), optional: this.slots.askedOptional() }
      : null;
  });
  /** The cast the user picks on the timeline, in a choreo that asks for it. */
  protected readonly timelineCast = computed<TimelineCast | null>(() => {
    const d = this.discussion;
    if (!d.slotted()) return null;
    const asked = d.askedCast();
    const draft = d.castDraft();
    return {
      asked,
      question: asked ? this.slots.askedText() : '',
      editable: { moderator: d.castEditable('moderator'), participants: d.castEditable('participants') },
      options: { moderator: d.castOptions('moderator'), participants: d.castOptions('participants') },
      choices: { moderator: d.castChoices('moderator'), participants: d.castChoices('participants') },
      ready: asked === 'moderator' ? draft.moderator !== null : draft.participants.length > 0,
    };
  });
  /** The data basis as the repository keeps it (see `loadBasis`). */
  private readonly basis = signal<DataBasis>({});
  private basisRun = 0;
  private readonly handedStimuli = computed(() => this.slots.handed().get('stimulus') ?? NO_FILES);
  protected readonly hasClips = computed(() => this.transcript().clips.length > 0);
  /** No discussion can be started: a recording is shown, one runs, or the setup is incomplete. */
  protected readonly startDisabled = computed(
    () => this.recorded() || this.discussion.running() || this.missing().length > 0,
  );
  /** The red button starts the discussion; once there are phrases, it plays them. */
  protected readonly playLabel = computed(() => {
    if (!this.hasClips()) return 'Diskussion starten';
    const missing = this.player.missing();
    return missing.length ? `Abspielen braucht noch: ${missing.join('; ')}` : 'Diskussion abspielen';
  });
  /** Player mode always shows the preview, and as large as it fits (see `previewZoom`). */
  protected readonly previewShown = computed(() => this.player.open() || !this.ui.previewHidden());
  protected readonly previewOpen = computed(() => this.player.open() || this.ui.previewOpen());
  protected readonly previewZoom = signal(1);
  protected readonly previewLines = signal(BUBBLE_LINES);

  /**
   * The session's question as a form under the discussion: only when it asks for something the
   * app has no place for, and there is no chat widget that shows it. The director's instruction
   * counts as such for now: the timeline has no director track to answer it on yet.
   */
  protected readonly showQuestion = computed(() => {
    const place = this.slots.asked();
    return (
      !!this.discussion.pendingQuestion() &&
      (!place || place.kind === 'director') &&
      !this.widget.available
    );
  });

  constructor() {
    // The breadcrumb of the app shell (if there is one): Home › Gruppendiskussion › <guide>.
    const shell = this.shell;
    effect(() => shell.status.set(this.status()));
    inject(DestroyRef).onDestroy(() => {
      shell.status.set(null);
      // The guide lives on (it is the app's, not this page's); its session ends with the page.
      this.guide.suppress(false);
      this.guide.stop();
    });
    // The guide's chat (the director's questions, everything the app has no place for) shows in
    // the agent server's support widget, in the theme LeanScope opened the app with. Not on top
    // of a recording or the player: the guide has no part in those.
    effect(() => this.guide.setTheme(this.theme(), this.themeMode()));
    effect(() => this.guide.suppress(this.recorded() || this.player.open()));
    // The stimuli handed to the guide show at once, in their zone and on the timeline's track.
    effect(() => {
      const files = this.handedStimuli();
      const settled = this.guide.pastFirst();
      // Untracked: showing them writes the store's own signals, which this effect must not follow.
      untracked(() => {
        // The next choreo's session starts with nothing handed over: what is shown stays.
        if (files.length === 0 && settled) return;
        this.store.showHanded(files);
      });
    });
    // What the repository keeps of the data basis: read when the guide starts or rejoins, and
    // again once the first choreo has settled it.
    effect(() => {
      const choreo = this.guide.choreo();
      this.guide.pastFirst();
      untracked(() => {
        if (choreo && !this.recorded()) void this.loadBasis();
      });
    });
    // The minimized widget sits next to the place where the current question is answered. A
    // question without a place in the app is answered in the widget, at its home position.
    // Between questions (the guide works or talks) it stays where it is.
    effect(() => {
      const place = this.ui.askedPlace();
      const question = this.discussion.pendingQuestion();
      // The place renders after the view switch (and the timeline after its own effects).
      this.currentView();
      if (place) this.guide.anchor(ASKED_PLACE);
      else if (question) this.guide.anchor(null);
    });
    // Player mode: the preview grows until it fills the room above the strip.
    afterRenderEffect((onCleanup) => {
      const fold = this.previewFold()?.nativeElement;
      if (!this.player.open() || !fold || typeof ResizeObserver === 'undefined') {
        this.previewZoom.set(1);
        this.previewLines.set(BUBBLE_LINES);
        return;
      }
      const fit = () => {
        const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        const width = fold.clientWidth / rem;
        const height = fold.clientHeight / rem;
        const { min, max } = PLAYER_BUBBLE_LINES;
        // As large as the width allows, but never so large that the bubble's fewest lines don't fit.
        const zoom = Math.max(
          1,
          Math.min(width / PREVIEW_WIDTH_REM, height / (PREVIEW_FRAME_REM + min * BUBBLE_LINE_REM)),
        );
        const lines = Math.floor((height / zoom - PREVIEW_FRAME_REM) / BUBBLE_LINE_REM);
        this.previewZoom.set(Math.round(zoom * 100) / 100);
        this.previewLines.set(Math.max(BUBBLE_LINES, Math.min(max, lines)));
      };
      const observer = new ResizeObserver(fit);
      observer.observe(fold);
      onCleanup(() => observer.disconnect());
    });
    effect(() => {
      const guide = this.store.guide()?.title;
      shell.crumbs.set([
        { label: 'Gruppendiskussion', link: '/' },
        ...(guide ? [{ label: guide }] : []),
      ]);
    });
  }

  ngOnInit(): void {
    const recording = this.recordingRef()?.trim();
    // The recordings to choose from ("Studie", ⋮ menu), whatever is shown first.
    void this.loadRecordings();
    if (this.isDemo()) {
      void this.loadDemo(this.demoName()!);
    } else if (recording) {
      // One that can't be read leaves the URL, so the page is the usual one again.
      void this.showRecording(recording).then((shown) => {
        if (shown) return;
        void this.router.navigate([], { queryParams: { recording: null }, queryParamsHandling: 'merge' });
        void this.store.refresh();
      });
    } else {
      void this.store.refresh();
      const token = this.sessionToken()?.trim();
      if (token) {
        this.ui.cursorTime.set(0);
        void this.discussion.attach(token);
      } else {
        // The guide is there from the start: it leads to the discussion, it doesn't wait for one.
        this.startGuide();
      }
    }
  }

  /** Starts the guide's first chapter, unless it already runs or the setup is incomplete. */
  private startGuide(): void {
    if (this.isDemo() || this.missing().length > 0 || this.discussion.session.isActive()) return;
    this.ui.cursorTime.set(0);
    void this.discussion.start();
  }

  /**
   * Reads what the first choreo's Inventory keeps: the documents by zone, and the stimuli as
   * images. Quietly: without a login, or when the repository doesn't answer, the zones show what
   * this browser remembers.
   */
  private async loadBasis(): Promise<void> {
    const choreo = this.guide.choreos[0];
    if (!choreo || !this.resources.available) return;
    const run = ++this.basisRun;
    try {
      const refs = toDataBasis(await this.resources.query<DataBasisResult>(DATA_BASIS, { choreo }));
      const guids = basisFileRefs(refs);
      const basis = guids.length
        ? withFileNames(refs, await this.resources.query<DataBasisFilesResult>(DATA_BASIS_FILES, { guids }))
        : refs;
      if (run !== this.basisRun) return;
      this.basis.set(basis);
      const stimuli = await loadRepositoryStimuli(
        (basis.stimulus ?? []).map((file, i) => ({
          guid: `basis:${file.fileRef}`,
          name: file.name.replace(/\.[^.]+$/, ''),
          url: '',
          mimeType: file.mimeType,
          fileRef: file.fileRef,
          resourceRef: file.resourceRef,
          start: i * 30,
          end: (i + 1) * 30,
        })),
        (resource, file) => this.resources.file(resource, file),
      );
      if (run !== this.basisRun) return stimuli.forEach((s) => URL.revokeObjectURL(s.url));
      this.store.showKept(stimuli);
    } catch {
      // The zones keep what this browser remembers.
    }
  }

  /** The tour is being reset. */
  protected readonly busy = signal(false);
  /** "Tour zurücksetzen" asks for confirmation in the Studie view. */
  protected readonly confirmingReset = signal(false);
  /** The tour can be reset: no recording shown, setup complete. */
  private readonly canRestart = computed(() => !this.recorded() && this.missing().length === 0);
  /**
   * Something of the data basis is stored (in the repository, in the session's Inventory, or
   * handed over in this browser), so a reset deletes it before the tour starts over.
   */
  private readonly hasData = computed(
    () =>
      Object.keys(this.basis()).length > 0 ||
      Object.keys(this.guide.answers()).length > 0 ||
      Object.keys(this.guide.files()).length > 0,
  );

  /** "Tour zurücksetzen" in the timeline's ⋮ menu: confirmed in the Studie view. */
  protected askReset(): void {
    if (!this.canRestart() || this.busy()) return;
    this.show('study');
    this.confirmingReset.set(true);
  }

  /**
   * "Tour zurücksetzen", confirmed: the stored data basis is deleted on the agent server (kept
   * answers and the files only they listed), and the guide starts over at its first choreo and
   * asks for everything again. With nothing stored it just starts over.
   */
  protected async resetTour(): Promise<void> {
    if (!this.canRestart() || this.busy()) return;
    this.busy.set(true);
    this.notice.set(null);
    try {
      if (this.hasData()) {
        const outcome = await this.guide.resetData();
        if (!outcome.ok) return this.notice.set(resetFailure(outcome));
      } else {
        await this.guide.restart();
      }
      this.ui.cursorTime.set(0);
      this.store.showHanded([]);
      this.store.showKept([]);
      this.basis.set({});
      void this.loadBasis();
    } finally {
      this.busy.set(false);
    }
  }

  /** "Überspringen" on the asked zone. */
  protected async skipAsked(): Promise<void> {
    if (!(await this.slots.skip())) {
      this.notice.set(this.discussion.error() ?? 'Die Frage konnte nicht übersprungen werden.');
    }
  }

  protected show(view: DiscussionView): void {
    void this.router.navigate([], {
      queryParams: { view: view === 'study' ? null : view },
      queryParamsHandling: 'merge',
    });
  }

  /** "Auswerten" on a guide question: a question about it goes into the analysis field. */
  protected analyseQuestion(q: GuideQuestion): void {
    const frame = (text: string) => `Wie haben die Teilnehmenden auf Frage ${q.code} („${text}“) reagiert?`;
    const room = MAX_QUESTION - frame('').length;
    const text = q.text.length > room ? `${q.text.slice(0, Math.max(0, room - 1)).trimEnd()}…` : q.text;
    this.analysisView()?.fill(frame(text));
  }

  protected drop(event: { zone: DropZone; files: File[] }): void {
    // A .vtt brings the whole discussion along: it is shown as a recording, wherever it lands.
    const vtt = event.files.find((f) => /\.vtt$/i.test(f.name));
    if (vtt) {
      void vtt.text().then(async (text) => {
        if (await this.showVtt(text, vtt.name)) this.show('discussion');
      });
      return;
    }
    if (this.recorded()) {
      // The recording brings its own study: an offer dropped on top of it is simply ignored.
      if (event.zone === 'study-brief') return;
      this.notice.set(`Bei einer Aufzeichnung wird nichts eingelesen (${ZONE_LABEL[event.zone]}).`);
      return;
    }
    if (this.guide.pastFirst()) {
      // The guide has moved on: nothing asks for a document any more.
      this.notice.set(`Die Datengrundlage steht: ${ZONE_LABEL[event.zone]} wird nicht mehr angenommen. „Tour zurücksetzen“ fängt von vorn an.`);
      return;
    }
    this.notice.set(null);
    // Documents answer the session's input slots. Only without a session, and with the ingest
    // choreo set up, are they read into the repository instead.
    if (this.slots.active() || !this.ingestReady()) this.slots.drop(event.zone, event.files);
    else void this.ingest.drop(event.zone, event.files);
  }

  /** A pick only drafts: "Übernehmen" in the asked role's head answers the session. */
  protected pickCast(event: { role: CastRole; guid: string }): void {
    if (event.role === 'participants') this.discussion.addParticipant(event.guid);
    else this.discussion.pickModerator(event.guid);
  }

  protected async submitCast(role: CastRole): Promise<void> {
    if (!(await this.slots.submitCast(role))) {
      this.notice.set(this.discussion.error() ?? 'Die Auswahl wurde nicht angenommen.');
    }
  }

  protected dismissJob(id: number): void {
    if (id === REMEMBERED_JOB) {
      this.notice.set('Eine vor dem Neuladen übergebene Datei lässt sich hier nicht mehr entfernen. „Tour zurücksetzen“ fängt von vorn an.');
      return;
    }
    this.ingest.dismiss(id);
    this.slots.dismiss(id);
  }

  protected startDiscussion(): void {
    this.ui.cursorTime.set(0);
    void this.discussion.start();
  }

  /** The red button: starts the discussion, or opens player mode once there is something to hear. */
  protected play(): void {
    if (!this.hasClips()) return this.startDiscussion();
    this.morph(() => this.player.play());
  }

  protected closePlayer(): void {
    if (this.player.open()) this.morph(() => this.player.close());
  }

  /** Changes the layout as a view transition: the theme fades, the preview grows or shrinks. */
  private morph(change: () => void): void {
    if (typeof document.startViewTransition !== 'function') return change();
    document.startViewTransition(() => {
      change();
      return new Promise<void>((done) => afterNextRender(() => done(), { injector: this.injector }));
    });
  }

  protected moveStimulus(stimulus: Pick<Stimulus, 'guid' | 'start' | 'end'>): void {
    this.store.placeStimulus(stimulus);
  }

  /** Asks for a .vtt file and shows it as a recording. */
  protected pickVtt(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.vtt,text/vtt';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) void file.text().then((text) => this.showVtt(text, file.name));
    });
    input.click();
  }

  /** Opens the list of the repository's recordings, read anew. */
  protected openRecordingPicker(): void {
    this.pickerOpen.set(true);
    void this.loadRecordings();
  }

  /** Reads which recorded discussions the connected repository has. */
  private async loadRecordings(): Promise<void> {
    this.recordingsError.set(null);
    if (!this.resources.available) {
      this.recordingsError.set('Ohne Anmeldung ist kein Repository verbunden.');
      return;
    }
    try {
      this.recordings.set(toRecordings(await this.resources.query(RECORDINGS)));
    } catch (err) {
      this.recordingsError.set(`Die Aufzeichnungen konnten nicht gelesen werden: ${reason(err)}`);
    }
  }

  /** Shows the recording picked; from the timeline's menu it also switches to the discussion. */
  protected async pickRecording(guid: string, toDiscussion = true): Promise<void> {
    this.pickerOpen.set(false);
    if (!(await this.showRecording(guid))) return;
    void this.router.navigate([], {
      queryParams: { recording: guid, ...(toDiscussion ? { view: 'discussion' } : {}) },
      queryParamsHandling: 'merge',
    });
  }

  /**
   * Takes the repository recording away again, with all it brought (turns, cast, guide, stimuli):
   * the page is the one for a discussion of its own again.
   */
  protected clearRecording(): void {
    this.opening += 1;
    this.recording += 1;
    this.loadingRecording.set(null);
    this.guideLoading.set(false);
    if (this.player.open()) this.player.close();
    this.fileUrls.forEach((url) => URL.revokeObjectURL(url));
    this.fileUrls = [];
    this.notice.set(null);
    this.ui.cursorTime.set(0);
    this.recordedTitle.set(null);
    this.discussion.clearRecorded();
    this.store.load(EMPTY_STUDY);
    void this.store.refresh();
    // Without the recording the guide is back, from its first chapter.
    void this.router
      .navigate([], { queryParams: { recording: null }, queryParamsHandling: 'merge' })
      .then(() => this.startGuide());
  }

  /**
   * Shows a recorded discussion of the connected repository, read from its scenario's steps;
   * false (with a notice) when it can't be read.
   */
  private async showRecording(guid: string): Promise<boolean> {
    const run = ++this.opening;
    const settled = () => {
      if (run === this.opening) this.loadingRecording.set(null);
    };
    this.loadingRecording.set(guid);
    try {
      if (!this.resources.available) throw new Error('Ohne Anmeldung ist kein Repository verbunden.');
      const recording = await loadRecording(
        guid,
        (document, variables) => this.resources.query(document, variables),
        async (guids) => toModeratorRefs(await this.resources.query(MODERATORS_BY_GUID, { guids })),
      );
      if (run !== this.opening) return false;
      // Shown at once; the sign stays until its portraits, guide and stimuli are there too.
      void this.showImported(recording).finally(settled);
      return true;
    } catch (err) {
      settled();
      if (run === this.opening) {
        this.notice.set(`Die Aufzeichnung konnte nicht aus dem Repository gelesen werden: ${reason(err)}`);
      }
      return false;
    }
  }

  private async loadDemo(name: string): Promise<void> {
    const path = DEMO_FILES[name];
    if (!path) {
      this.notice.set(`Unbekannte Demo „${name}“. Verfügbar: ${Object.keys(DEMO_FILES).join(', ')}.`);
      return;
    }
    // `?recording=<guid>` on top of a demo: that recording, with the demo's file as the fallback.
    const recording = this.recordingRef()?.trim();
    if (recording && (await this.showRecording(recording))) return;
    try {
      const response = await fetch(new URL(path, document.baseURI));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await this.showVtt(await response.text(), path);
    } catch (err) {
      this.notice.set(`Die Demo konnte nicht geladen werden: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Shows a self-contained .vtt as a recording; false (with a notice) when it can't be read. */
  private async showVtt(text: string, fileName: string): Promise<boolean> {
    let imported: ImportedDiscussion;
    try {
      imported = fromWebVtt(text, { moderatorRefs: await this.repositoryModerators(text) });
    } catch (err) {
      this.notice.set(`${fileName} konnte nicht gelesen werden: ${err instanceof Error ? err.message : err}`);
      return false;
    }
    // A file replaces a repository recording still on its way, and its place in the URL.
    this.opening += 1;
    this.loadingRecording.set(null);
    if (this.recordingRef()) {
      void this.router.navigate([], { queryParams: { recording: null }, queryParamsHandling: 'merge' });
    }
    void this.showImported(imported);
    return true;
  }

  /** Shows a recording (from a file or the repository) and fills it in from its repository. */
  private showImported(imported: ImportedDiscussion): Promise<void> {
    this.notice.set(null);
    this.ui.cursorTime.set(0);
    this.recordedTitle.set(imported.title);
    this.store.load(imported.study);
    this.discussion.showRecorded(imported.transcript, imported.moderator);
    return this.connectRecording(imported);
  }

  /**
   * The moderator by the repository, for a file that names none itself: whoever of its personas
   * has the Group Role `Moderator` there. Empty when the file names one, nobody is signed in, or
   * the repository doesn't answer; `fromWebVtt` then says what is missing.
   */
  private async repositoryModerators(text: string): Promise<string[]> {
    try {
      const cast = vttCast(text);
      if (cast.namesModerator || !cast.personaRefs.length || !this.resources.available) return [];
      return toModeratorRefs(await this.resources.query(MODERATORS_BY_GUID, { guids: cast.personaRefs }));
    } catch {
      return [];
    }
  }

  /**
   * Fills the recording in from its repository (LEANSCOPE_REPOSITORY_ID): portraits and profiles of its
   * personas (`PERSONAS_BY_GUID`, run as the signed-in user), the
   * stimuli it names by `resourceRef` + `fileRef`, and the guide it names under `sources` when it
   * brings none itself (the source's own `text`, else `GUIDE_BY_GUID`). Its turns are then assigned to that guide's questions by
   * their words (`matchQuestions`). Without a login, or when the repository
   * doesn't answer, the recording stays as the file has it.
   */
  private async connectRecording(imported: ImportedDiscussion): Promise<void> {
    const run = ++this.recording;
    this.fileUrls.forEach((url) => URL.revokeObjectURL(url));
    this.fileUrls = [];
    // A file's own guide (and its tags) wins; `sources` only fills the gap.
    const sources = imported.study.guide ? [] : imported.sources;
    if (!this.resources.available) {
      const kept = [
        ...(imported.files.length ? [`${imported.files.length} Stimuli`] : []),
        ...(sources.length ? ['Leitfaden'] : []),
      ];
      if (kept.length) {
        this.notice.set(`Ohne Anmeldung nicht aus dem Repository geladen: ${kept.join(', ')}.`);
      }
      this.guideLoading.set(false);
      return;
    }
    this.guideLoading.set(sources.length > 0);
    const [personas, files, guideRead] = await Promise.allSettled([
      imported.personaRefs.length
        ? this.resources.query(PERSONAS_BY_GUID, { guids: imported.personaRefs }).then(toRepositoryPersonas)
        : Promise.resolve([]),
      loadRepositoryStimuli(imported.files, (resource, file) => this.resources.file(resource, file)),
      // A repository recording brings its guide's text along; only a file's `sources` need the query.
      sources.length
        ? Promise.resolve(guideFromSources(sources)).then(
            (own) =>
              own ??
              this.resources
                .query(GUIDE_BY_GUID, { guids: sources.map((s) => s.resourceRef) })
                .then((data) => toRepositoryGuide(data, sources)),
          )
        : Promise.resolve(null),
    ]);
    const loaded = files.status === 'fulfilled' ? files.value : [];
    const urls = [...new Set(loaded.map((s) => s.url))];
    if (run !== this.recording) {
      urls.forEach((url) => URL.revokeObjectURL(url));
      return;
    }
    this.fileUrls = urls;
    this.guideLoading.set(false);

    const found = personas.status === 'fulfilled' ? personas.value : [];
    const guide = guideRead.status === 'fulfilled' ? guideRead.value : null;
    const study = withRepositoryPersonas(imported.study, found);
    this.store.load({ ...study, ...(guide ? { guide } : {}), stimuli: [...study.stimuli, ...loaded] });
    if (guide) {
      // The stimuli as the file places them: a file that did not load still says what was on screen.
      const shown = [...imported.study.stimuli, ...imported.files];
      // A repository recording's steps name their topic: the turn can only open one of its questions.
      const topics = imported.topics ? topicQuestions(imported.topics, guide) : undefined;
      this.discussion.setRecorded(matchQuestions(imported.transcript, guide, shown, topics));
    }
    this.discussion.setModeratorImage(repositoryImageOf(imported.moderator.guid, imported.moderator.imageUrl, found));
    this.discussion.setModeratorColor(repositoryColorOf(imported.moderator.guid, imported.moderator.color, found));

    const failed = [
      ...(personas.status === 'rejected' ? [`Personas: ${reason(personas.reason)}`] : []),
      ...(loaded.length < imported.files.length ? [`${imported.files.length - loaded.length} Stimuli nicht geladen`] : []),
      ...(guideRead.status === 'rejected' ? [`Leitfaden: ${reason(guideRead.reason)}`] : []),
      ...(guideRead.status === 'fulfilled' && sources.length && !guide ? ['Leitfaden ohne Text'] : []),
    ];
    if (failed.length) this.notice.set(`Aus dem Repository: ${failed.join('; ')}.`);
  }

  protected exportVtt(): void {
    const transcript = this.transcript();
    const title = this.recordedTitle() ?? this.study().guide?.title ?? 'Gruppendiskussion';
    const vtt = toSelfContainedVtt({
      title,
      study: this.study(),
      transcript,
      moderator: {
        guid: transcript.clips.find((c) => c.moderator)?.speakerGuid ?? 'moderation',
        name: this.discussion.moderatorName(),
        imageUrl: this.discussion.moderatorImage(),
        color: this.discussion.moderatorColor(),
      },
    });
    const blob = new Blob([vtt], { type: 'text/vtt' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'transkript'}.vtt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url));
  }
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Why a reset of the data basis did not happen, for the notice. */
function resetFailure(outcome: { status: number; code?: string; message?: string }): string {
  if (outcome.code === 'busy') {
    return 'Thomas ist gerade beschäftigt, die Daten wurden nicht zurückgesetzt. Bitte gleich noch einmal versuchen.';
  }
  if (outcome.code === 'no-inventory') {
    return 'Dieser Choreo merkt sich nichts in einem Inventory: es gibt nichts zurückzusetzen.';
  }
  if (outcome.status === 404 || outcome.status === 405) {
    return 'Der Agent Server kennt das Zurücksetzen nicht (ab Version 0.168.0) oder die Sitzung ist nicht mehr erreichbar.';
  }
  if (outcome.status === 0) return 'Der Agent Server war nicht erreichbar, die Daten wurden nicht zurückgesetzt.';
  return `Die Daten wurden nicht zurückgesetzt: ${outcome.message ?? `Fehler ${outcome.status}`}.`;
}
