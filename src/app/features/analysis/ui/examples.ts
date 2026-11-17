import type { StudyBrief } from '../../discussion/model/study.model';

/** A sample question for the cards. */
export interface Example {
  text: string;
  icon: string;
}

/** Questions that fit any group discussion about campaigns. */
export const BUILT_IN_EXAMPLES: Example[] = [
  { text: 'Welche Kampagnenlinie bevorzugen die Teilnehmenden?', icon: 'chart' },
  { text: 'Wie oft wird Regionalität als Stärke der Stadtwerke genannt?', icon: 'hash' },
  { text: 'Welche Motive werden am häufigsten kritisiert und warum?', icon: 'message' },
  {
    text: 'Wie unterscheiden sich Traditionelle und Progressive in ihrer Bewertung der Kampagnen?',
    icon: 'segment',
  },
];

/**
 * The study's research questions first (they are what the client wants answered), then the
 * built-in ones, without duplicates.
 */
export function examplesFor(brief: StudyBrief | null | undefined): Example[] {
  const fromBrief = (brief?.researchQuestions ?? []).map((q) => ({ text: q.text.trim(), icon: 'spark' }));
  const seen = new Set<string>();
  return [...fromBrief, ...BUILT_IN_EXAMPLES].filter((e) => {
    const key = e.text.toLowerCase();
    if (!e.text || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
