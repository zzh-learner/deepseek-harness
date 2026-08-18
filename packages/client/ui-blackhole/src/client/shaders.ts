/**
 * GLSL sources (WebGL2 / GLSL ES 3.00), ported verbatim from the standalone
 * GARGANTUA project: Schwarzschild geodesic ray tracing, bloom extraction,
 * separable Gaussian blur, and the wallpaper composite whose alpha is driven
 * by luminance (premultiplied output — empty space stays transparent, the
 * disk and stars stay solid) with `uDim` as an optional darkening veil.
 *
 * @module @deepseek-ai/dsh-client-ui-blackhole/src/client/shaders
 */

/** Fullscreen big-triangle vertex shader. */
export const VERT_SRC = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUV;
void main(){
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

/** Main scene: null-geodesic integration a = -1.5·rs·h²·r/|r|⁵, thin accretion disk, procedural sky. */
export const SCENE_FRAG = `#version 300 es
precision highp float;
precision highp int;

uniform vec2  uRes;
uniform float uTime;
uniform vec3  uCamPos;
uniform mat3  uCamMat;
uniform float uFovTan;
uniform int   uSteps;

uniform float uRs;
uniform float uDiskIn;
uniform float uDiskOut;
uniform float uTemp;
uniform float uBright;
uniform float uSpin;
uniform float uTurb;
uniform float uLens;
uniform float uDoppler;
uniform float uStarDens;
uniform float uStarBright;
uniform float uNebula;
uniform float uExposure;

out vec4 fragColor;

const int MAXSTEPS = 384;

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i),                   hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)),  hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float a = 0.5, s = 0.0;
  for(int i = 0; i < 4; i++){ s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return s;
}
float vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i),                      hash13(i + vec3(1.0, 0.0, 0.0)), u.x),
        mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
    mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), u.x),
        mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), u.x), u.y),
    u.z);
}
float fbm3(vec3 p){
  float a = 0.5, s = 0.0;
  for(int i = 0; i < 3; i++){ s += a * vnoise3(p); p = p * 2.07 + 19.19; a *= 0.5; }
  return s;
}
vec2 rot2(vec2 v, float a){
  float c = cos(a), s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

const mat3 SR1 = mat3( 0.76484, 0.0, -0.64422,   0.0, 1.0, 0.0,   0.64422, 0.0, 0.76484);
const mat3 SR2 = mat3( 1.0, 0.0, 0.0,   0.0, 0.62161, 0.78333,   0.0, -0.78333, 0.62161);
const mat3 SR3 = mat3( 0.69671, 0.71736, 0.0,  -0.71736, 0.69671, 0.0,   0.0, 0.0, 1.0);

vec3 starLayer(vec3 d, float S, mat3 R, float sizeK, float intens){
  if(uStarDens <= 0.001) return vec3(0.0);
  vec3 q = R * d * S;
  vec3 id = floor(q);
  if(hash13(id) > uStarDens * 0.6) return vec3(0.0);
  vec3 f = q - id;
  vec3 sp = vec3(0.25) + 0.5 * hash33(id + 7.1);
  vec3 dv = f - sp;
  float b = hash13(id + 3.3);
  float mag = 0.2 + 1.8 * b * b * b * b;
  float star = exp(-dot(dv, dv) * sizeK);
  float th = hash13(id + 9.7);
  vec3 tint = mix(vec3(1.0, 0.80, 0.60), vec3(1.0), clamp(th * 2.0, 0.0, 1.0));
  tint = mix(tint, vec3(0.70, 0.80, 1.0), clamp(th * 2.0 - 1.0, 0.0, 1.0));
  return tint * (star * mag * intens);
}

vec3 background(vec3 d){
  vec3 col = starLayer(d, 22.0, SR1,  40.0, 1.7)
           + starLayer(d, 48.0, SR2,  95.0, 1.0)
           + starLayer(d, 82.0, SR3, 150.0, 0.6);
  vec3 bn = normalize(vec3(0.32, 0.86, 0.40));
  float bd = dot(d, bn);
  float band = exp(-bd * bd * 12.0);
  float mw = fbm3(d * 4.0 + 7.0);
  col *= 0.5 + 1.6 * band * (0.35 + 0.75 * mw);
  float neb1 = fbm3(d * 2.3 + 3.7);
  float neb2 = fbm3(d * 5.1 - 1.9);
  vec3 nebCol = mix(vec3(0.10, 0.16, 0.40), vec3(0.45, 0.22, 0.12), fbm3(d * 1.7 + 11.0));
  col += nebCol * (neb1 * neb2 * band * 3.0 * uNebula);
  return col * uStarBright;
}

vec3 bbColor(float t){
  vec3 c = mix(vec3(0.45, 0.06, 0.005), vec3(1.00, 0.35, 0.06), smoothstep(0.00, 0.35, t));
  c = mix(c, vec3(1.00, 0.78, 0.45), smoothstep(0.35, 0.70, t));
  c = mix(c, vec3(1.00, 0.96, 0.88), smoothstep(0.70, 0.95, t));
  c = mix(c, vec3(0.82, 0.90, 1.00), smoothstep(0.95, 1.25, t));
  return c;
}

vec4 diskShade(vec3 hit, vec3 pdir){
  float r = length(hit.xz);
  float t01 = (r - uDiskIn) / max(uDiskOut - uDiskIn, 0.001);

  float period = 16.0;
  float tt = uTime * max(uSpin, 0.0);
  float t1 = mod(tt, period);
  float t2 = mod(tt + period * 0.5, period);
  float w = abs(t1 / period * 2.0 - 1.0);
  float omega = 1.4 * pow(max(r / uRs, 0.01), -1.5);
  float base = mix(fbm(rot2(hit.xz, omega * t1) * 0.9),
                   fbm(rot2(hit.xz, omega * t2) * 0.9), w);
  float ring = 0.55 + 0.45 * fbm(vec2(r * (2.1 / uRs) + base * 1.5, 2.7));
  float n = pow(max(base * ring, 0.0), mix(0.85, 2.2, uTurb)) * (1.0 + uTurb * 1.5);

  float temp = uTemp * pow(clamp(uDiskIn / r, 0.0, 1.0), 0.75);

  float rr = max(r, uRs * 1.0001);
  float beta = clamp(sqrt(0.5 * uRs / rr) / sqrt(max(1.0 - uRs / rr, 0.05)), 0.0, 0.85);
  vec3 bdir = normalize(vec3(hit.z, 0.0, -hit.x));
  float gam = inversesqrt(1.0 - beta * beta);
  float dopp = 1.0 / (gam * (1.0 - dot(bdir * beta, -pdir)));
  float grav = sqrt(max(1.0 - uRs / rr, 0.0));
  float g = mix(1.0, dopp * mix(1.0, grav, 0.75), uDoppler);
  float e = pow(clamp(g, 0.05, 4.0), 3.0);
  temp *= mix(1.0, clamp(g, 0.3, 2.2), 0.6);

  vec3 col = bbColor(clamp(temp * (0.5 + 0.9 * n), 0.0, 1.25));
  float lum = uBright * pow(max(temp, 0.0), 1.2) * (0.22 + 1.9 * n);
  float fade = smoothstep(0.0, 0.05, t01) * (1.0 - smoothstep(0.6, 1.0, t01));
  float alpha = clamp(fade * (0.4 + 1.4 * n), 0.0, 1.0);
  return vec4(col * (lum * fade * e), alpha);
}

vec3 aces(vec3 x){
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  uv.x *= uRes.x / uRes.y;
  vec3 rd = normalize(uCamMat * normalize(vec3(uv * uFovTan, 1.0)));

  vec3 p = uCamPos;
  vec3 v = rd;
  vec3 L = cross(p, v);
  float h2 = dot(L, L);
  float curv = 1.5 * uRs * uLens;

  float camDist = length(uCamPos);
  float Rfar = max(40.0, camDist * 1.4);
  float escapeB = max(uDiskOut * 1.05, uRs * 12.0);

  vec3 col = vec3(0.0);
  float tr = 1.0;
  bool captured = false;

  if(dot(p, rd) > 0.0 && length(cross(p, rd)) > escapeB){
    col = background(rd);
    fragColor = vec4(pow(aces(col * uExposure), vec3(1.0 / 2.2)), 1.0);
    return;
  }

  float Rfar2 = Rfar * Rfar;
  float rs2 = uRs * uRs;
  for(int i = 0; i < MAXSTEPS; i++){
    if(i >= uSteps) break;
    float r2 = dot(p, p);
    if(r2 > Rfar2) break;
    float r = sqrt(r2);
    float dt = clamp(0.06 * (r - 0.7 * uRs), 0.02, 1.0);
    v += (-curv * h2 / (r2 * r2 * r)) * p * dt;
    vec3 np = p + v * dt;
    if(dot(np, np) < rs2){ captured = true; break; }
    if(p.y * np.y < 0.0){
      vec3 hit = mix(p, np, p.y / (p.y - np.y));
      float hr = length(hit.xz);
      if(hr > uDiskIn && hr < uDiskOut){
        vec4 dc = diskShade(hit, normalize(v));
        col += tr * dc.rgb;
        tr *= 1.0 - dc.a;
        if(tr < 0.02) break;
      }
    }
    p = np;
  }
  if(!captured) col += tr * background(normalize(v));
  vec3 c = pow(aces(col * uExposure), vec3(1.0 / 2.2));
  fragColor = vec4(c, 1.0);
}`

/** Bloom pass 1: brightness extraction. */
export const BRIGHT_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vUV;
out vec4 fragColor;
void main(){
  vec3 c = texture(uTex, vUV).rgb;
  float l = max(c.r, max(c.g, c.b));
  fragColor = vec4(c * smoothstep(0.5, 0.85, l), 1.0);
}`

/** Bloom pass 2: separable Gaussian. */
export const BLUR_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uDir;
in vec2 vUV;
out vec4 fragColor;
void main(){
  const float w0 = 0.227027, w1 = 0.1945946, w2 = 0.1216216, w3 = 0.054054, w4 = 0.016216;
  vec2 o = uDir;
  vec3 s = texture(uTex, vUV).rgb * w0
    + (texture(uTex, vUV + o      ).rgb + texture(uTex, vUV - o      ).rgb) * w1
    + (texture(uTex, vUV + o * 2.0).rgb + texture(uTex, vUV - o * 2.0).rgb) * w2
    + (texture(uTex, vUV + o * 3.0).rgb + texture(uTex, vUV - o * 3.0).rgb) * w3
    + (texture(uTex, vUV + o * 4.0).rgb + texture(uTex, vUV - o * 4.0).rgb) * w4;
  fragColor = vec4(s, 1.0);
}`

/** Wallpaper composite: luminance-driven premultiplied alpha plus the `uDim` veil. */
export const COMPOSITE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform float uDim;
uniform vec2 uRes;
in vec2 vUV;
out vec4 fragColor;
void main(){
  vec3 c = texture(uScene, vUV).rgb;
  c += texture(uBloom, vUV).rgb * uBloomStrength;
  vec2 q = vUV * 2.0 - 1.0;
  q.x *= uRes.x / uRes.y;
  c *= 1.0 - 0.24 * smoothstep(0.55, 1.7, length(q));
  float lum = max(c.r, max(c.g, c.b));
  float a = clamp(uDim + (1.0 - uDim) * smoothstep(0.02, 0.16, lum), 0.0, 1.0);
  fragColor = vec4(c * a, a);
}`
