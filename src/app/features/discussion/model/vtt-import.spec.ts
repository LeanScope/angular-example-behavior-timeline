import elections from '../../../../../public/demo/wahlplakate-buergerdialog.vtt' with { loader: 'text' };
import { guideFromMarkdown } from './guide-markdown';
import { matchQuestions } from './question-match';
import { toSelfContainedVtt } from './vtt-export';
import { VttImportError, fromWebVtt, parseTimestamp, vttCast } from './vtt-import';
import { MODERATOR_TRAIT, toModeratorRefs } from './actor-traits';

const fixture = (manifest: string, cues: string) =>
  `WEBVTT\nTitel\n\nNOTE\n\`\`\`yaml\n${manifest.trim()}\n\`\`\`\n\n${cues.trim()}\n`;

const MANIFEST = `
title: Testrunde
study:
  guide:
    name: Leitfaden Test
    blocks:
      - heading: Block A – Einstieg (10 min)
        questions:
          - key: q_a1
            text: Wer sind Sie?
  stimuli:
    - key: s1
      name: Plakat
      url: https://example.org/plakat.jpg
      mimeType: image/jpeg
      start: "00:00:03.000"
      end: "00:01:00.000"
      credit: "Foto: Jemand, CC BY-SA 4.0"
actors:
  Maren:
    personaRef: Mod-1
    moderator: true
    imageUrl: https://example.org/maren.png
  Inge Paulsen:
    personaRef: p-inge
    role: Lehrerin
    profile: Reist gern.
    attributes:
      Politische Orientierung: Mitte
`;

const CUES = `
Begrüßung
00:00:00.000 --> 00:00:02.500
<v Maren>Willkommen! [q_a1] Wer sind Sie?

7
00:00:03.000 --> 00:00:05.000
<v Inge Paulsen>Inge, A &amp; B.
`;

describe('fromWebVtt', () => {
  it('reads the study, the cast and the cues with their own times', () => {
    const d = fromWebVtt(fixture(MANIFEST, CUES));
    expect(d.title).toBe('Testrunde');
    expect(d.moderator).toEqual({ guid: 'mod-1', name: 'Maren', imageUrl: 'https://example.org/maren.png', color: null });
    expect(d.study.guide?.blocks.map((b) => [b.code, b.title, b.minutes])).toEqual([['A', 'Einstieg', 10]]);
    expect(d.study.screener?.participants[0]).toMatchObject({
      guid: 'p-inge',
      name: 'Inge Paulsen',
      filled: true,
      attributes: [{ label: 'Politische Orientierung', value: 'Mitte' }],
    });
    expect(d.study.stimuli[0]).toMatchObject({ guid: 's1', start: 3, end: 60, credit: 'Foto: Jemand, CC BY-SA 4.0' });

    const [opening, answer] = d.transcript.clips;
    expect(opening).toMatchObject({ moderator: true, text: 'Willkommen! Wer sind Sie?', title: 'Begrüßung', start: 0, end: 2.5 });
    // A numeric cue identifier is no title; entities are decoded.
    expect(answer.title).toBeUndefined();
    expect(answer).toMatchObject({ speakerGuid: 'p-inge', text: 'Inge, A & B.', questionKey: 'q_a1', start: 3 });
    expect(d.transcript.badges).toEqual([{ questionKey: 'q_a1', start: 0 }]);
    expect(d.transcript.duration).toBe(5);
  });

  it('refuses a voice the manifest does not name', () => {
    expect(() => fromWebVtt(fixture(MANIFEST, CUES.replace('<v Inge Paulsen>', '<v Fremde>')))).toThrow(
      /„Fremde“ steht nicht unter „actors“/,
    );
  });

  it('refuses a blank line inside the manifest, with its line', () => {
    const broken = fixture(MANIFEST.replace('study:', '\nstudy:'), CUES);
    expect(() => fromWebVtt(broken)).toThrow(VttImportError);
    expect(() => fromWebVtt(broken)).toThrow(/Leerzeile im Manifest.*Zeile 7/);
  });

  it('refuses an actor without a reference and a file without exactly one moderator', () => {
    expect(() => fromWebVtt(fixture(MANIFEST.replace('personaRef: p-inge', 'role2: x'), CUES))).toThrow(
      /„Inge Paulsen“ hat keine gültige personaRef/,
    );
    expect(() => fromWebVtt(fixture(MANIFEST.replace('moderator: true', 'moderator: false'), CUES))).toThrow(
      /Genau eine Person/,
    );
  });

  it('takes the moderator from the repository when the file names none', () => {
    const bare = fixture(MANIFEST.replace('moderator: true', 'moderator: false'), CUES);
    expect(vttCast(bare)).toEqual({ personaRefs: ['mod-1', 'p-inge'], namesModerator: false });
    const d = fromWebVtt(bare, { moderatorRefs: ['MOD-1'] });
    expect(d.moderator.name).toBe('Maren');
    expect(d.study.screener?.participants.map((p) => p.name)).toEqual(['Inge Paulsen']);
    // The file's own word wins over the repository's.
    expect(fromWebVtt(fixture(MANIFEST, CUES), { moderatorRefs: ['p-inge'] }).moderator.name).toBe('Maren');
  });

  it('reads the moderators from the Group Role relationships', () => {
    const row = (ownerRef: string, value: string) => ({
      ownerRef,
      parameterOverrides: [{ parameterRef: MODERATOR_TRAIT.parameterRef, value }],
    });
    const data = { uxmData: { resourceRelationships: [row('F3CC44E7', 'Moderator'), row('p-2', 'Participant')] } };
    expect(toModeratorRefs(data)).toEqual(['f3cc44e7']);
    expect(toModeratorRefs(null)).toEqual([]);
  });

  it('refuses a file without a manifest', () => {
    expect(() => fromWebVtt('WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\n<v A>Hi\n')).toThrow(/Kein Manifest/);
  });

  it('parses timestamps', () => {
    expect(parseTimestamp('01:02:03.5')).toBe(3723.5);
    expect(parseTimestamp('02:03.250')).toBe(123.25);
    expect(parseTimestamp(7)).toBe(7);
    expect(parseTimestamp('soon')).toBeUndefined();
  });
});

describe('the demo file and real-world manifests', () => {
  it('Wahlplakate has six citizens, four guide blocks and five credited posters', () => {
    const d = fromWebVtt(elections);
    const participants = d.study.screener?.participants ?? [];
    expect(participants).toHaveLength(6);
    expect(participants.every((p) => p.attributes?.some((a) => a.label === 'Politische Orientierung'))).toBe(true);
    // Portraits are picked by meaning from the agent server's public catalog.
    expect(participants.every((p) => p.imageUrl?.includes('/api/v1/resources/public/match?kind=image&q='))).toBe(true);
    expect(d.study.guide?.blocks.map((b) => b.code)).toEqual(['A', 'B', 'C', 'D']);
    expect(d.study.stimuli.map((s) => s.guid)).toEqual(['s_spd', 's_linke', 's_cdu', 's_afd', 's_gruene']);
    expect(d.study.stimuli.every((s) => s.credit?.startsWith('Plakat: '))).toBe(true);
    // Shown one after the other, without overlap.
    d.study.stimuli.slice(1).forEach((s, i) => expect(s.start).toBeGreaterThanOrEqual(d.study.stimuli[i].end));
    // Every guide question is opened, and every turn has a title.
    expect(new Set(d.transcript.badges.map((b) => b.questionKey)).size).toBe(7);
    expect(d.transcript.clips.every((c) => c.title)).toBe(true);
  });

  it('reads traits by guid: the Group Role makes the moderator, a segment share shows', () => {
    const manifest = `
title: Runde
actors:
  Maren:
    actorRef: mod-1
    parameters:
      - { ownerRef: mod-1, resourceRef: ${MODERATOR_TRAIT.resourceRef}, parameterRef: ${MODERATOR_TRAIT.parameterRef}, value: Moderator }
  Inge Paulsen:
    actorRef: p-inge
    parameters:
      - { ownerRef: role-1, resourceRef: bd0db97a-0584-47fc-8621-984dbd103882, parameterRef: 837576b3-1d20-4010-812f-7cc223753819, value: 19 }
`;
    const d = fromWebVtt(fixture(manifest, CUES));
    expect(d.moderator.name).toBe('Maren');
    const participants = d.study.screener?.participants ?? [];
    expect(participants.map((p) => p.name)).toEqual(['Inge Paulsen']);
    // No profile in the file, but nobody is "being generated": the cast of a recording is complete.
    expect(participants.every((p) => p.filled)).toBe(true);
    expect(participants[0].attributes).toContainEqual({ label: 'segmentSharePercentage', value: '19' });
    expect(participants[0].parameters).toEqual([
      {
        ownerRef: 'role-1',
        resourceRef: 'bd0db97a-0584-47fc-8621-984dbd103882',
        parameterRef: '837576b3-1d20-4010-812f-7cc223753819',
        value: '19',
      },
    ]);
  });

  it("reads the server export's top-level fileResources as stimuli", () => {
    const manifest = `
title: Runde
fileResources:
  - key: r_1
    name: "Stimulus material: Übersicht.png"
    resourceRef: res-1
    fileRef: file-1
    start: 00:17:56.000
    end: 01:05:09.000
  - key: r_2
    name: Kampagne1.png
    resourceRef: res-2
    fileRef: file-2
    start: 01:05:09.000
    end: 01:28:33.000
actors:
  Maren: { actorRef: mod-1, moderator: true }
  Inge Paulsen: { actorRef: p-inge }
`;
    const d = fromWebVtt(fixture(manifest, CUES));
    expect(d.study.stimuli).toEqual([]);
    expect(d.files.map((s) => [s.guid, s.name, s.resourceRef, s.fileRef, s.mimeType, s.start, s.end])).toEqual([
      ['r_1', 'Stimulus material: Übersicht.png', 'res-1', 'file-1', '', 1076, 3909],
      ['r_2', 'Kampagne1.png', 'res-2', 'file-2', '', 3909, 5313],
    ]);
  });

  it('prefers the hand-written study.stimuli over fileResources', () => {
    const both = `${MANIFEST.trim()}
fileResources:
  - key: r_1
    resourceRef: res-1
    fileRef: file-1
    start: "00:00:01.000"
    end: "00:00:02.000"
`;
    const d = fromWebVtt(fixture(both, CUES));
    expect(d.study.stimuli.map((s) => s.guid)).toEqual(['s1']);
    expect(d.files).toEqual([]);
  });

  it("reads the server export's sources, and leaves out one without a resource", () => {
    const manifest = `
title: Runde
sources:
  - key: s_1
    name: Discussion Guide
    resourceRef: ac34fe04-30ea-4023-87d6-b094316612d4
  - name: Screener
    resourceRef: res-2
    fileRef: file-2
  - key: s_3
    name: Ohne Ressource
actors:
  Maren: { actorRef: mod-1, moderator: true }
  Inge Paulsen: { actorRef: p-inge }
`;
    expect(fromWebVtt(fixture(manifest, CUES)).sources).toEqual([
      { key: 's_1', name: 'Discussion Guide', resourceRef: 'ac34fe04-30ea-4023-87d6-b094316612d4' },
      { key: 's_2', name: 'Screener', resourceRef: 'res-2', fileRef: 'file-2' },
    ]);
    expect(fromWebVtt(fixture(MANIFEST, CUES)).sources).toEqual([]);
  });
});

describe('toSelfContainedVtt', () => {
  it('writes a recording matched to its repository guide with the guide and its tags', () => {
    const manifest = `
title: Runde
actors:
  Maren: { actorRef: mod-1, moderator: true }
  Inge Paulsen: { actorRef: p-inge }
`;
    const cues = `
1
00:00:00.000 --> 00:00:05.000
<v Maren>Inge, wo siehst du bei den Stadtwerken noch Schwächen, was sollte besser werden?

2
00:00:05.000 --> 00:00:09.000
<v Inge Paulsen>Beim Preis.
`;
    const first = fromWebVtt(fixture(manifest, cues));
    const guide = guideFromMarkdown('Leitfaden', '## A. Einstieg\n- Wie geht es Ihnen heute?\n- Wo sehen Sie Schwächen? Was sollte besser werden?');
    const transcript = matchQuestions(first.transcript, guide, []);
    expect(transcript.badges).toEqual([{ questionKey: 'q_2', start: 0 }]);

    const again = fromWebVtt(toSelfContainedVtt({ ...first, study: { ...first.study, guide }, transcript }));
    expect(again.transcript.badges).toEqual(transcript.badges);
    expect(again.transcript.clips.map((c) => c.questionKey)).toEqual(['q_2', 'q_2']);
    expect(again.study.guide?.blocks[0].questions.map((q) => q.key)).toEqual(['q_1', 'q_2']);
  });

  it('round-trips through fromWebVtt', () => {
    for (const source of [elections, fixture(MANIFEST, CUES)]) {
      const first = fromWebVtt(source);
      const again = fromWebVtt(toSelfContainedVtt(first));
      expect(again.study).toEqual(first.study);
      expect(again.transcript).toEqual(first.transcript);
      expect(again.moderator).toEqual(first.moderator);
    }
  });
});
