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

  it('is null while the worker has written no root or no questions', () => {
    expect(toUploadedGuide({ uxmData: { resources: [] } })).toBeNull();
    expect(toUploadedGuide({ uxmData: { resources: [{ guid: 'root', line: 'x', resourceRelationships_: [] }] } })).toBeNull();
  });
});
