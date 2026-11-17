import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { authGuard } from '../../leanscope/auth.guard';
import { APP_ENV } from '../app-env';

/** `?demo=<name>` → a self-contained WebVTT in `public/demo/`. A bare `?demo` is the first. */
export const DEMO_FILES: Record<string, string> = {
  wahlplakate: 'demo/wahlplakate-buergerdialog.vtt',
};
export const DEFAULT_DEMO = 'wahlplakate';
/**
 * Demos whose discussions live in a repository (the one `demos/<name>/.env` connects). Started
 * with `npm run demo <name>`, such a demo bundles no file: everything comes from the recording
 * picked from the repository, after signing in.
 */
export const REPOSITORY_DEMOS = new Set(['stadtwerke']);

/**
 * The file demo to show: `?demo[=<name>]`, else the one `npm run demo <name>` built for
 * (APP_DEMO), unless a session is to be followed or a repository recording is asked for.
 * Undefined: no demo, the usual page.
 */
export function demoNameOf(params: {
  asked: string | undefined;
  built: string;
  sessionToken?: string;
  recording?: string;
}): string | undefined {
  if (params.asked !== undefined) return params.asked.trim().toLowerCase() || DEFAULT_DEMO;
  const built = params.built.trim().toLowerCase();
  if (!built || params.sessionToken?.trim() || params.recording?.trim()) return undefined;
  return REPOSITORY_DEMOS.has(built) ? undefined : built;
}

/**
 * `authGuard`, except for a file demo: one the app was built for (`npm run demo:wahlplakate`, i.e.
 * APP_DEMO) or one asked for with `?demo[=<name>]` (the login page links to it). Such a demo brings
 * everything along, so it opens without a login. The start page of a deployed app (built without
 * APP_DEMO) still asks for one.
 */
export const demoOrAuthGuard: CanActivateFn = (route, state) => {
  const params = route.queryParamMap;
  const demo = demoNameOf({
    asked: params.get('demo') ?? undefined,
    built: inject(APP_ENV).demo,
    sessionToken: params.get('sessionToken') ?? undefined,
    recording: params.get('recording') ?? undefined,
  });
  if (demo !== undefined && demo in DEMO_FILES) return true;
  return authGuard(route, state);
};
