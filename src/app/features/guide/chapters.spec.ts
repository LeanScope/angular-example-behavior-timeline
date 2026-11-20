import { EMPTY_APP_ENV } from '../app-env';
import { guideChoreos, inventoryAnswers, nextChoreo } from './chapters';

describe('the guide\'s choreos', () => {
  it('lists the configured choreos in order and leaves out one without a guid', () => {
    expect(guideChoreos(' entry ', EMPTY_APP_ENV)).toEqual(['entry']);
    expect(guideChoreos('entry', { ...EMPTY_APP_ENV, directorChoreoGuid: 'director' })).toEqual(['entry', 'director']);
    expect(guideChoreos('', EMPTY_APP_ENV)).toEqual([]);
  });

  it('names the choreo after the current one', () => {
    const choreos = ['entry', 'director'];
    expect(nextChoreo(choreos, 'entry')).toBe('director');
    expect(nextChoreo(choreos, 'director')).toBeNull();
    expect(nextChoreo(choreos, 'other')).toBeNull();
    expect(nextChoreo(choreos, null)).toBeNull();
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
