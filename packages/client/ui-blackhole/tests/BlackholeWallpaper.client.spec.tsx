// @vitest-environment jsdom
/**
 * The GARGANTUA wallpaper component: mounts the engine on its canvas,
 * bridges the wallpaper registry's visibility through module state,
 * persists panel params to localStorage (defaults, corrupt JSON, partial
 * objects), pushes slider/preset/quality/checkbox edits into the engine,
 * screenshots through the capture button, shows the fatal block when
 * WebGL2 is unavailable, and tears the engine down on unmount.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BlackholeWallpaper, visibility } from '../src/client/BlackholeWallpaper.tsx'

type FrameCallback = (stamp: number) => void

const STORAGE_KEY = 'dsh.ui-blackhole.params.v1'

const originalGetContext = HTMLCanvasElement.prototype.getContext.bind(HTMLCanvasElement.prototype)
let currentGL: WebGL2RenderingContext | null = null
const seen: { draws: number; uniforms: Map<string, unknown> } = { draws: 0, uniforms: new Map() }
let loseContext: ReturnType<typeof vi.fn> = vi.fn()

/** Fresh recording GL stub: the component only needs a working pipeline. */
function installGL(): void {
  seen.draws = 0
  seen.uniforms = new Map()
  loseContext = vi.fn()
  const set = (loc: { __name: string }, v: unknown): void => { seen.uniforms.set(loc.__name, v) }
  currentGL = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TEXTURE_2D: 8, TEXTURE_MIN_FILTER: 9,
    TEXTURE_MAG_FILTER: 10, TEXTURE_WRAP_S: 11, TEXTURE_WRAP_T: 12, LINEAR: 13, CLAMP_TO_EDGE: 14,
    RGBA8: 15, RGBA: 16, UNSIGNED_BYTE: 17, FRAMEBUFFER: 18, COLOR_ATTACHMENT0: 19, TRIANGLES: 20,
    COLOR_BUFFER_BIT: 21, TEXTURE0: 22, TEXTURE1: 23,
    createShader: () => ({}), shaderSource: () => {}, compileShader: () => {},
    getShaderParameter: () => true, getShaderInfoLog: () => 'log',
    createProgram: () => ({}), attachShader: () => {}, linkProgram: () => {},
    getProgramParameter: () => true, getProgramInfoLog: () => 'log',
    getUniformLocation: (_p: unknown, name: string) => ({ __name: name }),
    createVertexArray: () => ({}), bindVertexArray: () => {},
    createBuffer: () => ({}), bindBuffer: () => {}, bufferData: () => {},
    enableVertexAttribArray: () => {}, vertexAttribPointer: () => {},
    createTexture: () => ({}), deleteTexture: () => {}, bindTexture: () => {},
    texParameteri: () => {}, texImage2D: () => {},
    createFramebuffer: () => ({}), deleteFramebuffer: () => {}, bindFramebuffer: () => {},
    framebufferTexture2D: () => {},
    useProgram: () => {},
    uniform1i: (l: { __name: string }, v: number) => { set(l, v) },
    uniform1f: (l: { __name: string }, v: number) => { set(l, v) },
    uniform2f: (l: { __name: string }, a: number, b: number) => { set(l, [a, b]) },
    uniform3fv: (l: { __name: string }, v: Float32Array) => { set(l, [...v]) },
    uniformMatrix3fv: () => {},
    viewport: () => {}, activeTexture: () => {},
    drawArrays: () => { seen.draws += 1 },
    clearColor: () => {}, clear: () => {},
    getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext } : null),
  } as unknown as WebGL2RenderingContext
}

let frames: FrameCallback[] = []
let clock = 0

const pump = (stamp: number): void => {
  const pending = frames
  frames = []
  for (const cb of pending) cb(stamp)
}

const runFrames = async (n: number, gapMs: number, base: number): Promise<void> => {
  await act(async () => {
    for (let i = 1; i <= n; i++) pump(base + i * gapMs)
  })
}

const camPos = (): number[] => seen.uniforms.get('uCamPos') as number[]

/** The range slider whose row labels itself with the given text. */
const sliderByLabel = (root: HTMLElement, label: string): HTMLInputElement => {
  const hit = Array.from(root.querySelectorAll('input[type="range"]'))
    .find(el => (el.parentElement?.textContent ?? '').includes(label))
  if (hit === undefined) throw new Error('slider not found: ' + label)
  return hit as HTMLInputElement
}

/** The checkbox whose label carries the given text. */
const checkboxByLabel = (root: HTMLElement, label: string): HTMLInputElement => {
  const hit = Array.from(root.querySelectorAll('input[type="checkbox"]'))
    .find(el => (el.parentElement?.textContent ?? '').includes(label))
  if (hit === undefined) throw new Error('checkbox not found: ' + label)
  return hit as HTMLInputElement
}

const buttonByText = (root: HTMLElement, text: string): HTMLButtonElement => {
  const hit = Array.from(root.querySelectorAll('button')).find(el => el.textContent === text)
  if (hit === undefined) throw new Error('button not found: ' + text)
  return hit
}

beforeEach(() => {
  frames = []
  clock = 1_000
  installGL()
  localStorage.clear()
  visibility.desired = true
  visibility.apply = null
  vi.stubGlobal('requestAnimationFrame', (cb: FrameCallback): number => { frames.push(cb); return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('ResizeObserver', undefined)
  vi.stubGlobal('matchMedia', vi.fn((): { matches: boolean } => ({ matches: false })))
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, value: 1200 })
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, value: 800 })
  const getContextStub = vi.fn((): WebGL2RenderingContext | null => currentGL) as unknown as typeof HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = getContextStub
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (HTMLCanvasElement.prototype as { clientWidth?: unknown }).clientWidth
  delete (HTMLCanvasElement.prototype as { clientHeight?: unknown }).clientHeight
  HTMLCanvasElement.prototype.getContext = originalGetContext
  visibility.desired = true
  visibility.apply = null
})

describe('BlackholeWallpaper', () => {
  it('renders the canvas, panel, and placeholder stats', () => {
    const host = render(<BlackholeWallpaper />)
    expect(host.container.querySelector('canvas')).not.toBeNull()
    expect(host.container.textContent).toContain('GARGANTUA')
    expect(host.container.textContent).toContain('卡冈图雅 · 黑洞壁纸')
    expect(host.container.textContent).toContain('--FPS')
    expect(buttonByText(host.container, '保存截图')).toBeDefined()
  })

  it('starts the loop and renders frames', async () => {
    render(<BlackholeWallpaper />)
    expect(frames).toHaveLength(1)
    expect(seen.draws).toBe(0)
    await runFrames(2, 16, 1000)
    expect(seen.draws).toBe(14)
  })

  it('updates the stats readout on the 90-frame cadence', async () => {
    const host = render(<BlackholeWallpaper />)
    await runFrames(90, 16, 1000)
    const text = host.container.textContent ?? ''
    expect(text).toContain('63FPS')
    expect(text).toContain('900×600')
    expect(text).toContain('220积分步')
  })

  it('bridges registry visibility to the host element and the engine', async () => {
    const host = render(<BlackholeWallpaper />)
    const root = host.container.firstElementChild as HTMLElement
    expect(visibility.apply).toBeTypeOf('function')
    visibility.apply!(false)
    expect(root.style.display).toBe('none')
    await runFrames(1, 16, 1000) // the queued tick drains; the loop stops
    const draws = seen.draws
    await runFrames(1, 16, 1016)
    expect(seen.draws).toBe(draws)
    visibility.apply!(true)
    expect(root.style.display).toBe('')
    await runFrames(1, 16, 1032)
    expect(seen.draws).toBe(draws + 7)
  })

  it('stays hidden when the registry hid the layer before mount', async () => {
    visibility.desired = false
    const host = render(<BlackholeWallpaper />)
    const root = host.container.firstElementChild as HTMLElement
    expect(root.style.display).toBe('none')
    await runFrames(1, 16, 1000) // the queued creation frame drains; nothing re-queues
    // 7 draws from the params effect's immediate pump while paused, 7 from the drained frame
    expect(seen.draws).toBe(14)
  })

  it('unmounts by nulling the bridge and disposing the engine', async () => {
    const host = render(<BlackholeWallpaper />)
    const bridge = visibility.apply
    host.unmount()
    expect(visibility.apply).toBeNull()
    expect(loseContext).toHaveBeenCalledTimes(1)
    // the retained closure survives with both refs detached
    expect(() => { bridge?.(false); bridge?.(true) }).not.toThrow()
    await act(async () => { pump(1016) })
    expect(seen.draws).toBe(0)
  })

  it('persists slider edits and pushes them into the engine', async () => {
    const host = render(<BlackholeWallpaper />)
    const slider = sliderByLabel(host.container, '色温')
    await act(async () => { fireEvent.change(slider, { target: { value: '1.2' } }) })
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { temp: number }
    expect(stored.temp).toBe(1.2)
    await runFrames(1, 16, 1000)
    expect(seen.uniforms.get('uTemp')).toBe(1.2)
  })

  it('adjusts the wallpaper strength through the css opacity slider', async () => {
    const host = render(<BlackholeWallpaper />)
    const slider = sliderByLabel(host.container, '壁纸浓度')
    await act(async () => { fireEvent.change(slider, { target: { value: '0.5' } }) })
    const canvas = host.container.querySelector('canvas') as HTMLCanvasElement
    expect(canvas.style.opacity).toBe('0.5')
  })

  it('loads persisted params over the defaults', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ temp: 1.2, cssOpacity: 0.4 }))
    const host = render(<BlackholeWallpaper />)
    expect(sliderByLabel(host.container, '色温').value).toBe('1.2')
    expect(sliderByLabel(host.container, '壁纸浓度').value).toBe('0.4')
  })

  it('falls back to defaults on absent, corrupt, and non-object stored params', () => {
    for (const raw of ['{oops', 'null', '123']) {
      localStorage.setItem(STORAGE_KEY, raw)
      const host = render(<BlackholeWallpaper />)
      expect(sliderByLabel(host.container, '色温').value).toBe('0.85')
      cleanup()
    }
  })

  it('survives a throwing localStorage write', async () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('quota exceeded')
    })
    const host = render(<BlackholeWallpaper />)
    const slider = sliderByLabel(host.container, '色温')
    await act(async () => { fireEvent.change(slider, { target: { value: '1.0' } }) })
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { temp: number }
    expect(stored.temp).toBe(1.0)
  })

  it('applies a preset to the engine and the store', async () => {
    const host = render(<BlackholeWallpaper />)
    await act(async () => { fireEvent.click(buttonByText(host.container, '电影模式')) })
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { doppler: number }
    expect(stored.doppler).toBe(0.55)
    await runFrames(1, 16, 1000)
    expect(seen.uniforms.get('uDoppler')).toBe(0.55)
  })

  it('applies the physics and hot presets too', async () => {
    const host = render(<BlackholeWallpaper />)
    await act(async () => { fireEvent.click(buttonByText(host.container, '物理真实')) })
    await runFrames(1, 16, 1000)
    expect(seen.uniforms.get('uDoppler')).toBe(1.5) // real
    await act(async () => { fireEvent.click(buttonByText(host.container, '炽热蓝盘')) })
    await runFrames(1, 16, 1016)
    expect(seen.uniforms.get('uTemp')).toBe(1.25) // hot
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { temp: number }
    expect(stored.temp).toBe(1.25)
  })

  it('locks the quality through the select', async () => {
    const host = render(<BlackholeWallpaper />)
    const select = host.container.querySelector('select') as HTMLSelectElement
    await act(async () => { fireEvent.change(select, { target: { value: '2' } }) })
    expect(select.value).toBe('2')
    await runFrames(1, 16, 1000)
    expect(seen.uniforms.get('uSteps')).toBe(320)
  })

  it('stops auto-rotation when the checkbox clears', async () => {
    const host = render(<BlackholeWallpaper />)
    await runFrames(2, 16, 1000)
    expect(camPos()).toBeDefined()
    const rotating = [...camPos()]
    await runFrames(1, 16, 1032)
    expect(camPos()).not.toEqual(rotating)
    await act(async () => { fireEvent.click(checkboxByLabel(host.container, '自动旋转')) })
    await runFrames(1, 16, 1048)
    const frozen = [...camPos()]
    await runFrames(1, 16, 1064)
    expect(camPos()).toEqual(frozen)
  })

  it('toggles interactive mode and panel collapse', async () => {
    const host = render(<BlackholeWallpaper />)
    const root = host.container.firstElementChild as HTMLElement
    expect(root.hasAttribute('data-interactive')).toBe(false)
    await act(async () => { fireEvent.click(checkboxByLabel(host.container, '交互模式')) })
    expect(root.hasAttribute('data-interactive')).toBe(true)
    expect(root.hasAttribute('data-collapsed')).toBe(false)
    await act(async () => { fireEvent.click(host.container.querySelector('button[title="收起面板"]')!) })
    expect(root.hasAttribute('data-collapsed')).toBe(true)
    await act(async () => { fireEvent.click(host.container.querySelector('button[title="展开面板"]')!) })
    expect(root.hasAttribute('data-collapsed')).toBe(false)
  })

  it('saves a screenshot through the capture button', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const host = render(<BlackholeWallpaper />)
    const canvas = host.container.querySelector('canvas') as HTMLCanvasElement
    canvas.toDataURL = vi.fn((): string => 'data:image/png;base64,QQQ')
    await act(async () => { fireEvent.click(buttonByText(host.container, '保存截图')) })
    await runFrames(1, 16, 1000)
    expect(click).toHaveBeenCalledTimes(1)
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toContain('gargantua-')
    expect(anchor.href).toBe('data:image/png;base64,QQQ')
  })

  it('replaces the stats with the fatal block when WebGL2 is unavailable', () => {
    currentGL = null
    const host = render(<BlackholeWallpaper />)
    const text = host.container.textContent ?? ''
    expect(text).toContain('当前浏览器不支持 WebGL2，无法渲染黑洞壁纸。')
    expect(text).not.toContain('--FPS')
  })
})
