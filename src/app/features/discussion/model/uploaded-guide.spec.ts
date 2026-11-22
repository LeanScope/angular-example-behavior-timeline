import { INVENTORY_TYPE_GUID } from './guide-root';
import { toInventoryGuid, toUploadedGuide, type GuideGraphResult } from './uploaded-guide';

const question = (guid: string, line: string, description: string, key?: string) => ({
  guid,
  line,
  description,
  resourceRelationships_: key ? [{ parameters_: [{ value: key }] }] : [],
});

describe('toInventoryGuid', () => {
  it('picks the attached resource that IS the Inventory type', () => {
    const guid = toInventoryGuid({
      uxmData: {
        scenarios: [
          {
            resourceRelationships_: [
              { resource_: { guid: 'config', resourceRelationships_: [{ resourceRef: 'other-type' }] } },
              { resource_: { guid: 'inv', resourceRelationships_: [{ resourceRef: INVENTORY_TYPE_GUID.toUpperCase() }] } },
            ],
          },
        ],
      },
    });
    expect(guid).toBe('inv');
  });

  it('is null for a choreo without an Inventory', () => {
    expect(toInventoryGuid({ uxmData: { scenarios: [] } })).toBeNull();
  });
});

describe('toUploadedGuide', () => {
  it('groups the questions by section, in listIndex order, with their keys', () => {
    const data: GuideGraphResult = {
      uxmData: {
        resources: [
          {
            guid: 'root',
            line: 'Leitfaden Stadtwerke.docx',
            resourceRelationships_: [
              { listIndex: 2, resource_: question('q3', 'Was stört Sie?', 'Block B – Erwartungen (15 min)') },
              { listIndex: 0, resource_: question('q1', 'Wie geht es Ihnen?', 'Block A – Einstieg (10 min)', 'q_1a2b3c4d') },
              { listIndex: 1, resource_: question('q2', 'Seit wann sind Sie Kunde?', 'Block A – Einstieg (10 min)') },
            ],
          },
        ],
      },
    };
    const guide = toUploadedGuide(data);
    expect(guide?.title).toBe('Leitfaden Stadtwerke');
    expect(guide?.blocks.map((b) => [b.title, b.minutes])).toEqual([
      ['Einstieg', 10],
      ['Erwartungen', 15],
    ]);
    expect(guide?.blocks[0].questions.map((q) => [q.key, q.text])).toEqual([
      ['q_1a2b3c4d', 'Wie geht es Ihnen?'],
      ['q2', 'Seit wann sind Sie Kunde?'],
    ]);
  });

  it('takes the lettered sections as blocks with their minutes, and what lies beneath as subsections', () => {
    const data: GuideGraphResult = {
      uxmData: {
        resources: [
          {
            guid: 'root',
            line: 'Leitfaden.docx',
            resourceRelationships_: [
              { listIndex: 0, resource_: question('q1', 'Wie lange schon Kunde?', 'A. Begrüßung (10 min) / 1.5. Vorstellung der Teilnehmenden') },
              { listIndex: 1, resource_: question('q2', 'Was fällt Ihnen ein?', 'B. Marke (20 min) / 2.1. Assoziationen') },
              { listIndex: 2, resource_: question('q3', 'Wofür stehen sie?', 'B. Marke (20 min) / 2.2. Stärken/Schwächen') },
              { listIndex: 3, resource_: question('q4', 'Was schätzen Sie?', 'B. Marke (20 min) / 2.2. Stärken/Schwächen') },
            ],
          },
        ],
      },
    };
    const guide = toUploadedGuide(data)!;
    expect(guide.blocks.map((b) => [b.code, b.title, b.minutes])).toEqual([
      ['A', 'Begrüßung', 10],
      ['B', 'Marke', 20],
    ]);
    expect(guide.blocks[1].questions.map((q) => q.section)).toEqual([
      '2.1. Assoziationen',
      '2.2. Stärken/Schwächen',
      '2.2. Stärken/Schwächen',
    ]);
  });

  it('does not take a document title every question sits under for a block', () => {
    const data: GuideGraphResult = {
      uxmData: {
        resources: [
          {
            guid: 'root',
            line: 'guide.md',
            resourceRelationships_: [
              { listIndex: 0, resource_: question('q1', 'Wie geht es?', 'Interviewleitfaden / Einstieg') },
              { listIndex: 1, resource_: question('q2', 'Was nutzen Sie?', 'Interviewleitfaden / Aktuelle Nutzung') },
            ],
          },
        ],
      },
    };
    expect(toUploadedGuide(data)!.blocks.map((b) => b.title)).toEqual(['Einstieg', 'Aktuelle Nutzung']);
  });

  it('is null while the worker has written no root or no questions', () => {
    expect(toUploadedGuide({ uxmData: { resources: [] } })).toBeNull();
    expect(toUploadedGuide({ uxmData: { resources: [{ guid: 'root', line: 'x', resourceRelationships_: [] }] } })).toBeNull();
  });
});
