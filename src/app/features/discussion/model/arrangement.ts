import type { Guide, GuideBlock, Transcript } from './study.model';

/** A guide block placed on the timeline (seconds). */
export interface PlacedBlock {
  code: string;
  title: string;
  tone: number;
  start: number;
  end: number;
  /** Planned length from the guide. */
  minutes: number;
  /** True when every question of the block is done. */
  done: boolean;
  /** True while the discussion has not reached the block: it shows its planned length. */
  planned: boolean;
}

/**
 * Where the guide's blocks sit on the timeline. Before the discussion, the blocks follow each
 * other with their planned minutes. Once it runs, a block starts where the moderator opened its
 * first question and ends where the next reached block starts (or the discussion's end); blocks
 * not reached yet follow with their planned length, so the timeline shows how long it may still
 * take — like a live broadcast that runs shorter or longer than planned.
 */
export function arrangeBlocks(guide: Guide | null, transcript: Transcript): PlacedBlock[] {
  if (!guide) return [];
  const blockOf = new Map(guide.blocks.flatMap((b) => b.questions.map((q) => [q.key, b.code])));
  const reachedAt = new Map<string, number>();
  for (const badge of transcript.badges) {
    const code = blockOf.get(badge.questionKey);
    if (code && !reachedAt.has(code)) reachedAt.set(code, badge.start);
  }

  const reached = guide.blocks
    .filter((b) => reachedAt.has(b.code))
    .sort((a, b) => reachedAt.get(a.code)! - reachedAt.get(b.code)!);
  const placed: PlacedBlock[] = reached.map((block, i) => {
    const start = reachedAt.get(block.code)!;
    const next = reached[i + 1];
    const end = next ? reachedAt.get(next.code)! : Math.max(transcript.duration, start + 1);
    return { ...describe(block, transcript), start, end, planned: false };
  });

  let time = placed.at(-1)?.end ?? 0;
  for (const block of guide.blocks) {
    if (reachedAt.has(block.code)) continue;
    const end = time + block.minutes * 60;
    placed.push({ ...describe(block, transcript), start: time, end, planned: true });
    time = end;
  }
  return placed;
}

function describe(block: GuideBlock, transcript: Transcript) {
  return {
    code: block.code,
    title: block.title,
    tone: block.tone,
    minutes: block.minutes,
    done: block.questions.length > 0 && block.questions.every((q) => transcript.done.has(q.key)),
  };
}

/** The block the discussion is in at `time`: the last one that started, if any. */
export function blockAt(blocks: PlacedBlock[], time: number): PlacedBlock | undefined {
  let found: PlacedBlock | undefined;
  for (const block of blocks) {
    if (block.start <= time && (!found || block.start >= found.start)) found = block;
  }
  return found;
}
