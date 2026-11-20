import { EMPTY_APP_ENV } from '../app-env';
import { chaptersOf, inventoryAnswers, nextChapter } from './chapters';

describe('chapters', () => {
  it('lists the configured chapters in order and leaves out one without a choreo', () => {
    expect(chaptersOf(' entry ', EMPTY_APP_ENV).map((c) => c.choreoGuid)).toEqual(['entry']);
    const both = chaptersOf('entry', { ...EMPTY_APP_ENV, directorChoreoGuid: 'director' });
    expect(both.map((c) => c.id)).toEqual(['data-basis', 'direction']);
    expect(chaptersOf('', EMPTY_APP_ENV)).toEqual([]);
  });

  it('names the chapter after the current one', () => {
    const chapters = chaptersOf('entry', { ...EMPTY_APP_ENV, directorChoreoGuid: 'director' });
    expect(nextChapter(chapters, chapters[0])?.id).toBe('direction');
    expect(nextChapter(chapters, chapters[1])).toBeNull();
    expect(nextChapter(chapters, null)).toBeNull();
  });

  it('reads the remembered answers by field key, list entries in order', () => {
    const answers = inventoryAnswers([
      { facetGuid: 'f1', label: 'Moderatorin', values: { 'moderator[0]': 'm1' } },
      { facetGuid: 'f2', label: 'Teilnehmende', values: { 'participants[0]': 'p1', 'participants[1]': 'p2' } },
      { facetGuid: 'f3', label: 'Angebot', values: { brief: '' } },
    ]);
    expect(answers).toEqual({ moderator: ['m1'], participants: ['p1', 'p2'] });
  });
});
