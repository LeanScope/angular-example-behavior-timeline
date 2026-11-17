import { arrangeBlocks, blockAt } from './arrangement';
import type { Guide, Transcript } from './study.model';

const guide: Guide = {
  title: 'Leitfaden',
  totalMinutes: 30,
  blocks: [
    { code: 'A', title: 'Einstieg', minutes: 10, tone: 1, questions: [{ key: 'q_a', code: 'A1', text: '', blockCode: 'A', tone: 1 }] },
    { code: 'B', title: 'Bild', minutes: 15, tone: 2, questions: [{ key: 'q_b', code: 'B1', text: '', blockCode: 'B', tone: 2 }] },
    { code: 'C', title: 'Preis', minutes: 5, tone: 3, questions: [{ key: 'q_c', code: 'C1', text: '', blockCode: 'C', tone: 3 }] },
  ],
};

const transcript = (badges: Transcript['badges'], duration: number): Transcript => ({
  clips: [],
  badges,
  done: new Set(),
  duration,
});

describe('arrangeBlocks', () => {
  it('lays out the plan before the discussion', () => {
    expect(arrangeBlocks(guide, transcript([], 0)).map((b) => [b.code, b.start, b.end, b.planned])).toEqual([
      ['A', 0, 600, true],
      ['B', 600, 1500, true],
      ['C', 1500, 1800, true],
    ]);
  });

  it('aligns reached blocks to the discussion and appends the rest with planned length', () => {
    const blocks = arrangeBlocks(guide, transcript([{ questionKey: 'q_a', start: 0 }, { questionKey: 'q_b', start: 120 }], 200));
    expect(blocks.map((b) => [b.code, b.start, b.end, b.planned])).toEqual([
      ['A', 0, 120, false],
      ['B', 120, 200, false],
      ['C', 200, 500, true],
    ]);
  });

  it('follows the order the moderator chose, not the guide order', () => {
    const blocks = arrangeBlocks(guide, transcript([{ questionKey: 'q_c', start: 0 }, { questionKey: 'q_a', start: 50 }], 80));
    expect(blocks.map((b) => b.code)).toEqual(['C', 'A', 'B']);
    expect(arrangeBlocks(null, transcript([], 0))).toEqual([]);
  });

  it('carries the planned minutes and marks a block done when all its questions are', () => {
    const t = { ...transcript([{ questionKey: 'q_a', start: 0 }], 100), done: new Set(['q_a']) };
    expect(arrangeBlocks(guide, t).map((b) => [b.code, b.minutes, b.done])).toEqual([
      ['A', 10, true],
      ['B', 15, false],
      ['C', 5, false],
    ]);
  });
});

describe('blockAt', () => {
  const blocks = arrangeBlocks(guide, transcript([{ questionKey: 'q_a', start: 10 }, { questionKey: 'q_b', start: 120 }], 200));

  it('is the last block that started', () => {
    expect(blockAt(blocks, 5)).toBeUndefined();
    expect(blockAt(blocks, 10)?.code).toBe('A');
    expect(blockAt(blocks, 150)?.code).toBe('B');
    expect(blockAt(blocks, 9999)?.code).toBe('C');
    expect(blockAt([], 0)).toBeUndefined();
  });
});
