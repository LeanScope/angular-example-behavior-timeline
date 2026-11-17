import defaultLine from '../../../../../../public/brands/default/busy-line.svg' with { loader: 'text' };
import mindlineLine from '../../../../../../public/brands/mindline/busy-line.svg' with { loader: 'text' };
import { parseBusyLine } from '../../../../design-system/brand.service';
import { buildLoadingLineShape } from './loading-line-shape';

describe('brand busy line', () => {
  for (const [brand, svg] of [['default', defaultLine], ['mindline', mindlineLine]]) {
    it(`${brand}: the brand pack's busy-line.svg builds a seamless morph`, () => {
      const line = parseBusyLine(svg);
      expect(line).not.toBeNull();
      const shape = buildLoadingLineShape(line!.path, line!.strokeWidth);
      const frames = shape.values.split(';');
      expect(frames.length).toBe(shape.keyTimes.split(';').length);
      expect(frames[0]).toBe(shape.rest);
      expect(shape.viewBox.split(' ').map(Number).every(Number.isFinite)).toBe(true);
    });
  }

  it('reads no line from an SVG without a path', () => {
    expect(parseBusyLine('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBeNull();
  });
});
