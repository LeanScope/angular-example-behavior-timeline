import type {
  ChartKind,
  ChartUnit,
  Finding,
  FindingChart,
  FindingEvidence,
  ParsedAnswer,
} from './finding.types';

const KINDS: ChartKind[] = ['bar', 'groupedBar', 'stackedBar100', 'pie', 'heatmap'];
const UNITS: ChartUnit[] = ['percent', 'count'];
const MAX_EVIDENCE = 5;

// Any fenced block. ```finding is preferred, but models also write ```json, ```JSON, no tag,
// an indented closing fence, or stop before the closing fence.
const BLOCK = /```[ \t]*([A-Za-z]*)[^\n]*\r?\n([\s\S]*?)(?:\r?\n[ \t]*```|$)/g;
const BROKEN = 'Der Ergebnisblock ist kein gültiges JSON.';

/**
 * Splits an analyst answer into readable text and the machine-readable finding.
 * Never throws: a missing or broken block gives `finding: null` and the whole text.
 */
export function parseAnswer(line: string): ParsedAnswer {
  const blocks = [...line.matchAll(BLOCK)];
  // The last block that looks like a finding wins.
  for (const block of blocks.reverse()) {
    const tagged = block[1].toLowerCase() === 'finding';
    const body = block[2].trim();
    if (!tagged && !looksLikeFinding(body)) continue;
    const raw = parseJson(body);
    if (raw === undefined) return { text: stripBlock(line, block), finding: null, problem: BROKEN };
    if (!isRecord(raw)) continue;
    const finding = toFinding(raw);
    return {
      text: stripBlock(line, block),
      finding,
      problem: finding ? null : 'Der Ergebnisblock passt nicht zum erwarteten Format.',
    };
  }
  return { text: line.trim(), finding: null, problem: null };
}

/** An untagged or json block counts only when it is clearly a finding object. */
function looksLikeFinding(body: string): boolean {
  return body.startsWith('{') && (/"v"\s*:\s*1\b/.test(body) || /"takeaway"\s*:/.test(body));
}

/** JSON.parse, retried without trailing commas. `undefined` when it still fails. */
function parseJson(body: string): unknown {
  for (const candidate of [body, body.replace(/,(\s*[}\]])/g, '$1')]) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

function stripBlock(line: string, block: RegExpMatchArray): string {
  const start = block.index ?? 0;
  return (line.slice(0, start) + line.slice(start + block[0].length)).trim();
}

/** Validates and normalizes a parsed object. Returns null when the essentials are missing. */
export function toFinding(raw: Record<string, unknown>): Finding | null {
  const title = str(raw['title']);
  const takeaway = str(raw['takeaway']);
  if (!title || !takeaway) return null;
  const population = isRecord(raw['population']) ? raw['population'] : {};
  return {
    v: 1,
    title,
    takeaway,
    chart: toChart(raw['chart']),
    population: { description: str(population['description']), n: num(population['n']) },
    evidence: list(raw['evidence'])
      .filter(isRecord)
      .map(
        (e): FindingEvidence => ({
          speaker: str(e['speaker']),
          questionCode: str(e['questionCode']) || null,
          quote: str(e['quote']),
        }),
      )
      .filter((e) => e.quote)
      .slice(0, MAX_EVIDENCE),
    sources: list(raw['sources']).map(str).filter(Boolean),
  };
}

function toChart(raw: unknown): FindingChart | null {
  if (!isRecord(raw) || !isRecord(raw['x'])) return null;
  const categories = list(raw['x']['categories']).map(String);
  const series = list(raw['series'])
    .filter(isRecord)
    .map((s) => ({ name: str(s['name']), values: list(s['values']).map((v) => num(v) ?? 0) }))
    // One value per category, or the chart would lie.
    .filter((s) => s.values.length === categories.length);
  if (categories.length === 0 || series.length === 0) return null;
  const kind = str(raw['kind']) as ChartKind;
  const unit = str(raw['unit']) as ChartUnit;
  return {
    kind: KINDS.includes(kind) ? kind : series.length > 1 ? 'groupedBar' : 'bar',
    unit: UNITS.includes(unit) ? unit : 'count',
    x: { label: str(raw['x']['label']), categories },
    series,
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v.replace(',', '.')))) {
    return Number(v.replace(',', '.'));
  }
  return null;
}
