/**
 * The five GLSL sources: every pass declares GLSL ES 3.00 and carries the
 * uniform set the engine binds each frame, so a shader/uniform rename fails
 * here before it surfaces as a silent black canvas.
 */

import { describe, expect, it } from 'vitest'
import { VERT_SRC, SCENE_FRAG, BRIGHT_FRAG, BLUR_FRAG, COMPOSITE_FRAG } from '../src/client/shaders.ts'

const ALL = [VERT_SRC, SCENE_FRAG, BRIGHT_FRAG, BLUR_FRAG, COMPOSITE_FRAG]

describe('shader sources', () => {
  it('declare the WebGL2 GLSL ES 3.00 version in every pass', () => {
    for (const src of ALL) expect(src.startsWith('#version 300 es\n')).toBe(true)
  })

  it('project the fullscreen big triangle from the shared vertex stage', () => {
    expect(VERT_SRC).toContain('layout(location = 0) in vec2 aPos;')
    expect(VERT_SRC).toContain('vUV = aPos * 0.5 + 0.5;')
  })

  it('declare the uniforms the engine binds every frame', () => {
    for (const decl of ['uniform vec2  uRes;', 'uniform float uTime;', 'uniform vec3  uCamPos;',
      'uniform mat3  uCamMat;', 'uniform int   uSteps;', 'uniform float uRs;', 'uniform float uTurb;',
      'uniform float uDoppler;', 'uniform float uNebula;', 'uniform float uExposure;']) {
      expect(SCENE_FRAG).toContain(decl)
    }
    expect(SCENE_FRAG).toContain('const int MAXSTEPS = 384;')
    expect(SCENE_FRAG).toContain('float curv = 1.5 * uRs * uLens;')
    expect(BRIGHT_FRAG).toContain('uniform sampler2D uTex;')
    expect(BLUR_FRAG).toContain('uniform vec2 uDir;')
    expect(COMPOSITE_FRAG).toContain('uniform float uBloomStrength;')
    expect(COMPOSITE_FRAG).toContain('uniform float uDim;')
  })
})
