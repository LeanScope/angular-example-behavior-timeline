import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type {
  EndReason,
  SessionResponse,
  SseFrame,
} from '../../leanscope/agent-server.types';
import { LEANSCOPE_CONFIG } from '../../leanscope/leanscope.config';
import type { SessionState } from '../../leanscope/leanscope-session.service';
import { SupportWidget } from '../../leanscope/ui/support-widget';
import { APP_ENV, EMPTY_APP_ENV } from '../app-env';
import { GUIDE_SESSION_FACTORY, GuideService } from './guide.service';

function setup(options: { director?: string; gone?: string } = {}) {
  const state = signal<SessionState>('idle');
  const endReason = signal<EndReason | null>(null);
  const sessionOf = signal<SessionResponse | null>(null);
  const listeners: ((frame: SseFrame) => void)[] = [];
  let started = 0;
  const session = {
    state,
    endReason,
    session: sessionOf,
    pendingQuestion: signal(null),
    start: vi.fn(async (overrides?: { choreoScenarioGuid?: string; sessionScenarioGuid?: string }) => {
      started += 1;
      if (options.gone && overrides?.sessionScenarioGuid === options.gone) {
        state.set('error');
        sessionOf.set(null);
        return;
      }
      state.set('working');
      endReason.set(null);
      sessionOf.set({
        sessionId: '',
        sessionScenarioGuid: overrides?.sessionScenarioGuid ?? `scenario-${started}`,
        sessionToken: `tok-${started}`,
        controllerUrl: '',
        uiUrl: 'https://ui.example/?theme=mindline&themeMode=follow',
        markdown: '',
      });
    }),
    attach: vi.fn(async (token: string) => {
      state.set('waiting');
      sessionOf.set({ sessionId: '', sessionScenarioGuid: '', sessionToken: token, controllerUrl: '', uiUrl: '', markdown: '' });
      return true;
    }),
    sessionConfig: vi.fn(async () => ({ choreoScenarioGuid: 'entry' })),
    begin: vi.fn(async () => undefined),
    stop: vi.fn(() => {
      state.set('idle');
      sessionOf.set(null);
    }),
    onFrame: vi.fn((listener: (frame: SseFrame) => void) => {
      listeners.push(listener);
      return () => undefined;
    }),
  };
  const widget = { available: true, show: vi.fn(), hide: vi.fn(), anchorTo: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: GUIDE_SESSION_FACTORY, useValue: () => session },
      { provide: SupportWidget, useValue: widget },
      { provide: LEANSCOPE_CONFIG, useValue: { choreoScenarioGuid: 'entry', repositoryId: '1', agentServerUrl: 'https://server.example' } },
      { provide: APP_ENV, useValue: { ...EMPTY_APP_ENV, directorChoreoGuid: options.director ?? 'director' } },
    ],
  });
  const guide = TestBed.inject(GuideService);
  const end = (reason: EndReason) => {
    endReason.set(reason);
    state.set('ended');
    TestBed.tick();
  };
  const frame = (event: string, data: unknown) => listeners.forEach((l) => l({ event, data }));
  return { guide, session, widget, end, frame };
}

describe('GuideService', () => {
  beforeEach(() => localStorage.clear());

  it('starts with the first choreo and shows its chat in the widget', async () => {
    const { guide, session, widget } = setup();
    await guide.start();
    TestBed.tick();
    expect(session.start).toHaveBeenCalledWith({ choreoScenarioGuid: 'entry' });
    expect(guide.choreo()).toBe('entry');
    expect(widget.show).toHaveBeenLastCalledWith('tok-1', {
      theme: 'mindline',
      themeMode: 'follow',
      hostSlots: ['brief', 'document', 'screener', 'stimuli', 'moderator', 'participants'],
    });
  });

  it('goes on to the next choreo when one reaches its authored end, and the widget follows', async () => {
    const { guide, session, widget, end } = setup();
    await guide.start();
    end('terminal');
    await vi.waitFor(() => expect(session.start).toHaveBeenLastCalledWith({ choreoScenarioGuid: 'director' }));
    TestBed.tick();
    expect(guide.choreo()).toBe('director');
    expect(widget.show).toHaveBeenLastCalledWith('tok-2', expect.anything());

    // The last choreo's end starts nothing more.
    end('terminal');
    expect(session.start).toHaveBeenCalledTimes(2);
  });

  it('stays where it is when a choreo ends any other way, or is the last', async () => {
    const { guide, session, end } = setup();
    await guide.start();
    end('error');
    expect(session.start).toHaveBeenCalledTimes(1);

    TestBed.resetTestingModule();
    const alone = setup({ director: '' });
    await alone.guide.start();
    alone.end('terminal');
    expect(alone.session.start).toHaveBeenCalledTimes(1);
  });

  it('keeps what the Inventory remembers across choreos', async () => {
    const { guide, frame, end } = setup();
    await guide.start();
    frame('inventory', { rows: [{ facetGuid: 'f', label: 'Moderatorin', values: { 'moderator[0]': 'm1' } }] });
    expect(guide.answers()).toEqual({ moderator: ['m1'] });
    end('terminal');
    expect(guide.answers()).toEqual({ moderator: ['m1'] });
  });

  it('follows an attached session and knows which of its choreos it runs', async () => {
    const { guide, session, end } = setup();
    await guide.attach('given');
    expect(session.begin).toHaveBeenCalled();
    expect(guide.choreo()).toBe('entry');
    end('terminal');
    await vi.waitFor(() => expect(session.start).toHaveBeenCalledWith({ choreoScenarioGuid: 'director' }));
  });

  it('hides the widget while suppressed and without a session', async () => {
    const { guide, widget } = setup();
    await guide.start();
    TestBed.tick();
    widget.hide.mockClear();
    guide.suppress(true);
    TestBed.tick();
    expect(widget.hide).toHaveBeenCalled();
    guide.suppress(false);
    TestBed.tick();
    expect(widget.show).toHaveBeenLastCalledWith('tok-1', expect.anything());
    guide.stop();
    TestBed.tick();
    expect(guide.choreo()).toBeNull();
    expect(widget.anchorTo).toHaveBeenLastCalledWith(null);
  });

  it('anchors the widget to a place, and sends it home without one', async () => {
    const { guide, widget } = setup();
    const place = document.createElement('div');
    place.className = 'asked-place';
    document.body.appendChild(place);
    guide.anchor('.asked-place');
    expect(widget.anchorTo).toHaveBeenLastCalledWith(place);
    guide.anchor(null);
    expect(widget.anchorTo).toHaveBeenLastCalledWith(null);
    place.remove();
  });

  it('rejoins the session this browser remembers, of the choreo it ran', async () => {
    const first = setup();
    await first.guide.start();
    first.frame('inventory', { rows: [{ facetGuid: 'f', label: 'Teilnehmende', values: { 'participants[0]': 'p1' } }] });
    first.end('terminal');
    await vi.waitFor(() => expect(first.guide.choreo()).toBe('director'));
    expect(first.guide.pastFirst()).toBe(true);
    await vi.waitFor(() => expect(first.session.start).toHaveBeenCalledTimes(2));

    TestBed.resetTestingModule();
    const again = setup();
    await again.guide.start();
    expect(again.session.start).toHaveBeenCalledWith({ choreoScenarioGuid: 'director', sessionScenarioGuid: 'scenario-2' });
    expect(again.guide.choreo()).toBe('director');
    // What the first choreo was told is still known, though this session never heard it.
    expect(again.guide.answers()).toEqual({ participants: ['p1'] });
  });

  it('begins anew when the remembered session is gone, and on restart', async () => {
    const first = setup();
    await first.guide.start();

    TestBed.resetTestingModule();
    const gone = setup({ gone: 'scenario-1' });
    await gone.guide.start();
    expect(gone.session.start).toHaveBeenLastCalledWith({ choreoScenarioGuid: 'entry' });
    expect(gone.guide.choreo()).toBe('entry');

    TestBed.resetTestingModule();
    const fresh = setup();
    await fresh.guide.restart();
    expect(fresh.session.start).toHaveBeenCalledTimes(1);
    expect(fresh.session.start).toHaveBeenCalledWith({ choreoScenarioGuid: 'entry' });
  });
});
