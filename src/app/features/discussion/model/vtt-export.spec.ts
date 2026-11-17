import type { Clip } from './study.model';
import { timestamp, toWebVtt } from './vtt-export';

const clip = (start: number, end: number, speakerName: string, text: string): Clip => ({
  guid: String(start),
  speakerGuid: speakerName,
  speakerName,
  moderator: false,
  text,
  start,
  end,
});

describe('toWebVtt', () => {
  it('writes one cue per clip with the speaker as a voice', () => {
    expect(
      toWebVtt(
        [clip(0, 4.5, 'Maren', 'Willkommen!'), clip(3725.25, 3730, 'Inge <IP>', 'A & B\n\nC --> D')],
        'Gruppe 1',
      ),
    ).toBe(
      'WEBVTT - Gruppe 1\n\n' +
        '1\n00:00:00.000 --> 00:00:04.500\n<v Maren>Willkommen!\n\n' +
        '2\n01:02:05.250 --> 01:02:10.000\n<v Inge IP>A &amp; B\nC --&gt; D\n',
    );
  });

  it('formats timestamps', () => {
    expect(timestamp(-1)).toBe('00:00:00.000');
    expect(timestamp(61.0004)).toBe('00:01:01.000');
  });
});
