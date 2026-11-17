import type { VttParameter } from './actor-traits';
// The app's view of a study: what the dropped documents became, and what the discussion said.
// Times are seconds from the start of the discussion.

/** One block of the interview guide ("Block A – Einstieg (10 min)"): the arrangement track. */
export interface GuideBlock {
  /** "A", "B", …, in guide order. */
  code: string;
  title: string;
  /** Planned length. From the heading's "(10 min)", else an even share of the total. */
  minutes: number;
  /** Colour tone 1–8 (design tokens `--section-N-*`). */
  tone: number;
  questions: GuideQuestion[];
}

/** One interview question (not a research question). */
export interface GuideQuestion {
  /** The question facet's key (`q_1a2b3c4d`), as the moderator tags it in the discussion. */
  key: string;
  /** "A1", "A2", "B1", …: block letter plus position. */
  code: string;
  text: string;
  blockCode: string;
  tone: number;
  /** The files the guide names for this question ("Kampagne1.png"): what is on screen when it is asked. */
  materials?: string[];
}

export interface Guide {
  title: string;
  blocks: GuideBlock[];
  /** Sum of the blocks' minutes. */
  totalMinutes: number;
}

export interface StudyBrief {
  title: string;
  goals: { key: string; text: string }[];
  researchQuestions: { key: string; text: string }[];
}

export interface Ocean {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
}

/** A participant persona. A stub (`filled: false`) shows as a skeleton track. */
export interface Participant {
  guid: string;
  name: string;
  initials: string;
  filled: boolean;
  role?: string;
  profile?: string;
  demographics?: string;
  ocean?: Ocean;
  imageUrl?: string;
  /** The persona's colour (`Persona.backgroundColor`), e.g. for the role badge. */
  color?: string;
  /** Further traits for the Steckbrief ("Politische Orientierung": "Mitte"), in given order. */
  attributes?: ParticipantAttribute[];
  /** The traits a recording named by guid (`actor-traits.ts`), kept for its export. */
  parameters?: VttParameter[];
}

export interface ParticipantAttribute {
  label: string;
  value: string;
}

export interface Screener {
  title: string;
  criteria: { key: string; text: string }[];
  participants: Participant[];
}

export interface Stimulus {
  guid: string;
  name: string;
  url: string;
  mimeType: string;
  /** Attribution shown with the image ("Foto: …, CC BY-SA 4.0"), required by most free licences. */
  credit?: string;
  /** The page the image comes from (its licence and author). */
  source?: string;
  /** The LeanScope `File` it was read from, when `url` is a local copy (a blob URL). */
  fileRef?: string;
  /** The resource that owns that file: files are read through their resource. */
  resourceRef?: string;
  /** Where it sits on the stimuli track (seconds). Placed by the user; defaults to the end. */
  start: number;
  end: number;
}

export interface Study {
  brief: StudyBrief | null;
  guide: Guide | null;
  screener: Screener | null;
  stimuli: Stimulus[];
}

export const EMPTY_STUDY: Study = { brief: null, guide: null, screener: null, stimuli: [] };

/** One turn of the discussion on a speaker's track. */
export interface Clip {
  guid: string;
  speakerGuid: string;
  speakerName: string;
  /** True for the moderator's track. */
  moderator: boolean;
  text: string;
  /**
   * The turn in 2–4 words, from the step's `title` (written by the agent server when the choreo
   * opts in): participants with a leading emoji ("😟 Preis zu hoch"), the moderator without.
   * Absent while the step's title is still the speaker's name, or empty.
   */
  title?: string;
  start: number;
  end: number;
  /** The guide question this turn belongs to (the last one the moderator opened). */
  questionKey?: string;
  /** The repository's ScenarioStep this turn is, for a recording read from its repository. */
  stepGuid?: string;
}

/** Where the moderator actually opened a guide question (the badge track). */
export interface QuestionBadge {
  questionKey: string;
  start: number;
}

export interface Transcript {
  clips: Clip[];
  badges: QuestionBadge[];
  /** Keys of the questions every participant has answered and the moderator has left. */
  done: Set<string>;
  /** End of the last clip. */
  duration: number;
  /** The repository's Scenario the clips are the steps of, for a recording read from its repository. */
  scenarioGuid?: string;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : (parts[0][1] ?? '');
  return (first + last).toUpperCase();
}
