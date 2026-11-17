// App configuration that is safe to commit. The values that depend on your repository (choreo
// guids, repository id, login) live in `.env` (gitignored, see `.env.example`) or, on a build
// server, in its environment variables. None of them is a secret: the user signs in.
//
// Coding agents: you may edit this file. Never open, print or edit `.env`.

import type { LeanScopeConfig, LeanScopeEnv } from '../app/leanscope/leanscope.config';
import { EMPTY_APP_ENV, type AppEnv } from '../app/features/app-env';

/**
 * Your values from `.env`. `npm start` and `npm run build` put them in at build time (see
 * scripts/run-ng.mjs); in tests and plain `ng` commands they are undefined, so the app starts
 * with empty values and the home page lists what's missing.
 */
declare const LEANSCOPE_ENV: (LeanScopeEnv & { app?: AppEnv; agentServerUrl?: string }) | undefined;

const defined = typeof LEANSCOPE_ENV === 'undefined' ? undefined : LEANSCOPE_ENV;

const fromEnv: LeanScopeEnv = {
  choreoScenarioGuid: defined?.choreoScenarioGuid ?? '',
  repositoryId: defined?.repositoryId ?? '',
  supabaseUrl: defined?.supabaseUrl ?? '',
  supabaseAnonKey: defined?.supabaseAnonKey ?? '',
};

export const environment: { leanscope: LeanScopeConfig; app: AppEnv } = {
  /** App settings from `.env` (APP_BRAND, APP_INGEST_CHOREO_GUID, APP_STUDY_QUERY_GUID). */
  app: { ...EMPTY_APP_ENV, ...defined?.app },

  leanscope: {
    /** The LeanScope Agent Server (REST + SSE). API docs: <agentServerUrl>/api/v1/docs */
    agentServerUrl: defined?.agentServerUrl?.trim() || 'https://dev.api.agents.leanscope.ai',

    /** The agent server's own UI. The session's chat shows in its support widget. */
    agentUiUrl: 'https://dev.agents.leanscope.ai',

    /** Language the session speaks, e.g. 'en' or 'de'. */
    locale: 'de',

    ...fromEnv,
  },
};
