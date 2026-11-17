import { portraitMatchUrl, withPortrait } from './portrait-match';
import type { Participant } from './study.model';

const SERVER = 'https://dev.api.agents.leanscope.ai/';
const petra: Participant = {
  guid: 'p1',
  name: 'Petra Lindner',
  initials: 'PL',
  filled: true,
  role: 'Verkäuferin',
  demographics: '58, Gera, verwitwet',
};

describe('portraitMatchUrl', () => {
  it('asks the public catalog for an image described by role and demographics', () => {
    const url = new URL(portraitMatchUrl(SERVER, petra)!);
    expect(url.origin + url.pathname).toBe('https://dev.api.agents.leanscope.ai/api/v1/resources/public/match');
    expect(url.searchParams.get('kind')).toBe('image');
    expect(url.searchParams.get('q')).toBe('Portrait: Verkäuferin; 58, Gera, verwitwet');
  });

  it('has nothing to match on for a name-only stub', () => {
    expect(portraitMatchUrl(SERVER, { guid: 's', name: 'Stub', initials: 'ST', filled: false })).toBeUndefined();
  });
});

describe('withPortrait', () => {
  it('keeps an image of its own', () => {
    expect(withPortrait(SERVER, { ...petra, imageUrl: 'https://x/y.png' }).imageUrl).toBe('https://x/y.png');
  });

  it('adds a matched portrait otherwise', () => {
    expect(withPortrait(SERVER, petra).imageUrl).toContain('/resources/public/match?kind=image');
  });
});
