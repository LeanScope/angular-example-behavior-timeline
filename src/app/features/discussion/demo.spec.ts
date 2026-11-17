import { TestBed } from '@angular/core/testing';
import {
  convertToParamMap,
  provideRouter,
  UrlTree,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
} from '@angular/router';
import { LeanScopeAuthService } from '../../leanscope/leanscope-auth.service';
import { APP_ENV, EMPTY_APP_ENV } from '../app-env';
import { demoNameOf, demoOrAuthGuard } from './demo';

function guard(query: Record<string, string>, built = '') {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: APP_ENV, useValue: { ...EMPTY_APP_ENV, demo: built } },
      { provide: LeanScopeAuthService, useValue: { signedIn: () => false } },
    ],
  });
  const route = { queryParamMap: convertToParamMap(query) } as ActivatedRouteSnapshot;
  const state = { url: '/' } as RouterStateSnapshot;
  return TestBed.runInInjectionContext(() => demoOrAuthGuard(route, state));
}

describe('demoNameOf', () => {
  it('takes ?demo first, a bare one is the default demo', () => {
    expect(demoNameOf({ asked: '', built: 'stadtwerke' })).toBe('wahlplakate');
    expect(demoNameOf({ asked: 'Wahlplakate', built: '' })).toBe('wahlplakate');
  });

  it('takes the built file demo unless a session or recording is asked for', () => {
    expect(demoNameOf({ asked: undefined, built: 'wahlplakate' })).toBe('wahlplakate');
    expect(demoNameOf({ asked: undefined, built: 'wahlplakate', recording: 'g' })).toBeUndefined();
    expect(demoNameOf({ asked: undefined, built: 'wahlplakate', sessionToken: 't' })).toBeUndefined();
  });

  it('is no demo for the plain app or a repository demo', () => {
    expect(demoNameOf({ asked: undefined, built: '' })).toBeUndefined();
    expect(demoNameOf({ asked: undefined, built: 'stadtwerke' })).toBeUndefined();
  });
});

describe('demoOrAuthGuard', () => {
  it('opens a file demo without a login: built in or asked for with ?demo', () => {
    expect(guard({}, 'wahlplakate')).toBe(true);
    expect(guard({ demo: 'wahlplakate' })).toBe(true);
    expect(guard({ demo: '' })).toBe(true);
  });

  it('sends the plain app, an unknown or repository demo and a recording to the login', () => {
    expect(guard({})).toBeInstanceOf(UrlTree);
    expect(guard({ demo: 'unknown' })).toBeInstanceOf(UrlTree);
    expect(guard({}, 'stadtwerke')).toBeInstanceOf(UrlTree);
    expect(guard({ recording: 'g' }, 'wahlplakate')).toBeInstanceOf(UrlTree);
  });
});
