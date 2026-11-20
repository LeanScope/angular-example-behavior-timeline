import type { PendingQuestion, Step } from '../../../leanscope/agent-server.types';
import { castFromSlots, personaAnswer, personaChoices, slotOf, withRememberedCast } from './slots';

/** One facet behind several slots: only the key tells them apart. */
const DOCUMENT_FACET = 'f9c9d201-8669-46ce-9fb4-bcbdcbbdeb14';
const ENTITY_REF_FACET = '4be49876-f43a-4322-bef8-1ce564568c81';
const MAREN = '11111111-1111-4111-8111-111111111111';
const SANDRA = '22222222-2222-4222-8222-222222222222';
const KLAUS = '33333333-3333-4333-8333-333333333333';

const question = (patch: Partial<PendingQuestion>): PendingQuestion => ({
  guid: 'q',
  fieldKeys: [],
  required: [],
  ...patch,
});

const envelope = (facet: string, key: string | null) =>
  JSON.stringify({
    type: 'tool_input_schema',
    toolName: `__facet_${facet}__`,
    schema: key ? { type: 'object', properties: { [key]: { type: 'string' } } } : { type: 'string' },
  });

const step = (guid: string, line: string, questions: string | null = null, pending = false): Step => ({
  action: 'UPDATE',
  guid,
  scenarioGuid: 's',
  listIndex: null,
  title: null,
  line,
  actorSymbolRef: 'human',
  predecessorRefs: null,
  questions,
  actions: null,
  pending,
});

describe('slotOf', () => {
  it('finds the place by the field key, whatever facet is behind it', () => {
    expect(slotOf(question({ facetGuid: DOCUMENT_FACET, fieldKeys: ['document'] }))).toEqual({
      kind: 'zone',
      zone: 'interview-guide',
    });
    expect(slotOf(question({ facetGuid: DOCUMENT_FACET, fieldKeys: ['screener'] }))).toEqual({
      kind: 'zone',
      zone: 'screener',
    });
    expect(slotOf(question({ fieldKeys: ['participants'] }))).toEqual({ kind: 'cast', role: 'participants' });
  });

  it('reads the keys from the schema when fieldKeys are empty', () => {
    expect(slotOf(question({ schema: { properties: { stimuli: { type: 'string' } } } }))).toEqual({
      kind: 'zone',
      zone: 'stimulus',
    });
  });

  it('knows no place for other keys or forms with several fields', () => {
    expect(slotOf(question({ fieldKeys: ['message'] }))).toBeNull();
    expect(slotOf(question({ fieldKeys: ['document', 'screener'] }))).toBeNull();
    expect(slotOf(null)).toBeNull();
  });
});

describe('personaAnswer / personaChoices', () => {
  it('answers a single persona with its guid and lists the offered ones', () => {
    const q = question({
      fieldKeys: ['moderator'],
      schema: {
        properties: {
          moderator: { type: 'string', format: 'uuid', oneOf: [{ const: MAREN, title: 'Maren' }] },
        },
      },
    });
    expect(personaAnswer(q, [MAREN])).toEqual({ moderator: MAREN });
    expect(personaChoices(q)).toEqual([{ guid: MAREN, label: 'Maren' }]);
  });

  it('answers several personas as entity refs when the items are objects', () => {
    const q = question({
      fieldKeys: ['participants'],
      schema: {
        properties: {
          participants: {
            type: 'array',
            items: { type: 'object', properties: { _guid: { type: 'string', format: 'uuid' } } },
          },
        },
      },
    });
    expect(personaAnswer(q, [SANDRA, KLAUS])).toEqual({
      participants: [{ _guid: SANDRA }, { _guid: KLAUS }],
    });
    expect(personaChoices(q)).toBeNull();
  });
});

describe('castFromSlots', () => {
  it('takes the moderator and the participants from the answered cast slots', () => {
    const cast = castFromSlots([
      step('d', '{"document":"https://files/guide.md"}', envelope(DOCUMENT_FACET, 'document')),
      step('m', JSON.stringify({ moderator: MAREN }), envelope(ENTITY_REF_FACET, 'moderator')),
      // A bare leaf schema: the answer's key names the slot.
      step('p', JSON.stringify({ participants: [{ _guid: SANDRA }, { _guid: KLAUS }] }), envelope(ENTITY_REF_FACET, null)),
    ]);
    expect(cast).toEqual({
      slotted: true,
      moderator: MAREN,
      participants: [SANDRA, KLAUS],
      answered: { moderator: true, participants: true },
    });
  });

  it('is slotted but empty while a cast slot is still asked', () => {
    const cast = castFromSlots([step('m', '', envelope(ENTITY_REF_FACET, 'moderator'), true)]);
    expect(cast.slotted).toBe(true);
    expect(cast.moderator).toBeNull();
    expect(cast.answered.moderator).toBe(false);
  });

  it('is not slotted for a session without known slots', () => {
    expect(castFromSlots([step('a', 'Hallo')]).slotted).toBe(false);
  });
});

describe('castFromSlots with a review line', () => {
  it('reads the picks from the review\'s data, not the personas its schema offered', () => {
    const offered = [MAREN, SANDRA, KLAUS].map((guid) => ({ const: guid, title: guid }));
    const step = {
      action: 'UPDATE',
      guid: 's',
      scenarioGuid: 'x',
      listIndex: null,
      title: null,
      actorSymbolRef: 'human',
      predecessorRefs: null,
      actions: null,
      questions: JSON.stringify({
        type: 'tool_input_schema',
        schema: { properties: { participants: { type: 'array', items: { type: 'string', oneOf: offered } } } },
      }),
      line: JSON.stringify({
        kind: 'review',
        schema: { properties: { participants: { type: 'array', items: { type: 'string', oneOf: offered } } } },
        data: { participants: [SANDRA] },
      }),
    } as Step;
    const cast = castFromSlots([step]);
    expect(cast.participants).toEqual([SANDRA]);
    expect(cast.answered.participants).toBe(true);
  });
});

describe('withRememberedCast', () => {
  const m = '11111111-1111-4111-8111-111111111111';
  const p1 = '22222222-2222-4222-8222-222222222222';
  const p2 = '33333333-3333-4333-8333-333333333333';
  const open = castFromSlots([]);

  it('takes the roles the session does not answer from the remembered answers', () => {
    const cast = withRememberedCast(open, { moderator: [`"${m}"`], participants: [p1, p2, p1] }, null);
    expect(cast).toEqual({
      slotted: true,
      moderator: m,
      participants: [p1, p2],
      answered: { moderator: true, participants: true },
    });
  });

  it('takes a persona\'s guid, not a guid inside its portrait URL', () => {
    const cast = withRememberedCast(
      open,
      { participants: [{ _guid: p1, imageUrl: `https://x.example/media/${m}?size=s` }, `["${p2}"]`] },
      null,
    );
    expect(cast.participants).toEqual([p1, p2]);
  });

  it('leaves a role open while the session asks for it, and keeps the session\'s own answers', () => {
    const asked = withRememberedCast(open, { moderator: [m], participants: [p1] }, 'moderator');
    expect(asked.moderator).toBeNull();
    expect(asked.answered).toEqual({ moderator: false, participants: true });

    const own = { ...open, slotted: true, moderator: p2, answered: { moderator: true, participants: false } };
    expect(withRememberedCast(own, { moderator: [m] }, null)).toBe(own);
  });
});
