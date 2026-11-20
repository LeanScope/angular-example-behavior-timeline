import type { InventoryRow } from '../../leanscope/agent-server.types';
import type { AppEnv } from '../app-env';

/**
 * The guided process is a row of choreos: the guide (the persona who leads through the app in the
 * support widget) runs one after the other, each as a session of its own. The next one starts
 * when the one before reached its authored end. A "chapter" is nothing but the choreo at a
 * position in this row; its `_guid` is its identity.
 *
 * A choreo without a guid is left out, so the row ends where the configuration does. A further
 * chapter (e.g. the analysis) is one more entry here.
 */
export function guideChoreos(entryChoreoGuid: string, env: AppEnv): string[] {
  return [
    // The data basis: documents, moderator, participants (LEANSCOPE_CHOREO_SCENARIO_GUID).
    entryChoreoGuid,
    // "🎬 Thomas zeigt, wie man Regie führt": one director instruction per turn.
    env.directorChoreoGuid,
  ]
    .map((guid) => guid.trim())
    .filter((guid) => guid !== '');
}

/** The choreo after `current`, or null when it is the last (or not one of them). */
export function nextChoreo(choreos: readonly string[], current: string | null): string | null {
  const index = current ? choreos.indexOf(current) : -1;
  return index === -1 ? null : (choreos[index + 1] ?? null);
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
