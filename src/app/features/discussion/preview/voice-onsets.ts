/** How far the level has to climb out of its last dip to count as a new syllable. */
const RISE = 0.12;
/** Below this the voice is too quiet to send out a ring. */
const FLOOR = 0.08;
/** At most one ring per this many milliseconds, so fast speech doesn't blur into a smear. */
const MIN_GAP_MS = 180;

/**
 * Finds the syllables in a voice's loudness, so the speaker's rings beat with the voice: every
 * time the level climbs out of a dip, {@link feed} returns how loud that syllable is (0 to 1).
 */
export class VoiceOnsets {
  private dip = 0;
  private last = Number.NEGATIVE_INFINITY;

  /** Takes the next level; returns the loudness of a syllable that starts now, or `null`. */
  feed(level: number, now: number): number | null {
    if (level < this.dip) this.dip = level;
    if (level < FLOOR || level - this.dip < RISE || now - this.last < MIN_GAP_MS) return null;
    this.dip = level;
    this.last = now;
    return Math.min(1, level);
  }

  reset(): void {
    this.dip = 0;
    this.last = Number.NEGATIVE_INFINITY;
  }
}
