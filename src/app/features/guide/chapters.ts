import type { InventoryRow } from '../../leanscope/agent-server.types';
import type { AppEnv } from '../app-env';

/**
 * One chapter of the guided process: a choreo the guide (the persona who leads through the app in
 * the support widget) runs as a session of its own. The chapters run in order; the next one
 * starts when the one before reached its authored end.
 */
export interface Chapter {
  id: string;
  title: string;
  /** `_guid` of the chapter's choreo. */
  choreoGuid: string;
  /**
   * Field keys the app answers in a place of its own. For a question that asks for exactly one
   * of them the widget points to the app instead of showing its form (`hostSlots`).
   */
  hostSlots: readonly string[];
}

/**
 * The chapters this build is configured for, in order. One without a choreo guid is left out, so
 * the list ends where the configuration does. A further chapter (e.g. the analysis) is one more
 * entry here.
 */
export function chaptersOf(entryChoreoGuid: string, env: AppEnv): Chapter[] {
  const all: Chapter[] = [
    {
      id: 'data-basis',
      title: 'Datengrundlage',
      choreoGuid: entryChoreoGuid.trim(),
      hostSlots: ['brief', 'document', 'screener', 'stimuli', 'moderator', 'participants'],
    },
    {
      id: 'direction',
      title: 'Regie',
      choreoGuid: env.directorChoreoGuid.trim(),
      // Its form has several fields (speaker and instruction), which the widget shows itself.
      hostSlots: [],
    },
  ];
  return all.filter((chapter) => chapter.choreoGuid !== '');
}

/** The chapter after `current`, or null when it is the last (or not one of them). */
export function nextChapter(chapters: readonly Chapter[], current: Chapter | null): Chapter | null {
  const index = current ? chapters.findIndex((c) => c.id === current.id) : -1;
  return index === -1 ? null : (chapters[index + 1] ?? null);
}

/**
 * What the Inventory remembers, by field key: a list answer (`participants[0]`,
 * `participants[1]`) under its key, in order.
 */
export function inventoryAnswers(rows: readonly InventoryRow[]): Record<string, unknown[]> {
  const answers: Record<string, unknown[]> = {};
  for (const row of rows) {
    for (const [coordinate, value] of Object.entries(row.values ?? {})) {
      if (value === null || value === undefined || value === '') continue;
      const key = coordinate.replace(/\[.*$/, '');
      (answers[key] ??= []).push(...(Array.isArray(value) ? value : [value]));
    }
  }
  return answers;
}
