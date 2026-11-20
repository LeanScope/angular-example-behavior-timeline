import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import type { PendingQuestion } from '../../../leanscope/agent-server.types';
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

function setup() {
  const pendingQuestion = signal<PendingQuestion | null>(null);
  const session = {
    pendingQuestion,
    session: signal<unknown>({ sessionToken: 'tok' }),
    error: signal<string | null>(null),
    parkFile: vi.fn((file: File) => `pending://1/${file.name}`),
    submit: vi.fn(async () => {
      pendingQuestion.set(null);
      return true;
    }),
  };
  const navigate = vi.fn(async () => true);
  TestBed.configureTestingModule({
    providers: [
      SlotService,
      DiscussionUiState,
      { provide: DiscussionService, useValue: { session } },
      { provide: Router, useValue: { navigate } },
    ],
  });
  const slots = TestBed.inject(SlotService);
  const ui = TestBed.inject(DiscussionUiState);
  return { slots, ui, session, pendingQuestion, navigate };
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
});
