import {
  initialsOf,
  type Guide,
  type GuideBlock,
  type Ocean,
  type Participant,
  type ParticipantAttribute,
  type Screener,
  type Stimulus,
  type Study,
  type StudyBrief,
} from './study.model';

/**
 * What the published query "Studie der Choreo" returns: the resources the document worker wrote
 * for the ingest choreo's Inventory (leanscope-agent-server docs/interview-guide-graph.md and
 * tasks/todo-study-documents-breakdown.md). The query aliases its fields to these names, so this
 * file is the one place that knows the shape.
 */
export interface StudyQueryResult {
  guide?: DocumentRoot | null;
  brief?: DocumentRoot | null;
  screener?: (DocumentRoot & { participants?: PersonaNode[] | null }) | null;
  stimuli?: FileNode[] | null;
}

export interface DocumentRoot {
  guid: string;
  /** The root's label: the file name. */
  line?: string | null;
  /** The `HAS` children in `listIndex` order. */
  children?: ChildNode[] | null;
}

export interface ChildNode {
  guid: string;
  /** The species the child IS: `question`, `goal`, `researchQuestion` or `criterion`. */
  kind?: string | null;
  /** The facet key, e.g. `q_1a2b3c4d` for a guide question. */
  key?: string | null;
  /** The text: the question, goal or criterion. */
  line?: string | null;
  /** For a guide question: its section heading path ("Block A – Einstieg (10 min)"). */
  description?: string | null;
  listIndex?: number | null;
}

export interface PersonaNode {
  guid: string;
  name?: string | null;
  role?: string | null;
  profile?: string | null;
  demographics?: string | null;
  /** OCEAN as 0..1 values, when the persona has them. */
  ocean?: Partial<Ocean> | null;
  imageUrl?: string | null;
  /** The persona's colour, aliased from `backgroundColor`. */
  color?: string | null;
  /** Further traits for the Steckbrief. Not in the query yet; demo files carry them. */
  attributes?: ParticipantAttribute[] | null;
}

export interface FileNode {
  guid: string;
  name?: string | null;
  url?: string | null;
  mimeType?: string | null;
  credit?: string | null;
  source?: string | null;
}

/** Planned length of a guide without any minutes in its headings. */
export const DEFAULT_GUIDE_MINUTES = 90;
/** How long a stimulus is shown when placed for the first time (seconds). */
export const DEFAULT_STIMULUS_SECONDS = 180;

export function toStudy(result: StudyQueryResult | null | undefined): Study {
  return {
    guide: result?.guide ? toGuide(result.guide) : null,
    brief: result?.brief ? toBrief(result.brief) : null,
    screener: result?.screener ? toScreener(result.screener) : null,
    stimuli: (result?.stimuli ?? []).flatMap(toStimulus),
  };
}

/**
 * Groups the guide's questions into blocks by their section. A section heading like
 * "Block B – Erwartungen (15 min)" gives the title "Erwartungen" and 15 minutes. Reading the
 * minutes from the heading is string parsing; it is the only place the guide states its timing,
 * and a heading without minutes simply gets an even share of the total.
 */
export function toGuide(root: DocumentRoot): Guide {
  const questions = sorted(root.children).filter((c) => !c.kind || c.kind === 'question');
  const paths = questions.map((q) => sectionPath(q.description));
  // The block is the first level where the questions part ways: a document title the nested
  // questions all sit under is not a block. What lies beneath the block is the subsection.
  const title = commonPrefix(paths.filter((p) => p.length > 1));
  const sections: { heading: string; items: { node: ChildNode; section: string }[] }[] = [];
  questions.forEach((q, i) => {
    const below = startsWith(paths[i], title) && paths[i].length > title.length ? paths[i].slice(title.length) : paths[i];
    const heading = below[0] ?? '';
    const section = below.slice(1).join(' / ');
    const current = sections.at(-1);
    if (current && current.heading === heading) current.items.push({ node: q, section });
    else sections.push({ heading, items: [{ node: q, section }] });
  });

  const parsed = sections.map((s) => parseHeading(s.heading));
  const known = parsed.reduce((sum, p) => sum + (p.minutes ?? 0), 0);
  const unknown = parsed.filter((p) => p.minutes === undefined).length;
  const share = unknown > 0 ? Math.max(5, Math.round((DEFAULT_GUIDE_MINUTES - known) / unknown)) : 0;

  const blocks: GuideBlock[] = sections.map((section, i) => {
    const code = blockCode(i);
    const tone = (i % 8) + 1;
    return {
      code,
      title: parsed[i].title || `Block ${code}`,
      minutes: parsed[i].minutes ?? share,
      tone,
      questions: section.items.map(({ node: q, section: sub }, j) => ({
        key: q.key || q.guid,
        code: `${code}${j + 1}`,
        text: (q.line ?? '').trim(),
        blockCode: code,
        tone,
        ...(sub ? { section: sub } : {}),
      })),
    };
  });
  return {
    title: stripExtension(root.line) || 'Leitfaden',
    blocks,
    totalMinutes: blocks.reduce((sum, b) => sum + b.minutes, 0),
  };
}

export function toBrief(root: DocumentRoot): StudyBrief {
  const children = sorted(root.children);
  const pick = (kind: string) =>
    children
      .filter((c) => c.kind === kind && c.line?.trim())
      .map((c) => ({ key: c.key || c.guid, text: c.line!.trim() }));
  return {
    title: stripExtension(root.line) || 'Angebot',
    goals: pick('goal'),
    researchQuestions: pick('researchQuestion'),
  };
}

export function toScreener(root: DocumentRoot & { participants?: PersonaNode[] | null }): Screener {
  return {
    title: stripExtension(root.line) || 'Screener',
    criteria: sorted(root.children)
      .filter((c) => c.kind === 'criterion' && c.line?.trim())
      .map((c) => ({ key: c.key || c.guid, text: c.line!.trim() })),
    participants: (root.participants ?? []).map(toParticipant),
  };
}

export function toParticipant(node: PersonaNode, index = 0): Participant {
  const name = node.name?.trim() || `Teilnehmende ${index + 1}`;
  const profile = node.profile?.trim() || undefined;
  const ocean = toOcean(node.ocean);
  const attributes = (node.attributes ?? [])
    .map((a) => ({ label: a.label?.trim() ?? '', value: a.value?.trim() ?? '' }))
    .filter((a) => a.label && a.value);
  return {
    guid: node.guid,
    name,
    initials: initialsOf(name),
    // A stub is written before the persona is generated: it has a name, but no profile yet.
    filled: !!profile,
    ...(node.role?.trim() ? { role: node.role.trim() } : {}),
    ...(profile ? { profile } : {}),
    ...(node.demographics?.trim() ? { demographics: node.demographics.trim() } : {}),
    ...(ocean ? { ocean } : {}),
    ...(node.imageUrl?.trim() ? { imageUrl: node.imageUrl.trim() } : {}),
    ...(node.color?.trim() ? { color: node.color.trim() } : {}),
    ...(attributes.length ? { attributes } : {}),
  };
}

function toOcean(value: Partial<Ocean> | null | undefined): Ocean | undefined {
  if (!value) return undefined;
  const keys: (keyof Ocean)[] = [
    'openness',
    'conscientiousness',
    'extraversion',
    'agreeableness',
    'neuroticism',
  ];
  if (!keys.every((k) => typeof value[k] === 'number')) return undefined;
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  return Object.fromEntries(keys.map((k) => [k, clamp(value[k]!)])) as unknown as Ocean;
}

function toStimulus(node: FileNode, index: number): Stimulus[] {
  if (!node.url) return [];
  return [
    {
      guid: node.guid,
      name: node.name?.trim() || `Stimulus ${index + 1}`,
      url: node.url,
      mimeType: node.mimeType ?? '',
      ...(node.credit?.trim() ? { credit: node.credit.trim() } : {}),
      ...(node.source?.trim() ? { source: node.source.trim() } : {}),
      start: index * DEFAULT_STIMULUS_SECONDS,
      end: (index + 1) * DEFAULT_STIMULUS_SECONDS,
    },
  ];
}

function sorted(children: ChildNode[] | null | undefined): ChildNode[] {
  return [...(children ?? [])].sort((a, b) => (a.listIndex ?? 0) - (b.listIndex ?? 0));
}

/** The innermost heading of a section path ("Leitfaden > Block A – Einstieg"). */
/**
 * A question's section as its heading path, outermost first. The worker joins the headings with
 * " / "; a slash without spaces ("Headline/Text") belongs to a heading and does not split it.
 */
function sectionPath(description: string | null | undefined): string[] {
  return (description ?? '').split(/\s+\/\s+|\s*[>›»]\s*|\n/).map((p) => p.trim()).filter(Boolean);
}

/** The leading headings all paths share, leaving each at least one of its own. */
function commonPrefix(paths: string[][]): string[] {
  if (paths.length === 0) return [];
  let n = 0;
  while (paths.every((p) => p.length > n + 1 && p[n] === paths[0][n])) n++;
  return paths[0].slice(0, n);
}

function startsWith(path: string[], prefix: string[]): boolean {
  return prefix.every((heading, i) => path[i] === heading);
}

const MINUTES = /\(?\s*(?:ca\.?\s*)?(\d{1,3})\s*(?:min(?:\.|uten)?|')\s*\)?/i;
const BLOCK_PREFIX = /^(?:block|teil|abschnitt|phase)?\s*[A-Z0-9]{0,2}\s*[:.–—-]\s*/i;

function parseHeading(heading: string): { title: string; minutes?: number } {
  const match = heading.match(MINUTES);
  const minutes = match ? Number(match[1]) : undefined;
  const title = heading.replace(MINUTES, '').replace(BLOCK_PREFIX, '').trim();
  return minutes && minutes > 0 ? { title, minutes } : { title };
}

function blockCode(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : `Z${index - 25}`;
}

function stripExtension(name: string | null | undefined): string {
  return (name ?? '').replace(/\.(md|markdown|docx?|xlsx?|pdf)$/i, '').trim();
}
