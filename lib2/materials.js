/* office3d/v2/lib2/materials.js — v1 (2026-11-17) คลังวัสดุ procedural canvas texture
   API เดิม (คงไว้ทั้งหมด): O3D2.mats.get(name) → THREE.MeshStandardMaterial (แคช ห้าม dispose/แก้)
                            O3D2.mats.names · O3D2.mats.spec · O3D2.mats.has(name)
   API เพิ่ม: mats.getFloor(name, wMetre, dMetre)  → material clone + repeat ตามขนาดพื้นจริง (แคช, ไม่ชนของเดิม)
              mats.attachRenderer(renderer)        → anisotropy = min(16, getMaxAnisotropy())
              mats.envMap(renderer)                → PMREM env กลาง ๆ (ทำให้โลหะ/กระจกมีเงา) — optional
              mats.stats()                         → {textures, canvases, materials, floors, genMs}
   texture ทุกตัววาดจาก <canvas> ในเครื่อง (≤256 px, RepeatWrapping, ลูกเล่น bump/rough จาก canvas เดียวกัน)
   สร้างแบบ lazy: ครั้งแรกที่มีคนเรียก mats.get(name) เท่านั้น · ไม่โหลดไฟล์ภายนอก/ไม่ใช้ CDN */
(function () {
  var O = window.O3D2 = window.O3D2 || {};
  var THREE = window.THREE;

  /* =========================================================== 0) helper เล็ก ๆ */
  var now = (typeof performance !== 'undefined' && performance.now)
    ? function () { return performance.now(); }
    : function () { return Date.now(); };

  function rng(a) { /* mulberry32 — คงที่ทุกเครื่อง */
    return function () {
      a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function canvasOf(size) {
    var c = document.createElement('canvas'); c.width = c.height = size; return c;
  }
  /* วาด pixel ต่อ pixel: fn(x, y, out, i) — out = [r,g,b] ที่ใช้ซ้ำ (ไม่สร้าง array ทุกพิกเซล) */
  function paint(size, fn) {
    var c = canvasOf(size), ctx = c.getContext('2d');
    var img = ctx.createImageData(size, size), d = img.data, o = [0, 0, 0], i, x, y;
    for (y = 0; y < size; y++) {
      for (x = 0; x < size; x++) {
        i = y * size + x;
        fn(x, y, o, i);
        d[i * 4] = o[0] < 0 ? 0 : o[0] > 255 ? 255 : o[0];
        d[i * 4 + 1] = o[1] < 0 ? 0 : o[1] > 255 ? 255 : o[1];
        d[i * 4 + 2] = o[2] < 0 ? 0 : o[2] > 255 ? 255 : o[2];
        d[i * 4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
  /* value-noise แบบ wrap (ไม่มีตะเข็บเวลา repeat) */
  function grid(cells, r) {
    var g = new Float32Array(cells * cells), i;
    for (i = 0; i < g.length; i++) g[i] = r();
    return g;
  }
  function sample(g, cells, u, v) {
    var x = u * cells, y = v * cells;
    var xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    var x0 = xi % cells, x1 = (xi + 1) % cells, y0 = yi % cells, y1 = (yi + 1) % cells;
    var a = g[y0 * cells + x0], b = g[y0 * cells + x1], c2 = g[y1 * cells + x0], dd = g[y1 * cells + x1];
    var sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    var t1 = a + (b - a) * sx, t2 = c2 + (dd - c2) * sx;
    return t1 + (t2 - t1) * sy;
  }
  /* field: array size² ค่า -0.5..0.5 (หลาย octave) */
  function field(size, cells, seed, oct) {
    oct = oct || 2;
    var r = rng(seed), f = new Float32Array(size * size), G = [], CC = [], W = [], tot = 0, k, x, y, v;
    for (k = 0; k < oct; k++) {
      var cc = Math.max(2, Math.round(cells * Math.pow(3, k)));
      G.push(grid(cc, r)); CC.push(cc);
      var w = 1 / Math.pow(1.9, k); W.push(w); tot += w;
    }
    for (y = 0; y < size; y++) {
      for (x = 0; x < size; x++) {
        v = 0;
        for (k = 0; k < oct; k++) v += sample(G[k], CC[k], x / size, y / size) * W[k];
        f[y * size + x] = (v / tot - 0.5) * 1.8;   // ขยายช่วงให้ ±0.9 → ลายชัดขึ้น
      }
    }
    return f;
  }
  function sf(f, size, u, v) { /* resample field ด้วยพิกัด wrap (u,v = ตัวคูณเศษส่วนได้) */
    return sfRaw(f, size, u - Math.floor(u), v - Math.floor(v));
  }
  function sfRaw(f, size, u, v) {
    var x = u * size, y = v * size;
    var xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    var x0 = xi % size, x1 = (xi + 1) % size, y0 = yi % size, y1 = (yi + 1) % size;
    var a = f[y0 * size + x0], b = f[y0 * size + x1], c2 = f[y1 * size + x0], d2 = f[y1 * size + x1];
    var sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    var t1 = a + (b - a) * sx, t2 = c2 + (d2 - c2) * sx;
    return t1 + (t2 - t1) * sy;
  }

  /* =========================================================== 1) ลาย (canvas ทำครั้งเดียวต่อลาย) */
  var PAT = {
    /* พรม: noise 2 ชั้น + speckle ละเอียด, สีเทาเกือบขาว (สีจริงมาจาก material.color) */
    carpet: function () {
      var S = 128, f1 = field(S, 8, 21, 2), f2 = field(S, 18, 22, 1), r = rng(23);
      return paint(S, function (x, y, o, i) {
        var v = 233 + f1[i] * 20 + f2[i] * 16;
        o[0] = v * 1.01; o[1] = v; o[2] = v * 0.99;
      });
    },
    /* กระเบื้องปูพื้น: 2×2 แผ่น + รอยต่อ + bevel + tone ต่างกันเล็กน้อย (พื้นที่จริง 1.2 ม./รอบ) */
    tile: function () {
      var S = 256, T = S / 2, f = field(S, 7, 31, 2), r = rng(32), tone = [], i;
      for (i = 0; i < 4; i++) tone.push((r() - 0.5) * 18);
      return paint(S, function (x, y, o, idx) {
        var ti = (y < T ? 0 : 2) + (x < T ? 0 : 1);
        var lx = x % T, ly = y % T;
        var e = Math.min(Math.min(lx, T - 1 - lx), Math.min(ly, T - 1 - ly));
        var v = 212 + tone[ti] + f[idx] * 16;
        if (e < 3) v = 120 + f[idx] * 10;           // รอยต่อยาแนว (เข้ม)
        else if (e < 7) v -= 16;                    // เงา bevel ขอบแผ่น
        else v += 4 * (1 - e / T);                  // ผิวสว่างกลางแผ่น
        o[0] = v; o[1] = v * 0.996; o[2] = v * 0.978;
      });
    },
    /* ไม้ปูพื้น: 3 แผ่นต่อรอบ (1.2 ม.) + ลายไม้ยาว + รอยต่อแผ่น */
    planks: function () {
      var S = 256, N = 3, ph = S / N, fg = field(S, 3, 41, 2), fs = field(S, 26, 42, 1);
      var r = rng(43), tn = [], i;
      for (i = 0; i < N; i++) tn.push(1 + (r() - 0.5) * 0.24);
      return paint(S, function (x, y, o, idx) {
        var pi = Math.min(N - 1, Math.floor(y / ph)), ly = y - pi * ph;
        var w = sf(fs, S, x / S, y / S * 3) * 0.7;
        var g = sf(fg, S, x / S * 2, y / S * 7 + w);
        var k = 0.92 + g * 0.40 + fg[idx] * 0.12;
        if (ly < 2.2 || ly > ph - 2.2) k = 0.34;    // รอยต่อแผ่นไม้
        else if (ly < 5.5) k *= 0.82;               // ขอบแผ่นนูน
        k *= tn[pi];
        o[0] = 189 * k; o[1] = 143 * k; o[2] = 97 * k;
      });
    },
    /* ลายไม้เนื้อ (เฟอร์นิเจอร์) — สีอบในเนื้อ texture */
    grain: function (tint, seed, contrast) {
      return function () {
        var S = 128, fg = field(S, 3, seed, 2), fs = field(S, 10, seed + 7, 1);
        var k0 = contrast || 0.34;
        return paint(S, function (x, y, o, idx) {
          var w = sf(fs, S, x / S, y / S * 3) * 0.65;
          var g = sf(fg, S, x / S * 2, y / S * 6 + w);
          var k = 0.97 + g * k0;
          o[0] = tint[0] * k; o[1] = tint[1] * k; o[2] = tint[2] * k * 0.985;
        });
      };
    },
    /* ผนังสี: orange-peel จาง ๆ (แทบไม่เห็น แต่ kills ความเรียบ пластик) */
    paint: function () {
      var S = 128, f1 = field(S, 18, 51, 1), f2 = field(S, 6, 52, 1);
      return paint(S, function (x, y, o, i) {
        var v = 249 + f1[i] * 6 + f2[i] * 2.5;
        o[0] = v; o[1] = v; o[2] = v;
      });
    },
    /* acoustic panel: ผิวผ้า + กรอบร่องรอบแผ่น (เห็นเป็น panel ทุก face) */
    acoustic: function () {
      var S = 128, f = field(S, 10, 61, 2);
      return paint(S, function (x, y, o, i) {
        var e = Math.min(Math.min(x, S - 1 - x), Math.min(y, S - 1 - y));
        var v = 238 + f[i] * 12 + 6 * Math.sin(x * Math.PI / 2);
        if (e < 4) v = 162;                          // ร่องขอบแผ่น
        else if (e < 8) v = 204;                     // เงาในร่อง
        o[0] = v; o[1] = v; o[2] = v;
      });
    },
    /* ผ้าทอ (โซฟา/เก้าอี้บุผ้า) */
    weave: function () {
      var S = 128, f = field(S, 12, 71, 1);
      return paint(S, function (x, y, o, i) {
        var v = 230 + f[i] * 22
          + 14 * Math.sin(x * 2 * Math.PI / 3)
          + 14 * Math.sin(y * 2 * Math.PI / 3);
        o[0] = v; o[1] = v; o[2] = v;
      });
    },
    /* ผ้าตาข่ายเก้าอี้ (mesh chair) — ตาห่าง + รูมืด */
    mesh: function () {
      var S = 128, f = field(S, 16, 81, 1);
      return paint(S, function (x, y, o, i) {
        var pa = Math.sin((x + y) * Math.PI / 8), pb = Math.sin((x - y) * Math.PI / 8);
        var v = 226 + 12 * ((pa + pb) * 0.5) + f[i] * 8;
        if (pa * pb > 0.30) v -= 22;                 // รูตาข่าย
        o[0] = v; o[1] = v; o[2] = v;
      });
    },
    /* perforated metal — รูเจาะตาราง (ชื่อนอกลิสต์ ใช้ผ่าน mats.get('metal.perforated')) */
    perf: function () {
      var S = 128, P = 16, f = field(S, 12, 91, 1);
      return paint(S, function (x, y, o, i) {
        var dx = (x % P) - P / 2, dy = (y % P) - P / 2, rr = Math.sqrt(dx * dx + dy * dy);
        var v = 231 + f[i] * 9;
        if (rr < 4.0) v = 92;                        // รู
        else if (rr < 5.4) v = 198;                  // ขอบรู
        o[0] = v; o[1] = v; o[2] = v;
      });
    },
    /* สแตนเลส brushed — noise แนวเดียว (aniso จำลอง) */
    brushed: function () {
      var S = 128, f = field(S, 2, 101, 2), f2 = field(S, 60, 102, 1);
      return paint(S, function (x, y, o, i) {
        var band = sf(f, S, x / S * 2, y / S * 96);
        var v = 226 + band * 78 + f2[i] * 7;
        o[0] = v; o[1] = v; o[2] = v;
      });
    },
    /* กระดาษ */
    paper: function () {
      var S = 128, f = field(S, 16, 111, 1), f2 = field(S, 8, 112, 1);
      return paint(S, function (x, y, o, i) {
        var v = 245 + f[i] * 13 + f2[i] * 5;
        o[0] = v; o[1] = v; o[2] = v;
      });
    },
    /* กระดาษลัง: ลูกฟูก + สีน้ำตาลอบในเนื้อ */
    cardboard: function () {
      var S = 128, f = field(S, 8, 121, 2);
      return paint(S, function (x, y, o, i) {
        var k = 0.95 + 0.10 * Math.sin(y * Math.PI / 4) + f[i] * 0.16;
        o[0] = 187 * k; o[1] = 147 * k; o[2] = 99 * k;
      });
    },
    /* ใบไม้: เส้นกลางใบ (แนวตั้ง) + เส้นแขนงแนวนอนเป็นช่วง 16 px + warp คาบ 2π (wrap เนียน) */
    leaf: function () {
      var S = 128, f = field(S, 12, 131, 1);
      return paint(S, function (x, y, o, i) {
        var u = x / S;
        var warp = Math.sin(u * 2 * Math.PI) * 7 + Math.sin(u * 4 * Math.PI) * 3;
        var vp = Math.abs((((y + warp) % 16) + 16) % 16 - 8);
        var k = 0.90 + f[i] * 0.30;
        if (vp < 1.2) k *= 0.74;                                   // เส้นแขนง
        if (Math.abs(u - 0.5) < 0.03) k *= 0.58;                    // เส้นกลางใบ
        if (u < 0.06 || u > 0.94) k *= 0.86;                        // ขอบใบ
        o[0] = 104 * k; o[1] = 156 * k; o[2] = 96 * k;
      });
    },
    /* หิน/หินอ่อนเทา: speckle 2 ระดับ */
    stone: function () {
      var S = 128, f = field(S, 8, 141, 2), f2 = field(S, 16, 142, 1), r = rng(143);
      return paint(S, function (x, y, o, i) {
        var v = 202 + f[i] * 16 + f2[i] * 5;
        o[0] = v; o[1] = v * 1.01; o[2] = v * 0.985;
      });
    },
    /* ดิน */
    soil: function () {
      var S = 128, f = field(S, 10, 151, 2), f2 = field(S, 44, 152, 2);
      return paint(S, function (x, y, o, i) {
        var v = 84 + f[i] * 40 + f2[i] * 14;
        o[0] = v * 1.06; o[1] = v * 0.96; o[2] = v * 0.86;
      });
    },
    /* คอนกรีตขัดมัน: จุดด่างนุ่ม + คราบจาง */
    concrete: function () {
      var S = 128, f = field(S, 5, 161, 2), f2 = field(S, 16, 162, 1), r = rng(163);
      return paint(S, function (x, y, o, i) {
        var v = 214 + f[i] * 34 + f2[i] * 11;
        o[0] = v; o[1] = v * 1.005; o[2] = v * 0.99;
      });
    },
    /* ยาง/พื้นยาง: noise ละเอียด + เม็ด */
    rubber: function () {
      var S = 128, f = field(S, 10, 171, 2), f2 = field(S, 14, 172, 1), r = rng(172);
      return paint(S, function (x, y, o, i) {
        var v = 198 + f[i] * 44 + f2[i] * 16;
        o[0] = v; o[1] = v; o[2] = v;
      });
    },
    /* ปูนฉาบผนังภายนอก */
    stucco: function () {
      var S = 128, f = field(S, 10, 181, 2), f2 = field(S, 16, 182, 1);
      return paint(S, function (x, y, o, i) {
        var v = 234 + f[i] * 14 + f2[i] * 6;
        o[0] = v; o[1] = v * 0.995; o[2] = v * 0.97;
      });
    }
  };
  PAT.grainOak = PAT.grain([214, 172, 124], 51, 0.15);
  PAT.grainWalnut = PAT.grain([122, 86, 62], 52, 0.20);
  PAT.grainWhite = PAT.grain([240, 236, 228], 53, 0.16);
  PAT.grainLaminate = PAT.grain([226, 212, 188], 54, 0.17);

  /* =========================================================== 2) SPEC (ชื่อตายตัวตาม CONTRACT)
     c สี · r roughness · m metalness · t opacity · e/ei emissive
     pat ลาย canvas · tile เมตรต่อ 1 รอบ (ใช้กับ getFloor) · rx/ry repeat บน face · bump · roughMap */
  var SPEC = {
    /* ---- พื้น ---- */
    'floor.carpet.grey':  { c: 0xa2a8ad, r: 0.97, m: 0, pat: 'carpet', tile: 1.0, rx: 1, ry: 1, bump: 0.10 },
    'floor.carpet.blue':  { c: 0x6d7c91, r: 0.97, m: 0, pat: 'carpet', tile: 1.0, rx: 1, ry: 1, bump: 0.10 },
    'floor.tile.polished':{ c: 0xf7f6f2, r: 0.45, m: 0.03, pat: 'tile', tile: 1.2, rx: 1, ry: 1, bump: 0.10 },
    'floor.tile.dark':    { c: 0x7d8286, r: 0.50, m: 0.04, pat: 'tile', tile: 1.2, rx: 1, ry: 1, bump: 0.10 },
    'floor.wood.oak':     { c: 0xffffff, r: 0.50, m: 0, pat: 'planks', tile: 1.2, rx: 1, ry: 1, bump: 0.08, roughMap: 1 },
    'floor.concrete':     { c: 0xababa6, r: 0.93, m: 0, pat: 'concrete', tile: 2.0, rx: 1, ry: 1, bump: 0.12 },
    'floor.rubber':       { c: 0x505456, r: 0.90, m: 0, pat: 'rubber', tile: 0.6, rx: 1, ry: 1, bump: 0.14 },

    /* ---- ผนัง ---- */
    'wall.paint':         { c: 0xeff2f4, r: 0.88, m: 0, pat: 'paint', rx: 3, ry: 3 },
    'wall.paint.warm':    { c: 0xf1ece3, r: 0.88, m: 0, pat: 'paint', rx: 3, ry: 3 },
    'wall.paint.ceiling': { c: 0xf8f9fa, r: 1.0, m: 0, pat: 'paint', rx: 1, ry: 1 },
    'wall.acoustic':      { c: 0xb9bec4, r: 0.92, m: 0, pat: 'acoustic', rx: 1, ry: 1, bump: 0.18 },
    'wall.baseboard':     { c: 0xf7f8f9, r: 0.45, m: 0, pat: 'paint', rx: 1, ry: 1 },
    'wall.trim':          { c: 0xe1e5e8, r: 0.60, m: 0, pat: 'paint', rx: 1, ry: 1 },
    'wall.exterior':      { c: 0xdadbd6, r: 0.93, m: 0, pat: 'stucco', rx: 4, ry: 4 },

    /* ---- กระจก (ไม่มี texture — ตั้งใจ) ---- */
    'glass.clear':        { c: 0xcfe3ee, r: 0.05, m: 0, t: 0.16 },
    'glass.frosted':      { c: 0xdfe9ef, r: 0.30, m: 0, t: 0.32 },
    'glass.dark':         { c: 0x2b3540, r: 0.15, m: 0.2, t: 0.75 },

    /* ---- โลหะ (brushed = aniso จำลอง: noise แนวเดียว + roughnessMap) ---- */
    'metal.steel':        { c: 0xc2c9d0, r: 0.34, m: 0.90, pat: 'brushed', rx: 2, ry: 1, bump: 0.04, roughMap: 1 },
    'metal.chrome':       { c: 0xdfe4e9, r: 0.10, m: 1.00, pat: 'brushed', rx: 2, ry: 1, bump: 0.02 },
    'metal.dark':         { c: 0x40464e, r: 0.40, m: 0.78, pat: 'brushed', rx: 2, ry: 1, bump: 0.04, roughMap: 1 },
    'metal.aluminium':    { c: 0xb0b7be, r: 0.38, m: 0.85, pat: 'brushed', rx: 2, ry: 1, bump: 0.04, roughMap: 1 },

    /* ---- ไม้ (สีอบในเนื้อ texture) ---- */
    'wood.oak':           { c: 0xffffff, r: 0.62, m: 0, pat: 'grainOak', rx: 1, ry: 1, bump: 0.015, tile: 0.9, tileY: 0.9 },
    'wood.walnut':        { c: 0xffffff, r: 0.60, m: 0, pat: 'grainWalnut', rx: 1, ry: 1, bump: 0.015, tile: 0.9, tileY: 0.9 },
    'wood.white':         { c: 0xffffff, r: 0.50, m: 0, pat: 'grainWhite', rx: 1, ry: 1, bump: 0.012, tile: 0.9, tileY: 0.9 },
    'wood.laminate':      { c: 0xffffff, r: 0.45, m: 0, pat: 'grainLaminate', rx: 1, ry: 1, bump: 0.012, tile: 0.9, tileY: 0.9 },

    /* ---- ผ้า ---- */
    'fabric.grey':        { c: 0x787f86, r: 0.99, m: 0, pat: 'weave', rx: 3, ry: 3, bump: 0.12 },
    'fabric.navy':        { c: 0x3a4d66, r: 0.99, m: 0, pat: 'weave', rx: 3, ry: 3, bump: 0.12 },
    'fabric.mesh':        { c: 0x353b40, r: 0.85, m: 0.15, pat: 'mesh', rx: 3, ry: 3, bump: 0.14 },
    'fabric.cream':       { c: 0xded8cb, r: 0.99, m: 0, pat: 'weave', rx: 3, ry: 3, bump: 0.12 },

    /* ---- พลาสติก ---- */
    'plastic.white':      { c: 0xf3f4f5, r: 0.48, m: 0, pat: 'paint', rx: 2, ry: 2 },
    'plastic.black':      { c: 0x252a2e, r: 0.44, m: 0.12, pat: 'paint', rx: 2, ry: 2 },
    'plastic.grey':       { c: 0x7b8188, r: 0.58, m: 0, pat: 'paint', rx: 2, ry: 2 },

    /* ---- อื่น ๆ ---- */
    'rubber':             { c: 0x35393c, r: 0.93, m: 0, pat: 'rubber', rx: 2, ry: 2, bump: 0.16 },
    'paper':              { c: 0xf5f3ed, r: 0.90, m: 0, pat: 'paper', rx: 2, ry: 2, bump: 0.03 },
    'cardboard':          { c: 0xffffff, r: 0.95, m: 0, pat: 'cardboard', rx: 2, ry: 2, bump: 0.12 },
    'ceramic':            { c: 0xf3f4f2, r: 0.22, m: 0, pat: 'paint', rx: 2, ry: 2, bump: 0.01 },
    'stone.grey':         { c: 0x9a9d9b, r: 0.72, m: 0, pat: 'stone', rx: 2, ry: 2, bump: 0.04 },

    /* ---- ต้นไม้ ---- */
    'plant.leaf':         { c: 0xffffff, r: 0.82, m: 0, pat: 'leaf', rx: 1, ry: 1, bump: 0.06 },
    'plant.pot':          { c: 0xc08160, r: 0.85, m: 0, pat: 'paint', rx: 2, ry: 2, bump: 0.03 },
    'soil':               { c: 0x453b31, r: 1.00, m: 0, pat: 'soil', rx: 2, ry: 2, bump: 0.22 },

    /* ---- จอ / ไฟ / ป้าย (ไม่มี texture) ---- */
    'screen.on':          { c: 0x141a20, r: 0.30, m: 0, e: 0x2f6f9e, ei: 0.55 },
    'screen.off':         { c: 0x14181c, r: 0.20, m: 0.2 },
    'led.warm':           { c: 0xfff3e0, r: 0.40, m: 0, e: 0xffe9c9, ei: 1.1 },
    'led.cool':           { c: 0xeaf4ff, r: 0.40, m: 0, e: 0xdceeff, ei: 1.0 },
    'sign.white':         { c: 0xf7f8f9, r: 0.60, m: 0 },
    'bin.grey':           { c: 0x4e555b, r: 0.70, m: 0.2, pat: 'paint', rx: 2, ry: 2, bump: 0.03 },
    'cable.black':        { c: 0x1c1f22, r: 0.80, m: 0 },
    'accent.orange':      { c: 0xe28a3b, r: 0.70, m: 0, pat: 'paint', rx: 2, ry: 2, bump: 0.02 },

    /* ---- นอกลิสต์ CONTRACT (ไม่โผล่ใน .names — เรียกได้ถ้าต้องการ) ---- */
    'metal.perforated':   { c: 0x8e949a, r: 0.45, m: 0.70, pat: 'perf', rx: 2, ry: 2, bump: 0.40, roughMap: 1 }
  };
  var NAMES = [], k;
  for (k in SPEC) if (k !== 'metal.perforated') NAMES.push(k);

  /* =========================================================== 3) texture plumbing (lazy + แคช) */
  var CV = {}, TEX = {}, texList = [], nCv = 0, nTex = 0, genMs = 0;

  function aniso() {
    var r = mats.renderer;
    if (!r || !r.capabilities || !r.capabilities.getMaxAnisotropy) return 1;
    var a = r.capabilities.getMaxAnisotropy();
    return a > 0 ? Math.min(16, a) : 1;
  }
  function srgb(t) {
    if (THREE.SRGBColorSpace !== undefined && 'colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
    else t.encoding = THREE.sRGBEncoding;
  }
  function linear(t) {
    if ('colorSpace' in t) t.colorSpace = (THREE.NoColorSpace !== undefined ? THREE.NoColorSpace : '');
    else t.encoding = THREE.LinearEncoding;
  }
  /* canvas ของลายหนึ่ง ๆ — สร้างครั้งแรกที่ใช้ (จับเวลาไว้ใน stats.genMs) */
  function canvasFor(name) {
    var c = CV[name];
    if (!c) {
      var t0 = now();
      c = CV[name] = PAT[name]();
      genMs += now() - t0; nCv++;
    }
    return c;
  }
  /* kind 'c' = map (sRGB) · 'g' = bump/roughness (linear) — canvas เดียวกัน */
  function tex(name, kind, rx, ry) {
    var key = name + '|' + kind + '|' + rx + '|' + ry;
    var t = TEX[key];
    if (t) return t;
    t = new THREE.CanvasTexture(canvasFor(name));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx || 1, ry || 1);
    if (kind === 'c') srgb(t); else linear(t);
    t.anisotropy = aniso();
    t.needsUpdate = true;
    TEX[key] = t; texList.push(t); nTex++;
    return t;
  }

  /* =========================================================== 4) วัสดุ (แคช) */
  var made = {}, floorCache = {}, floorTex = [], nFloor = 0;
  var envTex = null, envRenderer = null;
  var DEFAULT = { c: 0x8a8f94, r: 0.8, m: 0 };

  var mats = {
    names: NAMES,
    spec: SPEC,

    get: function (name) {
      var m = made[name];
      if (m) return m;
      var s = SPEC[name] || DEFAULT;
      m = new THREE.MeshStandardMaterial({
        color: s.c, roughness: s.r === undefined ? 0.8 : s.r, metalness: s.m || 0,
        transparent: !!s.t, opacity: s.t || 1,
        side: s.t ? THREE.DoubleSide : THREE.FrontSide
      });
      m.name = name;
      if (s.t) m.depthWrite = false;
      if (s.e) { m.emissive = new THREE.Color(s.e); m.emissiveIntensity = s.ei || 1; }
      if (s.pat) {
        try {
          var rx = s.rx || 1, ry = s.ry || 1;
          m.map = tex(s.pat, 'c', rx, ry);
          if (s.bump) { m.bumpMap = tex(s.pat, 'g', rx, ry); m.bumpScale = s.bump; }
          if (s.roughMap) m.roughnessMap = tex(s.pat, 'g', rx, ry);
          // ไม่เปิด dithering: มันเติม noise ระดับ pixel ให้ผิวเรียบใหญ่ (เห็นเป็น static บนมือถือ)
        } catch (err) {
          console.warn('[mats] texture ล้มเหลวสำหรับ ' + name, err);
        }
      }
      made[name] = m;
      return m;
    },

    has: function (name) { return !!SPEC[name]; },

    /* พื้น: clone วัสดุ + clone texture แล้วตั้ง repeat ตามขนาดจริง (repeat ไม่ชนกับของที่แชร์)
       ใช้: mats.getFloor('floor.wood.oak', room.w, room.d) → คืน material (แคชตาม rx/ry) */
    getFloor: function (name, w, d, rot) {
      var base = mats.get(name), s = SPEC[name];
      if (!s || !s.tile || !w || !d) return base;
      var tx = s.tile, ty = s.tileY || s.tile;
      var rx = Math.max(1, Math.round((w / tx) * 2) / 2);      // ปัดครึ่งรอบ → แคชไม่บาน
      var ry = Math.max(1, Math.round((d / ty) * 2) / 2);
      if (rot === 90 || rot === -90 || rot === Math.PI / 2 || rot === -Math.PI / 2) {
        var tmp = rx; rx = ry; ry = tmp;
      }
      var key = name + '|' + rx + '|' + ry;
      var m = floorCache[key];
      if (m) return m;
      m = base.clone();
      m.name = name + '@' + rx + 'x' + ry;
      ['map', 'bumpMap', 'roughnessMap', 'normalMap'].forEach(function (kk) {
        if (!base[kk]) return;
        var t = base[kk].clone();
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(rx, ry);
        t.anisotropy = aniso();
        t.needsUpdate = true;
        floorTex.push(t);
        m[kk] = t;
      });
      floorCache[key] = m; nFloor++;
      return m;
    },

    /* สำหรับผิวเฟอร์นิเจอร์ (บานตู้/หน้าโต๊ะ) ที่อยากได้สเกลจริง:
       forSurface(name, w, d[, rot]) → clone วัสดุ + repeat = w/tile × d/tileY (ค่าจาก SPEC.tile)
       (เป็นตัวเดียวกับ getFloor — ตั้งชื่อให้เรียกง่ายตอนไม่ใช่พื้น) */
    forSurface: function (name, w, d, rot) { return mats.getFloor(name, w, d, rot); },

    /* เรียกครั้งเดียวตอนมี renderer (assembler/index) → anisotropy สูงสุดที่การ์ดทำได้ */
    attachRenderer: function (r) {
      mats.renderer = r || null;
      var a = aniso();
      for (var i = 0; i < texList.length; i++) {
        if (texList[i].anisotropy !== a) { texList[i].anisotropy = a; texList[i].needsUpdate = true; }
      }
      for (i = 0; i < floorTex.length; i++) {
        if (floorTex[i].anisotropy !== a) { floorTex[i].anisotropy = a; floorTex[i].needsUpdate = true; }
      }
      return mats;
    },

    /* env กลาง ๆ จาก canvas gradient (PMREM) — ให้โลหะ/กระจกมี "เงา" ไม่ดำ
       ใช้: scene.environment = mats.envMap(renderer) (ไม่บังคับ แต่แนะนำ) */
    envMap: function (renderer) {
      renderer = renderer || mats.renderer;
      if (!renderer || !THREE.PMREMGenerator) return null;
      if (envTex && envRenderer === renderer) return envTex;
      try {
        var sc = new THREE.Scene();
        var c = canvasOf(128), ctx = c.getContext('2d');
        var g = ctx.createLinearGradient(0, 0, 0, 128);
        g.addColorStop(0, '#aab4bd'); g.addColorStop(0.45, '#98a2ab');
        g.addColorStop(0.55, '#7d858c'); g.addColorStop(1, '#3c4145');
        ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = 'rgba(255,255,255,0.72)';                 // แผ่นไฟเพดาน (ไฮไลต์)
        ctx.fillRect(14, 10, 34, 22); ctx.fillRect(78, 16, 30, 18);
        var sky = new THREE.CanvasTexture(c);
        srgb(sky);
        var ball = new THREE.Mesh(
          new THREE.SphereGeometry(40, 20, 14),
          new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide })
        );
        sc.add(ball);
        var pm = new THREE.PMREMGenerator(renderer);
        if (pm.compileCubemapShader) pm.compileCubemapShader();
        envTex = pm.fromScene(sc, 0.03).texture;
        pm.dispose();
        ball.geometry.dispose(); ball.material.dispose(); sky.dispose();
        envRenderer = renderer;
      } catch (e) {
        console.warn('[mats] envMap ล้มเหลว', e);
        envTex = null;
      }
      return envTex;
    },

    stats: function () {
      return {
        materials: Object.keys(made).length, names: NAMES.length,
        canvases: nCv, textures: nTex, floors: nFloor,
        genMs: Math.round(genMs)
      };
    },

    /* ---- ใช้ใน dev harness: ดู canvas ลายดิบ ๆ (ไม่ผ่านแสง/UV) ---- */
    patterns: function () {
      var out = [], p;
      for (p in PAT) if (typeof PAT[p] === 'function' && PAT[p].length === 0) out.push(p);
      return out;
    },
    canvas: function (patName) { return PAT[patName] ? canvasFor(patName) : null; }
  };

  mats.renderer = null;

  /* ---------- ดักจับ renderer ให้เอง (anisotropy) ----------
     หน้าเว็บส่วนใหญ่สร้าง THREE.WebGLRenderer เอง *หลัง* โหลด materials.js
     → ห่อ constructor เพื่อจับ instance แล้วตั้ง anisotropy = min(16, getMaxAnisotropy())
     (ถ้าหน้าไหนสร้าง renderer ก่อนโหลดไฟล์นี้ ให้เรียก mats.attachRenderer(r) เอง)
     anisotropy สำคัญมาก: ถ้าเป็น 1 ผิวที่มองเฉียง (พื้น/ผนัง/บานตู้) จะขึ้นเป็น noise/static */
  try {
    var RealR = THREE && THREE.WebGLRenderer;
    if (RealR && !RealR.__matsHook) {
      var Hooked = function (params) {
        var inst = new RealR(params);
        try { mats.attachRenderer(inst); } catch (e) { console.warn('[mats] attachRenderer', e); }
        return inst;
      };
      Hooked.prototype = RealR.prototype;
      Hooked.__matsHook = true;
      THREE.WebGLRenderer = Hooked;
    }
  } catch (e) { console.warn('[mats] hook renderer', e); }

  O.mats = mats;
})();
