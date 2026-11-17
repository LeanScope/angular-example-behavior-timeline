import { guideFromMarkdown } from './guide-markdown';
import { matchQuestions } from './question-match';
import type { Clip, Stimulus, Transcript } from './study.model';

/** An excerpt of the Stadtwerke Lindenau guide (repository 2449). */
const GUIDE = guideFromMarkdown(
  'Discussion Guide',
  `## A. Begrüßung der Teilnehmenden
- Reihum-Vorstellung der Teilnehmenden (Vorname, Alter, Beruf, Familienstand, Freizeitinteressen, Wohnsituation)
## B. Stadtwerke Lindenau: Markenwahrnehmung
- Projektiv: Wenn die Stadtwerke Lindenau eine Person wären – wie wäre diese Person? (Alter, Auftreten, Charakter)
- Was schätzen Sie an den Stadtwerken Lindenau? Was sind ihre Stärken?
- Wo sehen Sie Schwächen? Was sollte besser werden?
- Wo haben Sie die Stadtwerke Lindenau in letzter Zeit wahrgenommen? (Plakate, Anzeigen, Social Media)
- Was würde überhaupt nicht zu den Stadtwerken Lindenau passen?
## C. Kampagnenübersicht
**Materialien:** Übersichtsfolie mit allen drei Kampagnen, Übersicht_Kampagnen.png
- Präsentation aller drei Kampagnen nacheinander ohne Diskussion
- Begründung Platz 1: Was macht diese Kampagne besser als die anderen?
## D. Kampagne 1 im Detail
- Was fällt Ihnen als Erstes auf? Wohin geht Ihr Blick zuerst?, Kampagne1.png
- Wie glaubwürdig finden Sie die Aussagen? Nimmt man das den Stadtwerken Lindenau ab?, Kampagne1.png
## E. Kampagne 2 im Detail
- Was fällt Ihnen als Erstes auf? Wohin geht Ihr Blick zuerst?, Kampagne2.png
- Wie glaubwürdig finden Sie die Aussagen? Nimmt man das den Stadtwerken Lindenau ab?, Kampagne2.png`,
);
const CODE = new Map(GUIDE.blocks.flatMap((b) => b.questions.map((q) => [q.key, q.code])));

const stimulus = (name: string, start: number, end: number): Stimulus => ({
  guid: `${name}-${start}`,
  name,
  url: '',
  mimeType: '',
  start,
  end,
});
/** As the server's export names them, each shown for 100 seconds. */
const STIMULI = [
  stimulus('Stimulus material: Übersicht_Kampagnen.png', 100, 200),
  stimulus('Stimulus material: Kampagne1.png', 200, 300),
  stimulus('Stimulus material: Kampagne2.png', 300, 400),
];

/** A recording without tags: `[start, speaker, text]`, each turn 5 seconds. */
function recording(turns: [number, string, string][]): Transcript {
  const clips: Clip[] = turns.map(([start, speaker, text], i) => ({
    guid: `cue-${i + 1}`,
    speakerGuid: speaker.toLowerCase(),
    speakerName: speaker,
    moderator: speaker === 'Maren',
    text,
    start,
    end: start + 5,
  }));
  return { clips, badges: [], done: new Set(), duration: clips.at(-1)?.end ?? 0 };
}

/** The question each clip ended up with, as its code ("B3"). */
const codes = (t: Transcript) => t.clips.map((c) => (c.questionKey ? CODE.get(c.questionKey) : undefined));

describe('matchQuestions', () => {
  it('opens the question a paraphrasing moderator means, and keeps the answers with it', () => {
    const t = matchQuestions(
      recording([
        [0, 'Maren', 'Sagen Sie doch bitte Ihren Vornamen, Ihr Alter, Ihren Beruf und was Sie in Ihrer Freizeit machen.'],
        [10, 'Ernst', 'Ich bin Ernst, 48, Monteur.'],
        [20, 'Maren', 'Spannend, Max! Stefan, was findest du stark an den Stadtwerken Lindenau, was schätzt du?'],
        [30, 'Stefan', 'Den Service vor Ort.'],
        [40, 'Maren', 'Ernst, wo siehst du bei den Stadtwerken Lindenau noch Schwächen oder Dinge, die besser laufen könnten?'],
        [50, 'Ernst', 'Der Preis.'],
      ]),
      GUIDE,
      [],
    );
    expect(codes(t)).toEqual(['A1', 'A1', 'B2', 'B2', 'B3', 'B3']);
    expect(t.badges.map((b) => [CODE.get(b.questionKey), b.start])).toEqual([
      ['A1', 0],
      ['B2', 20],
      ['B3', 40],
    ]);
  });

  it('keeps a follow-up with the current question', () => {
    const t = matchQuestions(
      recording([
        [0, 'Maren', 'Ernst, wo siehst du bei den Stadtwerken Lindenau noch Schwächen, was sollte besser werden?'],
        [10, 'Ernst', 'Der Preis.'],
        [20, 'Maren', 'Das ist notiert, Ernst. Stefan, wie ist das bei dir?'],
        [30, 'Stefan', 'Die App.'],
      ]),
      GUIDE,
      [],
    );
    expect(codes(t)).toEqual(['B3', 'B3', 'B3', 'B3']);
    expect(t.badges.length).toBe(1);
  });

  it('tells the same question about two campaigns apart by the stimulus on screen', () => {
    const asked = 'Stefan, findest du die Aussagen auf den Motiven glaubwürdig? Nimmst du den Stadtwerken Lindenau das ab?';
    const t = matchQuestions(
      recording([
        [210, 'Maren', asked],
        [220, 'Stefan', 'Ja.'],
        [310, 'Maren', asked],
        [320, 'Stefan', 'Eher nicht.'],
      ]),
      GUIDE,
      STIMULI,
    );
    expect(codes(t)).toEqual(['D2', 'D2', 'E2', 'E2']);
  });

  it('matches a stimulus named by hand ("Kampagne 2") to the file the guide names', () => {
    const t = matchQuestions(
      recording([[310, 'Maren', 'Max, was fällt dir als Erstes auf? Wohin geht dein Blick zuerst?']]),
      GUIDE,
      [stimulus('Kampagne 1', 200, 300), stimulus('Kampagne 2', 300, 400)],
    );
    expect(codes(t)).toEqual(['E1']);
  });

  it('opens the next question that names a stimulus when it comes on and the turn says none of its words', () => {
    const t = matchQuestions(
      recording([
        [0, 'Maren', 'Ernst, was würde überhaupt nicht zu den Stadtwerken Lindenau passen?'],
        [100, 'Maren', 'Jetzt schaut euch bitte einmal in Ruhe das Bild an.'],
        [110, 'Maren', 'Lasst es einfach wirken.'],
      ]),
      GUIDE,
      STIMULI,
    );
    expect(codes(t)).toEqual(['B5', 'C1', 'C1']);
  });

  it('prefers a question of the current block over a better fit in a block the discussion has left', () => {
    const t = matchQuestions(
      recording([
        [210, 'Maren', 'Max, was fällt dir als Erstes auf? Wohin geht dein Blick zuerst?'],
        // Says B5's "überhaupt … passen" and D2's "Aussagen glaubwürdig": B5 fits better, but B is over.
        [220, 'Maren', 'Karl, passt das überhaupt? Findest du die Aussagen glaubwürdig?'],
      ]),
      GUIDE,
      STIMULI,
    );
    expect(codes(t)).toEqual(['D1', 'D2']);
  });

  it('never calls a question done: a match after the discussion cannot tell', () => {
    const t = matchQuestions(
      recording([
        [0, 'Maren', 'Wo seht ihr bei den Stadtwerken Lindenau Schwächen, was sollte besser werden?'],
        [10, 'Ernst', 'Der Preis.'],
        [20, 'Stefan', 'Die App.'],
        [30, 'Maren', 'Und was würde überhaupt nicht zu den Stadtwerken Lindenau passen?'],
      ]),
      GUIDE,
      [],
    );
    expect(t.badges.length).toBe(2);
    expect(t.done.size).toBe(0);
  });

  it("leaves a transcript with its own tags as it is, and one without a guide's questions too", () => {
    const tagged: Transcript = { ...recording([[0, 'Maren', 'Wo sehen Sie Schwächen?']]), badges: [{ questionKey: 'q_x', start: 0 }] };
    expect(matchQuestions(tagged, GUIDE, [])).toBe(tagged);
    const plain = recording([[0, 'Maren', 'Wo sehen Sie Schwächen?']]);
    expect(matchQuestions(plain, { title: '', blocks: [], totalMinutes: 0 }, [])).toBe(plain);
  });
});
