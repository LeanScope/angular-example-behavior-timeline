import { speakingSeconds } from './transcript-mapper';
import { initialsOf, type Clip, type Guide, type Participant, type Stimulus } from './study.model';
import type { ImportedDiscussion, RecordingSource } from './vtt-import';

/**
 * A recorded discussion read straight from its repository: a `Conversation` scenario whose steps
 * are the turns. No `.vtt` in between, so every turn keeps its step guid, and what a step `HAS`
 * says what was on screen and which guide questions it was about.
 *
 * The rules are the ones the agent server's export follows (`leanscope-agent-server`,
 * `src/shared/transcript/`), so a recording looks the same read here or from its exported file:
 *
 * - The turns are the active branch from the one step without a predecessor
 *   (`activeSuccessorRef`, else the only successor).
 * - A step's `duration.time` is the LENGTH of its turn. A turn starts where the turns before it
 *   end. A turn without a length gets the estimate a live session uses (`speakingSeconds`).
 * - Only a persona's step with text is a turn. Any other step is left out but keeps its recorded
 *   time on the clock.
 * - A resource a step `HAS` that owns a file was shown during that turn (a stimulus). A step that
 *   shows nothing neither ends nor extends a span.
 * - A resource without a file is the turn's topic: its `description` lists the guide questions.
 * - The guide is a resource the scenario attaches that `IS` an `📋 Interview Guide`.
 *
 * Session records of the agent server are `Conversation` scenarios too (`customId`
 * `session_<token>`). They carry no lengths and no persona guids, so they are not offered.
 */

/** The recorded discussions of the token's repository. */
export const RECORDINGS = `query Recordings($repositoryId: Int!) {
  uxmData(repositoryId: $repositoryId) {
    scenarios(where: { type: { eq: Conversation } }) {
      guid: _guid
      title
      customId
    }
  }
}`;

/** One recording: its title and what it attaches (stimuli, guide). */
export const RECORDING_BY_GUID = `query RecordingByGuid($repositoryId: Int!, $scenario: String!) {
  uxmData(repositoryId: $repositoryId) {
    scenarios(where: { _guid: { eq: $scenario } }) {
      guid: _guid
      title
      summary
      resourceRelationships_ {
        resource_ {
          guid: _guid
          line
          description
          customId
          fileRefs
          resourceRelationships_ { predicate resourceRef }
        }
      }
    }
  }
}`;

/** A page of a recording's steps. The default order (listIndex, then guid) keeps pages stable. */
export const RECORDING_STEPS = `query RecordingSteps($repositoryId: Int!, $scenario: String!, $limit: Int!, $offset: Int!) {
  uxmData(repositoryId: $repositoryId) {
    scenarioSteps(where: { scenarioRef: { eq: $scenario } }, limit: $limit, offset: $offset) {
      guid: _guid
      line
      title
      actorSymbolRef
      listIndex
      predecessorRefs
      successorRefs
      activeSuccessorRef
      duration { time { hour minute second } }
      resourceRelationships_ { predicate resourceRef }
    }
  }
}`;

/** The resources the steps name: a stimulus owns a file, a topic has the questions as text. */
export const RECORDING_RESOURCES = `query RecordingResources($repositoryId: Int!, $guids: [String!]!) {
  uxmData(repositoryId: $repositoryId) {
    resources(where: { _guid: { in: $guids } }) {
      guid: _guid
      line
      description
      fileRefs
    }
  }
}`;

/** The `📋 Interview Guide` type every guide resource `IS` (agent server `resource-types.ts`). */
export const INTERVIEW_GUIDE_TYPE = 'e62fbcd0-70ed-4dd6-80a5-c7e9b61256a9';
const SESSION_RECORD = /^session_/i;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 200;

export interface RecordingEntry {
  guid: string;
  title: string;
}

export interface RecordingScenarioRow {
  guid: string;
  title?: string | null;
  summary?: string | null;
  customId?: string | null;
  resourceRelationships_?:
    | {
        resource_?:
          | (RecordingResourceRow & {
              customId?: string | null;
              resourceRelationships_?: { predicate?: string | null; resourceRef?: string | null }[] | null;
            })
          | null;
      }[]
    | null;
}

export interface RecordingStepRow {
  guid: string;
  line?: string | null;
  title?: string | null;
  actorSymbolRef?: string | null;
  listIndex?: number | null;
  predecessorRefs?: string[] | null;
  successorRefs?: string[] | null;
  activeSuccessorRef?: string | null;
  duration?: { time?: { hour?: number | null; minute?: number | null; second?: number | null } | null } | null;
  resourceRelationships_?: { predicate?: string | null; resourceRef?: string | null }[] | null;
}

export interface RecordingResourceRow {
  guid: string;
  line?: string | null;
  description?: string | null;
  fileRefs?: string[] | null;
}

/** A recording that cannot be shown, with what is wrong. */
export class RecordingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordingError';
  }
}

/** A recording read from its repository: a `.vtt`'s content, plus what only the steps know. */
export type RepositoryRecording = ImportedDiscussion & Required<Pick<ImportedDiscussion, 'topics'>>;

/** `RepositoryResourcesService.query`. */
export type RunQuery = (document: string, variables?: Record<string, unknown>) => Promise<unknown>;

/** The recordings to offer, by title: `Conversation` scenarios that are no session record. */
export function toRecordings(data: unknown): RecordingEntry[] {
  const rows = (data as { uxmData?: { scenarios?: RecordingScenarioRow[] | null } } | null)?.uxmData?.scenarios ?? [];
  return rows
    .filter((row) => !SESSION_RECORD.test(row.customId?.trim() ?? ''))
    .map((row) => ({ guid: row.guid, title: row.title?.trim() || row.guid }))
    .sort((a, b) => a.title.localeCompare(b.title, 'de', { numeric: true }));
}

/**
 * Reads one recording: the scenario, all its steps (in pages), the resources the steps name and
 * who of the speakers is the moderator (`moderators`, e.g. `MODERATORS_BY_GUID`).
 */
export async function loadRecording(
  scenarioGuid: string,
  query: RunQuery,
  moderators: (personaRefs: string[]) => Promise<string[]> = async () => [],
): Promise<RepositoryRecording> {
  const scenario = query(RECORDING_BY_GUID, { scenario: scenarioGuid }).then(
    (data) => (data as { uxmData?: { scenarios?: RecordingScenarioRow[] | null } } | null)?.uxmData?.scenarios?.[0],
  );
  const steps: RecordingStepRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const data = await query(RECORDING_STEPS, { scenario: scenarioGuid, limit: PAGE, offset });
    const page = (data as { uxmData?: { scenarioSteps?: RecordingStepRow[] | null } } | null)?.uxmData?.scenarioSteps ?? [];
    steps.push(...page);
    if (page.length < PAGE) break;
  }
  const found = await scenario;
  if (!found) throw new RecordingError('Die Aufzeichnung gibt es in diesem Repository nicht.');

  const named = [...new Set(steps.flatMap((s) => resourceRefsOf(s)))];
  const resources: RecordingResourceRow[] = [];
  for (let i = 0; i < named.length; i += PAGE) {
    const data = await query(RECORDING_RESOURCES, { guids: named.slice(i, i + PAGE) });
    resources.push(...((data as { uxmData?: { resources?: RecordingResourceRow[] | null } } | null)?.uxmData?.resources ?? []));
  }
  const speakers = [...new Set(steps.map((s) => speakerOf(s)).filter((s): s is string => !!s))];
  const moderatorRefs = speakers.length ? await moderators(speakers).catch(() => []) : [];
  return fromScenarioSteps({ scenario: found, steps, resources, moderatorRefs });
}

export interface RecordingInput {
  scenario: RecordingScenarioRow;
  steps: readonly RecordingStepRow[];
  /** The resources the steps name (`RECORDING_RESOURCES`). */
  resources?: readonly RecordingResourceRow[];
  /** Persona guids with the Group Role `Moderator`. Without exactly one of the speakers among them, the first speaker moderates. */
  moderatorRefs?: Iterable<string>;
}

/** A recording's steps as the discussion the app shows. Pure. */
export function fromScenarioSteps(input: RecordingInput): RepositoryRecording {
  const title = input.scenario.title?.trim() || 'Gruppendiskussion';
  const resources = new Map((input.resources ?? []).map((r) => [r.guid.toLowerCase(), r]));
  const fileOf = (guid: string) => resources.get(guid)?.fileRefs?.map((f) => f.trim()).find(Boolean);

  // The turns on the clock.
  const turns: { step: RecordingStepRow; speaker: string; text: string; start: number; end: number }[] = [];
  const clock: { step: RecordingStepRow; start: number; end: number }[] = [];
  let at = 0;
  for (const step of activeBranch(input.steps)) {
    const text = step.line?.replace(/\s+/g, ' ').trim() ?? '';
    const speaker = speakerOf(step);
    const recorded = lengthOf(step);
    const length = text && speaker ? (recorded ?? speakingSeconds(text)) : (recorded ?? 0);
    if (text && speaker) turns.push({ step, speaker, text, start: at, end: at + length });
    clock.push({ step, start: at, end: at + length });
    at += length;
  }
  if (!turns.length) {
    throw new RecordingError(`„${title}“ hat keine gesprochenen Beiträge: Nur Schritte einer Persona mit Text zählen.`);
  }

  // The cast: one moderator, everyone else takes part.
  const speakers = [...new Set(turns.map((t) => t.speaker))];
  const given = new Set([...(input.moderatorRefs ?? [])].map((g) => g.trim().toLowerCase()));
  const moderating = speakers.filter((s) => given.has(s));
  const moderatorGuid = moderating.length === 1 ? moderating[0] : speakers[0];
  const nameOf = new Map<string, string>();
  for (const turn of turns) {
    if (!nameOf.has(turn.speaker)) nameOf.set(turn.speaker, turn.step.title?.trim() || turn.speaker);
  }
  const participants: Participant[] = speakers
    .filter((guid) => guid !== moderatorGuid)
    .map((guid) => ({ guid, name: nameOf.get(guid)!, initials: initialsOf(nameOf.get(guid)!), filled: true }));

  const clips: Clip[] = turns.map(({ step, speaker, text, start, end }) => ({
    guid: step.guid,
    stepGuid: step.guid,
    speakerGuid: speaker,
    speakerName: nameOf.get(speaker)!,
    moderator: speaker === moderatorGuid,
    text,
    start,
    end,
  }));

  const topics = new Map<string, string[]>();
  for (const { step } of turns) {
    const texts = resourceRefsOf(step)
      .filter((ref) => resources.has(ref) && !fileOf(ref))
      .flatMap((ref) => (resources.get(ref)!.description ?? '').split(/\r?\n/))
      .map((line) => line.trim())
      .filter(Boolean);
    if (texts.length) topics.set(step.guid, texts);
  }

  return {
    title,
    ...(input.scenario.summary?.trim() ? { description: input.scenario.summary.trim() } : {}),
    study: { brief: null, guide: null, screener: { title: '', criteria: [], participants }, stimuli: [] },
    transcript: {
      clips,
      badges: [],
      done: new Set(),
      duration: clips.reduce((max, c) => Math.max(max, c.end), 0),
      scenarioGuid: input.scenario.guid,
    },
    moderator: { guid: moderatorGuid, name: nameOf.get(moderatorGuid)!, imageUrl: null, color: null },
    personaRefs: speakers,
    files: shownSpans(clock, resources),
    sources: sourcesOf(input.scenario),
    topics,
  };
}

/**
 * Per turn, the keys of the guide questions its step's topic lists, for `matchQuestions` to
 * choose among. A topic's line is a question when the guide has one with the same text (a
 * question a guide repeats per campaign gives several keys; what is on screen tells them apart).
 * A turn whose topic names no question of this guide is left out.
 */
export function topicQuestions(topics: ReadonlyMap<string, readonly string[]>, guide: Guide): Map<string, Set<string>> {
  const byText = new Map<string, string[]>();
  for (const question of guide.blocks.flatMap((b) => b.questions)) {
    const text = comparable(question.text);
    byText.set(text, [...(byText.get(text) ?? []), question.key]);
  }
  const allowed = new Map<string, Set<string>>();
  for (const [clip, texts] of topics) {
    const keys = texts.flatMap((text) => byText.get(comparable(text)) ?? []);
    if (keys.length) allowed.set(clip, new Set(keys));
  }
  return allowed;
}

/** A question's text without its bullet, trailing file names, punctuation and case. */
function comparable(text: string): string {
  return text
    .replace(/^(?:[-*•]|\d+[.)])\s+/, '')
    .replace(/(?:[\s,]+[^\s,]+\.(?:png|jpe?g|gif|webp|svg|pdf))+$/i, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The persona who speaks in a step: its `actorSymbolRef` when that is a guid (not `human`, `agent`, a portrait URL). */
function speakerOf(step: RecordingStepRow): string | undefined {
  const ref = step.actorSymbolRef?.trim().toLowerCase() ?? '';
  return GUID.test(ref) ? ref : undefined;
}

/** The recorded length of a turn in seconds; none (or zero) is undefined. */
function lengthOf(step: RecordingStepRow): number | undefined {
  const time = step.duration?.time;
  if (!time) return undefined;
  const seconds = (time.hour ?? 0) * 3600 + (time.minute ?? 0) * 60 + (time.second ?? 0);
  return seconds > 0 ? seconds : undefined;
}

function resourceRefsOf(step: RecordingStepRow): string[] {
  const refs = (step.resourceRelationships_ ?? [])
    .filter((r) => r.predicate === 'HAS' && r.resourceRef?.trim())
    .map((r) => r.resourceRef!.trim().toLowerCase());
  return [...new Set(refs)];
}

/**
 * The active branch from the entry step. A chain that cannot be walked (no single entry, or a
 * fork without an active successor) is taken in creation order instead.
 */
function activeBranch(steps: readonly RecordingStepRow[]): RecordingStepRow[] {
  const byGuid = new Map(steps.map((s) => [s.guid, s]));
  const inCreationOrder = () =>
    [...steps].sort((a, b) => (a.listIndex ?? 0) - (b.listIndex ?? 0) || a.guid.localeCompare(b.guid));
  const entries = steps.filter((s) => !(s.predecessorRefs ?? []).some((ref) => byGuid.has(ref)));
  if (entries.length !== 1) return inCreationOrder();

  const branch: RecordingStepRow[] = [];
  const seen = new Set<string>();
  let current: RecordingStepRow | undefined = entries[0];
  while (current && !seen.has(current.guid)) {
    seen.add(current.guid);
    branch.push(current);
    const successors: string[] = (current.successorRefs ?? []).filter((ref) => byGuid.has(ref));
    const active: string | null | undefined = current.activeSuccessorRef;
    const next: string | undefined = active && byGuid.has(active) ? active : successors.length === 1 ? successors[0] : undefined;
    if (!next && successors.length > 1) return inCreationOrder();
    current = next ? byGuid.get(next) : undefined;
  }
  return branch;
}

/** What was on screen when: one stimulus per span of turns that show the same file resource. */
function shownSpans(
  clock: readonly { step: RecordingStepRow; start: number; end: number }[],
  resources: ReadonlyMap<string, RecordingResourceRow>,
): Stimulus[] {
  const fileOf = (guid: string) => resources.get(guid)?.fileRefs?.map((f) => f.trim()).find(Boolean);
  const spans: { resourceRef: string; start: number; end: number }[] = [];
  const open = new Map<string, { start: number; end: number }>();
  const close = (resourceRef: string) => {
    const span = open.get(resourceRef);
    if (span) spans.push({ resourceRef, ...span });
    open.delete(resourceRef);
  };
  for (const { step, start, end } of clock) {
    const here = new Set(resourceRefsOf(step).filter((ref) => fileOf(ref)));
    if (!here.size) continue;
    for (const resourceRef of [...open.keys()]) if (!here.has(resourceRef)) close(resourceRef);
    for (const resourceRef of here) {
      const span = open.get(resourceRef);
      if (span) span.end = end;
      else open.set(resourceRef, { start, end });
    }
  }
  for (const resourceRef of [...open.keys()]) close(resourceRef);

  return spans
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((span, i) => {
      const resource = resources.get(span.resourceRef)!;
      return {
        guid: `r_${i + 1}`,
        name: resource.line?.trim() || `Stimulus ${i + 1}`,
        url: '',
        mimeType: '',
        fileRef: fileOf(span.resourceRef)!,
        resourceRef: resource.guid,
        start: span.start,
        end: span.end,
      };
    });
}

/** The guides the scenario attaches: resources that are an `📋 Interview Guide`. */
function sourcesOf(scenario: RecordingScenarioRow): RecordingSource[] {
  const sources: RecordingSource[] = [];
  for (const relationship of scenario.resourceRelationships_ ?? []) {
    const resource = relationship.resource_;
    if (!resource || sources.some((s) => s.resourceRef === resource.guid)) continue;
    const isGuide = (resource.resourceRelationships_ ?? []).some(
      (r) => r.predicate === 'IS' && r.resourceRef?.trim().toLowerCase() === INTERVIEW_GUIDE_TYPE,
    );
    if (!isGuide) continue;
    const fileRef = resource.fileRefs?.map((f) => f.trim()).find(Boolean);
    const text = resource.description?.trim();
    sources.push({
      key: resource.customId?.trim() || `s_${sources.length + 1}`,
      name: resource.line?.trim() ?? '',
      resourceRef: resource.guid,
      ...(fileRef ? { fileRef } : {}),
      ...(text ? { text } : {}),
    });
  }
  return sources;
}
