import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { PendingQuestion, Step } from '../../../leanscope/agent-server.types';
import { APP_ENV, EMPTY_APP_ENV } from '../../app-env';
import { ANALYSIS_SESSION_FACTORY, AnalysisService } from './analysis.service';
import { exchangesFromSteps } from './session-exchanges';

const agent = (guid: string, line: string, pred: string[] = []): Step =>
  ({ guid, line, actorSymbolRef: 'ada', predecessorRefs: pred }) as unknown as Step;
const human = (guid: string, message: string, pred: string[] = []): Step =>
  ({
    guid,
    line: message ? JSON.stringify({ message }) : '',
    actorSymbolRef: 'human',
    predecessorRefs: pred,
  }) as unknown as Step;

const ANSWER =
  'Die zweite Linie gewinnt.\n```finding\n' +
  JSON.stringify({ v: 1, title: 'Favorit', takeaway: 'K2 vorn.', chart: null, evidence: [], sources: [] }) +
  '\n```';

describe('exchangesFromSteps', () => {
  it('pairs each question with the answer before the next question, skipping the greeting', () => {
    const steps = [
      agent('g', 'Hallo, was möchten Sie wissen?'),
      human('h1', 'Welche Kampagne?', ['g']),
      agent('a1', ANSWER, ['h1']),
      human('h2', '', ['a1']),
    ];
    const view = exchangesFromSteps(steps, 'h2');
    expect(view.exchanges).toEqual([{ id: 'h1', question: 'Welche Kampagne?', answer: ANSWER }]);
    expect(view.thinking).toBeNull();
  });

  it('reports the last question as thinking until its answer arrives', () => {
    const steps = [agent('g', 'Hallo'), human('h1', 'Welche Kampagne?', ['g'])];
    expect(exchangesFromSteps(steps, null).thinking?.question).toBe('Welche Kampagne?');
  });
});

describe('AnalysisService', () => {
  function setup(guid = 'choreo') {
    const steps = signal<Step[]>([]);
    const state = signal('idle');
    const pending = signal<PendingQuestion | null>(null);
    const session = {
      steps,
      state,
      pendingQuestion: pending,
      error: signal<string | null>(null),
      start: vi.fn(async () => state.set('working')),
      submit: vi.fn(async () => {
        state.set('working');
        return true;
      }),
      stop: vi.fn(),
      onFrame: vi.fn(() => () => undefined),
    };
    TestBed.configureTestingModule({
      providers: [
        AnalysisService,
        { provide: APP_ENV, useValue: { ...EMPTY_APP_ENV, analysisChoreoGuid: guid } },
        { provide: ANALYSIS_SESSION_FACTORY, useValue: () => session },
      ],
    });
    return { service: TestBed.inject(AnalysisService), session, steps, state, pending };
  }

  it('does nothing without a choreo guid', () => {
    const { service, session } = setup('');
    service.start();
    expect(service.configured).toBe(false);
    expect(session.start).not.toHaveBeenCalled();
  });

  it('waits until the session asks, submits the message and parses the answer', async () => {
    const { service, session, steps, state, pending } = setup();
    const asked = service.ask('Welche Kampagne?');
    // Shown right away, before the session holds the question.
    expect(service.entries()).toEqual([{ id: 'sent', question: 'Welche Kampagne?', answer: null }]);
    expect(session.start).toHaveBeenCalledWith({ choreoScenarioGuid: 'choreo' });

    pending.set({ guid: 'h1', fieldKeys: ['message'], required: ['message'] });
    state.set('asking');
    expect(await asked).toBe(true);
    expect(session.submit).toHaveBeenCalledWith({ message: 'Welche Kampagne?' });
    expect(service.busy()).toBe(true);

    steps.set([
      agent('g', 'Hallo'),
      human('h1', 'Welche Kampagne?', ['g']),
      agent('a1', ANSWER, ['h1']),
      human('h2', '', ['a1']),
    ]);
    pending.set({ guid: 'h2', fieldKeys: ['message'], required: ['message'] });
    state.set('asking');
    const [entry] = service.entries();
    expect(service.entries()).toHaveLength(1);
    expect(entry.answer?.finding?.takeaway).toBe('K2 vorn.');
    expect(entry.answer?.text).toBe('Die zweite Linie gewinnt.');
    expect(service.busy()).toBe(false);
  });
});
