import { toGuide, type ChildNode } from './study-mapper';
import type { Guide } from './study.model';

/**
 * A guide written as markdown (the `description` of a LeanScope `📋 Interview Guide` resource)
 * as the app's `Guide`:
 *
 * ```
 * # Diskussionsleitfaden            ← the title (else `name`)
 * ## B. Markenwahrnehmung           ← a block
 * ### 4.1. Spontane Assoziationen   ← a subsection: its questions stay in the block
 * **Materialien:** Folie, Übersicht.png   ← not a question; its file is shown with the questions below
 * - Wo sehen Sie Schwächen?         ← a question
 * - Was fällt Ihnen auf?, Kampagne1.png   ← a question and the file shown with it
 * ```
 *
 * A question's `materials` are the file names at its end. One that names none takes those of the
 * last such line above it in its subsection, else in its block.
 *
 * Every bullet is one question, nested ones too: the agent server splits a guide the same way
 * (`parseQuestions`, leanscope-agent-server `src/workers/interview-guide/interview-guide.ts`).
 * Paragraphs, bold-only lines and rules are not questions.
 *
 * This is string parsing because the guide is prose a researcher writes; a line it does not
 * recognise is left out, never an error. Keys are `q_1`, `q_2`, … in guide order, so an export
 * can tag the moderator's turns with them (`QUESTION_TAG`).
 */
export function guideFromMarkdown(name: string, markdown: string): Guide {
  let title = '';
  let heading = '';
  const questions: ChildNode[] = [];
  const materials = new Map<string, string[]>();
  /** Files a non-question line named for the questions below it: for the block, and for the subsection. */
  let blockFiles: string[] = [];
  let sectionFiles: string[] | null = null;
  let inSection = false;

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const head = line.match(HEADING);
    if (head) {
      const text = plain(head[2]);
      if (head[1].length === 1) title ||= text;
      else if (head[1].length === 2) [heading, blockFiles, inSection] = [text, [], false];
      else inSection = true;
      if (head[1].length > 1) sectionFiles = null;
      continue;
    }
    const bullet = line.match(BULLET);
    if (!bullet) {
      const named = splitMaterials(plain(line)).files;
      if (named.length && inSection) sectionFiles = named;
      else if (named.length) blockFiles = named;
      continue;
    }
    const { text, files } = splitMaterials(plain(bullet[1]));
    if (!text) continue;
    const key = `q_${questions.length + 1}`;
    questions.push({ guid: key, key, kind: 'question', line: text, description: heading, listIndex: questions.length });
    const shown = files.length ? files : (sectionFiles ?? blockFiles);
    if (shown.length) materials.set(key, shown);
  }

  const guide = toGuide({ guid: 'guide', line: title || name, children: questions });
  for (const block of guide.blocks) {
    for (const question of block.questions) {
      const files = materials.get(question.key);
      if (files) question.materials = files;
    }
  }
  return guide;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*$/;
/** `- `, `* `, `• `, `1. `, `1) `. A rule (`---`) or bold (`**x**`) has no space after its mark. */
const BULLET = /^(?:[-*•]|\d+[.)])\s+(.+)$/;
/** A file name at the end of a question: ", Kampagne1.png" (the comma is sometimes missing). */
const TRAILING_FILE = /[\s,]+([^\s,]+\.(?:png|jpe?g|gif|webp|svg|pdf))$/i;

/** Cuts the file names off a question's end: "Was fällt auf?, K1.png, K2.png" → text + both. */
function splitMaterials(line: string): { text: string; files: string[] } {
  const files: string[] = [];
  let text = line;
  for (let match = text.match(TRAILING_FILE); match; match = text.match(TRAILING_FILE)) {
    files.unshift(match[1]);
    text = text.slice(0, match.index);
  }
  return { text: text.replace(/[\s,]+$/, ''), files };
}

/** Markdown emphasis off: `**Blitzlicht:** reihum` → `Blitzlicht: reihum`. */
function plain(text: string): string {
  return text.replace(/(\*\*|__)(.+?)\1/g, '$2').trim();
}
