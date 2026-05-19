/* SPH Perception Demo — shared script
 * Used by both sph-demo.html (standalone) and index.html (integrated).
 *
 * Single source of truth: the demo's HTML markup is the SPH_DEMO_TEMPLATE
 * constant below. Each page contains only a `<div class="sph-demo-mount"></div>`
 * placeholder; this script populates it on DOM ready.
 *
 * Depends on:
 *   - sph-demo.css for styling (link from the host page)
 *   - MathJax 3 globally configured with \( \) inline + \[ \] display delimiters
 *     (already set up in index.html; sph-demo.html provides its own minimal config)
 */
(function () {
  'use strict';

  // ============================================================
  // HTML template — the entire .sph-card + the .stilde-label overlay.
  // Use String.raw so backslashes (\rho, \(, \tilde, ...) survive the JS parse.
  // ============================================================
  const SPH_DEMO_TEMPLATE = String.raw`
<div class="sph-card">
  <h2>SPH Perception</h2>

  <div class="perception-bar">
    <span class="label">Perception Operators:</span>
    <div class="chip-group" data-group="perception">
      <button class="chip" data-val="rho"        data-tex="\rho">(density)</button>
      <button class="chip" data-val="count"      data-tex="N">(count)</button>
      <button class="chip" data-val="S"          data-tex="\tilde{S}">(smoothing)</button>
      <button class="chip" data-val="grad0S"     data-tex="\nabla_{0} S">(gradient, 0-th)</button>
      <button class="chip active" data-val="grad1S" data-tex="\nabla_{1} S">(gradient, 1-st)</button>
      <button class="chip" data-val="gradRho"    data-tex="\nabla \rho">(density gradient)</button>
      <button class="chip" data-val="M"          data-tex="M">(moment matrix)</button>
      <button class="chip" data-val="none">none</button>
    </div>
  </div>

  <div class="main">
    <canvas id="main-canvas"></canvas>
    <div class="hint">drag = move centre &middot; shift-drag = pan &middot; wheel = zoom</div>
  </div>

  <div class="formula-display" id="formula-display"></div>

  <div class="kernels">
    <div class="kernel-block">
      <div class="kernel-plot">
        <div class="kernel-y-label">\(W_\epsilon(r)\)</div>
        <canvas id="kernel-w"></canvas>
        <div class="kernel-eps-label">\(\epsilon\)</div>
        <div class="kernel-x-label">\(|r|\)</div>
      </div>
      <div class="kernel-formula">
        \[
          W_\epsilon(r)=
          \begin{cases}
            \dfrac{4}{\pi\epsilon^8}\left(\epsilon^2-r^2\right)^3, & 0 \le r < \epsilon,\\
            0, & \text{otherwise}.
          \end{cases}
        \]
      </div>
    </div>
    <div class="kernel-block">
      <div class="kernel-plot">
        <div class="kernel-y-label">\(\|W_\epsilon^{\nabla}(r)\|\)</div>
        <canvas id="kernel-gradw"></canvas>
        <div class="kernel-eps-label">\(\epsilon\)</div>
        <div class="kernel-x-label">\(|r|\)</div>
      </div>
      <div class="kernel-formula">
        \[
          W_\epsilon^{\nabla}(\mathbf{r})=
          \begin{cases}
            \dfrac{10}{\pi\epsilon^5}\left(\epsilon-\|\mathbf{r}\|\right)^2
            \dfrac{\mathbf{r}}{\|\mathbf{r}\|}, & 0 < \|\mathbf{r}\| < \epsilon,\\
            \mathbf{0}, & \text{otherwise}.
          \end{cases}
        \]
      </div>
    </div>
  </div>

  <div class="controls-col">
    <details open>
      <summary>Sliders</summary>
      <div class="folder-body">
        <div class="slider-row">
          <span class="nm">\(N\)</span>
          <input type="range" id="N-slider" min="5" max="100" step="1" value="50">
          <span class="vl" id="N-val">50</span>
        </div>
        <div class="slider-row">
          <span class="nm">\(\epsilon\)</span>
          <input type="range" id="eps-slider" min="0.05" max="1.5" step="0.01" value="0.40">
          <span class="vl" id="eps-val">0.40</span>
        </div>
      </div>
    </details>

    <details>
      <summary>Initialization</summary>
      <div class="folder-body">
        <div>
          <div class="group-label">Position</div>
          <div class="chip-group" data-group="posInit">
            <button class="chip active" data-val="uniform">Uniform</button>
            <button class="chip" data-val="gaussian">Gaussian</button>
          </div>
        </div>
        <div class="slider-row">
          <span class="nm">\(R\)</span>
          <input type="range" id="R-slider" min="0.1" max="2.0" step="0.01" value="0.80">
          <span class="vl" id="R-val">0.80</span>
        </div>
        <div>
          <div class="group-label">State</div>
          <div class="chip-group" data-group="stateInit">
            <button class="chip" data-val="random">Random</button>
            <button class="chip" data-val="gradient">Gradient</button>
            <button class="chip active" data-val="ring">Rainbow</button>
          </div>
        </div>
      </div>
    </details>

    <details>
      <summary>Visualization</summary>
      <div class="folder-body">
        <div>
          <div class="group-label">Background</div>
          <div class="chip-group" data-group="bgMode">
            <button class="chip" data-val="splat">Splat</button>
            <button class="chip active" data-val="circles">Circles</button>
          </div>
        </div>
        <div class="slider-row">
          <span class="nm">\(\sigma\)</span>
          <input type="range" id="sigma-slider" min="0.02" max="0.4" step="0.01" value="0.10">
          <span class="vl" id="sigma-val">0.10</span>
        </div>
      </div>
    </details>

    <details>
      <summary>Gradient Normalization</summary>
      <div class="folder-body">
        <div class="chip-group" data-group="gradientNorm">
          <button class="chip active" data-val="log">Log norm</button>
          <button class="chip" data-val="none">No norm</button>
        </div>
      </div>
    </details>

    <details>
      <summary>Viewport</summary>
      <div class="folder-body">
        <button class="btn" id="reset-view-btn">Reset view</button>
        <div class="zoom-readout">zoom: <span id="zoom-val">1.00&times;</span></div>
      </div>
    </details>

    <button class="btn primary" id="reset-all-btn">Reset particles</button>
  </div>
</div>

<div class="canvas-math-label" id="canvas-math-label"></div>
<div class="stilde-label" id="stilde-label">\(\tilde{S}\)</div>
`;

  // ============================================================
  // Mount-time initialisation. Populates `mount` with the demo markup and
  // wires up all state, rendering, event handlers, and MathJax typesetting.
  // ============================================================
  function initSphDemo(mount) {
    mount.innerHTML = SPH_DEMO_TEMPLATE;

    // ----- State -----
    const state = {
      particles: [],
      N: 50,
      epsilon: 0.40,
      sigma: 0.10,
      initRange: 0.80,
      posInit: 'uniform',
      stateInit: 'ring',
      bgMode: 'circles',
      gradientNorm: 'log',
      perception: 'grad1S',
      view: { cx: 0, cy: 0, halfSpan: 1.2 },
      rho: null,
      stateCtx: null,
    };
    const DEFAULT_HALFSPAN = 1.2;
    const DET_TAU = 1e-6;

    // ----- Canvas / DPI -----
    const mainCanvas = mount.querySelector('#main-canvas');
    const ctx = mainCanvas.getContext('2d');
    const kWCanvas = mount.querySelector('#kernel-w');
    const kGCanvas = mount.querySelector('#kernel-gradw');
    const kWCtx = kWCanvas.getContext('2d');
    const kGCtx = kGCanvas.getContext('2d');

    function fitCanvas(c) {
      const dpr = window.devicePixelRatio || 1;
      const rect = c.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (c.width !== w || c.height !== h) {
        c.width = w; c.height = h;
        return true;
      }
      return false;
    }

    // ----- Coordinate transforms -----
    function viewScalePx() { return Math.min(mainCanvas.width, mainCanvas.height) / 2; }
    function worldToPx(wx, wy) {
      const s = viewScalePx();
      return [
        mainCanvas.width / 2  + (wx - state.view.cx) / state.view.halfSpan * s,
        mainCanvas.height / 2 + (wy - state.view.cy) / state.view.halfSpan * s,
      ];
    }
    function pxToWorld(px, py) {
      const s = viewScalePx();
      return [
        state.view.cx + (px - mainCanvas.width  / 2) / s * state.view.halfSpan,
        state.view.cy + (py - mainCanvas.height / 2) / s * state.view.halfSpan,
      ];
    }
    function worldSizeToPx(ws) { return ws / state.view.halfSpan * viewScalePx(); }
    function worldSizeToDefaultViewPx(ws) { return ws / DEFAULT_HALFSPAN * viewScalePx(); }
    function cssToCanvasPx(cssX, cssY) {
      const rect = mainCanvas.getBoundingClientRect();
      return [
        (cssX - rect.left) * (mainCanvas.width  / rect.width),
        (cssY - rect.top)  * (mainCanvas.height / rect.height),
      ];
    }

    // ----- SPH kernels -----
    function W(r, eps) {
      if (r >= eps) return 0;
      const c = 4 / (Math.PI * Math.pow(eps, 8));
      const d = eps * eps - r * r;
      return c * d * d * d;
    }
    function gradW(rx, ry, eps) {
      const r = Math.hypot(rx, ry);
      if (r === 0 || r >= eps) return [0, 0];
      const c = 10 / (Math.PI * Math.pow(eps, 5));
      const k = c * (eps - r) * (eps - r) / r;
      return [k * rx, k * ry];
    }
    function gradWNorm(r, eps) {
      if (r === 0 || r >= eps) return 0;
      return 10 / (Math.PI * Math.pow(eps, 5)) * (eps - r) * (eps - r);
    }

    // ----- Sampling -----
    function randn() {
      const u = Math.max(1e-9, Math.random()), v = Math.random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }
    function samplePos(R, mode) {
      if (mode === 'uniform') {
        return [(Math.random() * 2 - 1) * R, (Math.random() * 2 - 1) * R];
      } else if (mode === 'disk') {
        const r = R * Math.sqrt(Math.random());
        const t = Math.random() * 2 * Math.PI;
        return [r * Math.cos(t), r * Math.sin(t)];
      } else {
        const sig = R / 2.5;
        let x = randn() * sig, y = randn() * sig;
        x = Math.max(-R, Math.min(R, x));
        y = Math.max(-R, Math.min(R, y));
        return [x, y];
      }
    }
    function hsv2rgb(h, s, v) {
      h = (h % 1 + 1) % 1;
      const i = Math.floor(h * 6);
      const f = h * 6 - i;
      const p = v * (1 - s);
      const q = v * (1 - f * s);
      const t = v * (1 - (1 - f) * s);
      switch (i % 6) {
        case 0: return [v, t, p];
        case 1: return [q, v, p];
        case 2: return [p, v, t];
        case 3: return [p, q, v];
        case 4: return [t, p, v];
        default: return [v, p, q];
      }
    }
    function randUnit2D() {
      const a = Math.random() * 2 * Math.PI;
      return [Math.cos(a), Math.sin(a)];
    }
    function randomGradientCenter() {
      const maxOffset = state.initRange * 0.2;
      return [
        (Math.random() * 2 - 1) * maxOffset,
        (Math.random() * 2 - 1) * maxOffset,
      ];
    }

    function resampleStateCtx() {
      if (state.stateInit === 'gradient') {
        state.stateCtx = {
          center: randomGradientCenter(),
          dirs: [randUnit2D(), randUnit2D(), randUnit2D()],
        };
      } else if (state.stateInit === 'flat-ch') {
        state.stateCtx = {
          zeroCh: Math.floor(Math.random() * 3),
          dirs: [randUnit2D(), randUnit2D(), randUnit2D()],
        };
      } else {
        state.stateCtx = null;
      }
    }
    function sampleState(x, y) {
      if (state.stateInit === 'random') {
        return [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1];
      } else if (state.stateInit === 'gradient') {
        const c = state.stateCtx;
        const invR = 1 / Math.max(1e-9, state.initRange);
        const clamp = (v) => Math.max(-1, Math.min(1, v));
        const gx = x - c.center[0];
        const gy = y - c.center[1];
        return [
          clamp(c.dirs[0][0] * gx * invR + c.dirs[0][1] * gy * invR),
          clamp(c.dirs[1][0] * gx * invR + c.dirs[1][1] * gy * invR),
          clamp(c.dirs[2][0] * gx * invR + c.dirs[2][1] * gy * invR),
        ];
      } else if (state.stateInit === 'ring') {
        const angle = Math.atan2(y, x);
        const h = (angle / (2 * Math.PI) + 1) % 1;
        const [r, g, b] = hsv2rgb(h, 1, 1);
        return [r * 2 - 1, g * 2 - 1, b * 2 - 1];
      } else {
        const c = state.stateCtx;
        const invR = 1 / Math.max(1e-9, state.initRange);
        const clamp = (v) => Math.max(-1, Math.min(1, v));
        const out = [
          clamp(c.dirs[0][0] * x * invR + c.dirs[0][1] * y * invR),
          clamp(c.dirs[1][0] * x * invR + c.dirs[1][1] * y * invR),
          clamp(c.dirs[2][0] * x * invR + c.dirs[2][1] * y * invR),
        ];
        out[c.zeroCh] = 0;
        return out;
      }
    }

    function resample() {
      resampleStateCtx();
      lastEig = null;
      state.particles = [];
      state.particles.push({ x: 0, y: 0, r: 0, g: 0, b: 0 });
      for (let i = 1; i < state.N; i++) {
        const [x, y] = samplePos(state.initRange, state.posInit);
        const [r, g, b] = sampleState(x, y);
        state.particles.push({ x, y, r, g, b });
      }
      invalidate();
    }

    // ----- SPH operators -----
    function computeAllRho() {
      const N = state.particles.length;
      const rho = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        let s = 0;
        const pi = state.particles[i];
        for (let j = 0; j < N; j++) {
          const pj = state.particles[j];
          const r = Math.hypot(pi.x - pj.x, pi.y - pj.y);
          s += W(r, state.epsilon);
        }
        rho[i] = s;
      }
      state.rho = rho;
    }

    function computeCentreOps() {
      const N = state.particles.length;
      const pi = state.particles[0];
      let rho = 0, count = 0;
      let Sr = 0, Sg = 0, Sb = 0;
      let grx = 0, gry = 0;
      let m00 = 0, m01 = 0, m10 = 0, m11 = 0;
      let g00 = 0, g01 = 0, g10 = 0, g11 = 0, g20 = 0, g21 = 0;
      const Si = [pi.r, pi.g, pi.b];
      for (let j = 0; j < N; j++) {
        const pj = state.particles[j];
        // r_ji = x_j - x_i  →  W^∇(r_ji) points from i toward j.
        const rx = pj.x - pi.x;
        const ry = pj.y - pi.y;
        const rmag = Math.hypot(rx, ry);
        const w = W(rmag, state.epsilon);
        const [gx, gy] = gradW(rx, ry, state.epsilon);
        rho += w;
        if (rmag < state.epsilon) count++;
        grx += gx; gry += gy;
        const rj = state.rho[j];
        const invRho = rj > 1e-9 ? 1 / rj : 0;
        Sr += pj.r * w * invRho;
        Sg += pj.g * w * invRho;
        Sb += pj.b * w * invRho;
        m00 += rx * gx * invRho;
        m01 += rx * gy * invRho;
        m10 += ry * gx * invRho;
        m11 += ry * gy * invRho;
        const dr = pj.r - Si[0], dg = pj.g - Si[1], db = pj.b - Si[2];
        g00 += dr * gx * invRho;
        g01 += dr * gy * invRho;
        g10 += dg * gx * invRho;
        g11 += dg * gy * invRho;
        g20 += db * gx * invRho;
        g21 += db * gy * invRho;
      }
      const M = [[m00, m01], [m10, m11]];
      const grad0S = [[g00, g01], [g10, g11], [g20, g21]];
      const det = m00 * m11 - m01 * m10;
      let grad1S;
      if (Math.abs(det) >= DET_TAU) {
        const im00 =  m11 / det, im01 = -m01 / det;
        const im10 = -m10 / det, im11 =  m00 / det;
        grad1S = [
          [g00 * im00 + g01 * im10, g00 * im01 + g01 * im11],
          [g10 * im00 + g11 * im10, g10 * im01 + g11 * im11],
          [g20 * im00 + g21 * im10, g20 * im01 + g21 * im11],
        ];
      } else {
        grad1S = grad0S;
      }
      return { rho, count, S: [Sr, Sg, Sb], gradRho: [grx, gry], M, grad0S, grad1S };
    }

    function eig2x2(M) {
      const a = M[0][0], b = M[0][1], c = M[1][0], d = M[1][1];
      const T = a + d;
      const D = a * d - b * c;
      const disc = Math.max(0, T * T / 4 - D);
      const sq = Math.sqrt(disc);
      const l1 = T / 2 + sq, l2 = T / 2 - sq;
      function v(lam) {
        let vx, vy;
        if (Math.abs(b) > 1e-9) { vx = b; vy = lam - a; }
        else if (Math.abs(c) > 1e-9) { vx = lam - d; vy = c; }
        else {
          if (Math.abs(lam - a) < Math.abs(lam - d)) { vx = 1; vy = 0; }
          else { vx = 0; vy = 1; }
        }
        const n = Math.hypot(vx, vy) || 1;
        return [vx / n, vy / n];
      }
      return { v1: v(l1), l1, v2: v(l2), l2 };
    }

    // Temporal eigenvector tracking.
    let lastEig = null;
    function stabilizeEig(curr) {
      const signMatch = (vNew, vOld) => {
        const dot = vNew[0] * vOld[0] + vNew[1] * vOld[1];
        return dot >= 0 ? vNew : [-vNew[0], -vNew[1]];
      };
      const absDot = (a, b) => Math.abs(a[0] * b[0] + a[1] * b[1]);
      if (!lastEig) {
        lastEig = { v1: curr.v1.slice(), l1: curr.l1, v2: curr.v2.slice(), l2: curr.l2 };
        return curr;
      }
      const direct  = absDot(curr.v1, lastEig.v1) + absDot(curr.v2, lastEig.v2);
      const swapped = absDot(curr.v1, lastEig.v2) + absDot(curr.v2, lastEig.v1);
      let out;
      if (direct >= swapped) {
        out = {
          v1: signMatch(curr.v1, lastEig.v1), l1: curr.l1,
          v2: signMatch(curr.v2, lastEig.v2), l2: curr.l2,
        };
      } else {
        out = {
          v1: signMatch(curr.v2, lastEig.v1), l1: curr.l2,
          v2: signMatch(curr.v1, lastEig.v2), l2: curr.l1,
        };
      }
      lastEig = { v1: out.v1.slice(), l1: out.l1, v2: out.v2.slice(), l2: out.l2 };
      return out;
    }

    // ----- Drawing helpers -----
    function drawArrow(px1, py1, px2, py2, color, lineWidth) {
      if (px1 === px2 && py1 === py2) return;
      const head = Math.max(12, lineWidth * 5);
      const halfAng = 0.45;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const ang = Math.atan2(py2 - py1, px2 - px1);
      const backOff = head * Math.cos(halfAng) * 0.85;
      const sx = px2 - backOff * Math.cos(ang);
      const sy = py2 - backOff * Math.sin(ang);
      ctx.beginPath();
      ctx.moveTo(px1, py1);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px2, py2);
      ctx.lineTo(px2 - head * Math.cos(ang - halfAng), py2 - head * Math.sin(ang - halfAng));
      ctx.lineTo(px2 - head * Math.cos(ang + halfAng), py2 - head * Math.sin(ang + halfAng));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    function rgbStr(r, g, b, a) {
      const cl = v => Math.max(0, Math.min(255, Math.round(v * 255)));
      if (a === undefined) return `rgb(${cl(r)},${cl(g)},${cl(b)})`;
      return `rgba(${cl(r)},${cl(g)},${cl(b)},${a})`;
    }
    function s2c(v) { return Math.max(0, Math.min(1, (v + 1) * 0.5)); }
    const DRAW_THEME = {
      canvasBg: '#0b0e12',
      axis: '#56616d',
      guide: 'rgba(186, 198, 209, 0.62)',
      curve: '#e8edf2',
      text: '#dce5ee',
      mutedText: '#a8b3bd',
      centreStroke: '#f0f5f9',
      red: '#ff6b6b',
      green: '#6bd17d',
      blue: '#70a7ff',
    };
    function gradientDisplayVector(v) {
      if (state.gradientNorm !== 'log') return v;
      const mag = Math.hypot(v[0], v[1]);
      if (mag < 1e-9) return [0, 0];
      const scale = Math.log1p(mag) / mag;
      return [v[0] * scale, v[1] * scale];
    }

    // ----- S̃ HTML overlay -----
    const stildeLabel = mount.querySelector('#stilde-label');
    const canvasMathLabel = mount.querySelector('#canvas-math-label');
    let canvasMathTex = '';
    function positionCanvasOverlay(el, cx_canvas, cy_canvas, dx, dy) {
      const rect = mainCanvas.getBoundingClientRect();
      const mountRect = mount.getBoundingClientRect();
      const scaleX = rect.width  / mainCanvas.width;
      const scaleY = rect.height / mainCanvas.height;
      const x = rect.left - mountRect.left + (cx_canvas + dx) * scaleX;
      const y = rect.top  - mountRect.top  + (cy_canvas + dy) * scaleY;
      el.style.left = x + 'px';
      el.style.top  = y + 'px';
    }
    function setCanvasMathLabel(tex, cx_canvas, cy_canvas, dx, dy) {
      if (!tex) {
        canvasMathLabel.style.display = 'none';
        canvasMathTex = '';
        return;
      }
      positionCanvasOverlay(canvasMathLabel, cx_canvas, cy_canvas, dx, dy);
      canvasMathLabel.style.display = 'inline-block';
      if (tex !== canvasMathTex) {
        canvasMathTex = tex;
        canvasMathLabel.innerHTML = `\\(${tex}\\)`;
        queueTypeset([canvasMathLabel]);
      }
    }
    function positionStildeLabel(cx_canvas, cy_canvas) {
      if (state.perception !== 'S') {
        stildeLabel.style.display = 'none';
        return;
      }
      positionCanvasOverlay(stildeLabel, cx_canvas, cy_canvas, 0, -16);
      stildeLabel.style.display = 'inline-block';
    }

    // ----- Background (splat) -----
    const splatOff = document.createElement('canvas');
    const splatOffCtx = splatOff.getContext('2d');
    const SPLAT_RES = 220;

    function drawSplatBackground() {
      const W_ = mainCanvas.width, H_ = mainCanvas.height;
      const aspect = W_ / H_;
      let lrW, lrH;
      if (aspect >= 1) { lrW = SPLAT_RES; lrH = Math.round(SPLAT_RES / aspect); }
      else             { lrH = SPLAT_RES; lrW = Math.round(SPLAT_RES * aspect); }
      splatOff.width = lrW;
      splatOff.height = lrH;
      const img = splatOffCtx.createImageData(lrW, lrH);
      const data = img.data;
      const accR = new Float32Array(lrW * lrH);
      const accG = new Float32Array(lrW * lrH);
      const accB = new Float32Array(lrW * lrH);
      const accW = new Float32Array(lrW * lrH);
      const scale = lrW / W_;
      const sigmaPxLo = worldSizeToPx(state.sigma) * scale;
      const radius = Math.max(2, Math.ceil(sigmaPxLo * 3));
      const invTwoSig2 = 1 / (2 * sigmaPxLo * sigmaPxLo);
      for (const p of state.particles) {
        const [cxH, cyH] = worldToPx(p.x, p.y);
        const cx = cxH * scale, cy = cyH * scale;
        const x0 = Math.max(0, Math.floor(cx - radius));
        const x1 = Math.min(lrW, Math.ceil(cx + radius) + 1);
        const y0 = Math.max(0, Math.floor(cy - radius));
        const y1 = Math.min(lrH, Math.ceil(cy + radius) + 1);
        const pr = s2c(p.r), pg = s2c(p.g), pb = s2c(p.b);
        for (let y = y0; y < y1; y++) {
          const dy = y - cy;
          for (let x = x0; x < x1; x++) {
            const dx = x - cx;
            const w = Math.exp(-(dx * dx + dy * dy) * invTwoSig2);
            if (w < 1e-3) continue;
            const idx = y * lrW + x;
            accR[idx] += w * pr;
            accG[idx] += w * pg;
            accB[idx] += w * pb;
            accW[idx] += w;
          }
        }
      }
      const bgR = 0x0b, bgG = 0x0e, bgB = 0x12;
      for (let i = 0; i < lrW * lrH; i++) {
        const i4 = i * 4;
        const w = accW[i];
        if (w > 1e-6) {
          const a = 1 - Math.exp(-w * 1.4);
          const rr = accR[i] / w, gg = accG[i] / w, bb = accB[i] / w;
          data[i4]     = Math.round(rr * 255 * a + bgR * (1 - a));
          data[i4 + 1] = Math.round(gg * 255 * a + bgG * (1 - a));
          data[i4 + 2] = Math.round(bb * 255 * a + bgB * (1 - a));
        } else {
          data[i4]     = bgR;
          data[i4 + 1] = bgG;
          data[i4 + 2] = bgB;
        }
        data[i4 + 3] = 255;
      }
      splatOffCtx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(splatOff, 0, 0, W_, H_);
    }

    // ----- Main render -----
    let pendingFrame = false;
    function invalidate() {
      if (pendingFrame) return;
      pendingFrame = true;
      requestAnimationFrame(() => { pendingFrame = false; render(); });
    }

    function render() {
      fitCanvas(mainCanvas);
      fitCanvas(kWCanvas);
      fitCanvas(kGCanvas);
      const W_ = mainCanvas.width, H_ = mainCanvas.height;
      ctx.fillStyle = DRAW_THEME.canvasBg;
      ctx.fillRect(0, 0, W_, H_);
      computeAllRho();
      if (state.bgMode === 'splat') drawSplatBackground();

      const [ccx, ccy] = worldToPx(state.particles[0].x, state.particles[0].y);
      const epsPx = worldSizeToPx(state.epsilon);
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = DRAW_THEME.guide;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(ccx, ccy, epsPx, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.restore();

      const sigmaPx = state.bgMode === 'circles'
        ? worldSizeToDefaultViewPx(state.sigma)
        : worldSizeToPx(state.sigma);
      const circleRadiusPx = state.bgMode === 'circles'
        ? Math.max(3, sigmaPx * 0.4)
        : Math.max(3, Math.min(8, sigmaPx * 0.15 + 3));
      for (let i = 1; i < state.particles.length; i++) {
        const p = state.particles[i];
        const [px, py] = worldToPx(p.x, p.y);
        ctx.fillStyle = rgbStr(s2c(p.r), s2c(p.g), s2c(p.b));
        ctx.beginPath();
        ctx.arc(px, py, circleRadiusPx, 0, 2 * Math.PI);
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = 'rgba(255,255,255,0.38)';
        ctx.stroke();
      }

      const p0 = state.particles[0];
      const centreR = Math.max(circleRadiusPx, 7);
      ctx.fillStyle = rgbStr(s2c(p0.r), s2c(p0.g), s2c(p0.b));
      ctx.beginPath();
      ctx.arc(ccx, ccy, centreR, 0, 2 * Math.PI);
      ctx.fill();
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = DRAW_THEME.centreStroke;
      ctx.stroke();
      ctx.fillStyle = DRAW_THEME.centreStroke;
      ctx.beginPath();
      ctx.arc(ccx, ccy, 2, 0, 2 * Math.PI);
      ctx.fill();

      const ops = computeCentreOps();
      drawPerceptionOverlay(ccx, ccy, ops);
      positionStildeLabel(ccx, ccy);
      drawKernelPlots();
    }

    function drawPerceptionOverlay(cx, cy, ops) {
      const mode = state.perception;
      if (mode === 'none') {
        setCanvasMathLabel(null);
        return;
      }
      const arrowScale = worldSizeToPx(state.epsilon) * 1.4;
      if (mode === 'rho') {
        setCanvasMathLabel(`\\rho = ${ops.rho.toFixed(3)}`, cx, cy, 18, -18);
      } else if (mode === 'count') {
        setCanvasMathLabel(`N = ${ops.count}`, cx, cy, 18, -18);
      } else if (mode === 'S') {
        setCanvasMathLabel(null);
        ctx.save();
        const sz = 24;
        ctx.fillStyle = rgbStr(s2c(ops.S[0]), s2c(ops.S[1]), s2c(ops.S[2]));
        ctx.fillRect(cx - sz / 2, cy - 38, sz, sz);
        ctx.strokeStyle = DRAW_THEME.centreStroke;
        ctx.lineWidth = 2;
        ctx.strokeRect(cx - sz / 2, cy - 38, sz, sz);
        ctx.restore();
      } else if (mode === 'gradRho') {
        const [gx, gy] = gradientDisplayVector(ops.gradRho);
        if (Math.hypot(gx, gy) > 1e-9) {
          const ax = cx + gx * arrowScale * 0.3;
          const ay = cy + gy * arrowScale * 0.3;
          drawArrow(cx, cy, ax, ay, DRAW_THEME.curve, 3.4);
          setCanvasMathLabel('\\nabla\\rho', ax, ay, 8, -8);
        } else {
          setCanvasMathLabel(null);
        }
      } else if (mode === 'grad0S' || mode === 'grad1S') {
        const g = mode === 'grad0S' ? ops.grad0S : ops.grad1S;
        const colors = [DRAW_THEME.red, DRAW_THEME.green, DRAW_THEME.blue];
        for (let c = 0; c < 3; c++) {
          const [gx, gy] = gradientDisplayVector(g[c]);
          const ax = cx + gx * arrowScale * 0.5;
          const ay = cy + gy * arrowScale * 0.5;
          drawArrow(cx, cy, ax, ay, colors[c], 3);
        }
        setCanvasMathLabel(mode === 'grad0S' ? '\\nabla_{0}S' : '\\nabla_{1}S', cx, cy, 16, 18);
      } else if (mode === 'M') {
        const { v1, l1, v2, l2 } = stabilizeEig(eig2x2(ops.M));
        const maxLam = Math.max(Math.abs(l1), Math.abs(l2), 1e-9);
        const norm = arrowScale / maxLam * 0.8;
        const a1x = cx + v1[0] * l1 * norm;
        const a1y = cy + v1[1] * l1 * norm;
        const a2x = cx + v2[0] * l2 * norm;
        const a2y = cy + v2[1] * l2 * norm;
        drawArrow(cx, cy, a1x, a1y, DRAW_THEME.curve, 3.1);
        drawArrow(cx, cy, a2x, a2y, DRAW_THEME.mutedText, 3.1);
        setCanvasMathLabel('\\mathrm{eig}(\\mathbf{M})', cx, cy, 16, 18);
      }
    }

    // ----- Kernel plots -----
    const kWEpsLabel = mount.querySelectorAll('.kernel-block')[0].querySelector('.kernel-eps-label');
    const kGEpsLabel = mount.querySelectorAll('.kernel-block')[1].querySelector('.kernel-eps-label');

    function drawKernelOnto(canvas, c, fn, epsLabel) {
      const W_ = canvas.width, H_ = canvas.height;
      c.clearRect(0, 0, W_, H_);
      c.fillStyle = DRAW_THEME.canvasBg;
      c.fillRect(0, 0, W_, H_);
      const dpr = window.devicePixelRatio || 1;
      const fs = 13 * dpr;
      const padL = 18 * dpr;
      const padR = 24 * dpr;
      const padT = 36 * dpr;
      const padB = 28 * dpr;
      const eps = state.epsilon;
      const xMax = eps * 1.2;
      const N = 80;
      let maxY = 0;
      const samples = [];
      for (let i = 0; i <= N; i++) {
        const r = (i / N) * xMax;
        const y = fn(r);
        samples.push([r, y]);
        if (y > maxY) maxY = y;
      }
      if (maxY < 1e-12) maxY = 1;
      const x0 = padL, x1 = W_ - padR;
      const y0 = padT, y1 = H_ - padB;
      const rToPx = (r) => x0 + (r / xMax) * (x1 - x0);
      const axisColor = DRAW_THEME.axis;
      const axisW = 1 * dpr;
      const ah = 6 * dpr;
      const aw = 3.2 * dpr;
      c.strokeStyle = axisColor;
      c.fillStyle = axisColor;
      c.lineWidth = axisW;
      c.lineCap = 'butt';
      const xTipX = x1 + ah * 1.5;
      c.beginPath();
      c.moveTo(x0, y1); c.lineTo(xTipX, y1);
      c.stroke();
      c.beginPath();
      c.moveTo(xTipX, y1);
      c.lineTo(xTipX - ah, y1 - aw);
      c.lineTo(xTipX - ah, y1 + aw);
      c.closePath();
      c.fill();
      const yTipY = y0 - ah * 3;
      c.beginPath();
      c.moveTo(x0, y1); c.lineTo(x0, yTipY);
      c.stroke();
      c.beginPath();
      c.moveTo(x0, yTipY);
      c.lineTo(x0 - aw, yTipY + ah);
      c.lineTo(x0 + aw, yTipY + ah);
      c.closePath();
      c.fill();

      c.save();
      c.strokeStyle = DRAW_THEME.guide;
      c.setLineDash([3 * dpr, 3 * dpr]);
      c.lineWidth = 1.6 * dpr;
      c.beginPath();
      c.moveTo(rToPx(eps), y0);
      c.lineTo(rToPx(eps), y1);
      c.stroke();
      c.restore();

      c.strokeStyle = DRAW_THEME.curve;
      c.lineWidth = 2 * dpr;
      c.beginPath();
      for (let i = 0; i < samples.length; i++) {
        const [r, y] = samples[i];
        const px = rToPx(r);
        const py = y1 - (y / maxY) * (y1 - y0);
        if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.stroke();

      if (state.particles.length) {
        const p0 = state.particles[0];
        for (let i = 0; i < state.particles.length; i++) {
          const pj = state.particles[i];
          const r = Math.hypot(p0.x - pj.x, p0.y - pj.y);
          if (r >= xMax) continue;
          const y = fn(r);
          const px = rToPx(r);
          const py = y1 - (y / maxY) * (y1 - y0);
          c.fillStyle = rgbStr(s2c(pj.r), s2c(pj.g), s2c(pj.b));
          c.beginPath();
          c.arc(px, py, 7 * dpr, 0, 2 * Math.PI);
          c.fill();
          c.strokeStyle = 'rgba(255,255,255,0.32)';
          c.lineWidth = 0.8 * dpr;
          c.stroke();
        }
      }

      c.fillStyle = DRAW_THEME.mutedText;
      c.font = `${fs}px ui-monospace, Menlo, monospace`;
      c.textBaseline = 'top';
      c.textAlign = 'center';
      c.fillText('0', x0, y1 + 4 * dpr);

      // Position the MathJax-rendered ε tick label (HTML overlay) just below the
      // x-axis line, horizontally centred on the dashed guide. Coordinates are
      // computed from the canvas's current bounding rect so we convert from the
      // canvas-internal (DPR-scaled) coords used above into CSS px relative to
      // the kernel plot wrapper, which is the positioning ancestor.
      if (epsLabel) {
        const r = canvas.getBoundingClientRect();
        const cssToCanvasX = r.width  / W_;
        const cssToCanvasY = r.height / H_;
        const cssX_canvas  = rToPx(eps) * cssToCanvasX;
        const cssY_canvas  = (y1 + 4 * dpr) * cssToCanvasY; // 4 CSS px below axis
        epsLabel.style.left = (canvas.offsetLeft + cssX_canvas) + 'px';
        epsLabel.style.top  = (canvas.offsetTop  + cssY_canvas) + 'px';
      }
    }
    function drawKernelPlots() {
      drawKernelOnto(kWCanvas, kWCtx, (r) => W(r, state.epsilon), kWEpsLabel);
      drawKernelOnto(kGCanvas, kGCtx, (r) => gradWNorm(r, state.epsilon), kGEpsLabel);
    }

    // ----- Controls -----
    function setupSlider(id, valId, key, decimals, opts) {
      const el = mount.querySelector('#' + id);
      const vl = mount.querySelector('#' + valId);
      const resample_ = (opts && opts.resample) === true;
      el.addEventListener('input', () => {
        const v = parseFloat(el.value);
        state[key] = v;
        vl.textContent = decimals === 0 ? String(Math.round(v)) : v.toFixed(decimals);
        if (resample_) resample(); else invalidate();
      });
    }
    setupSlider('N-slider', 'N-val', 'N', 0, { resample: true });
    setupSlider('eps-slider', 'eps-val', 'epsilon', 2);
    setupSlider('R-slider', 'R-val', 'initRange', 2, { resample: true });
    setupSlider('sigma-slider', 'sigma-val', 'sigma', 2);

    function setupChipGroup(groupName, key, opts) {
      const container = mount.querySelector(`.chip-group[data-group="${groupName}"]`);
      if (!container) return;
      const resample_ = (opts && opts.resample) === true;
      const onPick = (opts && opts.onPick) || null;
      container.querySelectorAll('.chip').forEach(btn => {
        btn.addEventListener('click', () => {
          container.querySelectorAll('.chip').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          state[key] = btn.dataset.val;
          if (onPick) onPick();
          if (resample_) resample(); else invalidate();
        });
      });
    }
    setupChipGroup('perception', 'perception', { onPick: updateFormulaDisplay });
    setupChipGroup('bgMode', 'bgMode');
    setupChipGroup('gradientNorm', 'gradientNorm');
    setupChipGroup('posInit', 'posInit', { resample: true });
    setupChipGroup('stateInit', 'stateInit', { resample: true });

    // ----- MathJax typesetting -----
    // Serialize all typeset operations through MathJax.startup.promise so the
    // initial document typeset (auto-run by MathJax 3 on load) and our subsequent
    // per-element typesets never overlap on the same nodes. Race between two
    // concurrent typesetPromise calls is what previously corrupted \rho / \tilde{S}.
    function whenMathJaxReady(cb) {
      if (window.MathJax && MathJax.startup && MathJax.startup.promise) {
        MathJax.startup.promise.then(() => cb(MathJax));
      } else {
        setTimeout(() => whenMathJaxReady(cb), 100);
      }
    }
    function queueTypeset(elements) {
      whenMathJaxReady((mj) => {
        // Chain onto startup.promise so this typeset waits for any in-flight
        // typeset (including the auto-typeset) to complete, then runs.
        mj.startup.promise = mj.startup.promise
          .then(() => mj.typesetPromise(elements))
          .catch((err) => console.warn('SPH demo MathJax typeset:', err));
      });
    }

    // Inject a math span at the start of each chip that has data-tex.
    mount.querySelectorAll('.chip[data-tex]').forEach(btn => {
      const tex = btn.dataset.tex;
      const trailing = btn.textContent;
      btn.textContent = '';
      const math = document.createElement('span');
      math.className = 'chip-math';
      math.textContent = `\\(${tex}\\)`;
      btn.appendChild(math);
      btn.appendChild(document.createTextNode(' ' + trailing));
    });

    const PERCEPTION_FORMULAS = {
      rho:     '\\rho_i \\;=\\; \\sum_j m_j \\, W_\\epsilon(\\mathbf{r}_{ji})',
      count:   'N_i \\;=\\; \\Bigl|\\{\\, j : \\|\\mathbf{r}_{ji}\\| < \\epsilon \\,\\}\\Bigr|',
      S:       '\\tilde{\\mathbf{S}}_i \\;=\\; \\sum_j \\frac{m_j}{\\rho_j}\\, \\mathbf{S}_j \\, W_\\epsilon(\\mathbf{r}_{ji})',
      grad0S:  '\\nabla_{0}\\mathbf{S}_i \\;=\\; \\sum_j \\frac{m_j}{\\rho_j}\\, (\\mathbf{S}_j - \\mathbf{S}_i)\\, W_\\epsilon^{\\nabla}(\\mathbf{r}_{ji})^{\\!\\top}',
      grad1S:  '\\nabla_{1}\\mathbf{S}_i \\;=\\; \\mathbf{M}_i^{-1}\\, \\nabla_{0}\\mathbf{S}_i',
      gradRho: '\\nabla \\rho_i \\;=\\; \\sum_j m_j \\, W_\\epsilon^{\\nabla}(\\mathbf{r}_{ji})',
      M:       '\\mathbf{M}_i \\;=\\; \\sum_j \\frac{m_j}{\\rho_j}\\, \\mathbf{r}_{ji}\\, W_\\epsilon^{\\nabla}(\\mathbf{r}_{ji})^{\\!\\top}',
    };
    const formulaEl = mount.querySelector('#formula-display');

    // Seed initial formula content before the first typeset pass.
    if (PERCEPTION_FORMULAS[state.perception]) {
      formulaEl.innerHTML = `\\[ ${PERCEPTION_FORMULAS[state.perception]} \\]`;
    }
    // One queued typeset of the entire mount — covers chip math, axis labels,
    // ε ticks, S̃ overlay, and the seeded formula.
    queueTypeset([mount]);

    // Perception chip changes: replace innerHTML (which removes the old MathJax
    // rendered nodes), then queue a typeset of the fresh raw TeX.
    function updateFormulaDisplay() {
      const tex = PERCEPTION_FORMULAS[state.perception];
      formulaEl.innerHTML = tex ? `\\[ ${tex} \\]` : '';
      if (tex) queueTypeset([formulaEl]);
    }

    mount.querySelector('#reset-all-btn').addEventListener('click', () => {
      state.particles[0] && (state.particles[0].x = 0, state.particles[0].y = 0);
      resample();
    });
    mount.querySelector('#reset-view-btn').addEventListener('click', () => {
      state.view = { cx: 0, cy: 0, halfSpan: DEFAULT_HALFSPAN };
      mount.querySelector('#zoom-val').textContent =
        (DEFAULT_HALFSPAN / state.view.halfSpan).toFixed(2) + '×';
      invalidate();
    });

    // ----- Mouse / touch on main canvas -----
    let drag = null;
    function onPointerDown(e) {
      e.preventDefault();
      mainCanvas.setPointerCapture(e.pointerId);
      const [px, py] = cssToCanvasPx(e.clientX, e.clientY);
      if (e.shiftKey) {
        drag = { kind: 'pan', lastPx: px, lastPy: py };
      } else {
        drag = { kind: 'centre' };
        const [wx, wy] = pxToWorld(px, py);
        state.particles[0].x = wx;
        state.particles[0].y = wy;
        invalidate();
      }
      mainCanvas.classList.add('dragging');
    }
    function onPointerMove(e) {
      if (!drag) return;
      const [px, py] = cssToCanvasPx(e.clientX, e.clientY);
      if (drag.kind === 'centre') {
        const [wx, wy] = pxToWorld(px, py);
        state.particles[0].x = wx;
        state.particles[0].y = wy;
        invalidate();
      } else if (drag.kind === 'pan') {
        const s = viewScalePx();
        const dxW = (px - drag.lastPx) / s * state.view.halfSpan;
        const dyW = (py - drag.lastPy) / s * state.view.halfSpan;
        state.view.cx -= dxW;
        state.view.cy -= dyW;
        drag.lastPx = px; drag.lastPy = py;
        invalidate();
      }
    }
    function onPointerUp(e) {
      drag = null;
      mainCanvas.classList.remove('dragging');
      try { mainCanvas.releasePointerCapture(e.pointerId); } catch (_) {}
    }
    mainCanvas.addEventListener('pointerdown', onPointerDown);
    mainCanvas.addEventListener('pointermove', onPointerMove);
    mainCanvas.addEventListener('pointerup', onPointerUp);
    mainCanvas.addEventListener('pointercancel', onPointerUp);

    mainCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const dy = Math.max(-120, Math.min(120, e.deltaY));
      const factor = Math.exp(dy * 0.0015);
      const oldSpan = state.view.halfSpan;
      const newSpan = Math.max(0.05, Math.min(20, oldSpan * factor));
      const p0 = state.particles[0];
      state.view.cx = p0.x - (p0.x - state.view.cx) * (newSpan / oldSpan);
      state.view.cy = p0.y - (p0.y - state.view.cy) * (newSpan / oldSpan);
      state.view.halfSpan = newSpan;
      mount.querySelector('#zoom-val').textContent =
        (DEFAULT_HALFSPAN / state.view.halfSpan).toFixed(2) + '×';
      invalidate();
    }, { passive: false });

    window.addEventListener('resize', invalidate);
    window.addEventListener('scroll', invalidate, { passive: true });

    // ----- Boot -----
    resample();
    requestAnimationFrame(invalidate);
  }

  // ============================================================
  // Auto-mount every .sph-demo-mount on DOM ready.
  // ============================================================
  function mountAll() {
    document.querySelectorAll('.sph-demo-mount').forEach(initSphDemo);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll);
  } else {
    mountAll();
  }
})();
