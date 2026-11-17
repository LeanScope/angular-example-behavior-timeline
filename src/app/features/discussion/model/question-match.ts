import type { Guide, QuestionBadge, Stimulus, Transcript } from './study.model';

/**
 * Assigns a recording's turns to the guide's questions by their words, for a transcript whose
 * moderator turns carry no `[q_…]` tag (the agent server's export). One that has badges already
 * comes back unchanged: its own tags are the moderator's word.
 *
 * A moderator paraphrases the guide ("Was sind ihre Stärken?" becomes "Stefan, was findest du
 * stark an ihnen?"), so a turn opens the question whose words it covers best:
 *
 * - Words are compared lower-case, without umlauts and common endings; a word also matches a
 *   compound that starts with it ("Vorstellung" ~ "Vorstellungsrunde").
 * - A turn fits a question by how much of the question it says (weight of the shared words /
 *   weight of the question's words) and how much of what it says is that question (/ weight of
 *   the turn's words that the guide knows); the score is their harmonic mean. A word that few
 *   questions use weighs more (idf), so "Stadtwerke" counts little. Words in brackets
 *   ("(ggf. nachfragen: Idee, Farben)") are probes: they count when said, but need not be.
 * - A question that names a file (`materials`) can only be asked while a stimulus of that name is
 *   on screen. That tells the same question about Kampagne 1 and Kampagne 2 apart. A file that no
 *   stimulus of the recording is named after binds nothing.
 * - A guide is mostly followed in order: of the questions that score about as well as the best,
 *   the first at or after the current one wins, and one outside the current and the next block
 *   needs a clearer match. The current question stays while it still fits nearly as well.
 * - A turn that opens no question by its words is a follow-up and stays with the current one.
 *   The exception is the first turn under a newly shown stimulus: it opens the next question
 *   that names it ("Schaut euch die Übersicht an" has none of the guide's words).
 *
 * A recording read from its repository knows more: each step names its topic, and the topic
 * lists the guide questions it covers (`topics`, per clip guid the keys of those questions). A
 * moderator turn with a topic can only open one of its questions. When its words fit none of them
 * and the current question is not among them, it opens the first one that is on screen, at or
 * after the current question.
 *
 * This is a heuristic: it can miss a free paraphrase and take a follow-up for a new question.
 * So it says which question a turn belongs to, but never that a question is `done`: whether
 * everyone answered it cannot be told from a guess made after the discussion.
 */
export function matchQuestions(
  transcript: Transcript,
  guide: Guide,
  stimuli: readonly Stimulus[],
  topics?: ReadonlyMap<string, ReadonlySet<string>>,
): Transcript {
  const questions = guide.blocks.flatMap((b) => b.questions);
  if (transcript.badges.length || !questions.length) return transcript;

  const words = questions.map((q) => questionWords(q.text));
  const weight = weights(words.map((w) => w.all));
  const vocabulary = [...weight.keys()];
  const coreWeight = words.map((w) => sum(w.core, weight));
  /** What a word that only one question uses weighs: less in common is a coincidence. */
  const minShared = MIN_SHARED * Math.log(1 + questions.length);
  const blockOf = guide.blocks.flatMap((b, i) => b.questions.map(() => i));

  const shown = stimuli.map((s) => ({ name: fileKey(s.name), start: s.start, end: s.end }));
  /** Per question: the files it names that a stimulus of this recording is named after. */
  const bound = questions.map((q) =>
    (q.materials ?? []).map(fileKey).filter((m) => m && shown.some((s) => s.name.includes(m))),
  );
  const onScreen = (index: number, time: number) =>
    !bound[index].length ||
    bound[index].some((m) => shown.some((s) => s.name.includes(m) && s.start <= time && time < s.end));

  const badges: QuestionBadge[] = [];
  let current = -1;
  let lastTurn = -Infinity;
  const clips = transcript.clips.map((clip) => {
    if (clip.moderator) {
      const said = wordsOf(clip.text);
      const known = new Set(vocabulary.filter((w) => says(said, w)));
      const knownWeight = sum(known, weight);
      const topic = topics?.get(clip.guid);
      const scores = questions.map((q, i) => {
        if (!onScreen(i, clip.start) || (topic && !topic.has(q.key))) return 0;
        const shared = [...words[i].all].filter((w) => known.has(w));
        const sharedWeight = sum(shared, weight);
        if (shared.length < 2 || sharedWeight < minShared) return 0;
        // A probe that is said counts on both sides; one that is not said is not missed.
        const probes = sum(shared.filter((w) => !words[i].core.has(w)), weight);
        const covered = sharedWeight / (coreWeight[i] + probes);
        const meant = sharedWeight / knownWeight;
        const score = (2 * covered * meant) / (covered + meant);
        const ahead = current < 0 ? 0 : blockOf[i] - blockOf[current];
        return ahead === 0 || ahead === 1 ? score : score * OTHER_BLOCK;
      });
      const best = Math.max(...scores);
      let found = current;
      if (best >= MIN_SCORE) {
        const close = scores.map((s, i) => (s >= best - TIE ? i : -1)).filter((i) => i >= 0);
        const stays = current >= 0 && scores[current] >= MIN_SCORE && scores[current] >= best - STAY;
        found = stays ? current : (close.find((i) => i >= current) ?? scores.indexOf(best));
      } else if (topic && !(current >= 0 && topic.has(questions[current].key))) {
        // The step's topic has moved on: its first question on screen, at or after the current one.
        const open = questions.map((q, i) => (topic.has(q.key) && onScreen(i, clip.start) ? i : -1)).filter((i) => i >= 0);
        found = open.find((i) => i >= current) ?? open[0] ?? current;
      } else {
        // The first turn under a stimulus that just came on: the next question that names it.
        const fresh = shown.filter((s) => lastTurn < s.start && s.start <= clip.start);
        const names = (i: number) => bound[i].some((m) => fresh.some((s) => s.name.includes(m)));
        if (fresh.length && !(current >= 0 && names(current))) {
          const next = questions.findIndex((_, i) => i > current && names(i));
          if (next >= 0) found = next;
        }
      }
      lastTurn = clip.start;
      if (found !== current) {
        current = found;
        badges.push({ questionKey: questions[found].key, start: clip.start });
      }
    }
    return current >= 0 ? { ...clip, questionKey: questions[current].key } : clip;
  });

  return { ...transcript, clips, badges, done: new Set() };
}

/** How well a turn must fit a question to open it (0–1). */
const MIN_SCORE = 0.34;
/** The shared words must weigh this many times a word only one question uses. */
const MIN_SHARED = 1;
/** A question outside the current and the next block keeps this much of its score. */
const OTHER_BLOCK = 0.6;
/** Scores this close to the best count as equal; guide order decides. */
const TIE = 0.05;
/** The current question stays while it fits this nearly as well as the best: a follow-up rephrases it. */
const STAY = 0.15;
/** A word this long also matches a compound that starts with it. */
const MIN_PREFIX = 6;

const STOP_WORDS = new Set(
  (
    'aber alle allen als also auch auf aus bei bin bis bitte bzw dann das dass dein deine deinem deinen deiner ' +
    'dem den denn der des dich die dies diese diesem diesen dieser dieses dir doch dort durch ein eine einem einen ' +
    'einer eines einmal etwas euch euer eure euren fur ganz gern ggf gibt hab habe haben hast hat hier ich ihm ihn ' +
    'ihnen ihr ihre ihrem ihren ihrer immer ist jede jeder jetzt kann kannst kein keine konnen konnte man mal mein ' +
    'meine mich mir mit nach nicht noch nun nur oder schon sehr sei sein seid sich sie sind soll sollen sollte ' +
    'sollten uber und uns unser vom von vor war was wenn wer werden wie wir wird wirst wurde wurden wurdest zum zur'
  ).split(' '),
);
const ENDINGS = ['ern', 'en', 'er', 'es', 'em', 'st', 'e', 'n', 's', 't'];

/** A question's words: `core` outside brackets, `all` with the probes in brackets. */
function questionWords(text: string): { core: Set<string>; all: Set<string> } {
  return { core: wordsOf(text.replace(/\([^)]*\)/g, ' ')), all: wordsOf(text) };
}

/** The words of a text that say something, each in a comparable form. */
function wordsOf(text: string): Set<string> {
  const words = new Set<string>();
  for (const word of fold(text).split(/[^a-z0-9]+/)) {
    if (word.length < 3 || STOP_WORDS.has(word)) continue;
    const ending = ENDINGS.find((e) => word.endsWith(e) && word.length - e.length >= 4);
    words.add(ending ? word.slice(0, -ending.length) : word);
  }
  return words;
}

function fold(text: string): string {
  return text.toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss');
}

/** True when the turn says the word, or a compound one of them starts ("freizeit" ~ "freizeitinteressen"). */
function says(said: ReadonlySet<string>, word: string): boolean {
  if (said.has(word)) return true;
  for (const other of said) {
    const [short, long] = word.length <= other.length ? [word, other] : [other, word];
    if (short.length >= MIN_PREFIX && long.startsWith(short)) return true;
  }
  return false;
}

/** idf: a word in every question weighs ln 2, a word in one of eighty about 4.4. */
function weights(questions: readonly ReadonlySet<string>[]): Map<string, number> {
  const count = new Map<string, number>();
  for (const words of questions) for (const w of words) count.set(w, (count.get(w) ?? 0) + 1);
  return new Map([...count].map(([w, n]) => [w, Math.log(1 + questions.length / n)]));
}

function sum(words: Iterable<string>, weight: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const w of words) total += weight.get(w) ?? 0;
  return total;
}

/** A file or stimulus name to compare: "Stimulus material: Kampagne1.png" and "Kampagne 1" both hold "kampagne1". */
function fileKey(name: string): string {
  return fold(name.trim())
    .replace(/\.[a-z0-9]{2,4}$/, '')
    .replace(/[^a-z0-9]+/g, '');
}
