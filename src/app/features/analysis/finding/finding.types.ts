// A finding: one answer of the analysis choreo, as it returns it in a ```finding block (schema v1).
// The prompt of step "Antwort mit Diagramm" in choreo b25d6c7c… (repository 2449) defines the
// same shape. Change both together.
//
// Made for qualitative data: no SQL source and no weighting, but quotes as evidence.

export type ChartKind = 'bar' | 'groupedBar' | 'stackedBar100' | 'pie' | 'heatmap';
export type ChartUnit = 'percent' | 'count';

export interface FindingSeries {
  name: string;
  values: number[];
}

export interface FindingChart {
  kind: ChartKind;
  unit: ChartUnit;
  x: { label: string; categories: string[] };
  series: FindingSeries[];
}

/** A quote from the discussion that backs the finding. */
export interface FindingEvidence {
  speaker: string;
  /** Guide question code, e.g. "D2", when known. */
  questionCode: string | null;
  quote: string;
}

export interface Finding {
  v: 1;
  title: string;
  /** Kernaussage. */
  takeaway: string;
  chart: FindingChart | null;
  population: { description: string; n: number | null };
  evidence: FindingEvidence[];
  /** Titles of the repository resources the answer is based on. */
  sources: string[];
}

/** What the app makes of one answer of the analyst. */
export interface ParsedAnswer {
  /** The text before the finding block (Markdown), shown as the readable answer. */
  text: string;
  /** The finding, when the answer carried a valid one. */
  finding: Finding | null;
  /** Why a block that was there could not be used. */
  problem: string | null;
}
