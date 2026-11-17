import { stringify } from 'yaml';
import { traitAttributes } from './actor-traits';
import type { Clip, Participant, Study, Transcript } from './study.model';
import type { VttActor, VttManifest } from './vtt-import';

/**
 * The transcript as WebVTT: one cue per clip, the speaker as a voice span (`<v Name>`).
 * Times are the estimated ones the timeline shows.
 */
export function toWebVtt(clips: Clip[], title = ''): string {
  const header = title ? `WEBVTT - ${oneLine(title)}` : 'WEBVTT';
  const cues = clips.map(
    (clip, i) =>
      `${i + 1}\n${timestamp(clip.start)} --> ${timestamp(clip.end)}\n` +
      `<v ${voiceName(clip.speakerName)}>${escapeText(clip.text)}`,
  );
  return [header, ...cues].join('\n\n') + '\n';
}

export interface SelfContainedVtt {
  title: string;
  description?: string;
  study: Study;
  transcript: Transcript;
  moderator: { guid: string; name: string; imageUrl?: string | null; color?: string | null };
}

/**
 * The discussion as a self-contained WebVTT (format: `vtt-import.ts`): the manifest carries the
 * study and the cast, each cue's identifier is the turn's title, and a moderator cue that opened a
 * guide question starts with its `[q_…]` tag. `fromWebVtt` reads it back to the same screen.
 */
export function toSelfContainedVtt(input: SelfContainedVtt): string {
  const { study, transcript, moderator } = input;
  const participants = study.screener?.participants ?? [];
  const actors: Record<string, VttActor> = {
    [voiceName(moderator.name)]: {
      personaRef: moderator.guid,
      moderator: true,
      ...(moderator.imageUrl ? { imageUrl: moderator.imageUrl } : {}),
      ...(moderator.color ? { color: moderator.color } : {}),
    },
  };
  for (const p of participants) actors[voiceName(p.name)] = toActor(p);

  const manifest: VttManifest = {
    title: oneLine(input.title),
    ...(input.description ? { description: oneLine(input.description) } : {}),
    study: {
      ...(study.brief
        ? {
            brief: {
              name: study.brief.title,
              goals: study.brief.goals.map((g) => oneLine(g.text)),
              researchQuestions: study.brief.researchQuestions.map((q) => oneLine(q.text)),
            },
          }
        : {}),
      ...(study.guide
        ? {
            guide: {
              name: study.guide.title,
              blocks: study.guide.blocks.map((b) => ({
                heading: `Block ${b.code} – ${b.title} (${b.minutes} min)`,
                questions: b.questions.map((q) => ({ key: q.key, text: oneLine(q.text) })),
              })),
            },
          }
        : {}),
      ...(study.screener
        ? { screener: { name: study.screener.title, criteria: study.screener.criteria.map((c) => oneLine(c.text)) } }
        : {}),
      ...(study.stimuli.length
        ? {
            stimuli: study.stimuli.map((s) => ({
              key: s.guid,
              name: oneLine(s.name),
              // A repository file is named by its guid: a blob URL means nothing outside this tab.
              ...(s.fileRef && s.resourceRef ? { resourceRef: s.resourceRef, fileRef: s.fileRef } : { url: s.url }),
              mimeType: s.mimeType,
              start: timestamp(s.start),
              end: timestamp(s.end),
              ...(s.credit ? { credit: oneLine(s.credit) } : {}),
              ...(s.source ? { source: s.source } : {}),
            })),
          }
        : {}),
    },
    actors,
  };

  // No blank line may appear in the manifest (it would end the NOTE), so nothing is folded.
  const yaml = stringify(manifest, { lineWidth: 0 }).trimEnd();
  const opened = new Map<Clip, string[]>();
  for (const badge of transcript.badges) {
    const clip = transcript.clips.find((c) => c.moderator && c.start === badge.start);
    if (clip) opened.set(clip, [...(opened.get(clip) ?? []), badge.questionKey]);
  }
  const cues = transcript.clips.map((clip, i) => {
    const tags = (opened.get(clip) ?? []).map((key) => `[${key}] `).join('');
    const id = clip.title ? cueId(clip.title) : String(i + 1);
    return (
      `${id || i + 1}\n${timestamp(clip.start)} --> ${timestamp(clip.end)}\n` +
      `<v ${voiceName(clip.speakerName)}>${tags}${escapeText(clip.text)}`
    );
  });
  return [`WEBVTT\n${oneLine(input.title)}`, 'NOTE\n```yaml\n' + yaml + '\n```', ...cues].join('\n\n') + '\n';
}

function toActor(p: Participant): VttActor {
  // A trait the recording named by guid goes back as a parameter, not as a labelled attribute.
  const traits = new Set(traitAttributes(p.parameters ?? []).map((a) => a.label));
  const attributes = (p.attributes ?? []).filter((a) => !traits.has(a.label));
  return {
    personaRef: p.guid,
    ...(p.parameters?.length ? { parameters: p.parameters.map((x) => ({ ...x })) } : {}),
    ...(p.role ? { role: oneLine(p.role) } : {}),
    ...(p.profile ? { profile: oneLine(p.profile) } : {}),
    ...(p.demographics ? { demographics: oneLine(p.demographics) } : {}),
    ...(attributes.length
      ? { attributes: Object.fromEntries(attributes.map((a) => [a.label, oneLine(a.value)])) }
      : {}),
    ...(p.color ? { color: p.color } : {}),
    ...(p.imageUrl ? { imageUrl: p.imageUrl } : {}),
    ...(p.ocean ? { ocean: { ...p.ocean } } : {}),
  };
}

/** A cue identifier is one line and may not contain `-->`. */
function cueId(title: string): string {
  return oneLine(title).replace(/-->/g, '→');
}

/** `HH:MM:SS.mmm` */
export function timestamp(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}.${String(rest).padStart(3, '0')}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Cue text may not contain `-->` or an empty line; `&` and `<` must be escaped. */
function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

function voiceName(name: string): string {
  return oneLine(name).replace(/[<>&]/g, '');
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
