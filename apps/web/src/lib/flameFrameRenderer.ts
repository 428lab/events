import type { FlamePalette } from "@eventer/shared";

/**
 * 炎のフレーム (#566) の WebGL 描画。デザイン試作
 * docs/assets/live-flame-frame-566/prototype.html のシェーダーをそのまま移したもの。
 *
 * 枠（角丸の四角形）までの符号付き距離 d と外周に沿った長さ s を画素ごとに求め、
 * (s, d - 時間) でドメインワープした fbm ノイズを外へ流す。炎は重力を無視して
 * 枠から外向きに広がり、枠の内側（d < 0）は合成段で必ず透明にする。
 * 1 コマ = 炎 → 1/4 解像度のぼかし 4 回（グロー）→ 合成（かげろう・内側の透明化）。
 * 絵は時刻だけで決まる（同じ clock/flow なら同じ絵）。
 */

const VERTEX = `attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const COMMON = `precision highp float;
uniform vec2 uRes;
uniform vec2 uScale;
uniform vec2 uOrigin;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform float uR;
uniform float uT;
uniform float uH;
uniform float uTime;
uniform float uClock;
uniform float uTurb;
uniform float uEmber;
uniform float uCells;
uniform float uRp;
uniform float uLight;

vec2 stagePos(vec2 fc, vec2 res) { return uOrigin + vec2(fc.x, res.y - fc.y) / (uScale * res / uRes); }

vec4 frameCoords(vec2 p) {
  vec2 q = p - uCenter;
  vec2 c = max(uHalf - uR, 0.0);
  vec2 k = clamp(q, -c, c);
  vec2 dv = q - k;
  vec2 qq = abs(q) - c;
  float d = length(max(qq, 0.0)) + min(max(qq.x, qq.y), 0.0) - uR;
  float A = 1.5707963 * uRp;
  float P = 4.0 * c.x + 4.0 * c.y + 4.0 * A;
  float e = 1e-4, s = 0.0, J = 1.0, ld = length(dv);
  bool zx = abs(dv.x) < e, zy = abs(dv.y) < e;
  if (zx && zy) {
    s = k.x + c.x;
  } else if (zx) {
    s = dv.y < 0.0 ? k.x + c.x : 2.0 * c.x + 2.0 * A + 2.0 * c.y + (c.x - k.x);
  } else if (zy) {
    s = dv.x > 0.0 ? 2.0 * c.x + A + (k.y + c.y) : 4.0 * c.x + 2.0 * c.y + 3.0 * A + (c.y - k.y);
  } else {
    J = ld / uRp;
    if (dv.x > 0.0 && dv.y < 0.0)      s = 2.0 * c.x + atan(dv.x, -dv.y) * uRp;
    else if (dv.x > 0.0)               s = 2.0 * c.x + A + 2.0 * c.y + atan(dv.y, dv.x) * uRp;
    else if (dv.y > 0.0)               s = 4.0 * c.x + 2.0 * c.y + 2.0 * A + atan(-dv.x, dv.y) * uRp;
    else                               s = 4.0 * c.x + 4.0 * c.y + 3.0 * A + atan(-dv.y, -dv.x) * uRp;
  }
  return vec4(d, s, max(J, 0.05), P);
}

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float gnoise(vec3 p, float per) {
  vec3 i = floor(p), f = p - i;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float x0 = mod(i.x, per), x1 = mod(i.x + 1.0, per);
  #define G(X, Y, Z, O) dot(hash33(vec3(X, i.y + Y, i.z + Z)) * 2.0 - 1.0, f - O)
  float a = G(x0, 0.0, 0.0, vec3(0.0, 0.0, 0.0)), b = G(x1, 0.0, 0.0, vec3(1.0, 0.0, 0.0));
  float cc = G(x0, 1.0, 0.0, vec3(0.0, 1.0, 0.0)), dd = G(x1, 1.0, 0.0, vec3(1.0, 1.0, 0.0));
  float e1 = G(x0, 0.0, 1.0, vec3(0.0, 0.0, 1.0)), f1 = G(x1, 0.0, 1.0, vec3(1.0, 0.0, 1.0));
  float g1 = G(x0, 1.0, 1.0, vec3(0.0, 1.0, 1.0)), h1 = G(x1, 1.0, 1.0, vec3(1.0, 1.0, 1.0));
  #undef G
  return mix(mix(mix(a, b, u.x), mix(cc, dd, u.x), u.y), mix(mix(e1, f1, u.x), mix(g1, h1, u.x), u.y), u.z);
}
`;

const FLAME = `uniform vec3 uRamp0, uRamp1, uRamp2, uRamp3, uRamp4;

float fbm(vec3 p, float per, int oct) {
  float sum = 0.0, amp = 0.5;
  for (int i = 0; i < 5; i++) {
    if (i >= oct) break;
    sum += amp * gnoise(p, per);
    p = p * vec3(2.0, 2.03, 1.9) + vec3(0.0, 11.7, 3.1);
    per *= 2.0; amp *= 0.5;
  }
  return sum;
}

vec3 ramp(float h) {
  if (h < 0.25) return mix(uRamp0, uRamp1, h / 0.25);
  if (h < 0.5) return mix(uRamp1, uRamp2, (h - 0.25) / 0.25);
  if (h < 0.8) return mix(uRamp2, uRamp3, (h - 0.5) / 0.3);
  return mix(uRamp3, uRamp4, smoothstep(0.8, 1.0, h));
}

float pdist(float a, float b, float P) { float x = mod(a - b + 0.5 * P, P) - 0.5 * P; return x; }

float embers(float s, float v, float J, float P) {
  if (uEmber <= 0.0) return 0.0;
  float nE = floor(P / mix(90.0, 16.0, uEmber));
  float cell = P / nE;
  float ci = floor(s / cell);
  float acc = 0.0;
  for (int j = -1; j <= 1; j++) {
    float c = mod(ci + float(j), nE);
    for (int k = 0; k < 2; k++) {
      vec3 h0 = hash33(vec3(c, float(k) * 7.0 + 1.0, 3.0));
      float life = 0.9 + 1.3 * h0.x;
      float ph = uClock / life + h0.y;
      float m = floor(ph), a = ph - m;
      vec3 r = hash33(vec3(c + 0.37, float(k) + 13.0, m));
      vec3 r2 = hash33(vec3(m, c * 1.7, float(k) + 5.0));
      float travel = uH * (0.7 + 2.0 * r.y) * a * (1.0 - 0.35 * a);
      float vp = uT * 0.5 + uH * 0.25 * r.z + travel;
      float drift = (r2.x - 0.5) * cell * 0.9 * a + sin(uClock * (2.0 + 3.0 * r2.y) + r2.z * 30.0) * 3.0 * a;
      float sp = (c + r.x) * cell;
      float ds = pdist(s, sp, P) * J - drift;
      float dvv = v - vp;
      float size = 0.55 + 0.9 * r2.y * r2.y;
      float streak = 1.0 + 1.6 * (1.0 - a);
      float g = exp(-(ds * ds) / (size * size) - (dvv * dvv) / (size * size * streak * streak));
      float fade = smoothstep(0.0, 0.08, a) * pow(1.0 - a, 1.4);
      float flick = 0.55 + 0.45 * sin(uClock * (18.0 + 20.0 * r.z) + r2.x * 40.0);
      acc += g * fade * flick * step(r2.z, 0.35 + 0.65 * uEmber);
    }
  }
  return acc;
}

void main() {
  vec2 p = stagePos(gl_FragCoord.xy, uRes);
  vec4 fc = frameCoords(p);
  float d = fc.x, s = fc.y, J = fc.z, P = fc.w;
  if (d <= 0.0) { gl_FragColor = vec4(0.0); return; }
  float v = d - uT * 0.5;
  float y = max(v, 0.0) / uH;
  if (y > 3.6) { gl_FragColor = vec4(0.0); return; }

  float X = s / P * uCells;
  float cellH = 30.0 + uH * 0.35;
  float V = max(v, 0.0) / cellH;
  float t = uTime;

  float lenN = gnoise(vec3(X * 0.125, 0.5, t * 0.22 + 4.0), uCells * 0.125);
  float lenN2 = gnoise(vec3(X * 0.5, 2.5, t * 0.45), uCells * 0.5);
  float flare = 0.0;
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float period = 5.5 + 2.5 * fi;
    float cyc = uClock / period + fi * 0.43;
    float m = floor(cyc), a = cyc - m;
    vec3 r = hash33(vec3(m, fi + 21.0, 9.0));
    float dir = r.x < 0.5 ? -1.0 : 1.0;
    float pos = r.y * P + dir * a * P * (0.35 + 0.3 * r.z);
    float ds = pdist(s, pos, P);
    float env = smoothstep(0.0, 0.15, a) * smoothstep(1.0, 0.6, a) * step(0.3, r.z + 0.25);
    flare += env * exp(-ds * ds / (2.0 * 70.0 * 70.0));
  }
  float L = 0.95 + 0.55 * lenN + 0.3 * lenN2 + 0.55 * flare;

  vec3 wp = vec3(X * 0.5, V * 0.6 - t * 0.9, t * 0.3);
  float w1 = fbm(wp, uCells * 0.5, 2);
  float w2 = fbm(wp + vec3(3.0, 7.1, 1.7), uCells * 0.5, 2);
  float warpK = (0.35 + 1.1 * y) * (0.4 + uTurb);
  vec3 np = vec3(X + w1 * warpK * 1.6, V - t * 1.7 + w2 * warpK, t * 0.5);
  float n = fbm(np, uCells, 5);

  float amp = 0.45 + 0.9 * uTurb;
  float lick = gnoise(vec3(X * 1.5 + w1 * 0.8, V * 0.35 - t * 0.9, t * 0.25 + 7.0), uCells * 1.5);
  float heat = 0.84 - 0.95 * y / L;
  heat += n * (1.1 + 1.5 * y) * amp;
  heat += lick * smoothstep(0.05, 0.6, y) * (0.55 + 0.4 * uTurb);
  heat -= 0.15 * y * y;
  heat *= 1.0 + 0.35 * flare;

  float px = 1.0 / uScale.x;
  float line = 1.0 - smoothstep(uT - 0.5 * px, uT + px, d);
  heat = max(heat, line * (0.9 + 0.1 * n));

  float h = clamp(heat, 0.0, 1.0);
  float body = smoothstep(0.02, 0.3, heat);
  vec3 col = ramp(h);
  float e = embers(s, v, J, P);
  vec3 ecol = mix(uRamp3, uRamp4, 0.6);

  vec4 o;
  if (uLight > 0.5) {
    float a = body * (0.16 + 0.82 * smoothstep(0.0, 0.8, h));
    o = vec4(col * a, a);
    float ea = clamp(e, 0.0, 1.0) * 0.9;
    o = vec4(ecol * ea + o.rgb * (1.0 - ea), ea + o.a * (1.0 - ea));
  } else {
    float glow = body * (0.22 + 0.9 * h * h);
    o = vec4(col * glow, body * (0.12 + 0.55 * h));
    o.rgb += ecol * e * 1.4;
    o.a += e * 0.35;
  }
  gl_FragColor = clamp(o, 0.0, 1.0);
}
`;

const BLUR = `uniform sampler2D uTex;
uniform vec2 uDir;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 c = texture2D(uTex, uv) * 0.2270270;
  c += (texture2D(uTex, uv + uDir * 1.3846154) + texture2D(uTex, uv - uDir * 1.3846154)) * 0.3162162;
  c += (texture2D(uTex, uv + uDir * 3.2307692) + texture2D(uTex, uv - uDir * 3.2307692)) * 0.0702703;
  gl_FragColor = c;
}
`;

const COMPOSITE = `uniform sampler2D uFlame, uBloom;
uniform float uBloomK;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = stagePos(gl_FragCoord.xy, uRes);
  vec2 q = p - uCenter, c = max(uHalf - uR, 0.0), qq = abs(q) - c;
  float d = length(max(qq, 0.0)) + min(max(qq.x, qq.y), 0.0) - uR;
  float inside = clamp(d * uScale.x, 0.0, 1.0);
  if (inside <= 0.0) { gl_FragColor = vec4(0.0); return; }
  float v = d - uT;
  float sh = smoothstep(0.15 * uH, 1.3 * uH, v) * (0.6 + 1.6 * uTurb);
  vec2 wob = vec2(sin(p.y * 0.21 + uClock * 9.0 + sin(p.x * 0.07 + uClock * 2.3) * 2.0),
                  cos(p.x * 0.19 - uClock * 8.0 + sin(p.y * 0.05 - uClock * 1.7) * 2.0)) * sh;
  vec2 duv = wob * uScale / uRes * vec2(1.0, -1.0);
  vec4 f = texture2D(uFlame, uv + duv);
  vec4 b = texture2D(uBloom, uv + duv * 0.5);
  vec4 o;
  if (uLight > 0.5) {
    b *= uBloomK;
    o = f + b * (1.0 - f.a);
  } else {
    o = f + vec4(b.rgb * uBloomK, b.a * uBloomK * 0.25);
  }
  gl_FragColor = clamp(o, 0.0, 1.0) * inside;
}
`;

/** 温度の 5 段: 煙の縁 → 深い色 → 中間 → 明るい色 → 芯 */
export const FLAME_RAMPS: Record<FlamePalette, readonly string[]> = {
  ember: ["#2A0602", "#A3170A", "#F2560F", "#FFB22E", "#FFF6DA"],
  azure: ["#020624", "#0B2AA6", "#1F6BFF", "#62CCFF", "#F0FFFF"],
  violet: ["#14031F", "#5A0FA8", "#A33CFF", "#EA86FF", "#FFF2FF"],
  // 白磁の金。試作より少しだけ締めた琥珀と明るい芯にして、白い地でくすまないようにする
  gold: ["#5E3206", "#8E520B", "#BA7814", "#DDA032", "#F7D47E"],
};

/** 描画の入力。座標は要素の左上を原点にした配信画面の論理 px */
export interface FlameFrameParams {
  /** 枠（= 要素の箱）の大きさ */
  w: number;
  h: number;
  /** canvas の左上（要素の左上からのずれ）と大きさ */
  originX: number;
  originY: number;
  cssW: number;
  cssH: number;
  /** canvas の実画素 */
  backingW: number;
  backingH: number;
  radius: number;
  thickness: number;
  height: number;
  flicker: number;
  embers: number;
  palette: FlamePalette;
  light: boolean;
}

/** ゆらぎの強さに応じた炎の流れる速さ（試作と同じ） */
export const flameFlowSpeed = (flicker: number) => 0.55 + 0.9 * (flicker / 100);

/** 動きを減らすときに描く 1 コマの時刻（炎が育ちきった姿） */
export const FLAME_STATIC_TIME = 2.4;

/** 炎が枠の外へ届く余白（論理 px）。試作と同じ式 */
export const flameMargin = (thickness: number, height: number) => Math.ceil(thickness + height * 2.9 + 12);

const hexToRgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

interface Program { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }
interface Target { tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number }

/**
 * 1 つの WebGL 文脈で炎を描く。作れない（WebGL が無い・シェーダーが通らない）ときは
 * create が null を返し、呼ぶ側は枠の線だけを描く。
 */
export class FlameFrameRenderer {
  private targets: { flame: Target; a: Target; b: Target } | null = null;
  private targetSize = "";

  private constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGLRenderingContext,
    private readonly progs: { flame: Program; blur: Program; comp: Program },
    private readonly quad: WebGLBuffer,
  ) {}

  static create(canvas: HTMLCanvasElement, preserveDrawingBuffer = false): FlameFrameRenderer | null {
    const opts: WebGLContextAttributes = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer };
    let gl: WebGLRenderingContext | null = null;
    try {
      gl = (canvas.getContext("webgl2", opts) as WebGLRenderingContext | null) ?? canvas.getContext("webgl", opts);
    } catch {
      return null;
    }
    if (!gl) return null;
    try {
      const compile = (fs: string): Program => {
        const mk = (type: number, text: string) => {
          const sh = gl.createShader(type)!;
          gl.shaderSource(sh, text);
          gl.compileShader(sh);
          if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "shader");
          return sh;
        };
        const p = gl.createProgram()!;
        gl.attachShader(p, mk(gl.VERTEX_SHADER, VERTEX));
        gl.attachShader(p, mk(gl.FRAGMENT_SHADER, COMMON + fs));
        gl.bindAttribLocation(p, 0, "aPos");
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
        const u: Program["u"] = {};
        const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
        for (let i = 0; i < n; i++) {
          const name = gl.getActiveUniform(p, i)!.name;
          u[name] = gl.getUniformLocation(p, name);
        }
        return { p, u };
      };
      const progs = { flame: compile(FLAME), blur: compile(BLUR), comp: compile(COMPOSITE) };
      const quad = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      return new FlameFrameRenderer(canvas, gl, progs, quad);
    } catch (error) {
      console.error("flame frame: WebGL setup failed", error);
      return null;
    }
  }

  private makeTarget(w: number, h: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h };
  }

  private deleteTargets() {
    if (!this.targets) return;
    for (const t of Object.values(this.targets)) {
      this.gl.deleteTexture(t.tex);
      this.gl.deleteFramebuffer(t.fb);
    }
    this.targets = null;
    this.targetSize = "";
  }

  private ensureTargets(bw: number, bh: number) {
    const key = `${bw}x${bh}`;
    if (this.targets && this.targetSize === key) return this.targets;
    this.deleteTargets();
    if (this.canvas.width !== bw) this.canvas.width = bw;
    if (this.canvas.height !== bh) this.canvas.height = bh;
    const qw = Math.max(1, Math.ceil(bw / 4)), qh = Math.max(1, Math.ceil(bh / 4));
    this.targets = { flame: this.makeTarget(bw, bh), a: this.makeTarget(qw, qh), b: this.makeTarget(qw, qh) };
    this.targetSize = key;
    return this.targets;
  }

  /** clock は壁時計の秒（火の粉・かげろう・フレア）、flow はゆらぎの速さで積分した流れの時刻 */
  draw(params: FlameFrameParams, clock: number, flow: number) {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    const g = params;
    const bw = g.backingW, bh = g.backingH;
    const targets = this.ensureTargets(bw, bh);
    const R = Math.max(0, Math.min(g.radius, g.w / 2, g.h / 2));
    const height = g.height * (g.light ? 0.8 : 1);
    const Rp = R + height * 0.6 + 8;
    const cx = Math.max(g.w / 2 - R, 0), cy = Math.max(g.h / 2 - R, 0);
    const P = 4 * cx + 4 * cy + 2 * Math.PI * Rp;
    const cells = Math.max(8, Math.round(P / 24 / 8) * 8);
    const setCommon = (prog: Program, res: [number, number]) => {
      const u = prog.u;
      gl.uniform2f(u.uRes, res[0], res[1]);
      if (u.uScale) gl.uniform2f(u.uScale, bw / g.cssW, bh / g.cssH);
      if (u.uOrigin) gl.uniform2f(u.uOrigin, g.originX, g.originY);
      if (u.uCenter) gl.uniform2f(u.uCenter, g.w / 2, g.h / 2);
      if (u.uHalf) gl.uniform2f(u.uHalf, g.w / 2, g.h / 2);
      if (u.uR) gl.uniform1f(u.uR, R);
      if (u.uT) gl.uniform1f(u.uT, g.thickness);
      if (u.uH) gl.uniform1f(u.uH, height);
      if (u.uTurb) gl.uniform1f(u.uTurb, g.flicker / 100);
      if (u.uEmber) gl.uniform1f(u.uEmber, g.embers / 100);
      if (u.uCells) gl.uniform1f(u.uCells, cells);
      if (u.uRp) gl.uniform1f(u.uRp, Rp);
      if (u.uLight) gl.uniform1f(u.uLight, g.light ? 1 : 0);
    };
    const { flame, blur, comp } = this.progs;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.disable(gl.BLEND);
    // 1) 炎・枠の線・火の粉
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.flame.fb);
    gl.viewport(0, 0, bw, bh);
    gl.useProgram(flame.p);
    setCommon(flame, [bw, bh]);
    gl.uniform1f(flame.u.uTime, flow);
    gl.uniform1f(flame.u.uClock, clock);
    FLAME_RAMPS[g.palette].forEach((c, i) => gl.uniform3fv(flame.u[`uRamp${i}`], hexToRgb(c)));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // 2) グロー: 1/4 解像度で縦横に 2 回ずつぼかす
    const qa = targets.a, qb = targets.b;
    gl.useProgram(blur.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(blur.u.uTex, 0);
    const pass = (src: Target, dst: Target, dx: number, dy: number) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
      gl.viewport(0, 0, dst.w, dst.h);
      gl.uniform2f(blur.u.uRes, dst.w, dst.h);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform2f(blur.u.uDir, dx, dy);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    pass(targets.flame, qa, 2 / bw, 0);
    pass(qa, qb, 0, 2 / qa.h);
    pass(qb, qa, 3 / qa.w, 0);
    pass(qa, qb, 0, 3 / qa.h);
    // 3) 合成。枠の内側はここで必ず透明にする
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, bw, bh);
    gl.useProgram(comp.p);
    setCommon(comp, [bw, bh]);
    gl.uniform1f(comp.u.uClock, clock);
    gl.uniform1f(comp.u.uBloomK, g.light ? 0.5 : 0.95);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets.flame.tex);
    gl.uniform1i(comp.u.uFlame, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, qb.tex);
    gl.uniform1i(comp.u.uBloom, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE0);
  }

  isContextLost() {
    return this.gl.isContextLost();
  }

  /**
   * テクスチャ・プログラム・バッファを消す。文脈そのものは canvas と一緒に捨てられる。
   * loseContext() は呼ばない: 同じ canvas で作り直す（開発時の StrictMode の再実行など）と、
   * 失われた文脈が返ってきて炎が描けなくなる。
   */
  dispose() {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    this.deleteTargets();
    for (const prog of Object.values(this.progs)) gl.deleteProgram(prog.p);
    gl.deleteBuffer(this.quad);
  }
}

let sharedStill: FlameFrameRenderer | null | undefined;

/**
 * 止まった 1 コマ（サムネイル・動きを減らす）を描く。WebGL の文脈はページで 1 つだけ使い回し、
 * 描いた絵を呼ぶ側の 2D canvas へ写す。サムネイルが並んでも文脈の上限に届かない。
 * 描けなかったら false。
 */
export function drawFlameFrameStill(target: HTMLCanvasElement, params: FlameFrameParams, clock: number, flow: number): boolean {
  if (sharedStill === undefined || sharedStill?.isContextLost()) sharedStill = FlameFrameRenderer.create(document.createElement("canvas"), true);
  if (!sharedStill) return false;
  const ctx = target.getContext("2d");
  if (!ctx) return false;
  sharedStill.draw(params, clock, flow);
  if (target.width !== params.backingW) target.width = params.backingW;
  if (target.height !== params.backingH) target.height = params.backingH;
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(sharedStill.canvas, 0, 0);
  return true;
}
