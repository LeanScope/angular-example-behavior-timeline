type Point = readonly [x: number, y: number];

/** One cubic Bézier piece of the line: two control points and its end point. */
type Cubic = readonly [control1: Point, control2: Point, end: Point];

/** Morph data for the animated line: its resting m plus SMIL `keyTimes`/`values` for one cycle. */
export interface LoadingLineShape {
  readonly viewBox: string;
  readonly strokeWidth: number;
  readonly rest: string;
  readonly keyTimes: string;
  readonly values: string;
}

/** Line width when the brand's busy line names none, in the line's own units. */
export const DEFAULT_STROKE_WIDTH = 2.64;
/** Maximum segment length; shorter pieces let a passing front bend long runs instead of tilting them. */
const SUBDIVISION_STEP = 1.5;
/** Width of the soft edge of each travelling front. */
const FRONT_SOFTNESS = 10;
/** Distance by which the regrowing front trails the flattening front. */
const FRONT_GAP = 26;
/** Share of the cycle in which the m rests before the wave flashes through. */
const REST_SHARE = 0.78;
const WAVE_FRAME_COUNT = 24;

const lerp = (a: Point, b: Point, t: number): Point => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
const distance = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Parses an absolute `M x,y C …` path into its start point and cubic pieces. */
function parseCenterline(path: string): { start: Point; cubics: Cubic[] } {
  const numbers = (path.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  const points: Point[] = [];
  for (let i = 0; i < numbers.length; i += 2) points.push([numbers[i], numbers[i + 1]]);
  const [start, ...rest] = points;
  const cubics: Cubic[] = [];
  for (let i = 0; i < rest.length; i += 3) cubics.push([rest[i], rest[i + 1], rest[i + 2]]);
  return { start, cubics };
}

/** Splits every cubic into equal parameter steps of at most about {@link SUBDIVISION_STEP}. */
function subdivide(start: Point, cubics: readonly Cubic[]): Cubic[] {
  const result: Cubic[] = [];
  let current = start;
  for (const [c1, c2, end] of cubics) {
    const length = distance(current, c1) + distance(c1, c2) + distance(c2, end);
    let [from, control1, control2] = [current, c1, c2];
    for (let remaining = Math.max(1, Math.round(length / SUBDIVISION_STEP)); remaining > 1; remaining--) {
      // De Casteljau split at 1/remaining yields equal parameter steps across the curve.
      const t = 1 / remaining;
      const a = lerp(from, control1, t);
      const b = lerp(control1, control2, t);
      const c = lerp(control2, end, t);
      const d = lerp(a, b, t);
      const e = lerp(b, c, t);
      const split = lerp(d, e, t);
      result.push([a, d, split]);
      [from, control1, control2] = [split, e, c];
    }
    result.push([control1, control2, end]);
    current = end;
  }
  return result;
}

/** Tight bounds of the drawn curve (not its control polygon), sampled per piece. */
function curveBounds(start: Point, cubics: readonly Cubic[]) {
  const xs = [start[0]];
  const ys = [start[1]];
  let from = start;
  for (const [c1, c2, end] of cubics) {
    for (let i = 1; i <= 8; i++) {
      const t = i / 8;
      const u = 1 - t;
      xs.push(u * u * u * from[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * end[0]);
      ys.push(u * u * u * from[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * end[1]);
    }
    from = end;
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

const smoothstep = (value: number) => {
  const v = Math.min(1, Math.max(0, value));
  return v * v * (3 - 2 * v);
};

/**
 * Precomputes the morph of a line (the brand's busy line, see `busy-line.svg` in the brand pack):
 * it rests, then a wave flattens and regrows it from left to right. `centerline` is an absolute
 * `M x,y` followed by `C` pieces, about 50 units wide (the wave's fronts are sized for that).
 */
export function buildLoadingLineShape(centerline: string, strokeWidth = DEFAULT_STROKE_WIDTH): LoadingLineShape {
  const { start, cubics } = parseCenterline(centerline);
  const pieces = subdivide(start, cubics);
  const bounds = curveBounds(start, pieces);
  // The flattened line lies on the vertical middle of the box, so it stays centred next to the text.
  const centerY = (bounds.minY + bounds.maxY) / 2;

  /** Renders the line with a per-x amplitude: 1 keeps the m, 0 flattens it onto `centerY`. */
  const shape = (amplitude: (x: number) => number) => {
    const point = ([x, y]: Point) => `${x.toFixed(2)},${(centerY + amplitude(x) * (y - centerY)).toFixed(2)}`;
    return `M ${point(start)} ${pieces.map((piece) => `C ${piece.map(point).join(' ')}`).join(' ')}`;
  };

  /** One wave frame: a flattening front at `front`, followed at {@link FRONT_GAP} by a regrowing front. */
  const wave = (front: number) =>
    shape(
      (x) =>
        1 -
        smoothstep((front - x) / FRONT_SOFTNESS) +
        smoothstep((front - FRONT_GAP - x) / FRONT_SOFTNESS),
    );

  const rest = shape(() => 1);
  // The fronts enter at the left end and leave once both have passed the right end, so the first
  // and last wave frames equal the resting m and the loop is seamless.
  const firstFront = bounds.minX;
  const lastFront = bounds.maxX + FRONT_SOFTNESS + FRONT_GAP;
  const frames: [time: number, path: string][] = [[0, rest]];
  for (let i = 0; i <= WAVE_FRAME_COUNT; i++) {
    const progress = i / WAVE_FRAME_COUNT;
    frames.push([REST_SHARE + (1 - REST_SHARE) * progress, wave(firstFront + (lastFront - firstFront) * progress)]);
  }

  const pad = strokeWidth / 2;
  const viewBox = [
    bounds.minX - pad,
    bounds.minY - pad,
    bounds.maxX - bounds.minX + strokeWidth,
    bounds.maxY - bounds.minY + strokeWidth,
  ].map((value) => value.toFixed(2));

  return {
    viewBox: viewBox.join(' '),
    strokeWidth,
    rest,
    keyTimes: frames.map(([time]) => time.toFixed(4)).join(';'),
    values: frames.map(([, path]) => path).join(';'),
  };
}
