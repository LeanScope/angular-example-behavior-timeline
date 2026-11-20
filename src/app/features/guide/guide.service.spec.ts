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

function setup(options: { director?: string } = {}) {
  const state = signal<SessionState>('idle');
  const endReason = signal<EndReason | null>(null);
  const sessionOf = signal<SessionResponse | null>(null);
  const listeners: ((frame: SseFrame) => void)[] = [];
  let started = 0;
  const session = {
    state,
    endReason,
    session: sessionOf,
    start: vi.fn(async (_overrides?: { choreoScenarioGuid?: string }) => {
      started += 1;
      state.set('working');
      endReason.set(null);
      sessionOf.set({
        sessionId: '',
        sessionScenarioGuid: '',
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
  it('starts with the first chapter and shows its chat in the widget', async () => {
    const { guide, session, widget } = setup();
    await guide.start();
    TestBed.tick();
    expect(session.start).toHaveBeenCalledWith({ choreoScenarioGuid: 'entry' });
    expect(guide.chapter()?.id).toBe('data-basis');
    expect(widget.show).toHaveBeenLastCalledWith('tok-1', {
      theme: 'mindline',
      themeMode: 'follow',
      hostSlots: ['brief', 'document', 'screener', 'stimuli', 'moderator', 'participants'],
    });
  });

  it('goes on to the next chapter when one reaches its authored end, and the widget follows', async () => {
    const { guide, session, widget, end } = setup();
    await guide.start();
    end('terminal');
    await vi.waitFor(() => expect(session.start).toHaveBeenLastCalledWith({ choreoScenarioGuid: 'director' }));
    TestBed.tick();
    expect(guide.chapter()?.id).toBe('direction');
    expect(widget.show).toHaveBeenLastCalledWith('tok-2', expect.objectContaining({ hostSlots: [] }));

    // The last chapter's end starts nothing more.
    end('terminal');
    expect(session.start).toHaveBeenCalledTimes(2);
  });

  it('stays where it is when a chapter ends any other way, or is the last', async () => {
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

  it('keeps what the Inventory remembers across chapters', async () => {
    const { guide, frame, end } = setup();
    await guide.start();
    frame('inventory', { rows: [{ facetGuid: 'f', label: 'Moderatorin', values: { 'moderator[0]': 'm1' } }] });
    expect(guide.answers()).toEqual({ moderator: ['m1'] });
    end('terminal');
    expect(guide.answers()).toEqual({ moderator: ['m1'] });
  });

  it('follows an attached session and knows its chapter from the choreo it runs', async () => {
    const { guide, session, end } = setup();
    await guide.attach('given');
    expect(session.begin).toHaveBeenCalled();
    expect(guide.chapter()?.id).toBe('data-basis');
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
    expect(guide.chapter()).toBeNull();
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
});
