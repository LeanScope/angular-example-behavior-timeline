import { InjectionToken, makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core';

/**
 * Everything the generic client reads from `.env` (see `.env.example`). None of it is a secret:
 * the user signs in (`LeanScopeAuthService`) and the agent server runs sessions on its own keys.
 */
export interface LeanScopeEnv {
  /** The `_guid` of the choreo to run (LEANSCOPE_CHOREO_SCENARIO_GUID). */
  choreoScenarioGuid: string;
  /** The id of the repository the choreos live in (LEANSCOPE_REPOSITORY_ID). A login names none. */
  repositoryId: string;
  /** The LeanScope login: Supabase project URL (LEANSCOPE_SUPABASE_URL). A public value. */
  supabaseUrl?: string;
  /** The LeanScope login: Supabase anon key (LEANSCOPE_SUPABASE_ANON_KEY). A public value. */
  supabaseAnonKey?: string;
}

export interface LeanScopeConfig extends LeanScopeEnv {
  /** Base URL of the LeanScope Agent Server, without `/api/v1`. */
  agentServerUrl: string;
  /**
   * Origin of the agent server's own UI (it serves the support widget at
   * `<agentUiUrl>/embed/support-embed.js`). Empty: no widget.
   */
  agentUiUrl?: string;
  locale?: string;
}

export const LEANSCOPE_CONFIG = new InjectionToken<LeanScopeConfig>('LEANSCOPE_CONFIG');

/** `fetch`, injectable so tests can replace it. */
export const LEANSCOPE_FETCH = new InjectionToken<typeof fetch>('LEANSCOPE_FETCH', {
  providedIn: 'root',
  factory: () => (input, init) => fetch(input, init),
});

export function provideLeanScope(config: LeanScopeConfig): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: LEANSCOPE_CONFIG, useValue: config }]);
}

/** What is missing before a session can start, as hints for the user. Empty when ready. */
export function missingConfig(config: LeanScopeConfig): string[] {
  const missing: string[] = [];
  if (!config.agentServerUrl.trim()) {
    missing.push('agentServerUrl in src/environments/environment.ts');
  }
  if (!config.choreoScenarioGuid.trim()) {
    missing.push('LEANSCOPE_CHOREO_SCENARIO_GUID in .env');
  }
  if (!config.repositoryId?.trim()) {
    missing.push('LEANSCOPE_REPOSITORY_ID in .env');
  }
  if (!config.supabaseUrl?.trim()) {
    missing.push('LEANSCOPE_SUPABASE_URL in .env');
  }
  if (!config.supabaseAnonKey?.trim()) {
    missing.push('LEANSCOPE_SUPABASE_ANON_KEY in .env');
  }
  return missing;
}
