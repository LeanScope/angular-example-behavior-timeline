import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { RepositoryResourcesService } from '../../../leanscope/repository-resources.service';
import type { PendingQuestion } from '../../../leanscope/agent-server.types';
import { GuideService } from '../../guide/guide.service';
import { DiscussionUiState } from './discussion-ui.state';
import { DiscussionService } from './discussion.service';
import { SlotService } from './slot.service';

const fileQuestion = (guid: string, key: string): PendingQuestion => ({
  guid,
  question: 'An welchem Skript soll ich mich orientieren?',
  fieldKeys: [key],
  required: [],
  schema: { properties: { [key]: { type: 'string', format: 'data-url' } } },
});

/**
 * A session that asks `asks` in order: an answer moves on to the next question, an undo back to
 * the one before (asked anew, under a new guid, as the server does).
 */
function setup(asks: PendingQuestion[] = [], claims: Record<string, string[]> = {}) {
  const pendingQuestion = signal<PendingQuestion | null>(null);
  let at = -1;
  let round = 0;
  const ask = (index: number) => {
    at = index;
    const question = asks[index];
    pendingQuestion.set(question ? { ...question, guid: `${question.guid}#${++round}` } : null);
  };
  const session = {
    pendingQuestion,
    session: signal<unknown>({ sessionToken: 'tok' }),
    error: signal<string | null>(null),
    parkFile: vi.fn((file: File) => `pending://1/${file.name}`),
    submit: vi.fn(async (_answer: Record<string, unknown>) => {
      if (asks.length) ask(at + 1);
      else pendingQuestion.set(null);
      return true;
    }),
    undo: vi.fn(async () => {
      if (at <= 0) return false;
      ask(at - 1);
      return true;
    }),
  };
  const castDraft = signal<{ moderator: string | null; participants: string[] }>({ moderator: null, participants: [] });
  const discussion = {
    session,
    castDraft,
    submitCast: vi.fn(async (role: string) =>
      session.submit(role === 'moderator' ? { moderator: castDraft().moderator } : { participants: castDraft().participants }),
    ),
  };
  const navigate = vi.fn(async () => true);
  const noteFiles = vi.fn();
  const query = vi.fn(async (_doc: string, variables: { facets: string[] }) => ({
    uxmData: {
      resourceRelationships: variables.facets.flatMap((owner) =>
        (claims[owner] ?? []).map((resourceRef) => ({ ownerRef: owner, resourceRef })),
      ),
    },
  }));
  TestBed.configureTestingModule({
    providers: [
      SlotService,
      DiscussionUiState,
      { provide: DiscussionService, useValue: discussion },
      { provide: Router, useValue: { navigate } },
      { provide: RepositoryResourcesService, useValue: { available: true, query } },
      { provide: GuideService, useValue: { noteFiles } },
    ],
  });
  const slots = TestBed.inject(SlotService);
  const ui = TestBed.inject(DiscussionUiState);
  const start = () => {
    ask(0);
    TestBed.tick();
  };
  return { slots, ui, session, discussion, castDraft, pendingQuestion, navigate, noteFiles, start };
}

const file = (name: string) => new File(['x'], name);

describe('SlotService', () => {
  it('goes to the place of an asked slot and highlights it', () => {
    const { ui, pendingQuestion, navigate } = setup();
    pendingQuestion.set(fileQuestion('q1', 'document'));
    TestBed.tick();
    expect(ui.askedPlace()).toBe('interview-guide');
    expect(navigate).toHaveBeenCalledWith([], { queryParams: { view: null }, queryParamsHandling: 'merge' });

    pendingQuestion.set({ guid: 'q2', fieldKeys: ['moderator'], required: [] });
    TestBed.tick();
    expect(ui.askedPlace()).toBe('moderator');
    expect(navigate).toHaveBeenLastCalledWith([], { queryParams: { view: 'discussion' }, queryParamsHandling: 'merge' });
  });

  it('answers the asked slot with a file dropped on its zone', async () => {
    const { slots, session, pendingQuestion } = setup();
    pendingQuestion.set(fileQuestion('q1', 'document'));
    TestBed.tick();

    slots.drop('interview-guide', [file('leitfaden.md')]);
    await vi.waitFor(() => expect(slots.jobsOf('interview-guide')[0]?.state).toBe('done'));
    expect(session.submit).toHaveBeenCalledWith({ document: 'pending://1/leitfaden.md' });
  });

  it('holds a file dropped early and hands it over when its slot is asked, without going there', async () => {
    const { slots, session, pendingQuestion, navigate } = setup();
    slots.drop('screener', [file('screener.xlsx')]);
    expect(slots.jobsOf('screener')[0].message).toContain('sobald danach gefragt');
    expect(session.submit).not.toHaveBeenCalled();

    pendingQuestion.set(fileQuestion('q3', 'screener'));
    TestBed.tick();
    await vi.waitFor(() => expect(session.submit).toHaveBeenCalledWith({ screener: 'pending://1/screener.xlsx' }));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('goes to the timeline for the director\'s instruction, whatever else its form asks for', () => {
    const { ui, pendingQuestion, navigate } = setup();
    pendingQuestion.set({ guid: 'q5', fieldKeys: ['leadActor', 'innerVoice', 'conversation'], required: [] });
    TestBed.tick();
    expect(ui.askedPlace()).toBe('director');
    expect(navigate).toHaveBeenLastCalledWith([], { queryParams: { view: 'discussion' }, queryParamsHandling: 'merge' });
  });

  it('skips an asked document that is optional, with an empty answer', async () => {
    const { slots, session, pendingQuestion } = setup();
    pendingQuestion.set(fileQuestion('q6', 'screener'));
    TestBed.tick();
    expect(slots.askedOptional()).toBe(true);
    expect(await slots.skip()).toBe(true);
    expect(session.submit).toHaveBeenCalledWith({});
  });

  it('offers no skip for a required document, nor for the cast', async () => {
    const { slots, session, pendingQuestion } = setup();
    pendingQuestion.set({ ...fileQuestion('q7', 'brief'), required: ['brief'] });
    TestBed.tick();
    expect(slots.askedOptional()).toBe(false);
    expect(await slots.skip()).toBe(false);

    pendingQuestion.set({ guid: 'q8', fieldKeys: ['participants'], required: [] });
    TestBed.tick();
    expect(slots.askedOptional()).toBe(false);
    expect(session.submit).not.toHaveBeenCalled();
  });

  it('does nothing for questions the app has no place for', () => {
    const { ui, pendingQuestion, navigate } = setup();
    pendingQuestion.set({ guid: 'q4', fieldKeys: ['message'], required: [] });
    TestBed.tick();
    expect(ui.askedPlace()).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  describe('going back', () => {
    const optional = (key: string, facetGuid: string): PendingQuestion => ({ ...fileQuestion(key, key), facetGuid });
    const required = (key: string, facetGuid: string): PendingQuestion => ({ ...optional(key, facetGuid), required: [key] });
    const cast = (key: string, facetGuid: string): PendingQuestion => ({ guid: key, fieldKeys: [key], required: [key], facetGuid });
    const settled = () => vi.waitFor(() => TestBed.tick());
    /** Answers brief, document (both required), skips the screener, gives stimuli and the moderator. */
    async function answered(claims: Record<string, string[]> = {}) {
      const s = setup(
        [required('brief', 'f-brief'), required('document', 'f-doc'), optional('screener', 'f-screener'), optional('stimuli', 'f-stimuli'), cast('moderator', 'f-mod'), cast('participants', 'f-part')],
        claims,
      );
      s.start();
      s.slots.drop('study-brief', [file('angebot.docx')]);
      await vi.waitFor(() => expect(s.pendingQuestion()?.fieldKeys).toEqual(['document']));
      TestBed.tick();
      s.slots.drop('interview-guide', [file('leitfaden.docx')]);
      await vi.waitFor(() => expect(s.pendingQuestion()?.fieldKeys).toEqual(['screener']));
      TestBed.tick();
      expect(await s.slots.skip()).toBe(true);
      TestBed.tick();
      s.slots.drop('stimulus', [file('k1.png')]);
      await vi.waitFor(() => expect(s.pendingQuestion()?.fieldKeys).toEqual(['moderator']));
      TestBed.tick();
      s.castDraft.set({ moderator: 'm1', participants: [] });
      expect(await s.slots.submitCast('moderator')).toBe(true);
      TestBed.tick();
      expect(s.pendingQuestion()?.fieldKeys).toEqual(['participants']);
      s.session.submit.mockClear();
      return s;
    }

    it('undoes back to the removed required answer and gives the later ones again by itself', async () => {
      const s = await answered();
      const removal = s.slots.remove({ kind: 'zone', zone: 'interview-guide' });
      await vi.waitFor(() => expect(s.pendingQuestion()?.fieldKeys).toEqual(['document']));
      expect(await removal).toBe(true);
      expect(s.session.undo).toHaveBeenCalledTimes(4);
      TestBed.tick();
      // Only the removed slot is asked: nothing is given until the user answers it.
      expect(s.session.submit).not.toHaveBeenCalled();
      expect(s.slots.jobsOf('interview-guide')).toEqual([]);
      expect(s.noteFiles).toHaveBeenCalledWith('interview-guide', null);

      s.slots.drop('interview-guide', [file('leitfaden-v2.docx')]);
      await vi.waitFor(async () => {
        TestBed.tick();
        expect(s.pendingQuestion()?.fieldKeys).toEqual(['participants']);
      });
      expect(s.session.submit.mock.calls.map(([answer]) => answer)).toEqual([
        { document: 'pending://1/leitfaden-v2.docx' },
        {},
        { stimuli: 'pending://1/k1.png' },
        { moderator: 'm1' },
      ]);
    });

    it('does not ask again for a removed optional answer', async () => {
      const s = await answered();
      expect(await s.slots.remove({ kind: 'zone', zone: 'stimulus' })).toBe(true);
      expect(s.session.undo).toHaveBeenCalledTimes(2);
      await vi.waitFor(async () => {
        TestBed.tick();
        expect(s.session.submit.mock.calls.map(([answer]) => answer)).toEqual([{}, { moderator: 'm1' }]);
      });
      expect(s.pendingQuestion()?.fieldKeys).toEqual(['participants']);
      expect(s.slots.handed().get('stimulus')).toBeUndefined();
    });

    it('does not remove an answer others rest on, until they are removed too', async () => {
      const s = await answered({ 'f-doc': ['f-mod'] });
      expect(await s.slots.remove({ kind: 'zone', zone: 'interview-guide' })).toBe(false);
      expect(s.session.undo).not.toHaveBeenCalled();
      expect(s.slots.blocked()).toEqual({
        place: 'interview-guide',
        dependents: ['moderator'],
        message: 'Der Leitfaden kann nicht entfernt werden, solange die Moderation darauf beruht.',
      });

      const removal = s.slots.removeWithDependents();
      await vi.waitFor(() => expect(s.pendingQuestion()?.fieldKeys).toEqual(['document']));
      expect(await removal).toBe(true);
      expect(s.slots.blocked()).toBeNull();
      s.slots.drop('interview-guide', [file('leitfaden-v2.docx')]);
      // The moderator was removed with it: it is asked again, not given again.
      await vi.waitFor(async () => {
        TestBed.tick();
        expect(s.pendingQuestion()?.fieldKeys).toEqual(['moderator']);
      });
      await settled();
      expect(s.session.submit.mock.calls.map(([answer]) => answer)).toEqual([
        { document: 'pending://1/leitfaden-v2.docx' },
        {},
        { stimuli: 'pending://1/k1.png' },
      ]);
    });

    it('takes the answer away that a file line\'s × belongs to', async () => {
      const s = await answered();
      const line = s.slots.jobsOf('stimulus')[0];
      s.slots.dismiss(line.id);
      await vi.waitFor(async () => {
        TestBed.tick();
        expect(s.session.undo).toHaveBeenCalledTimes(2);
        expect(s.slots.jobsOf('stimulus')).toEqual([]);
        expect(s.session.submit).toHaveBeenCalledTimes(2);
      });
    });
  });
});
