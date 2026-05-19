/* === Tile Studio === */
(() => {
  'use strict';

  const canvas   = document.getElementById('tileCanvas');
  const ctx      = canvas.getContext('2d');

  /* ════ Noise dither canvas (breaks tile-gradient banding) ════ */
  const noiseCvs = document.createElement('canvas');
  noiseCvs.width = noiseCvs.height = 8;
  const nctx = noiseCvs.getContext('2d');
  (function buildNoise() {
    const img = nctx.createImageData(8, 8);
    const d = img.data;
    for (let i = 0; i < 64; i++) {
      const v = ((Math.sin((i * 7 + 13) * 127.1) * 43758.5453) % 1 + 1) % 1;
      // 20-90% grey range → subtle grain
      const grey = Math.round(51 + v * 153);
      d[i*4]   = grey;
      d[i*4+1] = grey;
      d[i*4+2] = grey;
      d[i*4+3] = 20;  /* ~8% alpha */
    }
    nctx.putImageData(img, 0, 0);
  })();
  const noisePat = ctx.createPattern(noiseCvs, 'repeat');

  const zoomDisp = document.getElementById('zoomVal');
  const gridTog  = document.getElementById('gridToggle');
  const numTog   = document.getElementById('showNums');
  const cwTog    = document.getElementById('spiralCw');

  /* --- config --- */
  let gradientOffset = 30;  /* default if config.json fails to load */

  /* --- layer color state --- */
  const LAYER_DEFAULTS = {
    all:        '#363636',
    primes:     '#c52727',
    fibonacci:  '#2d64d9',
  };
  const _layerColors = { ...LAYER_DEFAULTS };

  function hexToRgb(hex) {
    hex = hex.replace('#', '');
    return [parseInt(hex.substr(0, 2), 16), parseInt(hex.substr(2, 2), 16), parseInt(hex.substr(4, 2), 16)];
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => {
      const v = Math.max(0, Math.min(255, Math.round(x)));
      return v.toString(16).padStart(2, '0');
    }).join('');
  }
  /* generate lighter + darker variants from a mid-color */
  function layerGradient(mid) {
    const [r, g, b] = hexToRgb(mid);
    return {
      hi: rgbToHex(r + gradientOffset, g + gradientOffset, b + gradientOffset),
      lo: rgbToHex(r - gradientOffset, g - gradientOffset, b - gradientOffset),
    };
  }

  /* --- state --- */
  let currentTile = 'triangles';
  // Per-type base sizes — tiles keep this size at every level
  const tileSizeMap = { triangles: 60, squares: 40, hexagons: 25 };
  let tileLevel   = 1;  // doubles tile count each step (×1, ×2, ×4, ×8 …)
  function tileCountMult() { return Math.pow(2, tileLevel - 1); }
  // Min zoom = 1 pixel per tile → prevents zooming out past tile invisibility
  let startOffset  = -1;   // first tile number = 1 + startOffset
  function zoomMin() { return 1 / tileSizeMap[currentTile]; }
  let showGrid    = true;
  let showGradient = true;
  let showNums    = true;
  let highlightPrimes = true;   /* primes rendered in red (ON) vs grey (OFF) */
  let showAll   = true;        /* show composites + 1 (OFF = primes only) */
  let showLuminance = false;
  let showFib       = false;
  let spiralCw    = true;
  let panX = 0, panY = 0, zoom = 1;
  let dragging = false, dragMX = 0, dragMY = 0, dragPanX = 0, dragPanY = 0;
  let alphaMap = new Map(), targetMap = new Map(), animating = false;
  // pre-computed per-num caches (populated at build-time)
  let primalityCache = new Map(), lumCache = new Map();
  let screenshotMode = false;
  let screenshotCanvas = null, screenshotCtx = null;     /* hidden canvas + ctx for screenshot */
  let screenshotBounds = { x: 0, y: 0, w: 1, h: 1 };      /* world-coords of screenshot extent */

  /* ----- helpers ----- */
  function omega(n) {   // total prime factors with multiplicity
    let count = 0;
    for (let i = 2; i * i <= n; i++) {
      while (n % i === 0) { count++; n /= i; }
    }
    if (n > 1) count++;
    return count;
  }
  function isPrime(n) {
    if (n < 2) return false;
    if (n < 4) return true;
    if (n % 2 === 0 || n % 3 === 0) return false;
    for (let i = 5; i * i <= n; i += 6)
      if (n % i === 0 || n % (i + 2) === 0) return false;
    return true;
  }
  function primeColor(n) {
    if (!highlightPrimes) return '#aaaaaa';
    return (primalityCache.get(n) || false) ? '#ffffff' : '#aaaaaa';
  }
  /* ──── Fibonacci detector ──── */
  function isFibonacci(n) {
    const absN = Math.abs(n);
    for (let a = 0, b = 1; b <= absN;) {
      if (b === absN) return true;
      const t = a; a = b; b = t + a;
    }
    return false;
  }
  function luminanceScale(n) {
    const absN = Math.abs(n);
    if (absN <= 1) return 1;
    const o = omega(absN);
    return o <= 1 ? 1 : Math.pow(2 / 3, o - 1);
  }
  function targetAlpha(n) {
    if (n === startOffset + 1) return 1;        /* center tile always visible */
    /* each layer independently decides: tile is visible if ANY layer claims it */
    const allVisible   = showAll;
    const primeVisible = highlightPrimes && (primalityCache.get(n) || false);
    const fibVisible   = showFib && isFibonacci(n);
    return +(allVisible || primeVisible || fibVisible);
  }
  function flushAlpha() {
    // Skip animation at level x3+ — snap directly
    if (tileLevel >= 3) {
      for (const [n] of alphaMap) alphaMap.set(n, targetMap.get(n));
      return false;
    }
    let dirty = false;
    for (const [n, a] of alphaMap) {
      const t = targetMap.get(n);
      if (Math.abs(a - t) > 0.002) {
        alphaMap.set(n, a + (t - a) * 0.14);
        dirty = true;
      } else {
        alphaMap.set(n, t);
      }
    }
    return dirty;
  }
  function buildPoly(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }

  /* ----- draw one tile polygon — centroid computed from vertices ----- */
/* ──── Layer priority — top layer wins color, all three layers compete ──── */
  let _styleWinner = { comp: 'grey', pri: 'grey', fib: 'grey' };

  function _cacheFor() {
    return currentTile === 'triangles' ? _triCache
         : currentTile === 'squares'   ? _sqCache
         :                               _hexCache;
  }
  function _clearCaches() {
    _triCache = null; _sqCache = null; _hexCache = null;
    alphaMap.clear(); primalityCache.clear(); lumCache.clear(); targetMap.clear();
  }

  /* seed primality/luminance/alpha maps for a spiral result array */
  function primeCaches(coords) {
    alphaMap.clear(); primalityCache.clear(); lumCache.clear(); targetMap.clear();
    for (let i = 0; i < coords.length; i++) {
      const n = i + 1 + startOffset;
      primalityCache.set(n, isPrime(n));
      lumCache.set(n, luminanceScale(n));
      alphaMap.set(n, 0.001);
      targetMap.set(n, targetAlpha(n));
    }
  }

  /* given a style name, return { hi, lo, avg } as rgb-strings ready for rgba(…,lum) */
  function drawTileColor(styleName) {
    if (styleName === 'center') return { hi: '100,255,140', lo: '60,200,100', avg: '80,228,120' };
    let mid;
    if (styleName === 'prime')   mid = _layerColors.primes;
    else if (styleName === 'fib') mid = _layerColors.fibonacci;
    else                          mid = _layerColors.all;
    const { hi, lo } = layerGradient(mid);
    return {
      hi: hexToRgb(hi).join(','),
      lo: hexToRgb(lo).join(','),
      avg: hexToRgb(mid).join(','),
    };
  }

  function computeStylePriority() {
    let comp = null, pri = null, fib = null, both = null;
    const order = getLayerOrder();
    for (const l of order) {
      if (l === 'all' && showAll) {
        if (!comp) comp = 'grey';
        if (!pri) pri = 'grey';
        if (!fib) fib = 'grey';
        if (!both) both = 'grey';
        break;
      }
      if (l === 'primes' && highlightPrimes) {
        if (!pri) pri = 'prime';
        if (!both) both = 'prime';
      }
      if (l === 'fibonacci' && showFib) {
        if (!fib) fib = 'fib';
        if (!both) both = 'fib';
      }
    }
    _styleWinner = {
      comp: comp || 'grey',
      pri: pri || 'grey',
      fib: fib || 'grey',
      both: both || 'grey',
    };
  }

  function tileStyle(isPrime, isFibNum) {
    if (isPrime && isFibNum) return _styleWinner.both;
    if (isPrime) return _styleWinner.pri;
    if (isFibNum) return _styleWinner.fib;
    return _styleWinner.comp;
  }

  function drawTile(pts, num) {
    const a = alphaMap.get(num) || 0;
    if (a < 0.005) return;
    // centroid
    let _cx = 0, _cy = 0;
    for (const [px, py] of pts) { _cx += px; _cy += py; }
    _cx /= pts.length; _cy /= pts.length;
    // bounding radius for gradient span
    let _max = 0;
    for (const [px, py] of pts) {
      const d = Math.hypot(px - _cx, py - _cy);
      if (d > _max) _max = d;
    }
    // frustum culling — skip tiles outside viewport
    const cw = canvas.width, ch = canvas.height;
    const sx = cw / 2 + panX + _cx * zoom - _max * zoom;
    const sy = ch / 2 + panY + _cy * zoom - _max * zoom;
    const ex = sx + 2 * _max * zoom, ey = sy + 2 * _max * zoom;
    if (ex < 0 || sy > ch || sx > cw || ey < 0) return;
    const is = primalityCache.get(num) || false;
    const lum = showLuminance ? lumCache.get(num) : 1;
    const isCenter = num === startOffset + 1;

    const hasFib = showFib && isFibonacci(num);
    const style = isCenter ? 'center' : tileStyle(is, hasFib);

    const c = drawTileColor(style);
    const bgHi  = `rgba(${c.hi},${lum})`;
    const bgLo  = `rgba(${c.lo},${lum})`;
    const bgAvg = `rgba(${c.avg},${lum})`;
    ctx.save();
    ctx.globalAlpha = a;
    // Fill: gradient or flat
    if (showGradient) {
      const nw = { x: _cx - _max, y: _cy - _max };
      const s  = { x: _cx,        y: _cy + _max };
      const grad = ctx.createLinearGradient(nw.x, nw.y, s.x, s.y);
      grad.addColorStop(0, bgHi);
      grad.addColorStop(1, bgLo);
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = bgAvg;
    }
    buildPoly(pts);
    ctx.fill();
    ctx.lineWidth = showGrid ? 1.2 : 0;
    ctx.strokeStyle = showGrid ? 'rgba(162,155,254,.45)' : 'rgba(0,0,0,0)';
    ctx.stroke();
    /* inner black marker for center tile */
    if (isCenter) {
      const inner = pts.map(([px2, py2]) => [
        _cx + (px2 - _cx) * 0.6,
        _cy + (py2 - _cy) * 0.6
      ]);
      buildPoly(inner);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fill();
    }
    // Numbers fade out between 60% and 50% zoom
    const zoomAlpha = Math.min(1, Math.max(0, (zoom - 0.5) / 0.1));
    if (showNums && zoomAlpha > 0.005) {
      const fs = Math.max(8, tileSizeMap[currentTile] * 0.18);
      const baseCol = primeColor(num);
      const lumVal = showLuminance ? lumCache.get(num) : 1;
      // scale text alpha by luminance
      const r = parseInt(baseCol.slice(1, 3), 16);
      const g = parseInt(baseCol.slice(3, 5), 16);
      const b = parseInt(baseCol.slice(5, 7), 16);
      const textAlpha = lumVal * zoomAlpha;
      ctx.fillStyle = `rgba(${r},${g},${b},${textAlpha.toFixed(3)})`;
      ctx.font = '600 ' + fs + 'px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(num, _cx, _cy);
    }
    ctx.restore();
  }

  /* ===== SCREENSHOT — render full grid to a hidden canvas element ===== */
  /*   no numbers, first tile (num=1+offset) highlighted in light-green     */
  function captureScreenshot() {
    const s = tileSizeMap[currentTile];
    const tilesArr = _cacheFor()?.pts;
    if (!tilesArr || !tilesArr.length) return false;

    /* compute world-bounds from tile vertices */
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pts of tilesArr) for (const [vx, vy] of pts) {
      if (vx < minX) minX = vx;
      if (vy < minY) minY = vy;
      if (vx > maxX) maxX = vx;
      if (vy > maxY) maxY = vy;
    }
    const margin = s * 3;
    const rawW = maxX - minX + 2 * margin;
    const rawH = maxY - minY + 2 * margin;

    /* downscale to keep pixel buffer reasonable, higher at very low zoom */
    /* downscale: scales with tile-level (x1=500, x2=1k, x3=2k…) capped at 12k */
    const maxPx = Math.min(8000, Math.round(800 * (1 << (tileLevel - 1))));
    let pxScale = 1;
    if (rawW > maxPx) pxScale = maxPx / rawW;
    if (rawH * pxScale > maxPx) pxScale = maxPx / rawH;

    const sw = Math.round(rawW * pxScale);
    const sh = Math.round(rawH * pxScale);

    /* create or re-use hidden canvas */
    if (!screenshotCanvas) {
      screenshotCanvas = document.createElement('canvas');
      screenshotCanvas.style.display = 'none';
      document.body.appendChild(screenshotCanvas);
    }
    screenshotCanvas.width  = sw;
    screenshotCanvas.height = sh;
    if (!screenshotCtx) screenshotCtx = screenshotCanvas.getContext('2d');
    const octx = screenshotCtx;
    octx.clearRect(0, 0, sw, sh);

    /* world → offscreen pixel:  (wx,wy) → ((wx - origX)*pxScale, (wy - origY)*pxScale) */
    const origX = minX - margin;
    const origY = minY - margin;
    octx.translate(pxScale * (-origX), pxScale * (-origY));
    octx.scale(pxScale, pxScale);

    for (let i = 0; i < tilesArr.length; i++) {
      const pts = tilesArr[i];
      const num = i + 1 + startOffset;
      const a = targetAlpha(num);
      if (a < 0.005) continue;
      const isP = primalityCache.get(num) || false;
      const hasFib = showFib && isFibonacci(num);
      const isCenter = num === startOffset + 1;
      const sty = isCenter ? 'center' : tileStyle(isP, hasFib);
      const lum = showLuminance ? lumCache.get(num) : 1;

      const c = drawTileColor(sty);
      const bgHi  = 'rgba(' + c.hi + ',' + lum + ')';
      const bgLo  = 'rgba(' + c.lo + ',' + lum + ')';
      const bgAvg = 'rgba(' + c.avg + ',' + lum + ')';

      octx.save();
      /* centroid for center-tile inner marker */
      let _cx2 = 0, _cy2 = 0;
      for (const [p1, p2] of pts) { _cx2 += p1; _cy2 += p2; }
      _cx2 /= pts.length; _cy2 /= pts.length;
      octx.globalAlpha = a;
      if (showGradient) {
        let _mx = 0;
        for (const [p1, p2] of pts) { const d = Math.hypot(p1 - _cx2, p2 - _cy2); if (d > _mx) _mx = d; }
        const grad = octx.createLinearGradient(_cx2 - _mx, _cy2 - _mx, _cx2, _cy2 + _mx);
        grad.addColorStop(0, bgHi);
        grad.addColorStop(1, bgLo);
        octx.fillStyle = grad;
      } else {
        octx.fillStyle = bgAvg;
      }
      octx.beginPath();
      octx.moveTo(pts[0][0], pts[0][1]);
      for (let j = 1; j < pts.length; j++) octx.lineTo(pts[j][0], pts[j][1]);
      octx.closePath();
      octx.fill();
      octx.lineWidth = showGrid ? 1.2 : 0;
      octx.strokeStyle = showGrid ? 'rgba(162,155,254,.45)' : 'rgba(0,0,0,0)';
      octx.stroke();
      /* inner black marker for center tile */
      if (num === startOffset + 1) {
        const si = pts.map(([vx, vy]) => [
          _cx2 + (vx - _cx2) * 0.6,
          _cy2 + (vy - _cy2) * 0.6
        ]);
        octx.beginPath();
        octx.moveTo(si[0][0], si[0][1]);
        for (let j = 1; j < si.length; j++) octx.lineTo(si[j][0], si[j][1]);
        octx.closePath();
        octx.fillStyle = 'rgba(0,0,0,0.25)';
        octx.fill();
      }
      octx.restore();
    }

    /* bounds for drawImage (world coords) */
    screenshotBounds = { x: origX, y: origY, w: rawW, h: rawH };
    return true;
  }

  /* ===== Square spiral — 4-neighbour wall-follower ===== */
  function squareSpiral(count, cw) {
    const visited = new Set();
    const result  = [];
    const key = (r, c) => r * 100000 + c;

    const dirVec = [[0, 1], [1, 0], [0, -1], [-1, 0]];   // E S W N

    visited.add(key(0, 0));
    result.push([0, 0]);

    let [posR, posC] = [0, 0];
    let dir = 0;

    for (let num = 2; num <= count; num++) {
      const tw = cw ? (dir + 1) % 4 : (dir + 3) % 4;
      const gs = dir;
      const ta = cw ? (dir + 3) % 4 : (dir + 1) % 4;
      for (const nd of [tw, gs, ta]) {
        const [dr, dc] = dirVec[nd];
        const nr = posR + dr, nc = posC + dc;
        if (visited.has(key(nr, nc))) continue;
        visited.add(key(nr, nc));
        result.push([nr, nc]);
        [posR, posC] = [nr, nc];
        dir = nd;
        break;
      }
    }
    return result;
  }

  /* ===== Hex spiral — 6-neighbour wall-follower ===== */
  // Axial neighbours of hex (q, r), clockwise from East:
  //   0=(+1, 0) East    3=(-1, 0) West
  //   1=(+1,-1) NE      4=(-1,+1) SW
  //   2=(0, -1) NW      5=(0, +1) SE
  function hexSpiral(count, cw) {
    const visited = new Set();
    const result  = [];
    const key = (q, r) => q * 100000 + r;

    // 6 direction vectors: E, NE, NW, W, SW, SE
    const dirHex = [
      [1,  0],   // 0: E
      [1, -1],   // 1: NE
      [0, -1],   // 2: NW
      [-1, 0],   // 3: W
      [-1, 1],   // 4: SW
      [0,  1]    // 5: SE
    ];

    visited.add(key(0, 0));
    result.push([0, 0]);

    // Tile 2: always East of center
    visited.add(key(1, 0));
    result.push([1, 0]);

    let [posQ, posR] = [1, 0];
    let dir = 0; // facing East

    for (let num = 3; num <= count; num++) {
      // Scan 3 directions in clockwise order:
      // CW  (left-wall-hug):  snett bakåt vänster → snett frammåt vänster → rakt fram
      //                       = [(d+2)%6, (d+1)%6, d]
      // CCW (right-wall-hug): snett bakåt höger → snett frammåt höger → rakt fram
      //                       = [(d+4)%6, (d+5)%6, d]
      const scan = cw
        ? [(dir + 2) % 6, (dir + 1) % 6, dir]
        : [(dir + 4) % 6, (dir + 5) % 6, dir];

      let moved = false;
      for (const nd of scan) {
        const [dq, dr] = dirHex[nd];
        const nq = posQ + dq, nr = posR + dr;
        if (visited.has(key(nq, nr))) continue;
        visited.add(key(nq, nr));
        result.push([nq, nr]);
        [posQ, posR] = [nq, nr];
        dir = nd;
        moved = true;
        break;
      }
      if (!moved) break;
    }

    return result;
  }

  /* ----- triangular honeycomb spiral ----- */
  // Wall-following ("hug the wall") spiral.
  // Each triangle has 2 edge-neighbours that matter for traversal:
  //   UP   (r+c even):  (r, c-1) [West], (r, c+1) [East], (r-1, c) [North]
  //   DOWN (r+c odd):   (r, c-1) [West], (r, c+1) [East], (r+1, c) [South]
  // Direction encoding:  0=East(0,+1), 1=South(+1,0), 2=West(0,-1), 3=North(-1,0)
  //   CW (right turn)   = (dir+1)%4
  //   CCW (left turn)   = (dir+3)%4
  // Priority order:
  //   CW mode  →  try RIGHT → straight → LEFT (hugs right wall)
  //   CCW mode →  try LEFT → straight → RIGHT (hugs left wall)
  let _triCache = null, _sqCache = null, _hexCache = null;
  // Every consecutive pair shares exactly one triangle edge.
  const TRI_UP_VALID = [0, 1, 2], TRI_DN_VALID = [0, 2, 3];
  function triSpiral(count, cw) {
    const visited = new Set();
    const result  = [];
    const key = (r, c) => r * 100000 + c;
    function isUp(r, c) { return ((r + c) % 2 + 2) % 2 === 0; }

    const dirVec = [[0, 1], [1, 0], [0, -1], [-1, 0]];   // E=0 S=1 W=2 N=3

    visited.add(key(0, 0));
    result.push([0, 0]);

    // Tile 2: always directly East from center
    visited.add(key(0, 1));
    result.push([0, 1]);

    let [posR, posC] = [0, 1];
    let dir = 0; // just placed East, so facing East

    for (let num = 3; num <= count; num++) {
      // Valid edge-directions depend on triangle orientation:
      //   UP   (r+c even):  can go East, South, West — NOT North
      //   DOWN (r+c odd):   can go East, West, North — NOT South
      const up    = isUp(posR, posC);
      const valid = up ? TRI_UP_VALID : TRI_DN_VALID;

      // Scan directions clockwise, same wall-hug pattern as hexagons:
      // CW  (left-wall-hug):  left → straight → right
      // CCW (right-wall-hug): right → straight → left
      const raw = cw
        ? [(dir + 3) % 4, dir, (dir + 1) % 4]   // CW
        : [(dir + 1) % 4, dir, (dir + 3) % 4];  // CCW

      let moved = false;
      for (const nd of raw) {
        if (!valid.includes(nd)) continue;          // only edge-valid dirs
        const [dr, dc] = dirVec[nd];
        const nr = posR + dr, nc = posC + dc;
        if (visited.has(key(nr, nc))) continue;
        visited.add(key(nr, nc));
        result.push([nr, nc]);
        [posR, posC] = [nr, nc];
        dir = nd;
        moved = true;
        break;
      }
      if (!moved) break;
    }

    return { visited, result };
  }
  function drawTriangles() {
    const s = tileSizeMap[currentTile];
    const h = Math.sqrt(3) / 2 * s;
    const mult = tileCountMult();

    const colsNeeded = Math.ceil(canvas.width  / (s / 2)) * mult + 8;
    const rowsNeeded = Math.ceil(canvas.height / h      ) * mult + 8;
    const count = colsNeeded * rowsNeeded;

    // Only regenerate spiral when canvas size, direction or level changed
    const stale = !_triCache || _triCache.count !== count || _triCache.dir !== spiralCw || _triCache.level !== tileLevel || _triCache.start !== startOffset;
    if (stale) {
      const { result } = triSpiral(count, spiralCw);
      _triCache = { pts: [], count, dir: spiralCw, level: tileLevel, start: startOffset };

      // build tile geometry
      const tiles = [];
      for (let i = 0; i < result.length; i++) {
        const [r, c] = result[i];
        const isUp = ((r + c) % 2 + 2) % 2 === 0;
        const cx = c * (s / 2);
        const cy = r * h + h / 2;
        tiles.push(isUp
          ? [[cx,       cy - h / 2], [cx - s / 2, cy + h / 2], [cx + s / 2, cy + h / 2]]
          : [[cx - s / 2, cy - h / 2], [cx + s / 2, cy - h / 2], [cx,       cy + h / 2]]);
      }
      _triCache.pts = tiles;

      // prime the alpha / target maps
      primeCaches(result);
    }

    const tiles = _triCache?.pts;
    if (!tiles) return;
    for (let i = 0; i < tiles.length; i++) drawTile(tiles[i], i + 1 + startOffset);
  }

  function drawSquares() {
    const s = tileSizeMap[currentTile];
    const mult = tileCountMult();
    const colsNeeded = Math.ceil(canvas.width  / s) * mult + 6;
    const rowsNeeded = Math.ceil(canvas.height / s) * mult + 6;
    const count = colsNeeded * rowsNeeded;

    const stale = !_sqCache || _sqCache.count !== count || _sqCache.dir !== spiralCw || _sqCache.level !== tileLevel || _sqCache.start !== startOffset;
    if (stale) {
      const coords = squareSpiral(count, spiralCw);
      _sqCache = { pts: [], count, dir: spiralCw, level: tileLevel, start: startOffset };

      const tiles = [];
      for (let i = 0; i < coords.length; i++) {
        const [cx, cy] = coords[i];
        tiles.push([
          [cx * s,    cy * s],
          [(cx + 1) * s, cy * s],
          [(cx + 1) * s, (cy + 1) * s],
          [cx * s,    (cy + 1) * s]
        ]);
      }
      _sqCache.pts = tiles;

      primeCaches(coords);
    }

    const tiles = _sqCache?.pts;
    if (!tiles) return;
    for (let i = 0; i < tiles.length; i++) drawTile(tiles[i], i + 1 + startOffset);
  }

  function drawHexagons() {
    const s = tileSizeMap[currentTile];
    const mult = tileCountMult();
    const colsNeeded = Math.ceil(canvas.width / (Math.sqrt(3) * s)) * mult + 6;
    const rowsNeeded = Math.ceil(canvas.height / (1.5 * s))     * mult + 6;
    const count = colsNeeded * rowsNeeded;

    const stale = !_hexCache || _hexCache.count !== count || _hexCache.dir !== spiralCw || _hexCache.level !== tileLevel || _hexCache.start !== startOffset;
    if (stale) {
      const coords = hexSpiral(count, spiralCw);
      _hexCache = { pts: [], count, dir: spiralCw, level: tileLevel, start: startOffset };

      const tiles = [];
      for (let i = 0; i < coords.length; i++) {
        const [q, r] = coords[i];
        const px = s * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r);
        const py = s * 1.5 * r;
        const pts = [];
        for (let j = 0; j < 6; j++) {
          const a = Math.PI / 3 * j - Math.PI / 6;
          pts.push([px + s * Math.cos(a), py + s * Math.sin(a)]);
        }
        tiles.push(pts);
      }
      _hexCache.pts = tiles;

      primeCaches(coords);
    }

    const tiles = _hexCache?.pts;
    if (!tiles) return;
    for (let i = 0; i < tiles.length; i++) drawTile(tiles[i], i + 1 + startOffset);
  }

  // Transform:  translate(W/2,H/2) -> translate(panX,panY) -> scale(zoom)
  // World (wx,wy) maps to canvas:  cx = W/2 + panX + wx*zoom
  //  panX,panY are always in canvas-pixel units  (1 canvas px change = 1 screen px)
  function render() {
    const W = canvas.width, H = canvas.height;
    ctx.save();
    ctx.fillStyle = '#0f0f13';
    ctx.fillRect(0, 0, W, H);
    /* dither overlay — breaks tile-gradient color bands */
    ctx.fillStyle = noisePat;
    ctx.globalAlpha = .55;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;

    ctx.translate(W / 2, H / 2);
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    const fn = {
      triangles: drawTriangles,
      squares:   drawSquares,
      hexagons:  drawHexagons
    };

    // always rebuild cache if stale (e.g. level/direction just changed), even in screenshot mode
    const curCache = _cacheFor();
    const cacheStale = !curCache?.pts?.length;

    // screenshot mode: at zoom ≤ 30% draw cached canvas instead of tiles
    if (screenshotMode && zoom <= 0.45 && screenshotCanvas && !cacheStale) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium';
      ctx.drawImage(screenshotCanvas, screenshotBounds.x, screenshotBounds.y,
                    screenshotBounds.w, screenshotBounds.h);
    } else {
      (fn[currentTile] || drawTriangles)();
    }

    // vignette (back in canvas space)
    ctx.restore();
    const vw = Math.max(W, H);
    const vig = ctx.createRadialGradient(W / 2, H / 2, vw * 0.18, W / 2, H / 2, vw * 0.72);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,.55)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
  }

  /* ----- zoom display ----- */
  function updateZoomDisp() {
    zoomDisp.textContent = Math.round(zoom * 100) + '%';
  }

  /* ----- animation loop ----- */
  function tick() {
    if (flushAlpha()) {
      render();
      updateZoomDisp();
      requestAnimationFrame(tick);
    } else {
      animating = false;
      render();
      updateZoomDisp();
    }
  }
  function animate() {
    if (!animating) {
      animating = true;
      requestAnimationFrame(tick);
    }
  }

  /* ----- TILE BUTTONS ----- */
  document.querySelectorAll('.tile-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tile-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTile = btn.dataset.tile;
      _clearCaches();
      render();
      maybeCaptureScreenshot();
      animate();
    });
  });

  /* ----- FILTERS ----- */
  /* helpers */
  function maybeCaptureScreenshot() {
    if (!screenshotMode) return;
    const tiles = _cacheFor()?.pts;
    if (tiles?.length) captureScreenshot();
  }

  /* non-cache-clearing — capture BEFORE render so screenshot is current */
  gridTog.addEventListener('change', () => { showGrid = gridTog.checked; saveSettings(); maybeCaptureScreenshot(); render(); updateZoomDisp(); });
  document.getElementById('gradientToggle').addEventListener('change', e => { showGradient = e.target.checked; saveSettings(); maybeCaptureScreenshot(); render(); });
  numTog.addEventListener('change', () => { showNums = numTog.checked; render(); updateZoomDisp(); });
  document.getElementById('luminanceToggle').addEventListener('change', e => { showLuminance = e.target.checked; saveSettings(); maybeCaptureScreenshot(); render(); updateZoomDisp(); });

  document.getElementById('filterPrimes').addEventListener('change', e => {
    highlightPrimes = e.target.checked;
    computeStylePriority();
    for (const n of targetMap.keys()) targetMap.set(n, targetAlpha(n));
    saveSettings();
    maybeCaptureScreenshot();
    animate();
    updateZoomDisp();
  });
  document.getElementById('filterAll').addEventListener('change', e => {
    showAll = e.target.checked;
    computeStylePriority();
    for (const n of targetMap.keys()) targetMap.set(n, targetAlpha(n));
    saveSettings();
    maybeCaptureScreenshot();
    animate();
    updateZoomDisp();
  });
  document.getElementById('fibToggle').addEventListener('change', e => {
    showFib = e.target.checked;
    computeStylePriority();
    for (const n of targetMap.keys()) targetMap.set(n, targetAlpha(n));
    saveSettings();
    maybeCaptureScreenshot();
    animate();
  });


  /* ──── Layer eye buttons (click eye → toggle hidden checkbox) ──── */
  function syncLayerEyes() {
    document.querySelectorAll('.layer-eye').forEach(btn => {
      const cb = document.getElementById(btn.dataset.target);
      btn.textContent = '👁';
      btn.classList.toggle('active', !!cb?.checked);
    });
  }
  document.querySelectorAll('.layer-eye').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const cb = document.getElementById(btn.dataset.target);
      if (!cb) return;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      syncLayerEyes();
    });
  });

  /* ──── Color swatches (click → native color picker) ──── */
  const colorPicker = document.getElementById('layerColorPicker');
  let _colorPickerLayer = null;       /* which layer we're picking for */

  function updateColorSwatches() {
    document.querySelectorAll('.layer-color-swatch').forEach(btn => {
      btn.style.backgroundColor = _layerColors[btn.dataset.layer] || LAYER_DEFAULTS[btn.dataset.layer];
    });
  }

  document.querySelectorAll('.layer-color-swatch').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const layer = btn.dataset.layer;
      colorPicker.value = _layerColors[layer] || LAYER_DEFAULTS[layer];
      _colorPickerLayer = layer;
      colorPicker.click();
    });
  });

  colorPicker.addEventListener('input', () => {
    if (!_colorPickerLayer) return;
    _layerColors[_colorPickerLayer] = colorPicker.value;
    updateColorSwatches();
    computeStylePriority();
    saveSettings();
    render();
    maybeCaptureScreenshot();
    animate();
  });


  /* ──── Layers drag-and-drop reordering ──── */
  function getLayerOrder() {
    return Array.from(document.querySelectorAll('.layer-item'))
      .map(el => el.dataset.layer);
  }
  function setLayerOrder(order) {
    const list = document.getElementById('layersList');
    const map = {};
    order.filter(Boolean).forEach(k => map[k] = document.querySelector(`[data-layer="${k}"]`));
    list.innerHTML = '';
    order.filter(Boolean).forEach(k => { if (map[k]) list.appendChild(map[k]); });
  }
  function LS_DEFAULTS() {
    return {
      screenshot:  screenshotMode,
      gradient:    showGradient,
      luminance:   showLuminance,
      spiralCw:    spiralCw,
      grid:        showGrid,
      fib:         showFib,
      layerOrder:  getLayerOrder(),
      layerColors: { ..._layerColors },
    };
  }
  function saveSettings() {
    localStorage.setItem('tilestudio-settings', JSON.stringify(LS_DEFAULTS()));
  }
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('tilestudio-settings'));
      if (!s) return;
      screenshotMode        = !!s.screenshot;
      showGrid              = !!s.grid;
      showGradient          = !!s.gradient;
      showLuminance         = !!s.luminance;
      spiralCw              = !!s.spiralCw;
      showFib               = !!s.fib;
      if (s.layerOrder)     setLayerOrder(s.layerOrder);
      if (s.layerColors) {
        for (const k of Object.keys(LAYER_DEFAULTS)) {
          if (s.layerColors[k]) _layerColors[k] = s.layerColors[k];
        }
      }
    } catch (_) {}
  }

  (function() {
    const list = document.getElementById('layersList');
    let dragItem = null;
    list.addEventListener('dragstart', e => {
      dragItem = e.target.closest('.layer-item');
      if (!dragItem) return;
      dragItem.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    list.addEventListener('dragend', e => {
      if (dragItem) {
        dragItem.classList.remove('dragging');
        computeStylePriority();
        saveSettings();
        maybeCaptureScreenshot();
        render();
        dragItem = null;
      }
    });
    list.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const target = e.target.closest('.layer-item');
      if (!target || target === dragItem) return;
      const rect = target.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        list.insertBefore(dragItem, target);
      } else {
        list.insertBefore(dragItem, target.nextSibling);
      }
    });
  })();


  /* screenshot mode toggle — capture then render */
  document.getElementById('screenshotToggle').addEventListener('change', e => {
    screenshotMode = e.target.checked;
    saveSettings();
    if (screenshotMode) captureScreenshot();
    render();
    updateZoomDisp();
  });

  /* ----- Tile-level control (×1, ×2, ×4, ×8 …) ----- */
  /* cache-clearing — render first (builds cache), capture after, animate re-renders */
  function applyLevel() {
    _clearCaches();
    document.getElementById('levelDisp').value = tileLevel;
    render();
    maybeCaptureScreenshot();
    animate();
  }
  document.getElementById('levelUp').addEventListener('click', () => { tileLevel++; applyLevel(); });
  document.getElementById('levelDown').addEventListener('click', () => { if (tileLevel > 1) tileLevel--; applyLevel(); });

  /* enter key on input → apply typed level value */
  document.getElementById('levelDisp').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const v = parseInt(e.target.value, 10);
      if (v && v >= 1 && v <= 10) { tileLevel = v; applyLevel(); }
      else e.target.value = tileLevel;
    }
  });

  /* ----- Start-offset control (first tile number) --*/
  function applyStartOffset() {
    _clearCaches();
    document.getElementById("startDisp").value = startOffset + 1;
    render();
    maybeCaptureScreenshot();
    animate();
  }
  document.getElementById("startUp").addEventListener("click", () => { startOffset++; applyStartOffset(); });
  document.getElementById("startDown").addEventListener("click", () => { if (startOffset > -10000) startOffset--; applyStartOffset(); });

  /* enter key on input → apply typed offset value */
  document.getElementById('startDisp').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const v = parseInt(e.target.value, 10);
      if (!isNaN(v) && v >= -10000 && v <= 10000) { startOffset = v - 1; applyStartOffset(); }
      else e.target.value = startOffset + 1;
    }
  });

  cwTog.addEventListener('change', e => {
    spiralCw = e.target.checked;
    saveSettings();
    _clearCaches();
    render();
    maybeCaptureScreenshot();
    animate();
  });

  /* ----- MOUSE PAN (1:1 screen pixels, no zoom division!) ----- */
  canvas.addEventListener('mousedown', e => {
    dragging = true;
    dragMX = e.clientX; dragMY = e.clientY;
    dragPanX = panX; dragPanY = panY;
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    // pan is in canvas-pixel space → delta equals screen delta directly
    panX = dragPanX + (e.clientX - dragMX);
    panY = dragPanY + (e.clientY - dragMY);
    render();
    updateZoomDisp();
  });
  window.addEventListener('mouseup', () => { dragging = false; });

  /* ----- TOUCH PAN ----- */
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    dragging = true;
    dragMX = e.touches[0].clientX; dragMY = e.touches[0].clientY;
    dragPanX = panX; dragPanY = panY;
  }, { passive: true });
  canvas.addEventListener('touchmove', e => {
    if (!dragging || e.touches.length !== 1) return;
    panX = dragPanX + (e.touches[0].clientX - dragMX);
    panY = dragPanY + (e.touches[0].clientY - dragMY);
    render();
    updateZoomDisp();
  }, { passive: true });
  canvas.addEventListener('touchend', () => { dragging = false; });

  /* ----- WHEEL ZOOM (anchored at mouse) ----- */
  // worldX = (mouseCanvasX - W/2 - panX) / zoom
  // After zoom change: panX = mouseCanvasX - W/2 - worldX * newZoom
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const W = canvas.width, H = canvas.height;
    const rect = canvas.getBoundingClientRect();
    const mcx = e.clientX - rect.left;
    const mcy = e.clientY - rect.top;

    const worldX = (mcx - W / 2 - panX) / zoom;
    const worldY = (mcy - H / 2 - panY) / zoom;

    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    zoom = Math.max(zoomMin(), Math.min(3, zoom * factor));

    panX = mcx - W / 2 - worldX * zoom;
    panY = mcy - H / 2 - worldY * zoom;

    render();
    updateZoomDisp();
  }, { passive: false });

  /* ----- RESET ----- */
  document.getElementById('resetBtn').addEventListener('click', () => {
    panX = 0; panY = 0; zoom = 1;
    render();
    updateZoomDisp();
  });

  /* ----- RESIZE ----- */
  window.addEventListener('resize', () => {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width  = rect.width;
    canvas.height = rect.height;
    render();
    animate();
  });

  /* ----- INIT ----- */

  /* load config.json (gradientOffset), fall back to default 30 */
  (function loadConfig() {
    try {
      fetch('/config.json')
        .then(r => r.json())
        .then(d => { if (typeof d.gradientOffset === 'number') gradientOffset = d.gradientOffset; })
        .catch(() => {});
    } catch (_) {}
  })();

  (function init() {
    loadSettings();
    updateColorSwatches();
    computeStylePriority();
    document.getElementById('screenshotToggle').checked  = screenshotMode;
    document.getElementById('gradientToggle').checked     = showGradient;
    document.getElementById('luminanceToggle').checked    = showLuminance;
    document.getElementById('spiralCw').checked           = spiralCw;
    document.getElementById('gridToggle').checked         = showGrid;
    document.getElementById('filterPrimes').checked       = highlightPrimes;
    document.getElementById('filterAll').checked          = showAll;
    document.getElementById('fibToggle').checked          = showFib;
    syncLayerEyes();
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width  = rect.width;
    canvas.height = rect.height;
    render();
    animate();

    /* ── Settings dropdown toggle ── */
    (function() {
      const btn = document.getElementById('settingsBtn');
      const panel = document.getElementById('settingsPanel');
      if (!btn || !panel) return;
      btn.addEventListener('click', () => {
        btn.classList.toggle('open');
        panel.classList.toggle('open');
      });
    })();
  })();
})();
