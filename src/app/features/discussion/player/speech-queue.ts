import { Injectable, signal } from '@angular/core';

/**
 * Plays one phrase at a time. A phrase arrives in pieces (the `tts_audio` frames of its step), so
 * it starts with the first piece and goes on as the others come in:
 *
 *   begin() → push(piece)… → end()      the promise of begin() resolves `true` when all is heard
 *   stop()                               cuts the phrase off; that promise resolves `false`
 */
const LEVEL_GAIN = 3.5;
/** Share of the way down the level falls per frame. */
const LEVEL_FALL = 0.12;

@Injectable()
export class SpeechQueue {
  /** Seconds of the current phrase heard so far. */
  readonly elapsed = signal(0);
  /** How loud the voice is right now, 0 (silent) to 1. Follows the audio frame by frame. */
  readonly level = signal(0);

  private audio: HTMLAudioElement | null = null;
  private pieces: Blob[] = [];
  private next = 0;
  private complete = false;
  private busy = false;
  /** Seconds of the pieces that have finished. */
  private heard = 0;
  private url: string | null = null;
  private settle: ((finished: boolean) => void) | null = null;
  /** Bumped by every stop, so a late answer of a cut-off piece never touches the next phrase. */
  private run = 0;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples: Uint8Array<ArrayBuffer> | null = null;
  private metering = 0;

  /**
   * Call from the click that starts playback: browsers only let a page make sound, and measure
   * it, when a click has allowed it.
   */
  prime(): void {
    this.audio ??= this.createAudio();
    void this.context?.resume().catch(() => undefined);
  }

  /** Starts a new phrase (cutting off a running one). Resolves when it is over. */
  begin(): Promise<boolean> {
    this.stop();
    this.pieces = [];
    this.next = 0;
    this.complete = false;
    this.heard = 0;
    this.elapsed.set(0);
    return new Promise((resolve) => (this.settle = resolve));
  }

  push(piece: Blob): void {
    if (!this.settle) return;
    this.pieces.push(piece);
    this.pump();
  }

  /** No more pieces follow: the phrase is over once the last one has played. */
  end(): void {
    if (!this.settle) return;
    this.complete = true;
    this.pump();
  }

  stop(): void {
    this.run++;
    this.audio?.pause();
    this.release();
    this.busy = false;
    this.meter(false);
    this.finish(false);
  }

  private pump(): void {
    if (!this.settle || this.busy) return;
    const piece = this.pieces[this.next];
    if (!piece) {
      this.meter(false);
      if (this.complete) this.finish(true);
      return;
    }
    this.next++;
    this.busy = true;
    // One element for all pieces: browsers keep allowing playback on the element a click started.
    const audio = (this.audio ??= this.createAudio());
    this.url = URL.createObjectURL(piece);
    audio.src = this.url;
    const run = this.run;
    void this.context?.resume().catch(() => undefined);
    this.meter(true);
    // Autoplay refused (no click yet): the phrase counts as cut off.
    audio.play().catch(() => {
      if (run === this.run) this.stop();
    });
  }

  private createAudio(): HTMLAudioElement {
    const audio = new Audio();
    audio.addEventListener('timeupdate', () => {
      if (this.busy) this.elapsed.set(this.heard + audio.currentTime);
    });
    const next = () => {
      if (!this.busy) return;
      this.heard += Number.isFinite(audio.duration) ? audio.duration : audio.currentTime;
      this.elapsed.set(this.heard);
      this.release();
      this.busy = false;
      this.pump();
    };
    audio.addEventListener('ended', next);
    // A piece that can't be decoded is skipped.
    audio.addEventListener('error', next);
    this.listen(audio);
    return audio;
  }

  /** Routes the element through an analyser, so the loudness can be read. Without one: no level. */
  private listen(audio: HTMLAudioElement): void {
    if (typeof AudioContext === 'undefined') return;
    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaElementSource(audio).connect(analyser);
      analyser.connect(context.destination);
      this.context = context;
      this.analyser = analyser;
      this.samples = new Uint8Array(analyser.fftSize);
    } catch {
      this.context = null;
      this.analyser = null;
    }
  }

  /** Reads the loudness once per frame while a piece plays. */
  private meter(on: boolean): void {
    if (this.metering) cancelAnimationFrame(this.metering);
    this.metering = 0;
    const analyser = this.analyser;
    const samples = this.samples;
    if (!on || !analyser || !samples || typeof requestAnimationFrame === 'undefined') {
      this.level.set(0);
      return;
    }
    const read = () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
      // Speech rarely gets beyond a third of full scale: that is "loud" here.
      const now = Math.min(1, Math.sqrt(sum / samples.length) * LEVEL_GAIN);
      const before = this.level();
      // Up at once, down slowly: the halo swells with a syllable and breathes out after it.
      this.level.set(now > before ? now : before + (now - before) * LEVEL_FALL);
      this.metering = requestAnimationFrame(read);
    };
    this.metering = requestAnimationFrame(read);
  }

  private release(): void {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }

  private finish(finished: boolean): void {
    const settle = this.settle;
    this.settle = null;
    settle?.(finished);
  }
}
