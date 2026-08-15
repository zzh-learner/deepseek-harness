/**
 * The thinking-orb geometry engine: nine dot-lattice modes ported from the
 * orbs.jakubantalik.com (thinking-orbs) playground — seeded-rng orbit rings,
 * scan globe, band-twisting rubik, breathing wave, signal web, braid,
 * ribbon/ring bands, and shape morphing. Every generator is a pure function
 * `(size, t, opts) → OrbScene` over an orthographic yaw+tilt camera, with
 * dots as grayscale ink (`white` mixes toward light or dark by theme) and
 * depth-sorted painting. Constants preserve the source's hand-tuned values;
 * see the Agent Note for the port's provenance.
 *
 * @module @deepseek-ai/dsh-client-ui-orbs/src/client/orbs/engine
 */

/** One ink dot: canvas position, retained depth, radius, grayscale mix, opacity. */
export interface InkDot {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly r: number
  readonly white: number
  readonly a?: number
}

/** One ink line segment between two projected points. */
export interface InkLine {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
  readonly white: number
  readonly a: number
  readonly w: number
}

/** A complete drawable frame for one orb. */
export interface OrbScene {
  readonly dots: readonly InkDot[]
  readonly lines: readonly InkLine[]
}

/** The nine playground modes. */
export type OrbMode =
  | 'orbits' | 'globe' | 'rubik' | 'wave' | 'web'
  | 'braid' | 'ribbon' | 'ring' | 'morph'

/** Per-mode knobs; every consumer passes the hand-tuned {@link ORB_OPTIONS}. */
export interface OrbOptions {
  readonly orbitN?: number
  readonly ghostN?: number
  readonly ghostR?: number
  readonly ghostA?: number
  readonly particles?: number
  readonly partR?: number
  readonly partRDepth?: number
  readonly latRings?: number
  readonly lonDensity?: number
  readonly rBase?: number
  readonly rDepth?: number
  readonly rBoost?: number
  readonly rActive?: number
  readonly inkFar?: number
  readonly inkSpan?: number
  readonly rings?: number
  readonly nodeN?: number
  readonly thr?: number
  readonly signals?: number
  readonly nodeR?: number
  readonly nodeRDepth?: number
  readonly lineW?: number
  readonly strandN?: number
  readonly turns?: number
  readonly lanes?: number
  readonly segs?: number
  readonly moveCount?: number
  readonly rsPow?: number
  readonly rMin?: number
  readonly scanMul?: number
  readonly dimBase?: number
  readonly spin?: number
  readonly bandMul?: number
  readonly wobMul?: number
  readonly faceOn?: number
  readonly rDot?: number
  readonly spread?: number
}

/** Source time multipliers per mode (the 64px tuning table). */
export const ORB_SPEEDS: Readonly<Record<OrbMode, number>> = {
  orbits: 1.885,
  globe: 2.015,
  wave: 4.388,
  web: 3.315,
  braid: 1.625,
  ribbon: 2.34,
  ring: 3.24,
  rubik: 1.82,
  morph: 2.405,
}

/** Idle rotation order: morph fronts the sequence, then the curated tour. */
export const ORB_ROTATION: readonly OrbMode[] = [
  'morph', 'orbits', 'globe', 'rubik', 'ribbon', 'wave', 'web', 'braid', 'ring',
]

/**
 * One mode's total knob set: exactly the fields its generator reads, all
 * required. The hand-tuned table below satisfies this per mode, so a
 * generator's `n.field` reads never see `undefined` and carry no per-field
 * default branches.
 */
export type ModeOptions = {
  orbits: Required<Pick<OrbOptions, 'orbitN' | 'ghostN' | 'ghostR' | 'ghostA' | 'particles' | 'partR' | 'partRDepth' | 'rsPow' | 'rMin'>>
  globe: Required<Pick<OrbOptions, 'latRings' | 'lonDensity' | 'rBase' | 'rDepth' | 'rBoost' | 'inkFar' | 'inkSpan' | 'rsPow' | 'rMin' | 'scanMul' | 'dimBase'>>
  wave: Required<Pick<OrbOptions, 'rings' | 'lonDensity' | 'rBase' | 'rDepth' | 'rsPow' | 'rMin'>>
  web: Required<Pick<OrbOptions, 'nodeN' | 'thr' | 'signals' | 'nodeR' | 'nodeRDepth' | 'lineW' | 'rsPow' | 'rMin'>>
  braid: Required<Pick<OrbOptions, 'strandN' | 'turns' | 'ghostN' | 'rBase' | 'rDepth' | 'rsPow' | 'rMin'>>
  ribbon: Required<Pick<OrbOptions, 'lanes' | 'segs' | 'ghostN' | 'rBase' | 'rDepth' | 'rsPow' | 'rMin' | 'spin' | 'bandMul' | 'wobMul'>>
  ring: Required<Pick<OrbOptions, 'lanes' | 'segs' | 'ghostN' | 'rBase' | 'rDepth' | 'rsPow' | 'rMin' | 'spin' | 'bandMul' | 'wobMul' | 'faceOn'>>
  rubik: Required<Pick<OrbOptions, 'latRings' | 'lonDensity' | 'moveCount' | 'rBase' | 'rDepth' | 'rActive' | 'inkFar' | 'inkSpan' | 'rsPow' | 'rMin'>>
  morph: Required<Pick<OrbOptions, 'rDot' | 'rMin' | 'spread'>>
}

/** The hand-tuned knobs per mode (source: thinking-orbs 64px table). */
export const ORB_OPTIONS: Readonly<ModeOptions> = {
  orbits: { orbitN: 12, ghostN: 40, ghostR: 0.9, ghostA: 0.5, particles: 3, partR: 1.2, partRDepth: 1.6, rsPow: 0.6, rMin: 0.3 },
  globe: {
    latRings: 17, lonDensity: 44, rBase: 0.6, rDepth: 1.7, rBoost: 1,
    inkFar: 0.62, inkSpan: 0.54, rsPow: 0.6, rMin: 0.3, scanMul: 4.08, dimBase: 0.45,
  },
  wave: { rings: 15, lonDensity: 40, rBase: 0.6, rDepth: 1.7, rsPow: 0.6, rMin: 0.3 },
  web: { nodeN: 30, thr: 0.72, signals: 5, nodeR: 1.4, nodeRDepth: 1.8, lineW: 0.8, rsPow: 0.6, rMin: 0.3 },
  braid: { strandN: 52, turns: 3, ghostN: 150, rBase: 1.2, rDepth: 1.8, rsPow: 0.6, rMin: 0.3 },
  ribbon: { lanes: 3, segs: 44, ghostN: 38, rBase: 0.94, rDepth: 1.45, rsPow: 0.6, rMin: 0.3, spin: 0, bandMul: 3.9, wobMul: 1 },
  ring: {
    lanes: 3, segs: 44, ghostN: 0, rBase: 1.05, rDepth: 1.63, rsPow: 0.6,
    rMin: 0.3, spin: 0, bandMul: 3.627, wobMul: 0.368, faceOn: 1,
  },
  rubik: {
    latRings: 15, lonDensity: 40, moveCount: 14, rBase: 0.6, rDepth: 1.7,
    rActive: 0.3, inkFar: 0.62, inkSpan: 0.54, rsPow: 0.6, rMin: 0.3,
  },
  morph: { rDot: 0.0083, rMin: 0.25, spread: 1.45 },
}

/** Seeded rng (source constant pair). */
function ze(a: number, b: number): number {
  const n = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
  return n - Math.floor(n)
}

/**
 * Element read for indices the loops keep in range by construction (modular
 * arithmetic, walked segments); asserting beats re-checking every hot-loop
 * access the caller cannot make out-of-range. Exported for the component's
 * rotation walk, which shares the same modular-index guarantee.
 * @param xs - source array.
 * @param i - in-range index.
 * @returns the element.
 */
export function pick<T>(xs: readonly T[], i: number): T {
  return xs[i] as T
}

/** Fractional part. */
function frac(x: number): number {
  return x - Math.floor(x)
}

/** Fibonacci-sphere point i of n. */
function wu(i: number, n: number): readonly [number, number, number] {
  const g = Math.PI * (3 - Math.sqrt(5))
  const r = 1 - 2 * (i + 0.5) / n
  const l = Math.sqrt(1 - r * r)
  const o = i * g
  return [l * Math.cos(o), r, l * Math.sin(o)]
}

/** Radius scale: dot radii grow superlinearly with the orb's canvas size. */
function vt(size: number, p: number): number {
  return (size / 300) ** p
}

/** Signed angular difference. */
function angDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}

/**
 * Orthographic camera: yaw `e` and tilt `t`, center (n, r), depth scale `l`.
 * @returns projector from 3D unit-ish space to [x, y, z].
 */
function cam(e: number, t: number, n: number, r: number, l: number) {
  const o = Math.sin(t)
  const u = Math.cos(t)
  const i = Math.sin(e)
  const s = Math.cos(e)
  return (f: number, v: number, h: number): readonly [number, number, number] => {
    const p = f * s + h * i
    const y = -f * i + h * s
    const g = v * u - y * o
    const w = v * o + y * u
    return [n + p * l, r - g * l, w]
  }
}

/** Depth-normalized 0..1 from a projected z against its sphere radius. */
function depthOf(z: number, radius: number): number {
  return (z / radius + 1) / 2
}

/** Filter sub-visible dots and depth-sort (painter's order). */
function finish(dots: InkDot[], lines: InkLine[], rMin: number): OrbScene {
  const out = dots.filter(d => (d.a ?? 1) >= 0.02)
  for (const d of out) {
    (d as { r: number }).r = Math.max(rMin, d.r)
  }
  out.sort((a, b) => a.z - b.z)
  return { dots: out, lines: lines.filter(l => l.a >= 0.02) }
}

function genOrbits(size: number, t: number, n: ModeOptions['orbits']): OrbScene {
  const half = size / 2
  const reach = half * 0.82
  const project = cam(t * 0.12, 0.3, half, half, 1)
  const scale = vt(size, n.rsPow)
  const dots: InkDot[] = []
  const orbitN = n.orbitN
  const ghostN = n.ghostN
  const particles = n.particles
  for (let p = 0; p < orbitN; p++) {
    const y = ze(p, 1.7)
    const g = ze(p, 5.2)
    const w = ze(p, 8.9)
    const radius = reach * (0.45 + 0.52 * y)
    const yaw0 = y * 2 * Math.PI
    const polar = Math.acos(2 * g - 1)
    const dx = Math.sin(polar) * Math.cos(yaw0)
    const my = Math.cos(polar)
    const dz = Math.sin(polar) * Math.sin(yaw0)
    // Orbit plane basis: primary axis (S, x) normal to the orbit pole, with
    // E fixed to +z so the cross products close the frame.
    let sx = -my
    let ax = dx
    const len = Math.max(1e-6, Math.hypot(sx, ax))
    sx /= len
    ax /= len
    const ez = 0
    const bu = my * ez - dz * ax
    const bv = dz * sx - dx * ez
    const bw = dx * ax - my * sx
    const speed = (0.25 + 0.55 * w) * (w > 0.5 ? 1 : -1)
    for (let i = 0; i < ghostN; i++) {
      const a = i / ghostN * 2 * Math.PI
      const px = (sx * Math.cos(a) + bu * Math.sin(a)) * radius
      const py = (ax * Math.cos(a) + bv * Math.sin(a)) * radius
      const pz = (ez * Math.cos(a) + bw * Math.sin(a)) * radius
      const [x, y2, z] = project(px, py, pz)
      const d = depthOf(z, radius)
      dots.push({ x, y: y2, z, r: (n.ghostR) * scale, white: 0.72, a: (n.ghostA) * (0.4 + 0.6 * d) })
    }
    for (let i = 0; i < particles; i++) {
      const a = t * speed + i / particles * 2 * Math.PI + g * 6
      const px = (sx * Math.cos(a) + bu * Math.sin(a)) * radius
      const py = (ax * Math.cos(a) + bv * Math.sin(a)) * radius
      const pz = (ez * Math.cos(a) + bw * Math.sin(a)) * radius
      const [x, y2, z] = project(px, py, pz)
      const d = depthOf(z, radius)
      dots.push({ x, y: y2, z, r: ((n.partR) + (n.partRDepth) * d) * scale, white: 0.3 - 0.22 * d })
    }
  }
  return finish(dots, [], n.rMin)
}

function genGlobe(size: number, t: number, n: ModeOptions['globe']): OrbScene {
  const half = size / 2
  const reach = half * 0.82
  const project = cam(t * 0.5, 0.4 + 0.06 * Math.sin(t * 0.35), half, half, reach)
  const scan = t * (0.5 + 1.2 * (n.scanMul))
  const scale = vt(size, n.rsPow)
  const dimBase = n.dimBase
  const dots: InkDot[] = []
  const latRings = n.latRings
  const lonDensity = n.lonDensity
  for (let w = 0; w <= latRings; w++) {
    const lat = -Math.PI / 2 + w / latRings * Math.PI
    const ringR = Math.cos(lat)
    const y = Math.sin(lat)
    const per = Math.max(1, Math.round(Math.abs(ringR) * lonDensity))
    for (let i = 0; i < per; i++) {
      const lon = i / per * 2 * Math.PI
      const [x, y2, z] = project(ringR * Math.cos(lon), y, ringR * Math.sin(lon))
      const d = depthOf(z, 1)
      const off = angDiff(lon + t * 0.5, scan)
      const boost = Math.exp(-(off * off) / 0.18) * Math.max(0, z)
      dots.push({
        x,
        y: y2,
        z,
        r: ((n.rBase) + (n.rDepth) * d + (n.rBoost) * boost) * scale,
        white: (n.inkFar) - (n.inkSpan) * d,
        a: dimBase + (1 - dimBase) * Math.min(1, boost),
      })
    }
  }
  return finish(dots, [], n.rMin)
}

function genWave(size: number, t: number, n: ModeOptions['wave']): OrbScene {
  const half = size / 2
  const reach = half * 0.874
  const project = cam(t * 0.18, 0.38, half, half, 1)
  const scale = vt(size, n.rsPow)
  const dots: InkDot[] = []
  const rings = n.rings
  const lonDensity = n.lonDensity
  for (let h = 0; h <= rings; h++) {
    const lat = -Math.PI / 2 + h / rings * Math.PI
    const ringR = Math.cos(lat)
    const y = Math.sin(lat)
    const breathe = 0.62 * Math.sin(t * 2.1 - h * 0.52) + 0.38 * Math.sin(t * 1.27 + h * 0.83)
    const radius = reach * (0.88 + 0.105 * breathe)
    const per = Math.max(1, Math.round(Math.abs(ringR) * lonDensity))
    for (let i = 0; i < per; i++) {
      const lon = i / per * 2 * Math.PI
      const [x, y2, z] = project(ringR * Math.cos(lon) * radius, y * radius, ringR * Math.sin(lon) * radius)
      const d = depthOf(z, reach)
      const lift = Math.max(0, breathe)
      dots.push({
        x,
        y: y2,
        z,
        r: ((n.rBase) + (n.rDepth) * d) * (1 + 0.4 * lift) * scale,
        white: 0.66 - 0.56 * d - 0.1 * lift,
      })
    }
  }
  return finish(dots, [], n.rMin)
}

/** Bilinear value noise the web nodes drift on. */
function noise2(e: number, t: number): number {
  const n = Math.floor(e)
  const r = Math.floor(t)
  let l = e - n
  let o = t - r
  l = l * l * (3 - 2 * l)
  o = o * o * (3 - 2 * o)
  const u = ze(n, r)
  const i = ze(n + 1, r)
  const s = ze(n, r + 1)
  const f = ze(n + 1, r + 1)
  return u + (i - u) * l + (s - u) * o + (u - i - s + f) * l * o
}

function genWeb(size: number, t: number, n: ModeOptions['web']): OrbScene {
  const half = size / 2
  const reach = half * 0.8
  const project = cam(t * 0.12, 0.32, half, half, reach)
  const scale = vt(size, n.rsPow)
  const nodeN = n.nodeN
  const threshold = n.thr
  const dots: InkDot[] = []
  const lines: InkLine[] = []
  const pts: [number, number, number][] = []
  for (let i = 0; i < nodeN; i++) {
    const base = wu(i, nodeN)
    const x = base[0] + 0.3 * (noise2(i * 0.31 + 9, t * 0.24) - 0.5) * 2
    const y = base[1] + 0.3 * (noise2(i * 0.53 + 27, t * 0.21) - 0.5) * 2
    const z = base[2] + 0.3 * (noise2(i * 0.77 + 55, t * 0.27) - 0.5) * 2
    const len = Math.hypot(x, y, z)
    pts.push([x / len, y / len, z / len])
  }
  for (let i = 0; i < nodeN; i++) {
    const pi = pick(pts, i)
    for (let j = i + 1; j < nodeN; j++) {
      const pj = pick(pts, j)
      const dist = Math.hypot(pi[0] - pj[0], pi[1] - pj[1], pi[2] - pj[2])
      if (dist >= threshold) continue
      const p1 = project(pi[0], pi[1], pi[2])
      const p2 = project(pj[0], pj[1], pj[2])
      const d = ((p1[2] + p2[2]) / 2 + 1) / 2
      lines.push({
        x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1],
        white: 0.42,
        a: (1 - dist / threshold) * (0.3 + 0.55 * d),
        w: Math.max(0.6, (n.lineW) * scale),
      })
    }
  }
  for (let i = 0; i < nodeN; i++) {
    const pt = pick(pts, i)
    const p = project(pt[0], pt[1], pt[2])
    const d = depthOf(p[2], 1)
    const pulse = 1 + 0.25 * Math.sin(t * 1.4 + i * 2.7)
    dots.push({
      x: p[0], y: p[1], z: p[2],
      r: ((n.nodeR) + (n.nodeRDepth) * d) * pulse * scale,
      white: 0.55 - 0.45 * d,
    })
  }
  const signals = n.signals
  for (let i = 0; i < signals; i++) {
    const seed = Math.floor(t * 0.55 + i * 7.31)
    const from = Math.floor(ze(seed, i * 3.1 + 1.7) * nodeN)
    const to = Math.floor(ze(seed, i * 5.7 + 4.2) * nodeN)
    if (from === to) continue
    const prog = frac(t * 0.55 + i * 7.31)
    const src = pick(pts, from)
    const dst = pick(pts, to)
    const mx = src[0] + (dst[0] - src[0]) * prog
    const my = src[1] + (dst[1] - src[1]) * prog
    const mz = src[2] + (dst[2] - src[2]) * prog
    const len = Math.max(1e-6, Math.hypot(mx, my, mz))
    const p = project(mx / len, my / len, mz / len)
    const d = depthOf(p[2], 1)
    dots.push({
      x: p[0], y: p[1], z: p[2],
      r: ((n.nodeR) * 1.5 + (n.nodeRDepth) * d) * scale,
      white: 0.05,
      a: 0.5 + 0.5 * d,
    })
  }
  return finish(dots, lines, n.rMin)
}

function genBraid(size: number, t: number, n: ModeOptions['braid']): OrbScene {
  const half = size / 2
  const reach = half * 0.76
  const project = cam(t * 0.4, 0.3, half, half, 1)
  const scale = vt(size, n.rsPow)
  const dots: InkDot[] = []
  const ghostN = n.ghostN
  for (let i = 0; i < ghostN; i++) {
    const g = wu(i, ghostN)
    const p = project(g[0] * reach, g[1] * reach, g[2] * reach)
    const d = depthOf(p[2], reach)
    dots.push({ x: p[0], y: p[1], z: p[2], r: 0.8 * scale, white: 0.78, a: 0.1 + 0.22 * d })
  }
  const strandN = n.strandN
  const turns = n.turns
  for (let strand = 0; strand < 3; strand++) {
    const offset = strand / 3 * 2 * Math.PI
    for (let i = 0; i < strandN; i++) {
      const w = (frac(i / strandN + t * 0.045) * 2 - 1) * 0.96
      const ringR = Math.sqrt(Math.max(0, 1 - w * w))
      const a = w * Math.PI * turns + offset
      const bulge = 1 + 0.075 * Math.sin(w * Math.PI * turns * 2 + offset * 2 + t * 0.8)
      const radius = ringR * reach * bulge
      const p = project(Math.cos(a) * radius, w * reach * bulge, Math.sin(a) * radius)
      const d = depthOf(p[2], reach)
      dots.push({
        x: p[0], y: p[1], z: p[2],
        r: ((n.rBase) + (n.rDepth) * d) * scale,
        white: 0.62 - 0.5 * d,
        a: 0.8,
      })
    }
  }
  return finish(dots, [], n.rMin)
}

// ribbon and ring share this generator over the ring field superset: the
// ribbon table omits `faceOn`, whose undefined reads as the falsy non-facing
// branch — exactly ribbon's shape.
function genRibbonRing(size: number, t: number, n: ModeOptions['ring'] | ModeOptions['ribbon']): OrbScene {
  const half = size / 2
  const reach = half * 0.78
  const faceOn = (n as ModeOptions['ring']).faceOn === 1
  const spin = n.spin
  const project = cam(t * 0.1 * spin, 0.3, half, half, 1)
  const scale = vt(size, n.rsPow)
  const dots: InkDot[] = []
  const ghostN = n.ghostN
  for (let i = 0; i < ghostN; i++) {
    const g = wu(i, ghostN)
    const p = project(g[0] * reach, g[1] * reach, g[2] * reach)
    const d = depthOf(p[2], reach)
    dots.push({ x: p[0], y: p[1], z: p[2], r: 0.8 * scale, white: 0.78, a: 0.1 + 0.22 * d })
  }
  // Band frame: precessing pole (yaw p, tilt yy) spanned by (c, a, d) with
  // (m, k, S) as the lane-offset direction.
  const p = t * 0.24 * spin
  const yy = faceOn ? -0.3 : 0.55 + 0.3 * Math.sin(t * 0.18) * spin
  const g0 = Math.cos(p)
  const s0 = Math.sin(p)
  const cx = -s0 * Math.sin(yy)
  const ay = Math.cos(yy)
  const dz = g0 * Math.sin(yy)
  const mx = -s0 * ay
  const ky = s0 * cx - g0 * dz
  const sz = g0 * ay
  const wobble = 0.23 * (n.wobMul)
  const bandReach = faceOn ? reach / (1 + 0.85 * wobble) : reach
  const lanes = n.lanes
  const segs = n.segs
  const bands = Math.max(1, Math.round(lanes * (n.bandMul)))
  for (let i = 0; i < bands; i++) {
    const lane = (i - (bands - 1) / 2) * 0.075
    const edge = Math.abs(i - (bands - 1) / 2) / Math.max(1, (bands - 1) / 2)
    for (let j = 0; j < segs; j++) {
      const a = j / segs * 2 * Math.PI
      const wob = (0.16 * Math.sin(a * 3 - t * 1.7 + i * 0.22) + 0.07 * Math.sin(a * 5 + t * 1.1)) * (n.wobMul)
      const mul = faceOn ? 1 + wob : 1
      const laneOff = faceOn ? lane : lane + wob
      const tx = g0 * Math.cos(a) + cx * Math.sin(a) + mx * laneOff
      const ty = ay * Math.sin(a) + ky * laneOff
      const tz = s0 * Math.cos(a) + dz * Math.sin(a) + sz * laneOff
      const len = Math.hypot(tx, ty, tz)
      const radius = bandReach * mul
      const proj = project(tx / len * radius, ty / len * radius, tz / len * radius)
      const d = depthOf(proj[2], reach)
      dots.push({
        x: proj[0], y: proj[1], z: proj[2],
        r: ((n.rBase) + (n.rDepth) * d) * (1 - 0.25 * edge) * scale,
        white: 0.52 - 0.44 * d + 0.18 * edge,
        a: 0.4 + 0.6 * d,
      })
    }
  }
  return finish(dots, [], n.rMin)
}

/** One rubik band move: which axis, which coordinate band, twist sign. */
interface RubikMove {
  readonly axis: 0 | 1 | 2
  readonly lo: number
  readonly hi: number
  readonly ang: number
}

const rubikMovesCache = new Map<number, readonly RubikMove[]>()

/** Seeded move schedule (source generator). */
function rubikMoves(count: number): readonly RubikMove[] {
  const cached = rubikMovesCache.get(count)
  if (cached !== undefined) return cached
  const moves: RubikMove[] = []
  for (let i = 0; i < count; i++) {
    const axis = Math.min(2, Math.floor(ze(i, 2.3) * 3)) as 0 | 1 | 2
    const lo = -1 + 0.5 * Math.min(3, Math.floor(ze(i, 5.9) * 4))
    const sign = ze(i, 7.7) < 0.5 ? 1 : -1
    moves.push({ axis, lo, hi: lo + 0.5, ang: sign * Math.PI / 2 })
  }
  rubikMovesCache.set(count, moves)
  return moves
}

/** Eased twist amounts for each move at time t: how far each band has turned. */
function rubikTwist(t: number, count: number, phase: number, gap: number) {
  const cycle = 2 * count * phase + gap
  const pos = t % cycle
  const amounts = new Array<number>(count).fill(0)
  let active = -1
  if (pos < 2 * count * phase) {
    const slot = Math.floor(pos / phase)
    const frac2 = (pos - slot * phase) / phase
    const eased = 1 - (1 - Math.min(1, frac2 / 0.7)) ** 3
    if (slot < count) {
      for (let i = 0; i < slot; i++) amounts[i] = 1
      amounts[slot] = eased
      active = slot
    } else {
      const back = 2 * count - 1 - slot
      for (let i = 0; i < back; i++) amounts[i] = 1
      amounts[back] = 1 - eased
      active = back
    }
  }
  return { amounts, active }
}

/** Apply every band twist whose coordinate band contains the point. */
function rubikRotate(
  point: readonly [number, number, number],
  moves: readonly RubikMove[],
  twist: { readonly amounts: readonly number[]; readonly active: number },
): readonly [number, number, number, boolean] {
  let [x, y, z] = point
  let onActive = false
  for (let i = 0; i < moves.length; i++) {
    const amount = pick(twist.amounts, i)
    if (amount <= 0) continue
    const move = pick(moves, i)
    const coord = move.axis === 0 ? x : move.axis === 1 ? y : z
    if (coord < move.lo || coord >= move.hi) continue
    if (i === twist.active) onActive = true
    const angle = move.ang * amount
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    if (move.axis === 0) {
      const ny = y * cos - z * sin
      z = y * sin + z * cos
      y = ny
    } else if (move.axis === 1) {
      const nx = x * cos + z * sin
      z = -x * sin + z * cos
      x = nx
    } else {
      const nx = x * cos - y * sin
      y = x * sin + y * cos
      x = nx
    }
  }
  return [x, y, z, onActive]
}

function genRubik(size: number, t: number, n: ModeOptions['rubik']): OrbScene {
  const half = size / 2
  const reach = half * 0.82
  const project = cam(t * 0.55, 0.35 + 0.1 * Math.sin(t * 0.9), half, half, reach)
  const scale = vt(size, n.rsPow)
  const moves = rubikMoves(n.moveCount)
  const twist = rubikTwist(t, n.moveCount, 0.42, 1.2)
  const dots: InkDot[] = []
  const latRings = n.latRings
  const lonDensity = n.lonDensity
  for (let g = 0; g <= latRings; g++) {
    const lat = -Math.PI / 2 + g / latRings * Math.PI
    const ringR = Math.cos(lat)
    const y = Math.sin(lat)
    const per = Math.max(1, Math.round(Math.abs(ringR) * lonDensity))
    for (let i = 0; i < per; i++) {
      const lon = i / per * 2 * Math.PI
      const [rx, ry, rz, onActive] = rubikRotate([ringR * Math.cos(lon), y, ringR * Math.sin(lon)], moves, twist)
      const p = project(rx, ry, rz)
      const d = depthOf(p[2], 1)
      dots.push({
        x: p[0], y: p[1], z: p[2],
        r: ((n.rBase) + (n.rDepth) * d + (onActive ? (n.rActive) : 0)) * scale,
        white: (n.inkFar) - (n.inkSpan) * d - (onActive ? 0.14 : 0),
      })
    }
  }
  return finish(dots, [], n.rMin)
}

/** Smoothstep. */
function smooth(x: number): number {
  return x * x * (3 - 2 * x)
}

/** Arc-length sampler over a closed polyline. */
function arcSampler(points: readonly (readonly [number, number])[]) {
  const count = points.length
  const lengths: number[] = []
  let total = 0
  for (let i = 0; i < count; i++) {
    const a = pick(points, i)
    const b = pick(points, (i + 1) % count)
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    lengths.push(len)
    total += len
  }
  return (at: number): readonly [number, number] => {
    let remain = at * total
    let seg = 0
    while (remain > pick(lengths, seg) && seg < count - 1) {
      remain -= pick(lengths, seg)
      seg++
    }
    const a = pick(points, seg)
    const b = pick(points, (seg + 1) % count)
    const frac2 = Math.min(1, remain / pick(lengths, seg))
    return [a[0] + (b[0] - a[0]) * frac2, a[1] + (b[1] - a[1]) * frac2]
  }
}

/** The morph shapes: circle, triangle, square (source constants). */
const SHAPES = [
  (e: number): readonly [number, number] => {
    const a = -Math.PI / 2 + e * 2 * Math.PI
    return [Math.cos(a) * 0.24, Math.sin(a) * 0.24]
  },
  arcSampler([[0, -0.26], [0.24, 0.16], [-0.24, 0.16]]),
  arcSampler([[0, -0.2], [0.2, -0.2], [0.2, 0.2], [-0.2, 0.2], [-0.2, -0.2]]),
]

/** Morph cycle: hold then blend (source constants). */
const MORPH_HOLD = 1.4
const MORPH_BLEND = 0.9
const MORPH_CYCLE = 2.3

function genMorph(size: number, t: number, n: ModeOptions['morph']): OrbScene {
  const shapeCount = SHAPES.length
  const cyclePos = t % (MORPH_CYCLE * shapeCount)
  const index = Math.floor(cyclePos / MORPH_CYCLE)
  const within = cyclePos - index * MORPH_CYCLE
  const blend = within > MORPH_HOLD ? smooth((within - MORPH_HOLD) / MORPH_BLEND) : 0
  const spread = n.spread
  const from = pick(SHAPES, index)
  const to = pick(SHAPES, (index + 1) % shapeCount)
  const steps = 160
  const outline: [number, number][] = []
  for (let i = 0; i < steps; i++) {
    const at = i / steps
    const a = from(at)
    const b = to(at)
    outline.push([(a[0] + (b[0] - a[0]) * blend) * spread, (a[1] + (b[1] - a[1]) * blend) * spread])
  }
  const lengths: number[] = []
  let total = 0
  for (let i = 0; i < steps; i++) {
    const a = pick(outline, i)
    const b = pick(outline, (i + 1) % steps)
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    lengths.push(len)
    total += len
  }
  const iconScale = Math.max(0.35, size / 260)
  const dotCount = Math.max(6, Math.round(34 * iconScale))
  const radius = (n.rDot) * 1.35 * spread
  const breathe = 1 + 0.02 * Math.sin(within * 3.1)
  const dots: InkDot[] = []
  const half = size / 2
  let walked = 0
  let seg = 0
  for (let i = 0; i < dotCount; i++) {
    const target = i / dotCount * total
    while (walked + pick(lengths, seg) < target && seg < steps - 1) {
      walked += pick(lengths, seg)
      seg++
    }
    const a = pick(outline, seg)
    const b = pick(outline, (seg + 1) % steps)
    const segLen = pick(lengths, seg)
    const frac2 = Math.min(1, (target - walked) / segLen)
    const x = (a[0] + (b[0] - a[0]) * frac2) * breathe
    const y = (a[1] + (b[1] - a[1]) * frac2) * breathe
    dots.push({ x: half + x * size, y: half + y * size, z: 0, r: Math.max(0.35, radius * size), white: 0.1 })
  }
  return finish(dots, [], n.rMin)
}

/** Mode → generator dispatch (internal; the component drives it). */
const GENERATORS: { [M in OrbMode]: (size: number, t: number, opts: ModeOptions[M]) => OrbScene } = {
  orbits: genOrbits,
  globe: genGlobe,
  wave: genWave,
  web: genWeb,
  braid: genBraid,
  // ribbon's table lacks the ring-only faceOn flag; the generator's union
  // parameter accepts both shapes.
  ribbon: genRibbonRing,
  ring: genRibbonRing,
  rubik: genRubik,
  morph: genMorph,
}

/**
 * Build one orb's scene for a mode at animation time `t`.
 * @param mode - which playground mode to render.
 * @param size - square canvas side in CSS pixels.
 * @param t - mode-scaled animation time in seconds.
 * @param overrides - knobs to replace; the shipped hand-tuned table fills the rest.
 * @returns the depth-sorted ink scene.
 */
export function orbScene(
  mode: OrbMode,
  size: number,
  t: number,
  overrides: OrbOptions = {},
): OrbScene {
  // Merge is safe at this same-process call site: the table entry is total
  // for the mode and the partial override shape cannot reintroduce
  // `undefined` for a present field. The generic helper keeps the per-mode
  // options tied to the dispatched generator's parameter.
  return generate(mode, size, t, { ...ORB_OPTIONS[mode], ...overrides })
}

/** Per-mode dispatch with the generator's own options type. */
function generate<M extends OrbMode>(mode: M, size: number, t: number, opts: ModeOptions[M]): OrbScene {
  return GENERATORS[mode](size, t, opts)
}
