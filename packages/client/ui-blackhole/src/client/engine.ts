/**
 * The WebGL2 render engine, ported from the standalone GARGANTUA project:
 * ray-traced main pass into an offscreen target, quarter-resolution bloom
 * (extract + two H/V Gaussian rounds), and the wallpaper composite onto the
 * visible canvas. The loop is pausable — the wallpaper registry hides the
 * layer by pausing it, which stops all GPU work.
 *
 * @module @deepseek-ai/dsh-client-ui-blackhole/src/client/engine
 */

import { VERT_SRC, SCENE_FRAG, BRIGHT_FRAG, BLUR_FRAG, COMPOSITE_FRAG } from './shaders.ts'

/** Engine parameters; `dim` is the composite veil floor. */
export interface EngineParams {
  diskIn: number
  diskOut: number
  temp: number
  bright: number
  spin: number
  turb: number
  rs: number
  lens: number
  doppler: number
  starDens: number
  starBright: number
  nebula: number
  bloom: number
  exposure: number
  dim: number
}

/** One quality step: internal resolution scale and geodesic step count. */
export interface Quality { readonly scale: number; readonly steps: number }

/** Periodic stats for the panel readout. */
export interface EngineStats { readonly fps: string; readonly res: string; readonly steps: string }

/** Engine callbacks; every one is optional. */
export interface EngineCallbacks {
  onStats?: (stats: EngineStats) => void
  onQuality?: (index: number) => void
  onFatal?: (message: string) => void
}

/** The engine's public face. */
export interface Engine {
  setParams(params: Partial<EngineParams>): void
  setQuality(index: number, locked: boolean): void
  setAutoRotate(on: boolean): void
  capture(): void
  pause(): void
  resume(): void
  dispose(): void
}

const QUALITIES: readonly Quality[] = [
  { scale: 0.5, steps: 130 },
  { scale: 0.75, steps: 220 },
  { scale: 1.0, steps: 320 },
]
const FALLBACK_QUALITY: Quality = { scale: 0.75, steps: 220 }
const FOV_TAN = Math.tan(31 * Math.PI / 180)

/** Scene-pass uniform names (drives the LS mapped type). */
const SCENE_UNIFORMS = ['uRes', 'uTime', 'uCamPos', 'uCamMat', 'uFovTan', 'uSteps', 'uRs', 'uDiskIn', 'uDiskOut',
  'uTemp', 'uBright', 'uSpin', 'uTurb', 'uLens', 'uDoppler', 'uStarDens', 'uStarBright', 'uNebula', 'uExposure'] as const

/** Composite-pass uniform names (drives the LC mapped type). */
const COMPOSITE_UNIFORMS = ['uScene', 'uBloom', 'uBloomStrength', 'uRes', 'uDim'] as const

const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x))
/* v8 ignore next -- qualityIdx is only written via clamp(i, 0, 2), so the index always lands inside QUALITIES */
const qualityAt = (i: number): Quality => QUALITIES[i] ?? FALLBACK_QUALITY

/** Dead API handed back when WebGL2 is unavailable; every method is a no-op. */
const deadEngine = (report: (m: string) => void, message: string): Engine => ({
  setParams() { report(message) },
  setQuality() { report(message) },
  setAutoRotate() { report(message) },
  capture() { report(message) },
  pause() {},
  resume() { report(message) },
  dispose() {},
})

/**
 * Create the engine against one canvas.
 * @param canvasParam - the canvas to render into (WebGL2 context is taken here).
 * @param cbs - stats/quality/fatal callbacks.
 * @returns the engine API.
 */
export function createEngine(canvasParam: HTMLCanvasElement | null, cbs: EngineCallbacks): Engine {
  const P: EngineParams = {
    diskIn: 3.0, diskOut: 14.0, temp: 0.85, bright: 1.0, spin: 1.0, turb: 0.55,
    rs: 1.0, lens: 1.0, doppler: 0.7,
    starDens: 0.5, starBright: 1.0, nebula: 0.35,
    bloom: 0.7, exposure: 1.15, dim: 0.0,
  }
  const report = (m: string): void => { cbs.onFatal?.(m) }
  if (canvasParam === null) return deadEngine(report, '画布未就绪。')
  // const aliases keep the null narrowing inside closures below.
  const canvas = canvasParam

  const glRaw = canvas.getContext('webgl2', {
    antialias: false, depth: false, stencil: false, alpha: true,
    powerPreference: 'high-performance',
  })
  if (glRaw === null) return deadEngine(report, '当前浏览器不支持 WebGL2，无法渲染黑洞壁纸。')
  // Rebound off the narrowed expression so every closure below sees the
  // non-null type (function declarations are hoisted and would otherwise
  // fall back to the declared nullable type).
  const gl = glRaw

  let qualityIdx = 1
  let qualityLocked = false
  let shotScale = 0
  let shotPending = false
  let autoRotate = true
  let disposed = false
  let running = false
  let rafH: number | null = null
  let last = 0
  let ftEMA = 16
  let frames = 0

  const onLost = (e: Event): void => {
    e.preventDefault()
    running = false
    stopLoop()
    report('显卡上下文丢失，壁纸已停止。')
  }
  canvas.addEventListener('webglcontextlost', onLost)

  function compile(type: number, src: string): WebGLShader {
    const sh = gl.createShader(type)
    if (sh === null) throw new Error('gl.createShader returned null')
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) ?? 'unknown shader error'
      report('着色器编译失败：' + log)
      throw new Error(log)
    }
    return sh
  }
  function program(vsSrc: string, fsSrc: string): WebGLProgram {
    // Widened: the DOM binding returns null on context loss even though the
    // lib type omits it (the spec drives the null arm through a stub).
    const p = gl.createProgram() as WebGLProgram | null
    if (p === null) throw new Error('gl.createProgram returned null')
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc))
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link failed')
    return p
  }
  function locs<K extends string>(prog: WebGLProgram, names: readonly K[]): { readonly [P in K]: WebGLUniformLocation | null } {
    const o = {} as Record<K, WebGLUniformLocation | null>
    for (const n of names) o[n] = gl.getUniformLocation(prog, n)
    return o
  }

  let LS: { readonly [K in typeof SCENE_UNIFORMS[number]]: WebGLUniformLocation | null }
  let LB: { readonly uTex: WebGLUniformLocation | null }
  let LBl: { readonly uTex: WebGLUniformLocation | null; readonly uDir: WebGLUniformLocation | null }
  let LC: { readonly [K in typeof COMPOSITE_UNIFORMS[number]]: WebGLUniformLocation | null }
  let progBright: WebGLProgram
  let progBlur: WebGLProgram
  let progComp: WebGLProgram
  let progScene: WebGLProgram
  let vao: WebGLVertexArrayObject | null
  try {
    progScene = program(VERT_SRC, SCENE_FRAG)
    progBright = program(VERT_SRC, BRIGHT_FRAG)
    progBlur = program(VERT_SRC, BLUR_FRAG)
    progComp = program(VERT_SRC, COMPOSITE_FRAG)
    LS = locs(progScene, SCENE_UNIFORMS)
    LB = locs(progBright, ['uTex'])
    LBl = locs(progBlur, ['uTex', 'uDir'])
    LC = locs(progComp, COMPOSITE_UNIFORMS)
    vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    const vb = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, vb)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
  } catch {
    return deadEngine(report, 'WebGL2 初始化失败。')
  }

  interface Target { tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number }
  function makeTarget(w: number, h: number): Target {
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    const fb = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { tex, fb, w, h }
  }
  function delTarget(t: Target | null): void {
    if (t !== null) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb) }
  }

  let sceneT: Target | null = null
  let bloomA: Target | null = null
  let bloomB: Target | null = null
  let RW = 2
  let RH = 2

  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const s = shotScale > 0 ? shotScale : qualityAt(qualityIdx).scale
    RW = Math.max(2, Math.round(canvas.clientWidth * dpr * s))
    RH = Math.max(2, Math.round(canvas.clientHeight * dpr * s))
    if (canvas.width !== RW || canvas.height !== RH) { canvas.width = RW; canvas.height = RH }
    delTarget(sceneT); delTarget(bloomA); delTarget(bloomB)
    sceneT = makeTarget(RW, RH)
    const bw = Math.max(2, RW >> 2), bh = Math.max(2, RH >> 2)
    bloomA = makeTarget(bw, bh)
    bloomB = makeTarget(bw, bh)
  }

  // Camera: orbit + inertia + zoom.
  const cam = { yaw: 0.6, pitch: 0.14, dist: 15, vyaw: 0, vpitch: 0 }
  const camPos = new Float32Array(3)
  const camMat = new Float32Array(9)

  function updateCamera(dt: number): void {
    if (autoRotate && pointers.size === 0) cam.yaw += dt * 0.06
    if (pointers.size === 0) {
      cam.yaw += cam.vyaw * dt
      cam.pitch += cam.vpitch * dt
      const d = Math.exp(-3.2 * dt)
      cam.vyaw *= d; cam.vpitch *= d
    }
    cam.pitch = clamp(cam.pitch, -1.45, 1.45)
    cam.dist = clamp(cam.dist, 2.2, 70)

    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch)
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw)
    camPos[0] = cam.dist * cp * sy
    camPos[1] = cam.dist * sp
    camPos[2] = cam.dist * cp * cy
    const fx = -camPos[0] / cam.dist, fy = -camPos[1] / cam.dist, fz = -camPos[2] / cam.dist
    /* v8 ignore next -- pitch is clamped to ±1.45 (< π/2) and dist ≥ 2.2 before this line, so hypot(fz, fx) = cos(pitch)·dist is never 0 */
    const rl = Math.hypot(fz, fx) || 1e-6
    const rx = -fz / rl, rz = fx / rl
    const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy
    camMat[0] = rx; camMat[1] = 0; camMat[2] = rz
    camMat[3] = ux; camMat[4] = uy; camMat[5] = uz
    camMat[6] = fx; camMat[7] = fy; camMat[8] = fz
  }

  // Input: only in interactive mode does the canvas opt into pointer events.
  const pointers = new Map<number, { x: number; y: number }>()
  let pinchDist = 0

  const onDown = (e: PointerEvent): void => {
    try { canvas.setPointerCapture(e.pointerId) } catch { /* capture is best-effort */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size === 2) {
      const a = [...pointers.values()]
      const p0 = a[0], p1 = a[1]
      /* v8 ignore next -- a two-entry Map spread always yields defined [0]/[1]; the guard only narrows the noUncheckedIndexedAccess type */
      if (p0 !== undefined && p1 !== undefined) pinchDist = Math.hypot(p0.x - p1.x, p0.y - p1.y)
    }
    cam.vyaw = 0; cam.vpitch = 0
  }
  const onMove = (e: PointerEvent): void => {
    const pt = pointers.get(e.pointerId)
    if (pt === undefined) return
    const dx = e.clientX - pt.x, dy = e.clientY - pt.y
    pt.x = e.clientX; pt.y = e.clientY
    if (pointers.size === 1) {
      cam.yaw -= dx * 0.0042
      cam.pitch += dy * 0.0042
      cam.vyaw = cam.vyaw * 0.5 - dx * 0.0042 * 30
      cam.vpitch = cam.vpitch * 0.5 + dy * 0.0042 * 30
    } else if (pointers.size === 2) {
      const a = [...pointers.values()]
      const p0 = a[0], p1 = a[1]
      /* v8 ignore next -- a two-entry Map spread always yields defined [0]/[1]; the guard only narrows the noUncheckedIndexedAccess type */
      if (p0 !== undefined && p1 !== undefined) {
        const d = Math.hypot(p0.x - p1.x, p0.y - p1.y)
        if (pinchDist > 0 && d > 0) cam.dist *= pinchDist / d
        pinchDist = d
      }
    }
  }
  const onUp = (e: PointerEvent): void => { pointers.delete(e.pointerId); pinchDist = 0 }
  const onWheel = (e: WheelEvent): void => { e.preventDefault(); cam.dist *= Math.exp(e.deltaY * 0.0011) }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })

  function blurPass(src: Target, dst: Target, dx: number, dy: number, mult: number): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb)
    gl.viewport(0, 0, dst.w, dst.h)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, src.tex)
    gl.uniform1i(LBl.uTex, 0)
    gl.uniform2f(LBl.uDir, dx * mult / dst.w, dy * mult / dst.h)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  function renderAll(time: number): void {
    if (sceneT === null || bloomA === null || bloomB === null) return
    gl.bindVertexArray(vao)

    gl.useProgram(progScene)
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fb)
    gl.viewport(0, 0, RW, RH)
    gl.uniform2f(LS.uRes, RW, RH)
    gl.uniform1f(LS.uTime, time)
    gl.uniform3fv(LS.uCamPos, camPos)
    gl.uniformMatrix3fv(LS.uCamMat, false, camMat)
    gl.uniform1f(LS.uFovTan, FOV_TAN)
    gl.uniform1i(LS.uSteps, qualityAt(qualityIdx).steps)
    gl.uniform1f(LS.uRs, P.rs)
    gl.uniform1f(LS.uDiskIn, P.diskIn * P.rs)
    gl.uniform1f(LS.uDiskOut, P.diskOut * P.rs)
    gl.uniform1f(LS.uTemp, P.temp)
    gl.uniform1f(LS.uBright, P.bright)
    gl.uniform1f(LS.uSpin, P.spin)
    gl.uniform1f(LS.uTurb, P.turb)
    gl.uniform1f(LS.uLens, P.lens)
    gl.uniform1f(LS.uDoppler, P.doppler)
    gl.uniform1f(LS.uStarDens, P.starDens)
    gl.uniform1f(LS.uStarBright, P.starBright)
    gl.uniform1f(LS.uNebula, P.nebula)
    gl.uniform1f(LS.uExposure, P.exposure)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    if (P.bloom > 0.01) {
      gl.useProgram(progBright)
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fb)
      gl.viewport(0, 0, bloomA.w, bloomA.h)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, sceneT.tex)
      gl.uniform1i(LB.uTex, 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      gl.useProgram(progBlur)
      blurPass(bloomA, bloomB, 1, 0, 1.0)
      blurPass(bloomB, bloomA, 0, 1, 1.0)
      blurPass(bloomA, bloomB, 1, 0, 2.3)
      blurPass(bloomB, bloomA, 0, 1, 2.3)
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fb)
      gl.viewport(0, 0, bloomA.w, bloomA.h)
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.useProgram(progComp)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, sceneT.tex)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, bloomA.tex)
    gl.uniform1i(LC.uScene, 0)
    gl.uniform1i(LC.uBloom, 1)
    gl.uniform1f(LC.uBloomStrength, P.bloom)
    gl.uniform1f(LC.uDim, P.dim)
    gl.uniform2f(LC.uRes, canvas.width, canvas.height)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  function doCapture(): void {
    try {
      const a = document.createElement('a')
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      a.download = 'gargantua-' + ts + '.png'
      a.href = canvas.toDataURL('image/png')
      a.click()
    } catch (err) {
      report('截图失败：' + String(err))
    }
  }

  const nowMs = (): number => performance.now()

  function setQuality(i: number, locked: boolean): void {
    qualityIdx = clamp(i, 0, 2)
    if (locked) qualityLocked = true
    resize()
    cbs.onQuality?.(qualityIdx)
    if (!running) pump()
  }

  function step(t: number): void {
    const now = t
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    if (shotPending) { shotScale = Math.min(1, qualityAt(qualityIdx).scale); resize() }
    updateCamera(dt)
    renderAll(now / 1000)
    if (shotPending) { doCapture(); shotPending = false; shotScale = 0; resize() }
    ftEMA += (dt * 1000 - ftEMA) * 0.04
    frames++
    if (frames % 90 === 0) {
      const fps = 1000 / ftEMA
      cbs.onStats?.({
        fps: String(Math.round(fps)),
        res: `${RW}\u00d7${RH}`,
        steps: String(qualityAt(qualityIdx).steps),
      })
      if (!qualityLocked && qualityIdx > 0 && fps < 26) setQuality(qualityIdx - 1, false)
    }
    if (observer === null && frames % 30 === 0) layoutPoll()
  }

  function tick(t: number): void {
    if (disposed) return
    step(t)
    if (running) rafH = requestAnimationFrame(tick)
  }
  function startLoop(): void {
    last = nowMs()
    rafH = requestAnimationFrame(tick)
  }
  function stopLoop(): void {
    if (rafH !== null) cancelAnimationFrame(rafH)
    rafH = null
  }
  function pump(): void { step(nowMs()) }

  let observer: ResizeObserver | null = null
  let lastCW = 0
  let lastCH = 0
  function layoutPoll(): void {
    const w = canvas.clientWidth, h = canvas.clientHeight
    if (Math.abs(w - lastCW) > 2 || Math.abs(h - lastCH) > 2) { lastCW = w; lastCH = h; resize() }
  }
  observer = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => { lastCW = canvas.clientWidth; lastCH = canvas.clientHeight; resize() })
    : null
  observer?.observe(canvas)

  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced) autoRotate = false

  resize()
  if (reduced) { pump() } else { running = true; startLoop() }

  return {
    setParams(params) { Object.assign(P, params); if (!running) pump() },
    setQuality,
    setAutoRotate(on) { autoRotate = on },
    capture() { shotPending = true; if (!running) pump() },
    pause() { if (disposed || !running) return; running = false; stopLoop() },
    resume() {
      if (disposed || running) return
      if (reduced) { pump(); return }
      running = true; startLoop()
    },
    dispose() {
      if (disposed) return
      disposed = true; running = false
      stopLoop()
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('wheel', onWheel)
      observer?.disconnect()
      observer = null
      delTarget(sceneT); delTarget(bloomA); delTarget(bloomB)
      sceneT = bloomA = bloomB = null
      const ext = gl.getExtension('WEBGL_lose_context')
      ext?.loseContext()
    },
  }
}
