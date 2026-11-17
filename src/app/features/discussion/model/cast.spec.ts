import type { ActorRef, Step } from '../../../leanscope/agent-server.types';
import { castFromSession } from './cast';

const step = (guid: string, actor: string, line: string, extra: Partial<Step> = {}): Step => ({
  action: 'CREATE',
  guid,
  scenarioGuid: 's',
  listIndex: null,
  title: null,
  line,
  actorSymbolRef: actor,
  predecessorRefs: null,
  questions: null,
  actions: null,
  ...extra,
});

const actors: ActorRef[] = [
  { guid: 'maren', name: 'Maren', imageUrl: 'https://img/maren.png' },
  { guid: 'tom', name: 'Tom (14%)', imageUrl: 'https://img/tom.png' },
  { guid: 'karl', name: 'Karl (17%)' },
  { guid: 'stefan', name: 'Stefan (12%)' },
];

describe('castFromSession', () => {
  it('takes the first speaker as moderator and the others as participants, in order', () => {
    const cast = castFromSession(
      [
        step('1', 'maren', 'Willkommen!'),
        step('2', 'karl', 'Hallo.'),
        step('3', 'tom', 'Hi.'),
        step('4', 'maren', 'Erste Frage …'),
        step('5', 'karl', 'Noch mal ich.'),
      ],
      actors,
    );
    expect(cast.moderator).toEqual({ guid: 'maren', name: 'Maren', imageUrl: 'https://img/maren.png' });
    expect(cast.participants.map((p) => [p.guid, p.name, p.imageUrl])).toEqual([
      ['karl', 'Karl (17%)', undefined],
      ['tom', 'Tom (14%)', 'https://img/tom.png'],
    ]);
    expect(cast.participants[1]).toMatchObject({ initials: expect.any(String), filled: true });
  });

  it('skips the human, pending, empty and JSON steps', () => {
    const cast = castFromSession(
      [
        step('0', 'human', 'Start'),
        step('1', 'stefan', '', {}),
        step('2', 'stefan', 'later', { pending: true }),
        step('3', 'karl', '{"kind":"review"}'),
        step('4', 'maren', 'Willkommen!'),
        step('5', 'tom', 'Hi.'),
      ],
      actors,
    );
    expect(cast.moderator?.guid).toBe('maren');
    expect(cast.participants.map((p) => p.guid)).toEqual(['tom']);
  });

  it('names a speaker missing from the roster by the step title, and uses actorGuid first', () => {
    const cast = castFromSession(
      [
        step('1', 'maren', 'Willkommen!'),
        step('2', 'ignored', 'Hallo.', { actorGuid: 'eva', title: 'Eva' }),
      ],
      [],
    );
    expect(cast.moderator).toEqual({ guid: 'maren', name: 'Unbekannt', imageUrl: null });
    expect(cast.participants.map((p) => [p.guid, p.name])).toEqual([['eva', 'Eva']]);
  });

  it('leaves the known participants out and takes the first other speaker as moderator', () => {
    const cast = castFromSession(
      [step('1', 'tom', 'Ich zuerst.'), step('2', 'maren', 'Willkommen!'), step('3', 'karl', 'Hallo.')],
      actors,
      new Set(['tom', 'karl']),
    );
    expect(cast.moderator?.guid).toBe('maren');
    expect(cast.participants).toEqual([]);
  });

  it('has no moderator before anyone spoke', () => {
    expect(castFromSession([], actors)).toEqual({ moderator: null, participants: [] });
  });
});
