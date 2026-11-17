import { VoiceOnsets } from './voice-onsets';

describe('VoiceOnsets', () => {
  it('reports a syllable when the level climbs out of a dip', () => {
    const onsets = new VoiceOnsets();
    expect(onsets.feed(0.6, 0)).toBe(0.6);
  });

  it('stays quiet while the level only falls or barely moves', () => {
    const onsets = new VoiceOnsets();
    onsets.feed(0.6, 0);
    expect(onsets.feed(0.5, 300)).toBeNull();
    expect(onsets.feed(0.55, 600)).toBeNull();
  });

  it('reports the next syllable after a dip', () => {
    const onsets = new VoiceOnsets();
    onsets.feed(0.6, 0);
    onsets.feed(0.2, 200);
    expect(onsets.feed(0.5, 300)).toBe(0.5);
  });

  it('ignores a voice too quiet to be heard', () => {
    expect(new VoiceOnsets().feed(0.05, 0)).toBeNull();
  });

  it('keeps a minimum gap between syllables', () => {
    const onsets = new VoiceOnsets();
    onsets.feed(0.6, 0);
    onsets.feed(0.1, 50);
    expect(onsets.feed(0.6, 100)).toBeNull();
    expect(onsets.feed(0.6, 200)).toBe(0.6);
  });
});
