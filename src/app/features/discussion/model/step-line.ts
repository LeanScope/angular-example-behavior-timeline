/**
 * What a step's `line` says as spoken text. The agent server writes some lines as JSON envelopes
 * for a renderer (`{"kind":"review",…}`, `{"kind":"handoff",…}`; `leanscope-agent-server`,
 * `src/shared/schema/step-actions.ts`). Nobody says them:
 *
 * - a `review` envelope with a `note` reads as that note (what the step said),
 * - any other envelope reads as `''` (not a turn),
 * - any other line reads as itself.
 */
export function spokenTextOf(line: string | null | undefined): string {
  const raw = line?.trim() ?? '';
  if (!raw.startsWith('{')) return raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return raw;
  const envelope = parsed as { kind?: unknown; note?: unknown };
  if (typeof envelope.kind !== 'string') return raw;
  return envelope.kind === 'review' && typeof envelope.note === 'string' ? envelope.note.trim() : '';
}
