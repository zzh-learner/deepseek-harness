// @vitest-environment jsdom
/**
 * The WebGL2 engine: dead-engine fallbacks for every init failure, resize
 * math (devicePixelRatio x quality scale with a 2px floor), orbit camera
 * with drag inertia and pinch/wheel zoom, the bloom composite's on/off
 * split, screenshot capture, the stats cadence with automatic quality
 * downgrade, the pause/resume/dispose lifecycle, context loss,
 * reduced-motion single-frame mode, and the ResizeObserver vs
 * layout-poll layout paths.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEngine } from '../src/client/engine.ts'
import type { Engine, EngineCallbacks } from '../src/client/engine.ts'

type FrameCallback = (stamp: number) => void

/** Uniform-location token: name-keyed so assertions can read bound values. */
interface LocToken { readonly __name: string }

interface FakeGLFlags {
  compileOk: boolean
  linkOk: boolean
  shaderLog: string | null
  programLog: string | null
  createShaderNull: boolean
  createProgramNull: boolean
  loseContextExt: { loseContext: () => void } | null
}

/** The recording surface {@link fakeGL} hands back to each test. */
interface FakeGL {
  gl: WebGL2RenderingContext
  flags: FakeGLFlags
  seen: {
    draws: number
    clears: number
    clearColor: number[] | null
    texturesDeleted: number
    framebuffersDeleted: number
    uniforms: Map<string, unknown>
  }
}

/** Recording WebGL2 stub with the full surface createEngine touches. */
function fakeGL(): FakeGL {
  const flags: FakeGLFlags = {
    compileOk: true,
    linkOk: true,
    shaderLog: 'fake shader log',
    programLog: 'fake link log',
    createShaderNull: false,
    createProgramNull: false,
    loseContextExt: { loseContext: vi.fn() },
  }
  const seen = {
    draws: 0,
    clears: 0,
    clearColor: null as number[] | null,
    texturesDeleted: 0,
    framebuffersDeleted: 0,
    uniforms: new Map<string, unknown>(),
  }
  const set = (loc: unknown, value: unknown): void => {
    seen.uniforms.set((loc as LocToken).__name, value)
  }
  const gl = {
    VERTEX_SHADER: 35_633, FRAGMENT_SHADER: 35_632, COMPILE_STATUS: 35_713, LINK_STATUS: 35_714,
    ARRAY_BUFFER: 34_962, STATIC_DRAW: 35_044, FLOAT: 5_126,
    TEXTURE_2D: 3_553, TEXTURE_MIN_FILTER: 10_241, TEXTURE_MAG_FILTER: 10_240,
    TEXTURE_WRAP_S: 10_242, TEXTURE_WRAP_T: 10_243, LINEAR: 9_729, CLAMP_TO_EDGE: 33_071,
    RGBA8: 32_856, RGBA: 6_408, UNSIGNED_BYTE: 5_121,
    FRAMEBUFFER: 36_160, COLOR_ATTACHMENT0: 36_064, TRIANGLES: 4, COLOR_BUFFER_BIT: 16_384,
    TEXTURE0: 33_984, TEXTURE1: 33_985,
    createShader: (): unknown => (flags.createShaderNull ? null : { kind: 'shader' }),
    shaderSource: (): void => {},
    compileShader: (): void => {},
    getShaderParameter: (): boolean => flags.compileOk,
    getShaderInfoLog: (): string | null => flags.shaderLog,
    createProgram: (): unknown => (flags.createProgramNull ? null : { kind: 'program' }),
    attachShader: (): void => {},
    linkProgram: (): void => {},
    getProgramParameter: (): boolean => flags.linkOk,
    getProgramInfoLog: (): string | null => flags.programLog,
    getUniformLocation: (_p: unknown, name: string): unknown => ({ __name: name }),
    createVertexArray: (): unknown => ({ kind: 'vao' }),
    bindVertexArray: (): void => {},
    createBuffer: (): unknown => ({ kind: 'buffer' }),
    bindBuffer: (): void => {},
    bufferData: (): void => {},
    enableVertexAttribArray: (): void => {},
    vertexAttribPointer: (): void => {},
    createTexture: (): unknown => ({ kind: 'texture' }),
    deleteTexture: (): void => { seen.texturesDeleted += 1 },
    bindTexture: (): void => {},
    texParameteri: (): void => {},
    texImage2D: (): void => {},
    createFramebuffer: (): unknown => ({ kind: 'framebuffer' }),
    deleteFramebuffer: (): void => { seen.framebuffersDeleted += 1 },
    bindFramebuffer: (): void => {},
    framebufferTexture2D: (): void => {},
    useProgram: (): void => {},
    uniform1i: (loc: unknown, v: number): void => { set(loc, v) },
    uniform1f: (loc: unknown, v: number): void => { set(loc, v) },
    uniform2f: (loc: unknown, a: number, b: number): void => { set(loc, [a, b]) },
    uniform3fv: (loc: unknown, v: Float32Array): void => { set(loc, [...v]) },
    uniformMatrix3fv: (): void => {},
    viewport: (): void => {},
    activeTexture: (): void => {},
    drawArrays: (): void => { seen.draws += 1 },
    clearColor: (...c: number[]): void => { seen.clearColor = c },
    clear: (): void => { seen.clears += 1 },
    getExtension: (name: string): unknown => (name === 'WEBGL_lose_context' ? flags.loseContextExt : null),
  }
  return { gl: gl as unknown as WebGL2RenderingContext, flags, seen }
}

let frames: FrameCallback[] = []
let rafSeq = 0
const cancelled: number[] = []
let clock = 0

const pump = (stamp: number): void => {
  const pending = frames
  frames = []
  for (const cb of pending) cb(stamp)
}

/** Drain the running loop for n frames at the given stamp gap. */
const runFrames = (n: number, gapMs: number, base: number): void => {
  for (let i = 1; i <= n; i++) pump(base + i * gapMs)
}

const makeCanvas = (w = 1200, h = 800): { canvas: HTMLCanvasElement; box: { w: number; h: number } } => {
  const canvas = document.createElement('canvas')
  const box = { w, h }
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, get: () => box.w })
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, get: () => box.h })
  return { canvas, box }
}

interface Mounted { engine: Engine; canvas: HTMLCanvasElement; box: { w: number; h: number }; fake: ReturnType<typeof fakeGL> }

const engineOn = (canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, cbs: EngineCallbacks): Engine => {
  canvas.getContext = vi.fn(() => gl) as unknown as HTMLCanvasElement['getContext']
  return createEngine(canvas, cbs)
}

const makeLive = (cbs: EngineCallbacks = {}): Mounted => {
  const fake = fakeGL()
  const { canvas, box } = makeCanvas()
  const engine = engineOn(canvas, fake.gl, cbs)
  return { engine, canvas, box, fake }
}

/** Dispatch a synthetic pointer/wheel event with plain own properties. */
const fire = (el: HTMLElement, type: string, props: Record<string, unknown>): Event => {
  const ev = new Event(type, { cancelable: true })
  Object.assign(ev, props)
  el.dispatchEvent(ev)
  return ev
}

const camPos = (t: Mounted): number[] => t.fake.seen.uniforms.get('uCamPos') as number[]

const camRadius = (t: Mounted): number => {
  const p = camPos(t)
  return Math.hypot(p[0]!, p[1]!, p[2]!)
}

beforeEach(() => {
  frames = []
  rafSeq = 0
  cancelled.length = 0
  clock = 1_000
  vi.stubGlobal('requestAnimationFrame', (cb: FrameCallback): number => { frames.push(cb); return ++rafSeq })
  vi.stubGlobal('cancelAnimationFrame', (h: number): void => { cancelled.push(h) })
  vi.stubGlobal('ResizeObserver', undefined)
  vi.stubGlobal('matchMedia', vi.fn((): { matches: boolean } => ({ matches: false })))
  vi.stubGlobal('devicePixelRatio', 1)
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('dead engine fallbacks', () => {
  it('reports the missing canvas on every interactive method and keeps pause/dispose silent', () => {
    const onFatal = vi.fn()
    const engine = createEngine(null, { onFatal })
    engine.setParams({})
    engine.setQuality(1, false)
    engine.setAutoRotate(false)
    engine.capture()
    engine.resume()
    engine.pause()
    engine.dispose()
    expect(onFatal.mock.calls.map(c => c[0] as string)).toEqual(['画布未就绪。', '画布未就绪。', '画布未就绪。', '画布未就绪。', '画布未就绪。'])
  })

  it('reports the missing WebGL2 context the same way', () => {
    const { canvas } = makeCanvas()
    canvas.getContext = vi.fn(() => null)
    const onFatal = vi.fn()
    const engine = createEngine(canvas, { onFatal })
    engine.capture()
    engine.pause()
    engine.dispose()
    expect(onFatal).toHaveBeenCalledTimes(1)
    expect(onFatal).toHaveBeenCalledWith('当前浏览器不支持 WebGL2，无法渲染黑洞壁纸。')
  })

  it('surfaces the compile log before falling back', () => {
    const fake = fakeGL()
    fake.flags.compileOk = false
    const onFatal = vi.fn()
    const engine = engineOn(makeCanvas().canvas, fake.gl, { onFatal })
    expect(onFatal).toHaveBeenCalledWith('着色器编译失败：fake shader log')
    engine.setAutoRotate(true)
    expect(onFatal).toHaveBeenLastCalledWith('WebGL2 初始化失败。')
  })

  it('names an unknown shader error when the log is null', () => {
    const fake = fakeGL()
    fake.flags.compileOk = false
    fake.flags.shaderLog = null
    const onFatal = vi.fn()
    engineOn(makeCanvas().canvas, fake.gl, { onFatal })
    expect(onFatal).toHaveBeenCalledWith('着色器编译失败：unknown shader error')
  })

  it('swallows a null shader object into the dead engine', () => {
    const fake = fakeGL()
    fake.flags.createShaderNull = true
    const onFatal = vi.fn()
    const engine = engineOn(makeCanvas().canvas, fake.gl, { onFatal })
    expect(onFatal).not.toHaveBeenCalled()
    engine.capture()
    expect(onFatal).toHaveBeenCalledWith('WebGL2 初始化失败。')
  })

  it('swallows a link failure with and without a log', () => {
    const failing = fakeGL()
    failing.flags.linkOk = false
    const onFatal = vi.fn()
    const engine = engineOn(makeCanvas().canvas, failing.gl, { onFatal })
    engine.capture()
    expect(onFatal).toHaveBeenCalledWith('WebGL2 初始化失败。')

    const silent = fakeGL()
    silent.flags.linkOk = false
    silent.flags.programLog = null
    const engine2 = engineOn(makeCanvas().canvas, silent.gl, {})
    engine2.resume()
  })

  it('swallows a null program object into the dead engine', () => {
    const fake = fakeGL()
    fake.flags.createProgramNull = true
    const engine = engineOn(makeCanvas().canvas, fake.gl, {})
    engine.setParams({ temp: 1 })
  })

  it('tolerates a dead engine with no callbacks at all', () => {
    const engine = createEngine(null, {})
    expect(() => {
      engine.setParams({})
      engine.setQuality(0, true)
      engine.setAutoRotate(true)
      engine.capture()
      engine.pause()
      engine.resume()
      engine.dispose()
    }).not.toThrow()
  })
})

describe('resize', () => {
  it('scales the render targets by dpr capped at 2 and the quality scale', () => {
    const t = makeLive()
    expect(t.canvas.width).toBe(900) // 1200 x dpr 1 x quality-1 scale 0.75
    expect(t.canvas.height).toBe(600)
    t.engine.dispose()

    vi.stubGlobal('devicePixelRatio', 3)
    const hi = makeLive()
    expect(hi.canvas.width).toBe(1800) // min(3, 2)
    hi.engine.dispose()

    vi.stubGlobal('devicePixelRatio', undefined)
    const noDpr = makeLive()
    expect(noDpr.canvas.width).toBe(900) // || 1
    noDpr.engine.dispose()
  })

  it('floors tiny layouts at 2 pixels', () => {
    const fake = fakeGL()
    const { canvas } = makeCanvas(0, 0)
    const engine = engineOn(canvas, fake.gl, {})
    expect(canvas.width).toBe(2)
    expect(canvas.height).toBe(2)
    engine.dispose()
  })

  it('rewrites the canvas only when a dimension actually changes', () => {
    const fake = fakeGL()
    const { canvas } = makeCanvas(1200, 800)
    const widthWrites: number[] = []
    let w = 300
    let h = 150
    Object.defineProperty(canvas, 'width', {
      configurable: true,
      get: () => w,
      set: (v: number) => { w = v; widthWrites.push(v) },
    })
    Object.defineProperty(canvas, 'height', {
      configurable: true,
      get: () => h,
      set: (v: number) => { h = v },
    })
    const engine = engineOn(canvas, fake.gl, {})
    expect(widthWrites).toEqual([900]) // first resize: both dimensions differ
    engine.setQuality(1, false) // same computed size: neither differs
    expect(widthWrites).toEqual([900])
    h = 777 // width matches, height drifts
    engine.setQuality(1, false)
    expect(widthWrites).toEqual([900, 900])
    engine.dispose()
  })
})

describe('camera and pointer input', () => {
  it('orbits while auto-rotating and freezes when disabled', () => {
    const t = makeLive()
    pump(1016)
    const moving = [...camPos(t)]
    pump(1032)
    expect(camPos(t)).not.toEqual(moving)
    t.engine.setAutoRotate(false)
    pump(1048)
    const frozen = [...camPos(t)]
    pump(1064)
    expect(camPos(t)).toEqual(frozen)
    t.engine.dispose()
  })

  it('captures the pointer, rotates on drag, and coasts after release', () => {
    const t = makeLive()
    const capture = vi.fn()
    t.canvas.setPointerCapture = capture
    fire(t.canvas, 'pointerdown', { pointerId: 1, clientX: 500, clientY: 400 })
    expect(capture).toHaveBeenCalledWith(1)
    pump(1016)
    const before = [...camPos(t)]
    fire(t.canvas, 'pointermove', { pointerId: 1, clientX: 400, clientY: 400 })
    pump(1032)
    expect(camPos(t)).not.toEqual(before)
    fire(t.canvas, 'pointerup', { pointerId: 1 })
    pump(1048)
    expect(camPos(t)).not.toEqual(before) // inertia keeps the camera moving
    t.engine.dispose()
  })

  it('survives setPointerCapture throwing', () => {
    const t = makeLive()
    t.canvas.setPointerCapture = vi.fn(() => {
      throw new DOMException('invalid pointer id')
    })
    expect(() => fire(t.canvas, 'pointerdown', { pointerId: 3, clientX: 0, clientY: 0 })).not.toThrow()
    t.engine.setAutoRotate(false)
    pump(1016)
    const before = [...camPos(t)]
    fire(t.canvas, 'pointermove', { pointerId: 3, clientX: 60, clientY: 0 })
    pump(1032)
    expect(camPos(t)).not.toEqual(before)
    t.engine.dispose()
  })

  it('ignores moves from unknown pointer ids', () => {
    const t = makeLive()
    t.engine.setAutoRotate(false)
    pump(1016)
    const before = [...camPos(t)]
    fire(t.canvas, 'pointermove', { pointerId: 42, clientX: 900, clientY: 900 })
    pump(1032)
    expect(camPos(t)).toEqual(before)
    t.engine.dispose()
  })

  it('pinches with two fingers and ignores a zero-distance frame', () => {
    const t = makeLive()
    fire(t.canvas, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 })
    fire(t.canvas, 'pointerdown', { pointerId: 2, clientX: 100, clientY: 0 })
    pump(1016)
    expect(camRadius(t)).toBeCloseTo(15, 5)
    fire(t.canvas, 'pointermove', { pointerId: 1, clientX: 50, clientY: 0 }) // spread halves: dist doubles
    pump(1032)
    expect(camRadius(t)).toBeCloseTo(30, 5)
    fire(t.canvas, 'pointermove', { pointerId: 1, clientX: 100, clientY: 0 }) // exact overlap: d === 0
    pump(1048)
    expect(camRadius(t)).toBeCloseTo(30, 5)
    fire(t.canvas, 'pointercancel', { pointerId: 2 })
    fire(t.canvas, 'pointermove', { pointerId: 1, clientX: 0, clientY: 0 }) // back to single-finger drag
    pump(1064)
    expect(camRadius(t)).toBeCloseTo(30, 5)
    t.engine.dispose()
  })

  it('ignores drags while three pointers are down', () => {
    const t = makeLive()
    t.engine.setAutoRotate(false)
    fire(t.canvas, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 })
    fire(t.canvas, 'pointerdown', { pointerId: 2, clientX: 100, clientY: 0 })
    fire(t.canvas, 'pointerdown', { pointerId: 3, clientX: 50, clientY: 50 })
    pump(1016)
    const before = [...camPos(t)]
    fire(t.canvas, 'pointermove', { pointerId: 1, clientX: 80, clientY: 80 }) // neither single nor pinch
    pump(1032)
    expect(camPos(t)).toEqual(before)
    t.engine.dispose()
  })

  it('does not rescale a pinch that starts from a zero baseline', () => {
    const t = makeLive()
    fire(t.canvas, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 })
    fire(t.canvas, 'pointerdown', { pointerId: 2, clientX: 0, clientY: 0 }) // pinchDist === 0
    pump(1016)
    fire(t.canvas, 'pointermove', { pointerId: 2, clientX: 80, clientY: 0 })
    pump(1032)
    expect(camRadius(t)).toBeCloseTo(15, 5) // pinchDist was 0: no rescale yet
    fire(t.canvas, 'pointermove', { pointerId: 2, clientX: 40, clientY: 0 }) // now pinchDist > 0
    pump(1048)
    expect(camRadius(t)).toBeCloseTo(30, 5)
    t.engine.dispose()
  })

  it('zooms on wheel with preventDefault and clamps the orbit radius', () => {
    const t = makeLive()
    pump(1016)
    expect(camRadius(t)).toBeCloseTo(15, 5)
    const ev = fire(t.canvas, 'wheel', { deltaY: 1000 })
    expect(ev.defaultPrevented).toBe(true)
    pump(1032)
    expect(camRadius(t)).toBeGreaterThan(15)
    for (let i = 0; i < 40; i++) fire(t.canvas, 'wheel', { deltaY: 5000 })
    pump(1048)
    expect(camRadius(t)).toBeCloseTo(70, 3)
    for (let i = 0; i < 80; i++) fire(t.canvas, 'wheel', { deltaY: -5000 })
    pump(1064)
    expect(camRadius(t)).toBeCloseTo(2.2, 3)
    t.engine.dispose()
  })

  it('clamps the orbit pitch at the poles', () => {
    const t = makeLive()
    pump(1016)
    fire(t.canvas, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 })
    fire(t.canvas, 'pointermove', { pointerId: 1, clientX: 0, clientY: 100000 })
    pump(1032)
    expect(camPos(t)[1]).toBeCloseTo(15 * Math.sin(1.45), 3)
    fire(t.canvas, 'pointermove', { pointerId: 1, clientX: 0, clientY: -400000 })
    pump(1048)
    expect(camPos(t)[1]).toBeCloseTo(15 * Math.sin(-1.45), 3)
    t.engine.dispose()
  })

  it('holds the camera still while a pointer stays down', () => {
    const t = makeLive()
    t.canvas.setPointerCapture = vi.fn()
    fire(t.canvas, 'pointerdown', { pointerId: 9, clientX: 0, clientY: 0 })
    pump(1016)
    const held = [...camPos(t)]
    pump(1032)
    expect(camPos(t)).toEqual(held) // no auto-rotation and no inertia with a pointer down
    t.engine.dispose()
  })
})

describe('render passes', () => {
  it('draws scene + bloom chain + composite per frame and binds engine uniforms', () => {
    const t = makeLive()
    pump(1016)
    // 1 scene + 1 bright extract + 4 blur + 1 composite
    expect(t.fake.seen.draws).toBe(7)
    expect(t.fake.seen.clears).toBe(0)
    expect(t.fake.seen.uniforms.get('uSteps')).toBe(220)
    expect(t.fake.seen.uniforms.get('uDoppler')).toBe(0.7)
    expect(camPos(t)).toBeDefined()
    const before = t.fake.seen.draws
    t.engine.setParams({ temp: 1.1 }) // running: setParams does not pump
    expect(t.fake.seen.draws).toBe(before)
    pump(1032)
    expect(t.fake.seen.uniforms.get('uTemp')).toBe(1.1)
    t.engine.dispose()
  })

  it('clears the bloom target instead of blurring when bloom is off', () => {
    const t = makeLive()
    t.engine.setParams({ bloom: 0 })
    pump(1016)
    expect(t.fake.seen.draws).toBe(2) // scene + composite only
    expect(t.fake.seen.clears).toBe(1)
    expect(t.fake.seen.clearColor).toEqual([0, 0, 0, 1])
    t.engine.dispose()
  })
})

describe('screenshot capture', () => {
  it('waits for the next frame, saves the PNG, and restores the loop size', () => {
    const t = makeLive()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    t.canvas.toDataURL = vi.fn((): string => 'data:image/png;base64,ZZZ')
    t.engine.capture()
    expect(click).not.toHaveBeenCalled() // running: the shot waits for the next tick
    pump(1016)
    expect(click).toHaveBeenCalledTimes(1)
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toMatch(/^gargantua-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.png$/)
    expect(anchor.href).toBe('data:image/png;base64,ZZZ')
    expect(t.canvas.width).toBe(900) // shot scale reset
    t.engine.dispose()
  })

  it('reports a fatal message when the canvas cannot produce a data URL', () => {
    const onFatal = vi.fn()
    const t = makeLive({ onFatal })
    t.canvas.toDataURL = vi.fn((): string => {
      throw new Error('tainted')
    })
    t.engine.pause() // capture pumps immediately while paused
    t.engine.capture()
    expect(onFatal).toHaveBeenCalledWith('截图失败：Error: tainted')
    t.engine.dispose()
  })
})

describe('stats cadence and auto-downgrade', () => {
  it('reports rounded fps, resolution, and step count every 90 frames', () => {
    const stats: { fps: string; res: string; steps: string }[] = []
    const t = makeLive({ onStats: (s) => { stats.push({ ...s }) } })
    runFrames(89, 16, 1000)
    expect(stats).toHaveLength(0)
    runFrames(1, 16, 1000 + 89 * 16)
    expect(stats).toHaveLength(1)
    expect(stats[0]).toEqual({ fps: '63', res: '900\u00d7600', steps: '220' }) // Math.round(1000/16)
    t.engine.dispose()
  })

  it('downgrades unlocked quality below 26 fps and stops at the floor', () => {
    const onQuality = vi.fn()
    const stats: { steps: string }[] = []
    const t = makeLive({ onQuality, onStats: (s) => { stats.push({ steps: s.steps }) } })
    runFrames(90, 5000, 1000) // dt clamps to 0.1s: roughly 10 fps
    expect(onQuality).toHaveBeenCalledWith(0)
    runFrames(90, 5000, 1000 + 90 * 5000)
    expect(onQuality).toHaveBeenCalledTimes(1) // quality 0 is the floor
    expect(stats.at(-1)?.steps).toBe('130')
    t.engine.dispose()
  })

  it('pumps one frame when quality changes while paused', () => {
    const t = makeLive()
    t.engine.pause()
    pump(1016) // drain the queued tick
    const draws = t.fake.seen.draws
    t.engine.setQuality(2, true)
    expect(t.fake.seen.draws).toBe(draws + 7) // the immediate pump rendered
    expect(frames).toHaveLength(0) // the pump steps directly; the loop stays stopped
    t.engine.dispose()
  })

  it('keeps locked quality through slow frames', () => {
    const onQuality = vi.fn()
    const t = makeLive({ onQuality })
    t.engine.setQuality(1, true)
    expect(onQuality).toHaveBeenCalledWith(1)
    runFrames(90, 5000, 1000)
    expect(onQuality).toHaveBeenCalledTimes(1) // locked: no downgrade
    t.engine.dispose()
  })

  it('clamps the requested quality and runs without any callbacks', () => {
    const t = makeLive()
    t.engine.setQuality(99, false)
    pump(1016)
    expect(t.fake.seen.uniforms.get('uSteps')).toBe(320)
    t.engine.setQuality(-99, false)
    runFrames(90, 5000, 1032)
    expect(t.fake.seen.draws).toBeGreaterThan(0)
    t.engine.dispose()
  })
})

describe('layout tracking', () => {
  it('polls the canvas box on the 30-frame cadence without a ResizeObserver', () => {
    const t = makeLive()
    runFrames(30, 16, 1000) // frame 30: first poll sees the 0 -> box jump and resizes
    expect(t.fake.seen.texturesDeleted).toBe(3)
    runFrames(30, 16, 1000 + 30 * 16) // frame 60: unchanged box resizes nothing
    expect(t.fake.seen.texturesDeleted).toBe(3)
    t.box.w = 700
    runFrames(30, 16, 1000 + 60 * 16) // frame 90: poll sees the change
    expect(t.canvas.width).toBe(525) // 700 x 0.75
    expect(t.fake.seen.texturesDeleted).toBe(6)
    t.box.h = 900
    runFrames(30, 16, 1000 + 90 * 16) // frame 120: height-only drift also lands
    expect(t.canvas.height).toBe(675)
    expect(t.fake.seen.texturesDeleted).toBe(9)
    t.engine.dispose()
  })

  it('observes the canvas and resizes through the ResizeObserver callback', () => {
    const seenByInstance: unknown[][] = []
    const callbacks: (() => void)[] = []
    let disconnects = 0
    vi.stubGlobal('ResizeObserver', class {
      seen: unknown[] = []
      constructor(cb: () => void) { callbacks.push(cb); seenByInstance.push(this.seen) }
      observe(el: unknown): void { this.seen.push(el) }
      disconnect(): void { disconnects += 1 }
    })
    const t = makeLive()
    expect(seenByInstance).toEqual([[t.canvas]])
    t.box.w = 640
    callbacks[0]!()
    expect(t.canvas.width).toBe(480) // 640 x 0.75
    t.engine.dispose()
    expect(disconnects).toBe(1)
  })
})

describe('loop lifecycle', () => {
  it('pauses without re-queuing and resumes the loop', () => {
    const t = makeLive()
    t.engine.pause()
    expect(cancelled).toHaveLength(1)
    pump(1016) // drains the queued tick; running is false so it does not re-queue
    expect(frames).toHaveLength(0)
    const draws = t.fake.seen.draws
    pump(1032)
    expect(t.fake.seen.draws).toBe(draws)
    t.engine.resume()
    expect(frames).toHaveLength(1)
    pump(1048)
    expect(t.fake.seen.draws).toBe(draws + 7) // one frame = scene + bloom chain + composite
    t.engine.resume() // already running: no extra frame queues
    expect(frames).toHaveLength(1)
    t.engine.pause()
    t.engine.pause() // already paused: no extra cancel
    expect(cancelled).toHaveLength(2)
    t.engine.dispose()
  })

  it('ignores pause and resume after dispose', () => {
    const t = makeLive()
    t.engine.dispose()
    t.engine.pause()
    t.engine.resume()
    pump(1016) // cancel is a stub: the queued tick exits at the disposed guard
    expect(frames).toHaveLength(0)
    expect(cancelled).toHaveLength(1)
  })

  it('disposes once: cancels the frame, drops listeners, deletes targets, loses the context', () => {
    const t = makeLive()
    const capture = vi.fn()
    t.canvas.setPointerCapture = capture
    t.engine.dispose()
    expect(cancelled).toHaveLength(1)
    pump(1016) // cancel is a stub: the queued tick exits at the disposed guard
    expect(t.fake.seen.draws).toBe(0)
    fire(t.canvas, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 })
    expect(capture).not.toHaveBeenCalled() // pointer listener removed
    const lost = new Event('webglcontextlost', { cancelable: true })
    t.canvas.dispatchEvent(lost)
    expect(lost.defaultPrevented).toBe(false) // context-loss listener removed
    t.engine.dispose() // second dispose is a no-op
    t.engine.dispose()
    t.engine.setParams({ temp: 2 }) // after dispose: renders nothing (targets are gone)
    expect(t.fake.seen.draws).toBe(0)
  })

  it('loses the WebGL context on dispose when the extension exists', () => {
    const t = makeLive()
    const lose = t.fake.flags.loseContextExt as unknown as { loseContext: ReturnType<typeof vi.fn> }
    t.engine.dispose()
    t.engine.dispose()
    expect(lose.loseContext).toHaveBeenCalledTimes(1)
    expect(t.fake.seen.texturesDeleted).toBe(3)
    expect(t.fake.seen.framebuffersDeleted).toBe(3)
  })

  it('skips the lose_context extension when absent', () => {
    const fake = fakeGL()
    fake.flags.loseContextExt = null
    const engine = engineOn(makeCanvas().canvas, fake.gl, {})
    expect(() =>{  engine.dispose() }).not.toThrow()
  })

  it('stops rendering after the WebGL context is lost', () => {
    const onFatal = vi.fn()
    const t = makeLive({ onFatal })
    pump(1016)
    const lost = new Event('webglcontextlost', { cancelable: true })
    t.canvas.dispatchEvent(lost)
    expect(lost.defaultPrevented).toBe(true)
    expect(onFatal).toHaveBeenCalledWith('显卡上下文丢失，壁纸已停止。')
    const draws = t.fake.seen.draws
    pump(1032) // the queued tick steps once, then the loop stops re-queuing
    expect(t.fake.seen.draws).toBe(draws + 7)
    pump(1048)
    expect(t.fake.seen.draws).toBe(draws + 7)
    t.engine.dispose()
  })
})

describe('reduced motion', () => {
  it('draws one frame without a loop and without auto-rotation', () => {
    vi.stubGlobal('matchMedia', vi.fn((): { matches: boolean } => ({ matches: true })))
    const t = makeLive()
    expect(t.fake.seen.draws).toBe(7) // the creation pump: one frame of 7 draws
    expect(frames).toHaveLength(0)
    const camA = [...camPos(t)]
    clock = 2000
    t.engine.resume() // reduced resume pumps one frame and starts no loop
    expect(t.fake.seen.draws).toBe(14)
    expect(frames).toHaveLength(0)
    expect(camPos(t)).toEqual(camA) // autoRotate stays off across the elapsed time
    t.engine.pause() // never running: nothing to cancel
    expect(cancelled).toHaveLength(0)
    t.engine.dispose()
  })

  it('treats a missing matchMedia as unreduced', () => {
    vi.stubGlobal('matchMedia', undefined)
    const t = makeLive()
    expect(frames).toHaveLength(1) // loop started
    t.engine.dispose()
  })
})
