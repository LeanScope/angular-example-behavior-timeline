import {
  DestroyRef,
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
  SpeakMode,
  SpeakResult,
  SseFrame,
  TtsAudioEndFrame,
  TtsAudioFrame,
} from '../../../leanscope/agent-server.types';
import type { LeanScopeSessionService } from '../../../leanscope/leanscope-session.service';
import { APP_ENV } from '../../app-env';
import type { Clip } from '../model/study.model';
import { DiscussionUiState } from '../state/discussion-ui.state';
import { DiscussionService } from '../state/discussion.service';
import { createSession } from '../state/session-factory';
import { SpeechQueue } from './speech-queue';

/** How long a step may take to be heard before playback gives up (it includes the session's start). */
const STALL_MS = 60_000;
/** How long to wait before asking again while the session's engine is still starting. */
const RETRY_MS = 1_000;
/** How far short of the next turn the cursor waits while a voice is still speaking. */
const HOLD_SECONDS = 0.05;
/** Refusals of a step that just has nothing to say: its time passes in silence. */
const SILENT = new Set(['voiceless', 'no-speaker', 'empty']);

/** Makes the player's session; replaced in tests. */
export const PLAYER_SESSION_FACTORY = new InjectionToken<() => LeanScopeSessionService>(
  'PLAYER_SESSION_FACTORY',
  {
    providedIn: 'root',
    factory: () => {
      const injector = inject(Injector);
      return () => createSession(injector);
    },
  },
);

export type PlayerState = 'idle' | 'preparing' | 'speaking' | 'paused';

/** One turn: a step of the recording, spoken by its persona. */
export interface Turn {
  /** Who says what in which step: a changed step is spoken anew. */
  key: string;
  /** The repository's ScenarioStep the agent server speaks. */
  stepGuid: string;
  speakerGuid: string;
  start: number;
  end: number;
}

/** The turns of a recording read from its repository, one per step, in order. */
export function turnsOf(clips: Clip[]): Turn[] {
  return clips
    .filter((clip): clip is Clip & { stepGuid: string } => !!clip.stepGuid)
    .map((clip) => ({
      key: `${clip.stepGuid}\n${clip.speakerGuid}\n${clip.text}`,
      stepGuid: clip.stepGuid,
      speakerGuid: clip.speakerGuid,
      start: clip.start,
      end: clip.end,
    }));
}

/** A step asked for: its audio arrives as frames with the request's id. */
interface Request {
  turn: Turn;
  mode: SpeakMode;
  pieces: Blob[];
}

/**
 * Plays a recording read from its repository: the personas speak its steps with their voices,
 * from the timeline cursor on, and the cursor follows.
 *
 * The voices come from one session of a carrier choreo (APP_PLAYER_CHOREO_GUID), opened on the
 * first play and kept: the agent server's `/speak` route has it say any recorded step in its
 * persona's voice, in any order, without writing anything (agent server ≥ 0.160.0). The session
 * is never continued, so it costs nothing while it waits.
 *
 * - The step to be heard is asked for with `replace` (which drops what was asked before), the one
 *   after it with `queue`, so it is ready when the listener gets there. No further ahead.
 * - A jump asks for the target at once: no restart, no stepping through.
 * - A step heard once is kept, so going back plays from memory.
 * - Pause is "stop the audio"; what still arrives is kept. Close drops what was asked.
 */
@Injectable()
export class PlayerService {
  private readonly env = inject(APP_ENV);
  private readonly ui = inject(DiscussionUiState);
  private readonly discussion = inject(DiscussionService);
  private readonly queue = inject(SpeechQueue);
  private readonly createSession = inject(PLAYER_SESSION_FACTORY);

  private readonly _open = signal(false);
  private readonly _playing = signal(false);
  private readonly _speaking = signal<Turn | null>(null);
  private readonly _error = signal<string | null>(null);
  private readonly session = signal<LeanScopeSessionService | null>(null);

  /** Player mode is shown. */
  readonly open = this._open.asReadonly();
  /** Playback is on (the button shows Pause), also while a voice is still being prepared. */
  readonly playing = this._playing.asReadonly();
  readonly error = this._error.asReadonly();
  readonly state = computed<PlayerState>(() => {
    if (!this._playing()) return this._open() ? 'paused' : 'idle';
    return this._speaking() ? 'speaking' : 'preparing';
  });
  /** How loud the voice being heard is right now, 0 to 1. */
  readonly level = this.queue.level;
  /** What playback still needs, as hints. Empty when ready. */
  readonly missing = computed(() => {
    const clips = this.discussion.transcript().clips;
    return [
      ...(this.env.playerChoreoGuid.trim() ? [] : ['APP_PLAYER_CHOREO_GUID in .env']),
      ...(clips.some((clip) => !clip.stepGuid) ? ['eine Aufnahme aus dem Repository'] : []),
    ];
  });

  /** The recording's turns, in order. */
  private turns: Turn[] = [];
  /** The turn to be heard next. */
  private index = 0;
  /** Audio of the turns heard so far, by turn key. It outlives sessions. */
  private readonly heard = new Map<string, Blob[]>();
  /** The steps asked for whose audio has not ended, by request id. */
  private readonly requests = new Map<string, Request>();
  /** The request whose audio streams into the queue while it still arrives. */
  private streaming: string | null = null;
  private requestCount = 0;
  /** The speak calls go out one after the other, so the server gets them in the order asked. */
  private sending: Promise<unknown> = Promise.resolve();
  /** The session, once it was created. */
  private starting: Promise<LeanScopeSessionService> | null = null;
  /** A lost session was replaced once since the last answered request: a second loss fails. */
  private renewed = false;
  /** Bumped whenever the running turn is cut off, so its end is ignored. */
  private run = 0;
  private offFrames: (() => void) | null = null;
  private silence: ReturnType<typeof setTimeout> | null = null;
  private stall: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.halt();
      if (this.requests.size) void this.session()?.cancelSpeech();
      this.dropSession();
    });
    effect(() => {
      const session = this.session();
      if (!session) return;
      const state = session.state();
      const error = session.error();
      const reason = session.endReason();
      untracked(() => {
        if (state !== 'error' && state !== 'ended') return;
        // The next play opens a new session.
        this.dropSession();
        if (!this._playing()) return;
        const why = [reason, error].filter(Boolean).join(': ');
        this.fail(`Die Player-Choreo ist beendet${why ? ` (${why})` : ''}.`);
      });
    });
    // The cursor follows the voice through the turn. A voice often takes longer than the
    // transcript says: then the cursor waits short of the next turn, so the speaker stays in the
    // frame until they have really finished.
    effect(() => {
      const turn = this._speaking();
      if (!turn) return;
      const next = this.turns[this.turns.indexOf(turn) + 1];
      const end = next ? Math.min(turn.end, next.start - HOLD_SECONDS) : turn.end;
      const length = Math.max(0, end - turn.start);
      this.ui.cursorTime.set(turn.start + Math.min(this.queue.elapsed(), length));
    });
  }

  /** Opens player mode and plays from the timeline cursor. */
  play(): void {
    const clips = this.discussion.transcript().clips;
    if (!clips.length || this.missing().length) return;
    this.queue.prime();
    this._open.set(true);
    this._error.set(null);
    this.ui.hoverTime.set(null);
    this.turns = turnsOf(clips);
    this.index = indexAt(this.turns, this.ui.cursorTime());
    this._playing.set(true);
    this.step();
  }

  /** Cuts the speech off. `play()` goes on with the same turn. */
  pause(): void {
    this._playing.set(false);
    this.clearStall();
    this.halt();
  }

  toggle(): void {
    if (this._playing()) this.pause();
    else this.play();
  }

  /** Jumps to the turn at `time` (seconds): speaks it when playing, else just moves the cursor. */
  seek(time: number): void {
    this.halt();
    this.ui.cursorTime.set(Math.max(0, time));
    if (!this._playing()) return;
    this.index = indexAt(this.turns, time);
    this.step();
  }

  /**
   * Leaves player mode, and leaves nothing running that costs: what was asked for and is not
   * heard yet is dropped. The session itself stays, waiting, so the next play starts at once.
   */
  close(): void {
    this.pause();
    this._open.set(false);
    if (this.requests.size) void this.session()?.cancelSpeech();
    this.requests.clear();
  }

  /** Speaks the turn at `index` if nothing is being spoken: from memory, else via the session. */
  private step(): void {
    if (!this._playing() || this._speaking() || this.silence) return;
    const turn = this.turns[this.index];
    if (!turn) {
      // Past the last turn.
      this._playing.set(false);
      return;
    }
    if (!(turn.start <= this.ui.cursorTime() && this.ui.cursorTime() <= turn.end)) {
      this.ui.cursorTime.set(turn.start);
    }

    const known = this.heard.get(turn.key);
    if (known) return this.speak(turn, known, null);
    const asked = this.requestFor(turn);
    if (!asked) {
      this.ask(turn, 'replace');
      this.prefetch();
      return;
    }
    // Its audio is arriving: start with what is there.
    const [id, request] = asked;
    if (request.pieces.length) this.speak(turn, request.pieces, id);
    else this.watchStall();
  }

  /** Asks for the turn after the one to be heard, unless it is heard or asked for already. */
  private prefetch(): void {
    const next = this.turns[this.index + 1];
    if (next && !this.heard.has(next.key) && !this.requestFor(next)) this.ask(next, 'queue');
  }

  private requestFor(turn: Turn): [string, Request] | undefined {
    for (const entry of this.requests) if (entry[1].turn.key === turn.key) return entry;
    return undefined;
  }

  /** Has the session speak `turn`. `replace` drops what was asked before. */
  private ask(turn: Turn, mode: SpeakMode, id = `p-${++this.requestCount}`, retry = false): void {
    if (mode === 'replace') this.requests.clear();
    this.requests.set(id, { turn, mode, pieces: [] });
    // A retry keeps the timer running, so retrying has an end.
    if (!retry) this.watchStall();
    this.sending = this.sending.then(async () => {
      if (!this.requests.has(id)) return;
      let session: LeanScopeSessionService;
      try {
        session = await this.ready();
      } catch (err) {
        if (this.requests.has(id)) this.fail(err instanceof Error ? err.message : String(err));
        return;
      }
      if (!this.requests.has(id)) return;
      const result = await session.speak(turn.stepGuid, { requestId: id, mode });
      if (this.session() === session) this.answered(id, result);
    });
  }

  private answered(id: string, result: SpeakResult): void {
    const request = this.requests.get(id);
    if (!request) return;
    if (result.ok) {
      this.renewed = false;
      return;
    }
    const { status, reason } = result;
    if (reason && SILENT.has(reason)) {
      // Nothing to say: the turn passes in silence.
      this.requests.delete(id);
      this.heard.set(request.turn.key, []);
      return this.step();
    }
    if (reason === 'not-found' || reason === 'not-a-recording') {
      return this.fail('Die Aufnahme liegt nicht im Repository der Player-Choreo.');
    }
    if (status === 503 || status === 504) {
      // The engine is still starting: ask again in a moment (the stall timer bounds this).
      setTimeout(() => {
        if (!this.requests.has(id)) return;
        this.requests.delete(id);
        this.ask(request.turn, request.mode, id, true);
      }, RETRY_MS);
      return;
    }
    if ((status === 0 || status === 404 || status === 410) && !this.renewed) {
      // The session is gone: a new one, and the turn to be heard asked for again.
      this.renewed = true;
      this.halt();
      this.dropSession();
      return this.step();
    }
    this.fail(`Die Stimme konnte nicht angefordert werden (${status || 'keine Verbindung'}).`);
  }

  /** The session, created on first use and kept while it lives. */
  private ready(): Promise<LeanScopeSessionService> {
    const current = this.session();
    if (current && this.starting && !['ended', 'error'].includes(current.state())) return this.starting;
    this.release();
    const session = this.createSession();
    this.offFrames = session.onFrame((frame) => this.onFrame(frame));
    this.session.set(session);
    this.starting = session.start({ choreoScenarioGuid: this.env.playerChoreoGuid.trim() }).then(() => {
      if (session.state() === 'error') {
        throw new Error(session.error() ?? 'Die Player-Choreo konnte nicht gestartet werden.');
      }
      return session;
    });
    return this.starting;
  }

  /** Lets the session go, and with it what was asked of it. */
  private dropSession(): void {
    this.release();
    this.requests.clear();
    this.streaming = null;
  }

  private release(): void {
    this.offFrames?.();
    this.offFrames = null;
    this.session()?.stop();
    this.session.set(null);
    this.starting = null;
  }

  /** Plays `pieces`; with a request id, more of them arrive while it plays. */
  private speak(turn: Turn, pieces: Blob[], streaming: string | null): void {
    const index = this.index;
    this.clearStall();
    if (!streaming && pieces.length === 0) {
      // A turn without a voice: its time passes in silence.
      this._speaking.set(turn);
      this.silence = setTimeout(() => {
        this.silence = null;
        this.finished(index);
      }, Math.max(0, turn.end - turn.start) * 1000);
      this.prefetch();
      return;
    }
    const run = ++this.run;
    this._speaking.set(turn);
    this.streaming = streaming;
    void this.queue.begin().then((finished) => {
      if (run !== this.run) return;
      if (finished) this.finished(index);
      else {
        // The browser refused to play (no click yet).
        this._speaking.set(null);
        this._playing.set(false);
      }
    });
    for (const piece of pieces) this.queue.push(piece);
    if (!streaming) this.queue.end();
    // While this turn is heard, the session prepares the next one.
    this.prefetch();
  }

  private finished(index: number): void {
    this._speaking.set(null);
    this.streaming = null;
    this.index = index + 1;
    this.step();
  }

  /** Cuts off the turn being spoken. Audio still arriving for it is kept for later. */
  private halt(): void {
    this.run++;
    if (this.silence) clearTimeout(this.silence);
    this.silence = null;
    this.queue.stop();
    this._speaking.set(null);
    this.streaming = null;
  }

  private onFrame(frame: SseFrame): void {
    if (frame.event !== 'tts_audio' && frame.event !== 'tts_audio_end') return;
    // Frames without a request id are the carrier's own turns: not ours.
    const id = (frame.data as { requestId?: string } | null)?.requestId;
    const request = id ? this.requests.get(id) : undefined;
    if (!id || !request) return;
    if (this._playing()) this.watchStall();

    if (frame.event === 'tts_audio') {
      const piece = toBlob(frame.data as TtsAudioFrame);
      request.pieces.push(piece);
      if (this.streaming === id) this.queue.push(piece);
      else this.step();
      return;
    }
    const end = frame.data as TtsAudioEndFrame;
    this.requests.delete(id);
    // A superseded request's audio is incomplete; a failed one may work next time.
    if (end.cancelled) return;
    if (!end.reason) this.heard.set(request.turn.key, request.pieces);
    if (this.streaming === id) return this.queue.end();
    if (end.reason && this.turns[this.index]?.key === request.turn.key && !this._speaking()) {
      return this.speak(request.turn, request.pieces, null);
    }
    this.step();
  }

  private watchStall(): void {
    this.clearStall();
    this.stall = setTimeout(() => {
      if (!this._playing() || this._speaking()) return;
      this.fail('Die Player-Choreo antwortet nicht. Sind die Sprecher Personas dieses Repositorys?');
    }, STALL_MS);
  }

  private clearStall(): void {
    if (this.stall) clearTimeout(this.stall);
    this.stall = null;
  }

  private fail(message: string): void {
    this._error.set(message);
    this.pause();
  }
}

/** The turn to start with at `time`: the one heard then, else the next, else the first. */
function indexAt(turns: Turn[], time: number): number {
  let found = -1;
  for (let i = 0; i < turns.length && turns[i].start <= time; i++) found = i;
  if (found >= 0 && time <= turns[found].end) return found;
  return found + 1 < turns.length ? found + 1 : 0;
}

function toBlob(frame: TtsAudioFrame): Blob {
  const binary = atob(frame.audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: frame.mimeType || 'audio/mpeg' });
}
