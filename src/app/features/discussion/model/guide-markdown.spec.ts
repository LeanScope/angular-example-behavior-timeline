import { guideFromMarkdown } from './guide-markdown';

/** An excerpt of a guide as LeanScope keeps it: the `description` of an Interview Guide resource. */
const MARKDOWN = `# Diskussionsleitfaden – Stadtwerke Lindenau

## A. Begrüßung der Teilnehmenden

- Reihum-Vorstellung der Teilnehmenden (Vorname, Alter, Beruf)

## C. Kampagnenübersicht: Erster Eindruck und Ranking

**Materialien:** Übersichtsfolie mit allen drei Kampagnen, Übersicht_Kampagnen.png

- Online-Bewertungsbogen, Teil 1:
  - Ranking: Welche Kampagne gefällt Ihnen am besten?
- **Blitzlicht:** Jede Person nennt reihum ihren Platz 1

## D. Kampagne 2 im Detail (20 min)

### 5.1. Spontane Assoziationen

- Was fällt Ihnen als Erstes auf? Wohin geht Ihr Blick zuerst?, Kampagne2.png

### 5.2. Gesamtbewertung

**Materialien:** Online-Bewertungsbogen, Teil 3

1. Im Vergleich zu Kampagne 1: Was ist hier besser gelöst? , Kampagne1.png, Kampagne2.png
2) Was sollte wegfallen?,Kampagne1.png Kampagne2.png

**Abschließend – alle drei Motive auf einer Folie:**

---
`;

describe('guideFromMarkdown', () => {
  const guide = guideFromMarkdown('Discussion Guide', MARKDOWN);
  const questions = guide.blocks.flatMap((b) => b.questions);

  it('takes the title from the first heading and a block from each second-level heading', () => {
    expect(guide.title).toBe('Diskussionsleitfaden – Stadtwerke Lindenau');
    expect(guide.blocks.map((b) => [b.code, b.title, b.questions.length])).toEqual([
      ['A', 'Begrüßung der Teilnehmenden', 1],
      ['B', 'Kampagnenübersicht: Erster Eindruck und Ranking', 3],
      ['C', 'Kampagne 2 im Detail', 3],
    ]);
    expect(guide.blocks[2].minutes).toBe(20);
  });

  it('makes every bullet a question, nested and numbered ones too, keyed in guide order', () => {
    expect(questions.map((q) => [q.key, q.code, q.text])).toEqual([
      ['q_1', 'A1', 'Reihum-Vorstellung der Teilnehmenden (Vorname, Alter, Beruf)'],
      ['q_2', 'B1', 'Online-Bewertungsbogen, Teil 1:'],
      ['q_3', 'B2', 'Ranking: Welche Kampagne gefällt Ihnen am besten?'],
      ['q_4', 'B3', 'Blitzlicht: Jede Person nennt reihum ihren Platz 1'],
      ['q_5', 'C1', 'Was fällt Ihnen als Erstes auf? Wohin geht Ihr Blick zuerst?'],
      ['q_6', 'C2', 'Im Vergleich zu Kampagne 1: Was ist hier besser gelöst?'],
      ['q_7', 'C3', 'Was sollte wegfallen?'],
    ]);
  });

  it('cuts the files off a question, and gives one without files those its block names', () => {
    expect(questions.map((q) => q.materials)).toEqual([
      undefined,
      ['Übersicht_Kampagnen.png'],
      ['Übersicht_Kampagnen.png'],
      ['Übersicht_Kampagnen.png'],
      ['Kampagne2.png'],
      ['Kampagne1.png', 'Kampagne2.png'],
      ['Kampagne1.png', 'Kampagne2.png'],
    ]);
  });

  it('uses the given name for a guide without a title, and has no blocks for one without bullets', () => {
    expect(guideFromMarkdown('Discussion Guide', '## A. Einstieg\n- Wie geht es Ihnen?').title).toBe('Discussion Guide');
    expect(guideFromMarkdown('Leer', 'Nur ein Absatz.\n\n---').blocks).toEqual([]);
  });
});
