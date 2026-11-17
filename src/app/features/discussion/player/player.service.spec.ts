import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { SpeakMode, SpeakResult, SseFrame } from '../../../leanscope/agent-server.types';
import { LEANSCOPE_CONFIG } from '../../../leanscope/leanscope.config';
import { APP_ENV, EMPTY_APP_ENV } from '../../app-env';
import type { Clip, Transcript } from '../model/study.model';
import { DiscussionUiState } from '../state/discussion-ui.state';
import { DiscussionService } from '../state/discussion.service';
import { PLAYER_SESSION_FACTORY, PlayerService, turnsOf } from './player.service';
import { SpeechQueue } from './speech-queue';

/** A phrase of a recording read from its repository: its step guid is its own guid. */
const clip = (guid: string, start: number, speaker: string): Clip => ({
  guid,
  stepGuid: guid,
  speakerGuid: speaker,
  speakerName: speaker,
  moderator: speaker === 'mod',
  text: `Text ${guid}`,
  start,
  end: start + 4,
});

const transcriptOf = (clips: Clip[]): Transcript => ({
  clips,
  badges: [],
  done: new Set(),
  duration: clips.at(-1)?.end ?? 0,
});

/** A session of the carrier choreo: it speaks the steps asked for when the test says so. */
function fakeSession(answer: (stepGuid: string) => SpeakResult | undefined) {
  const state = signal('idle');
  let listener: (frame: SseFrame) => void = () => undefined;
  const speak = vi.fn(async (stepGuid: string, options: { requestId?: string; mode?: SpeakMode }) => {
    return answer(stepGuid) ?? ({ ok: true, requestId: options.requestId! } as SpeakResult);
  });
  const emit = (event: string, data: unknown) => listener({ event, data });
  return {
    state,
    error: signal<string | null>(null),
    endReason: signal<string | null>(null),
    start: vi.fn(async (_overrides: Record<string, unknown>) => state.set('working')),
    setTts: vi.fn(async (_active: boolean) => true),
    continue: vi.fn(async () => true),
    speak,
    cancelSpeech: vi.fn(async () => true),
    stop: vi.fn(),
    onFrame: (l: (frame: SseFrame) => void) => {
      listener = l;
      return () => undefined;
    },
    /** What was asked for so far: [step, mode]. */
    asked: () => speak.mock.calls.map(([step, options]) => [step, options.mode]),
    /** The id of the latest request for `stepGuid`. */
    idOf: (stepGuid: string) => speak.mock.calls.filter(([step]) => step === stepGuid).at(-1)![1].requestId!,
    /** A piece of the voice of the request for `stepGuid`. */
    piece(stepGuid: string, requestId = '') {
      emit('tts_audio', { stepGuid, requestId: requestId || this.idOf(stepGuid), audioBase64: btoa('x'), mimeType: 'audio/mpeg' });
    },
    end(stepGuid: string, extra: Record<string, unknown> = {}, requestId = '') {
      emit('tts_audio_end', { stepGuid, requestId: requestId || this.idOf(stepGuid), chunks: 1, ...extra });
    },
    /** The step's whole voice: one piece, then the end. */
    voice(stepGuid: string) {
      this.piece(stepGuid);
      this.end(stepGuid);
    },
    emit,
  };
}

/** A queue whose phrases end when the test says so. */
function fakeQueue() {
  let settle: ((finished: boolean) => void) | null = null;
  const done = (finished: boolean) => {
    const s = settle;
    settle = null;
    s?.(finished);
  };
  return {
    elapsed: signal(0),
    level: signal(0),
    prime: vi.fn(),
    begin: vi.fn(() => {
      done(false);
      return new Promise<boolean>((resolve) => (settle = resolve));
    }),
    push: vi.fn(),
    end: vi.fn(),
    stop: vi.fn(() => done(false)),
    finish: () => done(true),
  };
}

async function settled(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 10; j++) await Promise.resolve();
    TestBed.tick();
  }
}

function setup(
  options: {
    guid?: string;
    clips?: Clip[];
    answer?: (stepGuid: string) => SpeakResult | undefined;
  } = {},
) {
  const sessions: ReturnType<typeof fakeSession>[] = [];
  const queue = fakeQueue();
  const transcript = signal(
    transcriptOf(options.clips ?? [clip('m1', 0, 'mod'), clip('a1', 4, 'p1'), clip('a2', 8, 'p2'), clip('m2', 12, 'mod')]),
  );
  TestBed.configureTestingModule({
    providers: [
      PlayerService,
      DiscussionUiState,
      { provide: SpeechQueue, useValue: queue },
      { provide: DiscussionService, useValue: { transcript } },
      { provide: APP_ENV, useValue: { ...EMPTY_APP_ENV, playerChoreoGuid: options.guid ?? 'player-guid' } },
      {
        provide: LEANSCOPE_CONFIG,
        useValue: {
          agentServerUrl: '',
          choreoScenarioGuid: '',
          repositoryId: '',
        },
      },
      {
        provide: PLAYER_SESSION_FACTORY,
        useValue: () => {
          const session = fakeSession(options.answer ?? (() => undefined));
          sessions.push(session);
          return session;
        },
      },
    ],
  });
  return {
    player: TestBed.inject(PlayerService),
    ui: TestBed.inject(DiscussionUiState),
    queue,
    sessions,
    transcript,
  };
}

describe('PlayerService', () => {
  it('opens one carrier session and asks for the step at the cursor, and the one after it', async () => {
    const { player, ui, queue, sessions } = setup();
    ui.cursorTime.set(5);
    player.play();
    expect(player.open()).toBe(true);
    expect(player.state()).toBe('preparing');
    await settled();

    const [session] = sessions;
    expect(session.start).toHaveBeenCalledWith({ choreoScenarioGuid: 'player-guid' });
    expect(session.asked()).toEqual([
      ['a1', 'replace'],
      ['a2', 'queue'],
    ]);
    expect(session.continue).not.toHaveBeenCalled();
    expect(session.setTts).not.toHaveBeenCalled();

    session.piece('a1');
    expect(queue.begin).toHaveBeenCalledTimes(1);
    expect(player.state()).toBe('speaking');
    session.end('a1');
    expect(queue.push).toHaveBeenCalledTimes(1);
    expect(queue.end).toHaveBeenCalledTimes(1);
    await settled();
    expect(ui.cursorTime()).toBe(4);
  });

  it('asks one step ahead of what is heard, and no more', async () => {
    const { player, queue, sessions } = setup();
    player.play();
    await settled();
    const [session] = sessions;
    session.voice('m1');
    session.voice('a1');
    await settled();
    expect(session.asked()).toEqual([
      ['m1', 'replace'],
      ['a1', 'queue'],
    ]);

    // The second step is heard from what has arrived; now the third is asked for.
    queue.finish();
    await settled();
    expect(queue.begin).toHaveBeenCalledTimes(2);
    expect(session.asked().at(-1)).toEqual(['a2', 'queue']);
    expect(session.asked().length).toBe(3);
  });

  it('keeps the cursor short of the next turn while a voice outlasts its turn', async () => {
    const { player, ui, queue, sessions } = setup();
    player.play();
    await settled();
    sessions[0].voice('m1');
    await settled();

    queue.elapsed.set(2);
    await settled();
    expect(ui.cursorTime()).toBe(2);
    // The turn takes 4 s in the transcript, the voice more: the next turn starts at 4.
    queue.elapsed.set(5);
    await settled();
    expect(ui.cursorTime()).toBeLessThan(4);
    expect(ui.cursorTime()).toBeGreaterThan(3.9);

    queue.finish();
    await settled();
    expect(ui.cursorTime()).toBe(4);
  });

  it('pauses: cuts the speech off, keeps what arrives and plays it from memory on play', async () => {
    const { player, queue, sessions } = setup();
    player.play();
    await settled();
    const [session] = sessions;
    session.piece('m1');
    player.pause();
    expect(queue.stop).toHaveBeenCalled();
    expect(player.state()).toBe('paused');
    session.end('m1');

    const asked = session.speak.mock.calls.length;
    player.play();
    await settled();
    expect(sessions.length).toBe(1);
    expect(session.speak.mock.calls.length).toBe(asked);
    expect(queue.begin).toHaveBeenCalledTimes(2);
    expect(queue.end).toHaveBeenCalledTimes(1);
    expect(player.state()).toBe('speaking');
  });

  it('jumps anywhere in the same session: an unheard step is asked for at once, a heard one plays from memory', async () => {
    const { player, queue, sessions } = setup();
    player.play();
    await settled();
    const [session] = sessions;
    session.voice('m1');
    await settled();

    // Far ahead: the target replaces what was asked, no restart and no stepping through.
    player.seek(13);
    await settled();
    expect(session.asked().at(-1)).toEqual(['m2', 'replace']);
    // The superseded step's audio no longer counts.
    session.voice('a1');
    await settled();
    expect(queue.begin).toHaveBeenCalledTimes(1);
    session.voice('m2');
    expect(queue.begin).toHaveBeenCalledTimes(2);

    // Back to the first: from memory.
    const asked = session.speak.mock.calls.length;
    player.seek(1);
    await settled();
    expect(queue.begin).toHaveBeenCalledTimes(3);
    expect(session.asked().slice(asked)).toEqual([['a1', 'queue']]);
    expect(sessions.length).toBe(1);
  });

  it('ignores the carrier’s own turns and does not keep cancelled audio', async () => {
    const { player, queue, sessions } = setup();
    player.play();
    await settled();
    const [session] = sessions;
    session.emit('tts_audio', { stepGuid: 'director', audioBase64: btoa('x'), mimeType: 'audio/mpeg' });
    session.emit('tts_audio_end', { stepGuid: 'director', chunks: 1 });
    expect(queue.begin).not.toHaveBeenCalled();

    session.piece('m1');
    player.pause();
    session.end('m1', { cancelled: true });
    player.play();
    await settled();
    expect(session.asked().slice(-2)).toEqual([
      ['m1', 'replace'],
      ['a1', 'queue'],
    ]);
  });

  it('lets the time of a step without a voice pass in silence, and goes on', async () => {
    vi.useFakeTimers();
    try {
      const { player, queue, sessions } = setup({
        answer: (step) => (step === 'm1' ? { ok: false, status: 422, reason: 'voiceless' } : undefined),
      });
      player.play();
      await settled();
      expect(player.state()).toBe('speaking');
      expect(queue.begin).not.toHaveBeenCalled();
      vi.advanceTimersByTime(4000);
      await settled();
      sessions[0].voice('a1');
      expect(queue.begin).toHaveBeenCalledTimes(1);
      expect(player.error()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so when the recording is not in the player choreo’s repository', async () => {
    const { player } = setup({ answer: () => ({ ok: false, status: 404, reason: 'not-found' }) });
    player.play();
    await settled();
    expect(player.error()).toContain('Repository der Player-Choreo');
    expect(player.playing()).toBe(false);
  });

  it('opens a new session when the old one is gone, and asks again', async () => {
    let gone = true;
    const { player, sessions } = setup({
      answer: () => (gone ? ((gone = false), { ok: false, status: 410 }) : undefined),
    });
    player.play();
    await settled();
    expect(sessions.length).toBe(2);
    expect(sessions[1].asked()[0]).toEqual(['m1', 'replace']);
    expect(player.error()).toBeNull();
  });

  it('says why the session ended while playing', async () => {
    const { player, sessions } = setup();
    player.play();
    await settled();
    sessions[0].endReason.set('error');
    sessions[0].error.set('no credits');
    sessions[0].state.set('ended');
    await settled();
    expect(player.error()).toBe('Die Player-Choreo ist beendet (error: no credits).');
  });

  it('opens a new session on the next play when the old one has ended', async () => {
    const { player, sessions } = setup();
    player.play();
    await settled();
    player.pause();
    sessions[0].state.set('ended');
    await settled();
    player.play();
    await settled();
    expect(sessions.length).toBe(2);
  });

  it('closing drops what was asked for and keeps the session for the next play', async () => {
    const { player, sessions } = setup();
    player.play();
    await settled();
    const [session] = sessions;
    player.close();
    expect(player.open()).toBe(false);
    expect(session.cancelSpeech).toHaveBeenCalledTimes(1);
    expect(session.stop).not.toHaveBeenCalled();

    player.play();
    await settled();
    expect(sessions.length).toBe(1);
    expect(session.asked().at(-1)).toEqual(['a1', 'queue']);
    expect(session.asked().filter(([step]) => step === 'm1').length).toBe(2);
  });

  it('says what is missing and does not play without it', () => {
    const { player, sessions } = setup({ guid: '' });
    expect(player.missing()).toEqual(['APP_PLAYER_CHOREO_GUID in .env']);
    player.play();
    expect(player.open()).toBe(false);
    expect(sessions.length).toBe(0);
  });

  it('plays only a recording read from its repository', () => {
    const { player, sessions } = setup({ clips: [{ ...clip('m1', 0, 'mod'), stepGuid: undefined }] });
    expect(player.missing()).toEqual(['eine Aufnahme aus dem Repository']);
    player.play();
    expect(sessions.length).toBe(0);
  });
});

describe('turnsOf', () => {
  it('takes every step as a turn of its own', () => {
    const turns = turnsOf([clip('m1', 0, 'mod'), clip('a1', 4, 'p1'), clip('a2', 8, 'p1')]);
    expect(turns.map((t) => [t.stepGuid, t.speakerGuid, t.start, t.end])).toEqual([
      ['m1', 'mod', 0, 4],
      ['a1', 'p1', 4, 8],
      ['a2', 'p1', 8, 12],
    ]);
  });
});
