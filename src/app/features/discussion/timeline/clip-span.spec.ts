import type { Clip } from '../model/study.model';
import { clipSpans } from './clip-span';

const clip = (guid: string, speakerGuid: string, start: number, end: number, moderator = false): Clip => ({
  guid,
  speakerGuid,
  speakerName: speakerGuid,
  moderator,
  text: '',
  start,
  end,
});

describe('clipSpans', () => {
  it('runs each clip to the same speaker’s next turn, the last one to the end', () => {
    const spans = clipSpans(
      [clip('m1', 'mod', 0, 5, true), clip('a1', 'a', 5, 10), clip('m2', 'mod', 10, 12, true), clip('a2', 'a', 20, 25)],
      60,
    );
    expect(Object.fromEntries(spans)).toEqual({ m1: 10, a1: 20, m2: 60, a2: 60 });
  });

  it('never ends before the clip itself', () => {
    expect(clipSpans([clip('a1', 'a', 50, 70)], 60).get('a1')).toBe(70);
  });
});
