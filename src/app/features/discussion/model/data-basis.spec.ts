import { basisFileRefs, toDataBasis, withFileNames } from './data-basis';

const input = (guid: string, key: string, fileRefs: string[]) => ({
  resource_: { guid, fileRefs, parameters: [{ key, value: '"…"' }] },
});

const result = {
  uxmData: {
    scenarios: [
      {
        resourceRelationships_: [
          { resource_: { resourceRelationships_: [] } },
          {
            resource_: {
              resourceRelationships_: [
                input('in-brief', 'brief', ['f1']),
                input('in-stimuli', 'stimuli', ['f2', 'f3']),
                input('in-moderator', 'moderator[0]', []),
                { resource_: null },
              ],
            },
          },
        ],
      },
    ],
  },
};

describe('data basis', () => {
  it('reads the stored documents by the zone they were handed over at', () => {
    const basis = toDataBasis(result);
    expect(Object.keys(basis)).toEqual(['study-brief', 'stimulus']);
    expect(basis.stimulus?.map((f) => [f.resourceRef, f.fileRef])).toEqual([
      ['in-stimuli', 'f2'],
      ['in-stimuli', 'f3'],
    ]);
    expect(basisFileRefs(basis)).toEqual(['f1', 'f2', 'f3']);
  });

  it('names the files, and a file the repository does not name', () => {
    const named = withFileNames(toDataBasis(result), {
      uxmData: { files: [{ guid: 'f1', name: 'Angebot.docx', mimeType: 'application/msword' }, { guid: 'f2', name: 'K1.png', mimeType: 'image/png' }] },
    });
    expect(named['study-brief']?.[0]).toMatchObject({ name: 'Angebot.docx', mimeType: 'application/msword' });
    expect(named.stimulus?.map((f) => f.name)).toEqual(['K1.png', 'Datei']);
  });

  it('is empty for a choreo without stored answers', () => {
    expect(toDataBasis({})).toEqual({});
  });
});
