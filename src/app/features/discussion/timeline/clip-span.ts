import type { Clip } from '../model/study.model';

/**
 * How far each clip's text may run on its track: up to the speaker's next turn (or `length`).
 * Keyed by clip guid. The spoken part stays `clip.start..clip.end`; the rest only shows the text.
 */
export function clipSpans(clips: Clip[], length: number): Map<string, number> {
  const byTrack = new Map<string, Clip[]>();
  for (const clip of clips) {
    const track = clip.moderator ? 'moderator' : clip.speakerGuid;
    byTrack.set(track, [...(byTrack.get(track) ?? []), clip]);
  }
  const spans = new Map<string, number>();
  for (const list of byTrack.values()) {
    const ordered = [...list].sort((a, b) => a.start - b.start);
    ordered.forEach((clip, i) => {
      const next = ordered[i + 1]?.start ?? Math.max(length, clip.end);
      spans.set(clip.guid, Math.max(clip.end, next));
    });
  }
  return spans;
}
