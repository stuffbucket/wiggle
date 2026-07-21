// Hand-drawn brush strikethroughs via perfect-freehand — a marker/pen stroke
// (matching Wiggle's brush-mark icon), jittered per instance so no two strikes
// are identical, like a real editor's pen.
import { getStroke } from "perfect-freehand";

// Small deterministic PRNG so a given seed yields a stable-but-unique stroke.
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const avg = (a: number, b: number) => (a + b) / 2;

// perfect-freehand's canonical outline → SVG path helper.
function outlineToPath(points: number[][]): string {
  const len = points.length;
  if (len < 4) return "";
  let a = points[0];
  let b = points[1];
  const c = points[2];
  let d = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(
    2,
  )} ${avg(b[0], c[0]).toFixed(2)},${avg(b[1], c[1]).toFixed(2)} T`;
  for (let i = 2, max = len - 1; i < max; i++) {
    a = points[i];
    b = points[i + 1];
    d += `${avg(a[0], b[0]).toFixed(2)},${avg(a[1], b[1]).toFixed(2)} `;
  }
  return d + "Z";
}

/// A brush strike from (x1,y) to (x2,y), seeded so it's unique but stable.
export function strikePath(
  x1: number,
  x2: number,
  y: number,
  seed: number,
): string {
  const rnd = mulberry32(seed >>> 0);
  const over = 2 + rnd() * 8;
  const sx = x1 - over;
  const ex = x2 + over * 1.4;
  const tilt = (rnd() - 0.5) * 6; // slight overall slope, like a fast pen
  const segLen = 34;
  const n = Math.max(5, Math.round((ex - sx) / segLen));
  const pts: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = sx + (ex - sx) * t;
    const wobble = (rnd() - 0.5) * 3.4;
    const yy = y + tilt * (t - 0.5) + wobble;
    // fatter in the middle, tapered ends → marker feel
    const pressure = 0.35 + Math.sin(t * Math.PI) * 0.5 + rnd() * 0.12;
    pts.push([x, yy, pressure]);
  }
  const outline = getStroke(pts, {
    size: 6,
    thinning: 0.6,
    smoothing: 0.55,
    streamline: 0.6,
    start: { taper: 12 + rnd() * 16, cap: true },
    end: { taper: 20 + rnd() * 24, cap: true },
    simulatePressure: true,
  });
  return outlineToPath(outline);
}

/// A stable integer seed per mark from (block, visual line, run nonce), so the
/// same line wobbles identically across renders but differently each wiggle.
export function markSeed(block: number, line: number, nonce: number): number {
  let h = 2166136261 ^ block;
  h = Math.imul(h ^ line, 16777619);
  h = Math.imul(h ^ nonce, 16777619);
  return ((h >>> 0) % 2147483646) + 1;
}
