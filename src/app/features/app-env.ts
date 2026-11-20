import { InjectionToken } from '@angular/core';

/** App settings from `.env` that are not part of the generic LeanScope client. */
export interface AppEnv {
  /** Brand pack id under public/brands/ (APP_BRAND). Empty means `default`. */
  brand: string;
  /** `_guid` of the "📥 Studienunterlagen einlesen" choreo (APP_INGEST_CHOREO_GUID). */
  ingestChoreoGuid: string;
  /** `_guid` of the published ❓ query "Studie der Choreo" (APP_STUDY_QUERY_GUID). */
  studyQueryGuid: string;
  /** `_guid` of the player choreo that speaks a transcript (APP_PLAYER_CHOREO_GUID). */
  playerChoreoGuid: string;
  /** `_guid` of the analysis choreo that answers questions about the study (APP_ANALYSIS_CHOREO_GUID). */
  analysisChoreoGuid: string;
  /**
   * `_guid` of the choreo "🎬 Thomas führt Regie" (APP_DIRECTOR_CHOREO_GUID): the guide's second
   * chapter, which asks for one director instruction per turn of the discussion.
   */
  directorChoreoGuid: string;
  /** The demo `npm run demo <name>` was started for (APP_DEMO): shown when no `?demo` is given. */
  demo: string;
}

export const EMPTY_APP_ENV: AppEnv = {
  brand: '',
  ingestChoreoGuid: '',
  studyQueryGuid: '',
  playerChoreoGuid: '',
  analysisChoreoGuid: '',
  directorChoreoGuid: '',
  demo: '',
};

export const APP_ENV = new InjectionToken<AppEnv>('APP_ENV', {
  providedIn: 'root',
  factory: () => EMPTY_APP_ENV,
});

/** What the MVP still needs from `.env`, as hints. Empty when ready. */
export function missingAppEnv(env: AppEnv): string[] {
  const missing: string[] = [];
  if (!env.ingestChoreoGuid.trim()) missing.push('APP_INGEST_CHOREO_GUID in .env');
  if (!env.studyQueryGuid.trim()) missing.push('APP_STUDY_QUERY_GUID in .env');
  return missing;
}
