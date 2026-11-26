import { WebVTTParser, type Cue, type Entity } from 'webvtt-parser';
import { parseDocument } from 'yaml';
import { isModerator, parametersOf, traitAttributes, type VttParameter } from './actor-traits';
import { toStudy, type ChildNode, type FileNode, type PersonaNode } from './study-mapper';
import type { Clip, Ocean, QuestionBadge, Stimulus, Study, Transcript } from './study.model';
import { QUESTION_TAG, doneQuestions } from './transcript-mapper';

/**
 * A self-contained WebVTT: a recorded discussion that brings its whole study along, so demo data
 * is a file and not code.
 *
 * The format is the agent server's transcript format (`leanscope-agent-server`,
 * `src/shared/documents/webvtt.ts`): a YAML manifest in a fenced block inside a `NOTE`, with
 * `title`, `description` and `actors` keyed by the `<v …>` label, each carrying `actorRef` or
 * `personaRef`. The server ignores the extra top-level `study` key and keeps unknown actor keys,
 * so a file written for this app stays replayable there.
 *
 * ```
 * WEBVTT
 * Wahlplakate im Bürgerdialog
 *
 * NOTE
 * ```yaml
 * title: Wahlplakate im Bürgerdialog
 * study:
 *   guide: { name, blocks: [{ heading: "Block A – Einstieg (10 min)", questions: [{ key, text }] }] }
 *   brief: { name, goals: [text], researchQuestions: [text] }
 *   screener: { name, criteria: [text] }
 *   stimuli: [{ key, name, url | resourceRef + fileRef, mimeType, start: "00:03:52.000", end, credit, source }]
 * actors:
 *   Maren:
 *     actorRef: f3cc44e7-…
 *     parameters:                                   # traits, by guid (actor-traits.ts)
 *       - { ownerRef: f3cc44e7-…, resourceRef: <Group Role>, parameterRef: <type>, value: Moderator }
 *   Inge Paulsen: { personaRef: demo-inge, role, profile, demographics, color, imageUrl,
 *                   ocean: { openness, … }, attributes: { Grundhaltung: … } }
 * ```
 *
 * 😌 Ruhe und Kultur          ← the cue identifier is the turn's title (numeric: no title)
 * 00:00:12.800 --> 00:00:22.000
 * <v Inge Paulsen>Ich bin Inge …
 * ```
 *
 * A stimulus names its image by `url`, or by `resourceRef` + `fileRef`: a LeanScope resource of
 * the repository the recording belongs to, and the `File` attached to it. Those come back in `files`, for the caller to fetch with
 * the repository's token; the study holds them only once they are fetched.
 *
 * The server's own export (**Export Transcript (.vtt)**, agent server 0.157.0) has no `study`: it
 * lists what the recording had in hand under the top-level `fileResources`, each a resource with
 * its file on the cue clock (`key`, `name`, `resourceRef`, `fileRef`, `start`, `end`). Those are
 * read as stimuli too. It states no `mimeType`: that is the `File`'s own, known once it is fetched.
 * A file with both keeps its hand-written `study.stimuli`.
 *
 * That export (agent server 0.158.0) also names what the discussion was made from under the
 * top-level `sources` (`key`, `name`, `resourceRef`, optional `fileRef`): today its discussion
 * guide, a resource whose `description` is the guide's text. They come back in `sources`, for the
 * caller to read from the repository when the file has no `study.guide` of its own.
 *
 * The moderator is the actor whose Group Role `type` is `Moderator`; the older
 * `moderator: true` is still read. When the file names none, the caller may pass the guids the
 * repository gives that Group Role (`moderatorRefs`, from `MODERATORS_BY_GUID`). Known traits (the segment's share) show as attributes.
 *
 * The manifest must contain no blank line: a blank line ends a `NOTE`. `[q_a1]` in a moderator
 * cue opens that guide question, as in a live session. The cue times are the clip times.
 *
 * Like the server, it uses the W3C's parser for the cues and the `yaml` package for the
 * manifest, and refuses what would put words in the wrong mouth: no manifest, an actor without a
 * reference, a voice the roster doesn't name, not exactly one moderator.
 */

export interface ImportedDiscussion {
  title: string;
  description?: string;
  study: Study;
  transcript: Transcript;
  /**
   * `assumed`: nobody has the Group Role `Moderator`, so the first speaker takes the moderator's
   * track. Their badge then shows their own role (`repositoryRoleOf`), not "Moderator".
   */
  moderator: { guid: string; name: string; imageUrl: string | null; color: string | null; assumed?: boolean };
  /** Every voice's persona guid (`actorRef`/`personaRef`), the moderator's included. */
  personaRefs: string[];
  /** Stimuli whose image is a repository file (`fileRef`): placed, but not yet in `study`. */
  files: Stimulus[];
  /** What the discussion was made from (its guide), by repository resource. */
  sources: RecordingSource[];
  /**
   * Per turn (clip guid): the question texts of the topic its step names. Only a recording read
   * from its repository has them (`repository-recording.ts`).
   */
  topics?: Map<string, string[]>;
}

/** A resource the recording was made from, as the manifest's `sources` names it. */
export interface RecordingSource {
  key: string;
  name: string;
  resourceRef: string;
  /** Only when the resource owns a file (an uploaded document). */
  fileRef?: string;
  /** The resource's `description` (a guide's questions as markdown), when the reader already has it. */
  text?: string;
}

/** A file that cannot be shown, with what is wrong and where. */
export class VttImportError extends Error {
  constructor(
    message: string,
    /** 1-based line in the file, when the fault has one. */
    readonly line?: number,
  ) {
    super(line ? `${message} (Zeile ${line})` : message);
    this.name = 'VttImportError';
  }
}

/** The manifest as this app writes and reads it. Everything but `actors` is optional. */
export interface VttManifest {
  title?: string;
  description?: string;
  study?: {
    brief?: { name?: string; goals?: string[]; researchQuestions?: string[] };
    guide?: { name?: string; blocks?: { heading: string; questions?: { key: string; text: string }[] }[] };
    screener?: { name?: string; criteria?: string[] };
    stimuli?: VttStimulus[];
  };
  /** The server export's stimuli: resources with a file, placed on the cue clock. */
  fileResources?: VttStimulus[];
  /** The server export's sources: what the discussion was made from (its guide). */
  sources?: { key?: string; name?: string; resourceRef?: string; fileRef?: string }[];
  actors: Record<string, VttActor>;
}

export interface VttStimulus {
  key: string;
  name?: string;
  url?: string;
  /** A LeanScope `File` guid instead of a URL, read through the resource that owns it. */
  fileRef?: string;
  resourceRef?: string;
  /** Left out by the server export: the file's own type is taken once it is fetched. */
  mimeType?: string;
  start?: string | number;
  end?: string | number;
  credit?: string;
  source?: string;
}

export interface VttActor {
  actorRef?: string;
  personaRef?: string;
  /** Traits by guid: `[{ ownerRef, resourceRef, parameterRef, value }]`. */
  parameters?: VttParameter[];
  /** Older form of the Group Role trait; still read, `parameters` is preferred. */
  moderator?: boolean;
  role?: string;
  profile?: string;
  demographics?: string;
  color?: string;
  imageUrl?: string;
  ocean?: Partial<Ocean>;
  attributes?: Record<string, string>;
  /** The server's sociodemographics; kept for a server replay, not shown here. */
  age?: number;
  gender?: string;
  profession?: string;
}

const CUE_TIMING = /-->/;
const YAML_OPEN = /^\s*```\s*ya?ml\s*$/i;
const YAML_CLOSE = /^\s*```\s*$/;
const NUMERIC_ID = /^\d+$/;
/** The parser's own table lacks the `;`, which turns `&amp;` into `&;`. */
const ENTITIES: Record<Entity, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
  '&lrm;': '‎',
  '&rlm;': '‏',
};

export interface VttImportOptions {
  /**
   * Persona guids the repository gives the Group Role `Moderator` (`MODERATORS_BY_GUID`). Used
   * only when the file itself names no moderator; the file's own word wins.
   */
  moderatorRefs?: Iterable<string>;
}

/** What a `.vtt` names before it is read in full: its personas, and whether it names a moderator. */
export function vttCast(source: string): { personaRefs: string[]; namesModerator: boolean } {
  if (!/^﻿?WEBVTT/.test(source)) throw new VttImportError('Keine WebVTT-Datei: „WEBVTT“ fehlt am Anfang.', 1);
  const { manifest, firstLine } = readManifest(source);
  const roster = readRoster(manifest, firstLine);
  return {
    personaRefs: [...new Set([...roster.values()].map((a) => a.guid))],
    namesModerator: [...roster.values()].some((a) => isModerator(a.actor)),
  };
}

export function fromWebVtt(source: string, options: VttImportOptions = {}): ImportedDiscussion {
  if (!/^﻿?WEBVTT/.test(source)) throw new VttImportError('Keine WebVTT-Datei: „WEBVTT“ fehlt am Anfang.', 1);
  const { manifest, firstLine } = readManifest(source);
  const roster = readRoster(manifest, firstLine);

  let moderators = [...roster.entries()].filter(([, a]) => isModerator(a.actor));
  if (!moderators.length && options.moderatorRefs) {
    const fromRepository = new Set([...options.moderatorRefs].map((g) => g.trim().toLowerCase()));
    moderators = [...roster.entries()].filter(([, a]) => fromRepository.has(a.guid));
  }
  if (moderators.length !== 1) {
    throw new VttImportError(
      `Genau eine Person braucht die Gruppenrolle „Moderator“ (gefunden: ${moderators.length}).`,
      firstLine,
    );
  }
  const isTheModerator = (a: { guid: string }) => moderators.some(([, m]) => m.guid === a.guid);
  const [moderatorName, moderator] = moderators[0];

  const parsed = new WebVTTParser(ENTITIES).parse(source, 'metadata');
  // The title on the line below the signature is the one tolerated deviation from the spec.
  const error = parsed.errors.find((e) => !(e.line === 2 && /blank line after the signature/i.test(e.message)));
  if (error) throw new VttImportError(`Die Datei ist kein gültiges WebVTT: ${error.message}`, error.line);

  const participants: PersonaNode[] = [...roster.entries()]
    .filter(([, a]) => !isTheModerator(a))
    .map(([label, { guid, actor }]) => toPersonaNode(label, guid, actor));
  const study = toStudy(toQueryResult(manifest, participants));
  completeCast(study, roster);
  placeStimuli(study, manifest);
  const files = fileStimuli(manifest);

  return {
    title: manifest.title?.trim() || study.guide?.title || 'Gruppendiskussion',
    ...(manifest.description?.trim() ? { description: manifest.description.trim() } : {}),
    study,
    transcript: toTranscriptFromCues(parsed.cues, roster, moderator.guid, study),
    moderator: {
      guid: moderator.guid,
      name: moderatorName,
      imageUrl: moderator.actor.imageUrl?.trim() || null,
      color: typeof moderator.actor.color === 'string' ? moderator.actor.color.trim() || null : null,
    },
    personaRefs: [...new Set([...roster.values()].map((a) => a.guid))],
    files,
    sources: sourcesOf(manifest),
  };
}

/** The manifest's `sources` that name a resource; an entry without one is left out. */
function sourcesOf(manifest: VttManifest): RecordingSource[] {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return (Array.isArray(manifest.sources) ? manifest.sources : []).flatMap((s, i) => {
    const resourceRef = text(s?.resourceRef);
    if (!resourceRef || /\s/.test(resourceRef)) return [];
    const fileRef = text(s?.fileRef);
    return [{ key: text(s?.key) || `s_${i + 1}`, name: text(s?.name), resourceRef, ...(fileRef ? { fileRef } : {}) }];
  });
}

/** `HH:MM:SS.mmm` or `MM:SS.mmm` → seconds; a number passes through. */
export function parseTimestamp(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const match = value?.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return undefined;
  const [, h, m, s, ms] = match;
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number((ms ?? '0').padEnd(3, '0')) / 1000;
}

/** Roster: label → identity. References are compared lower-case, as on the server. */
function readRoster(manifest: VttManifest, firstLine: number): Map<string, { guid: string; actor: VttActor }> {
  const roster = new Map<string, { guid: string; actor: VttActor }>();
  for (const [rawLabel, actor] of Object.entries(manifest.actors)) {
    const label = rawLabel.trim();
    if (!actor || typeof actor !== 'object') {
      throw new VttImportError(`„${label}“ hat keine Angaben – mindestens personaRef fehlt.`, firstLine);
    }
    const ref = String(actor.personaRef ?? actor.actorRef ?? '').trim().toLowerCase();
    if (!ref || /\s/.test(ref)) {
      throw new VttImportError(`„${label}“ hat keine gültige personaRef/actorRef.`, firstLine);
    }
    roster.set(label, { guid: ref, actor });
  }
  return roster;
}

function readManifest(source: string): { manifest: VttManifest; firstLine: number } {
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (CUE_TIMING.test(lines[i])) break;
    if (!YAML_OPEN.test(lines[i])) continue;
    const close = lines.findIndex((line, j) => j > i && YAML_CLOSE.test(line));
    if (close < 0) throw new VttImportError('Der Manifest-Block wird nie geschlossen (``` fehlt).', i + 1);
    const blank = lines.slice(i + 1, close).findIndex((line) => !line.trim());
    if (blank >= 0) {
      throw new VttImportError('Leerzeile im Manifest: Sie beendet den NOTE-Block.', i + 2 + blank);
    }
    const firstLine = i + 2;
    const doc = parseDocument(lines.slice(i + 1, close).join('\n'));
    if (doc.errors.length) {
      const at = doc.errors[0].linePos?.[0]?.line;
      throw new VttImportError(
        `Das Manifest ist kein gültiges YAML: ${doc.errors[0].message.split('\n')[0]}`,
        at === undefined ? firstLine : firstLine + at - 1,
      );
    }
    const manifest = doc.toJS() as VttManifest | null;
    if (!manifest?.actors || typeof manifest.actors !== 'object' || Array.isArray(manifest.actors)) {
      throw new VttImportError('Das Manifest nennt keine „actors“.', firstLine);
    }
    return { manifest, firstLine };
  }
  throw new VttImportError('Kein Manifest: Die Datei braucht einen ```yaml-Block in einem NOTE vor dem ersten Cue.');
}

function toPersonaNode(label: string, guid: string, actor: VttActor): PersonaNode {
  const text = (v: unknown) => (typeof v === 'string' ? v : v == null ? null : String(v));
  const traits = traitAttributes(parametersOf(actor.parameters));
  const named = new Set(traits.map((t) => t.label));
  return {
    guid,
    name: label,
    role: text(actor.role),
    profile: text(actor.profile),
    demographics: text(actor.demographics),
    color: text(actor.color),
    imageUrl: text(actor.imageUrl),
    ocean: actor.ocean ?? null,
    attributes: [
      ...traits,
      ...Object.entries(actor.attributes ?? {})
        .filter(([key]) => !named.has(key))
        .map(([key, value]) => ({ label: key, value: text(value) ?? '' })),
    ],
  };
}

/**
 * A recording's cast is complete: nobody is still being generated from the screener, even
 * without a profile (that may come from the repository, or not at all). Each participant keeps
 * the traits its actor named, so an export writes them back.
 */
function completeCast(study: Study, roster: Map<string, { guid: string; actor: VttActor }>): void {
  if (!study.screener) return;
  const byGuid = new Map([...roster.values()].map((a) => [a.guid, parametersOf(a.actor.parameters)]));
  study.screener.participants = study.screener.participants.map((p) => {
    const parameters = byGuid.get(p.guid.toLowerCase()) ?? [];
    return { ...p, filled: true, ...(parameters.length ? { parameters } : {}) };
  });
}

/** The manifest's study in the shape the published query returns, so `toStudy` maps both. */
function toQueryResult(manifest: VttManifest, participants: PersonaNode[]) {
  const study = manifest.study ?? {};
  const listed = (kind: string, texts: string[] | undefined, offset = 0): ChildNode[] =>
    (texts ?? []).map((line, i) => ({ guid: `${kind}-${offset + i + 1}`, kind, line, listIndex: offset + i }));

  let index = 0;
  const questions: ChildNode[] = (study.guide?.blocks ?? []).flatMap((block) =>
    (block.questions ?? []).map((q) => ({
      guid: q.key,
      key: q.key,
      kind: 'question',
      line: q.text,
      description: `Leitfaden > ${block.heading}`,
      listIndex: index++,
    })),
  );
  const goals = study.brief?.goals ?? [];
  return {
    guide: study.guide ? { guid: 'guide', line: study.guide.name ?? null, children: questions } : null,
    brief: study.brief
      ? {
          guid: 'brief',
          line: study.brief.name ?? null,
          children: [...listed('goal', goals), ...listed('researchQuestion', study.brief.researchQuestions, goals.length)],
        }
      : null,
    screener:
      study.screener || participants.length
        ? {
            guid: 'screener',
            line: study.screener?.name ?? null,
            children: listed('criterion', study.screener?.criteria),
            participants,
          }
        : null,
    stimuli: stimuliOf(manifest).filter((s) => !isRepositoryFile(s)).map(
      (s): FileNode => ({
        guid: s.key,
        name: s.name ?? null,
        url: s.url ?? null,
        mimeType: s.mimeType ?? null,
        credit: s.credit ?? null,
        source: s.source ?? null,
      }),
    ),
  };
}

/** The hand-written `study.stimuli`, else the server export's `fileResources`. */
function stimuliOf(manifest: VttManifest): VttStimulus[] {
  const own = manifest.study?.stimuli;
  if (Array.isArray(own) && own.length) return own;
  return Array.isArray(manifest.fileResources) ? manifest.fileResources : [];
}

function isRepositoryFile(s: { fileRef?: string; resourceRef?: string }): boolean {
  return !!s.fileRef?.trim() && !!s.resourceRef?.trim();
}

/** The stimuli kept in the repository, placed as the manifest says (else one after the other). */
function fileStimuli(manifest: VttManifest): Stimulus[] {
  const STEP = 60;
  return stimuliOf(manifest)
    .filter(isRepositoryFile)
    .map((s, i) => {
      const start = parseTimestamp(s.start);
      const end = parseTimestamp(s.end);
      const placed = start !== undefined && end !== undefined && end > start;
      return {
        guid: s.key,
        name: s.name?.trim() || `Stimulus ${i + 1}`,
        url: '',
        fileRef: s.fileRef!.trim(),
        resourceRef: s.resourceRef!.trim(),
        mimeType: s.mimeType?.trim() ?? '',
        ...(s.credit?.trim() ? { credit: s.credit.trim() } : {}),
        ...(s.source?.trim() ? { source: s.source.trim() } : {}),
        start: placed ? start : i * STEP,
        end: placed ? end : (i + 1) * STEP,
      };
    });
}

/** Puts each stimulus where the manifest says; the rest keep `toStudy`'s default places. */
function placeStimuli(study: Study, manifest: VttManifest): void {
  const placed = new Map(stimuliOf(manifest).map((s) => [s.key, s]));
  study.stimuli = study.stimuli.map((stimulus) => {
    const given = placed.get(stimulus.guid);
    const start = parseTimestamp(given?.start);
    const end = parseTimestamp(given?.end);
    return start !== undefined && end !== undefined && end > start ? { ...stimulus, start, end } : stimulus;
  });
}

function toTranscriptFromCues(
  cues: Cue[],
  roster: Map<string, { guid: string; actor: VttActor }>,
  moderatorGuid: string,
  study: Study,
): Transcript {
  const participants = study.screener?.participants ?? [];
  const clips: Clip[] = [];
  const badges: QuestionBadge[] = [];
  let currentQuestion: string | undefined;

  cues.forEach((cue, i) => {
    const voice = voiceOf(cue);
    if (!voice) throw new VttImportError(`Cue ${i + 1} („${cue.id}“) nennt keine Stimme (<v Name>).`);
    const speaker = roster.get(voice);
    if (!speaker) throw new VttImportError(`Cue ${i + 1}: „${voice}“ steht nicht unter „actors“.`);

    const moderator = speaker.guid === moderatorGuid;
    const raw = textOf(cue.tree).replace(/\s+/g, ' ').trim();
    let text = raw;
    if (moderator) {
      for (const match of raw.matchAll(QUESTION_TAG)) {
        currentQuestion = match[1].toLowerCase();
        badges.push({ questionKey: currentQuestion, start: cue.startTime });
      }
      text = raw.replace(QUESTION_TAG, '').trim();
    }
    if (!text) return;

    const title = cue.id.trim();
    clips.push({
      guid: `cue-${i + 1}`,
      speakerGuid: speaker.guid,
      speakerName: voice,
      moderator,
      text,
      ...(title && !NUMERIC_ID.test(title) ? { title } : {}),
      start: cue.startTime,
      end: cue.endTime,
      ...(currentQuestion ? { questionKey: currentQuestion } : {}),
    });
  });

  return {
    clips,
    badges,
    done: doneQuestions(clips, badges, participants),
    duration: clips.reduce((max, c) => Math.max(max, c.end), 0),
  };
}

function voiceOf(cue: Cue): string | undefined {
  for (const node of cue.tree.children as { name?: string; value?: string }[]) {
    if (node.name === 'v' && typeof node.value === 'string') return node.value.trim();
  }
  return undefined;
}

function textOf(node: unknown): string {
  const n = node as { type?: string; value?: string; children?: unknown[] };
  if (n.type === 'text') return n.value ?? '';
  return (n.children ?? []).map(textOf).join('');
}
