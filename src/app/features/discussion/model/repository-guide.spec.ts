import { guideFromSources, toRepositoryGuide } from './repository-guide';

const rows = (...resources: { guid: string; line?: string; description?: string | null }[]) => ({ uxmData: { resources } });

describe('toRepositoryGuide', () => {
  it("reads the guide from the source's description, compared by guid without case", () => {
    const guide = toRepositoryGuide(
      rows({ guid: 'AC34FE04', line: 'Discussion Guide', description: '## A. Einstieg\n- Wie geht es Ihnen?' }),
      [{ resourceRef: 'ac34fe04', name: 'Discussion Guide' }],
    );
    expect(guide?.title).toBe('Discussion Guide');
    expect(guide?.blocks.map((b) => b.questions.map((q) => q.text))).toEqual([['Wie geht es Ihnen?']]);
  });

  it('takes the first source that has a text', () => {
    const guide = toRepositoryGuide(
      rows({ guid: 'g-1', line: 'Datei', description: null }, { guid: 'g-2', description: '# Zweiter\n- Frage?' }),
      [{ resourceRef: 'g-1' }, { resourceRef: 'g-2' }, { resourceRef: 'g-3' }],
    );
    expect(guide?.title).toBe('Zweiter');
  });

  it('gives none when no source has questions', () => {
    expect(toRepositoryGuide(rows({ guid: 'g-1', description: 'Nur Text.' }), [{ resourceRef: 'g-1' }])).toBeNull();
    expect(toRepositoryGuide(null, [{ resourceRef: 'g-1' }])).toBeNull();
    expect(toRepositoryGuide(rows(), [])).toBeNull();
  });
});

describe('guideFromSources', () => {
  it("reads the guide from a source's own text, without a query", () => {
    const guide = guideFromSources([
      { resourceRef: 'g-1', name: 'Ohne Text' },
      { resourceRef: 'g-2', name: 'Discussion Guide', text: '## A. Einstieg\n- Wie geht es Ihnen?' },
    ]);
    expect(guide?.title).toBe('Discussion Guide');
    expect(guide?.blocks.map((b) => b.questions.map((q) => q.text))).toEqual([['Wie geht es Ihnen?']]);
  });

  it('gives none when no source brings a text', () => {
    expect(guideFromSources([{ resourceRef: 'g-1', name: 'Datei' }])).toBeNull();
  });
});
