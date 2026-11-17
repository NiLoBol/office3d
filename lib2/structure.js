/* office3d/v2/lib2/structure.js — เปลือกอาคาร (ผนังเจาะช่องจริง / พื้น+โครง slab / ฝ้าแขวน / ดาดฟ้า+parapet / กันสาดทางเข้า)
   API:  window.O3D2.structure.build(ctx) → { group, colliders, groups, meta, toggle }
   ctx = { THREE, plan, mats, util, renderer, scene }   (ไม่ scene.add เอง — assembler เป็นคนใส่)

   หน่วยเมตร · y=0 = ระดับพื้น finished floor · wallH = plan.building.wallH
   ใครต่อตรงไหน (สำหรับโหนดอื่น / assembler):
     · assembler  → scene.add(res.group) ; สลับได้ res.groups.{walls,floors,ceilings,roof,extras,glass}.visible หรือ res.toggle('ceilings', false)
     · doors      → res.meta.glass = ด้านที่เว้นว่างไว้ (2 ด้าน) · res.meta.doors = ช่องที่เจาะแล้ว · res.meta.entrance
                    (โครง+กระจกหน้าต่างนอกที่ผมทำอยู่ใน groups.glass — ซ่อน/ทิ้งได้ถ้าโหนด doors ทำเอง)
     · lighting   → res.meta.lumSlots = จุดเจาะช่องดวงโคม 77 จุด {room,x,z,size:0.6,y:2.97} (ฝ้าเป็นโพรง 0.6×0.6 จริง)
     · walk mode  → res.colliders (22 กล่อง; ช่องประตู/ทางเข้าเดินผ่านได้ · ด้านกระจกยังไม่มี collider)
   โครงสร้างไฟล์:
     1) groups           3) พื้น/ฐาน/ธรณี        5) ดาดฟ้า/parapet
     2) ผนัง (line model) 4) ฝ้าแขวน + t-bar      6) ภายนอก (กันสาด/เสา/ลาน) + collider + meta
*/
(function () {
  var O = window.O3D2 = window.O3D2 || {};

  function build(ctx) {
    var THREE = (ctx && ctx.THREE) || window.THREE;
    var U = (ctx && ctx.util) || O.util;
    var MATS = (ctx && ctx.mats) || O.mats;
    var plan = (ctx && ctx.plan) || window.OFFICE2;

    var B = plan.building;
    var wallH = B.wallH || 3.05, tExt = B.tExt || 0.24, tInt = B.tInt || 0.12, slabT = B.slab || 0.22;
    var X0 = B.x || 0, Z0 = B.z || 0, X1 = X0 + (B.w || 34), Z1 = Z0 + (B.d || 22);

    var FLOOR_T = 0.02;                       /* วัสดุปูพื้น (top = y 0) */
    var ceilY = wallH - (plan.ceiling && plan.ceiling.drop || 0.06); /* 2.99 */
    var CEIL_T = 0.04, ceTop = ceilY + CEIL_T / 2, ceBot = ceilY - CEIL_T / 2;
    var bbH = 0.10, bbT = 0.02;               /* baseboard */
    var J = 0.02;                             /* ความหนา reveal/ขอบปูน */

    var fallback = new THREE.MeshStandardMaterial({ color: 0x8d9296, roughness: 0.85, metalness: 0 });
    function MT(n) { var m = MATS && MATS.get ? MATS.get(n) : null; return m || fallback; }

    /* ---------- 1) groups -------------------------------------------------- */
    var root = new THREE.Group(); root.name = 'structure';
    var G = {};
    ['walls', 'floors', 'ceilings', 'roof', 'extras', 'glass'].forEach(function (k) {
      G[k] = new THREE.Group(); G[k].name = 'structure:' + k; root.add(G[k]);
    });

    /* ---------- helpers ---------------------------------------------------- */
    /* กล่องตามแนวผนัง: dir 'x' → ยาวตาม x, c = z กึ่งกลาง · dir 'z' → ยาวตาม z, c = x กึ่งกลาง
       off = เลื่อนศูนย์กลางขวางแนว (ใช้แยกชั้นผนังนอก) */
    function put(group, dir, c, t, a, b, y0, y1, m, off) {
      var len = b - a, h = y1 - y0;
      if (len < 0.005 || h < 0.005) return null;
      var o = off || 0, w, d, x, z;
      if (dir === 'x') { w = len; d = t; x = (a + b) / 2; z = c + o; }
      else { w = t; d = len; x = c + o; z = (a + b) / 2; }
      var mesh = U.box(w, h, d, m, x, (y0 + y1) / 2, z);
      group.add(mesh);
      return mesh;
    }
    function slabBox(group, xa, za, xb, zb, y0, y1, m) {
      if (xb - xa < 0.005 || zb - za < 0.005 || y1 - y0 < 0.005) return null;
      var mesh = U.box(xb - xa, y1 - y0, zb - za, m, (xa + xb) / 2, (y0 + y1) / 2, (za + zb) / 2);
      group.add(mesh);
      return mesh;
    }
    /* ช่วง [a,b] ที่ไม่ถูกตัดด้วย cuts [[a,b],...] */
    function subRanges(a, b, cuts) {
      var out = [], cur = a;
      cuts.slice().sort(function (p, q) { return p[0] - q[0]; }).forEach(function (ct) {
        var ca = Math.max(a, ct[0]), cb = Math.min(b, ct[1]);
        if (cb <= ca) return;
        if (ca > cur + 0.005) out.push([cur, ca]);
        if (cb > cur) cur = cb;
      });
      if (b > cur + 0.005) out.push([cur, b]);
      return out;
    }

    /* ---------- 2) ผนัง: line model --------------------------------------- */
    var lines = {}, lineOrder = [];
    function lineKey(dir, c, t) { return dir + '|' + c.toFixed(3) + '|' + t.toFixed(3); }
    function getLine(dir, c, t, kind, sign) {
      var k = lineKey(dir, c, t), L = lines[k];
      if (!L) {
        L = lines[k] = { dir: dir, c: c, t: t, kind: kind || 'int', sign: sign || 0, iv: [], opens: [], parts: [] };
        lineOrder.push(L);
      }
      return L;
    }
    function addIv(L, a, b, glass) {
      if (Math.abs(b - a) < 0.005) return;
      L.iv.push({ a: Math.min(a, b), b: Math.max(a, b), glass: !!glass });
    }
    /* แบ่งช่วงของเส้นผนัง: glass ชนะ solid (ด้านที่ room.glass เว้นว่างให้โหนด doors) */
    function resolveLine(L) {
      var pts = [], seen = {}, i, j;
      for (i = 0; i < L.iv.length; i++) {
        [L.iv[i].a, L.iv[i].b].forEach(function (v) {
          var k = v.toFixed(4);
          if (!seen[k]) { seen[k] = 1; pts.push(v); }
        });
      }
      pts.sort(function (p, q) { return p - q; });
      var parts = [];
      for (i = 0; i + 1 < pts.length; i++) {
        var a = pts[i], b = pts[i + 1];
        if (b - a < 1e-4) continue;
        var mid = (a + b) / 2, gl = false, so = false;
        for (j = 0; j < L.iv.length; j++) {
          var iv = L.iv[j];
          if (iv.a < mid && iv.b > mid) { if (iv.glass) gl = true; else so = true; }
        }
        var kind = gl ? 'glass' : (so ? 'solid' : 'none');
        var last = parts[parts.length - 1];
        if (last && last.kind === kind && Math.abs(last.b - a) < 1e-3) last.b = b;
        else parts.push({ a: a, b: b, kind: kind });
      }
      L.parts = parts;
    }
    /* ท่อนผนังจริง: แบ่งที่ช่องเปิด + เหลือ sill ใต้ช่อง / ทับหลังเหนือช่อง */
    function pieces(a, b, opens, top, base) {
      var out = [], cur = a, list = opens.slice().sort(function (p, q) { return p.a - q.a; });
      for (var i = 0; i < list.length; i++) {
        var o = list[i], oa = Math.max(a, o.a), ob = Math.min(b, o.b);
        if (ob - oa < 0.01) continue;
        if (oa > cur + 0.005) out.push({ a: cur, b: oa, y0: base, y1: top });
        if (o.y0 > base + 0.005) out.push({ a: oa, b: ob, y0: base, y1: o.y0 });
        if (o.y1 < top - 0.005) out.push({ a: oa, b: ob, y0: o.y1, y1: top });
        if (ob > cur) cur = ob;
      }
      if (b > cur + 0.005) out.push({ a: cur, b: b, y0: base, y1: top });
      return out;
    }
    /* reveal: ธรณี/ขอบปูนรอบช่อง (หนา J, ยื่นพ้นผิวผนังข้างละ 0.004 กัน z-fight) */
    function reveals(L, o) {
      var t = L.t + 0.008, m = MT('wall.trim');
      put(G.walls, L.dir, L.c, t, o.a, o.a + J, o.y0, o.y1, m, 0);
      put(G.walls, L.dir, L.c, t, o.b - J, o.b, o.y0, o.y1, m, 0);
      put(G.walls, L.dir, L.c, t, o.a + J, o.b - J, o.y1 - J, o.y1, m, 0);
      if (o.y0 > 0.02) put(G.walls, L.dir, L.c, t, o.a + J, o.b - J, o.y0, o.y0 + J, m, 0);
    }

    /* รายละเอียดต่อ space: ด้าน → dir/c/a/b/thickness */
    function sideGeom(sp, side) {
      if (side === 'z0') return { dir: 'x', c: sp.z, a: sp.x, b: sp.x + sp.w, sign: 1, t: Math.abs(sp.z - Z0) < 0.001 ? tExt : tInt };
      if (side === 'z1') return { dir: 'x', c: sp.z + sp.d, a: sp.x, b: sp.x + sp.w, sign: -1, t: Math.abs(sp.z + sp.d - Z1) < 0.001 ? tExt : tInt };
      if (side === 'x0') return { dir: 'z', c: sp.x, a: sp.z, b: sp.z + sp.d, sign: 1, t: Math.abs(sp.x - X0) < 0.001 ? tExt : tInt };
      return { dir: 'z', c: sp.x + sp.w, a: sp.z, b: sp.z + sp.d, sign: -1, t: Math.abs(sp.x + sp.w - X1) < 0.001 ? tExt : tInt };
    }
    function halfAtX(x) { return (Math.abs(x - X0) < 0.001 || Math.abs(x - X1) < 0.001) ? tExt / 2 : tInt / 2; }
    function halfAtZ(z) { return (Math.abs(z - Z0) < 0.001 || Math.abs(z - Z1) < 0.001) ? tExt / 2 : tInt / 2; }

    var spaces = (plan.rooms || []).slice();
    if (plan.corridor) spaces.push(plan.corridor);

    /* ---- 2a) ผนังภายนอก 4 ด้าน (ชั้นใน wall.paint 0.10 + ชั้นนอก wall.exterior 0.14) */
    var SIDES = [
      { id: 'z0', dir: 'x', c: Z0, a: X0 - tExt / 2, b: X1 + tExt / 2, sign: 1 },
      { id: 'z1', dir: 'x', c: Z1, a: X0 - tExt / 2, b: X1 + tExt / 2, sign: -1 },
      { id: 'x0', dir: 'z', c: X0, a: Z0 + tExt / 2 - 0.01, b: Z1 - tExt / 2 + 0.01, sign: 1 },
      { id: 'x1', dir: 'z', c: X1, a: Z0 + tExt / 2 - 0.01, b: Z1 - tExt / 2 + 0.01, sign: -1 }
    ];
    var EXT = {}; /* id → line */
    SIDES.forEach(function (s) { EXT[s.id] = getLine(s.dir, s.c, tExt, 'ext', s.sign); addIv(EXT[s.id], s.a, s.b, false); });
    function sideOf(id) { for (var i = 0; i < SIDES.length; i++) if (SIDES[i].id === id) return SIDES[i]; return null; }
    function along(s, v) { return (s.dir === 'x' ? X0 : Z0) + v; }  /* from/to ของ plan นับจากมุม min */

    var metaDoors = [], metaGlassParts = [], winParts = [], metaEntrance = null;

    var windows = (plan.windows || []);
    windows.forEach(function (w) {
      var s = sideOf(w.side); if (!s) return;
      var o = { a: along(s, w.from), b: along(s, w.to), y0: w.sill === undefined ? 0.95 : w.sill,
                y1: w.head === undefined ? 2.55 : w.head, kind: 'window' };
      if (o.b - o.a < 0.2 || o.y1 - o.y0 < 0.2) return;
      EXT[s.id].opens.push(o);
      winParts.push({ dir: s.dir, c: s.c, sign: s.sign, a: o.a, b: o.b, y0: o.y0, y1: o.y1 });
    });
    if (plan.entrance) {
      var es = sideOf(plan.entrance.side);
      if (es) {
        var eo = { a: along(es, plan.entrance.from), b: along(es, plan.entrance.to),
                   y0: 0, y1: plan.entrance.h || 2.4, kind: 'door' };
        EXT[es.id].opens.push(eo);
        metaEntrance = { dir: es.dir, c: es.c, a: eo.a, b: eo.b, h: eo.y1, side: es.id, type: plan.entrance.type };
      }
    }

    /* ---- 2b) ผนังภายใน (dedupe ด้วย line key + union ช่วง) */
    spaces.forEach(function (sp) {
      ['z0', 'z1', 'x0', 'x1'].forEach(function (side) {
        var g = sideGeom(sp, side);
        if (Math.abs(g.t - tExt) < 0.001) return;              /* ด้านนี้คือผนังนอก — ข้าม */
        var L = getLine(g.dir, g.c, tInt, 'int', 0);
        var isGlass = !!(sp.glass && sp.glass.indexOf(side) >= 0);
        addIv(L, g.a, g.b, isGlass);
      });
    });

    /* ---- 2c) ช่องประตูจาก plan.rooms[].door */
    spaces.forEach(function (sp) {
      var d = sp.door; if (!d) return;
      var g = sideGeom(sp, d.side);
      var isGlass = !!(sp.glass && sp.glass.indexOf(d.side) >= 0);
      var a = g.a + (d.at - d.w / 2), b = a + d.w;
      var h = d.h || 2.1;
      metaDoors.push({ room: sp.id, side: d.side, type: d.type, dir: g.dir, c: g.c, a: a, b: b, h: h, glass: isGlass });
      if (isGlass) return;                                  /* ด้านกระจกเว้นว่างทั้งด้าน (โหนด doors เติม) */
      var L = lines[lineKey(g.dir, g.c, g.t)];
      if (L) L.opens.push({ a: a, b: b, y0: 0, y1: h, kind: 'door' });
    });

    /* ---- 2d) สร้างผนัง + reveal + collider ------------------------------- */
    var colliders = [];
    lineOrder.forEach(resolveLine);
    lineOrder.forEach(function (L) {
      var doorsOnLine = L.opens.filter(function (o) { return o.y0 <= 0.05; });
      L.parts.forEach(function (p) {
        if (p.kind !== 'solid') return;
        var opens = L.opens.filter(function (o) { return o.b > p.a + 0.003 && o.a < p.b - 0.003; });
        var pcs = pieces(p.a, p.b, opens, wallH, 0);
        pcs.forEach(function (pc) {
          if (L.kind === 'ext') {                            /* 2 ชั้น: ใน (สี) 0.10 + นอก 0.14 */
            put(G.walls, L.dir, L.c, 0.10, pc.a, pc.b, pc.y0, pc.y1, MT('wall.paint'), L.sign * (L.t / 2 - 0.05));
            put(G.walls, L.dir, L.c, 0.14, pc.a, pc.b, pc.y0, pc.y1, MT('wall.exterior'), -L.sign * (L.t / 2 - 0.07));
          } else {
            put(G.walls, L.dir, L.c, L.t, pc.a, pc.b, pc.y0, pc.y1, MT('wall.paint'), 0);
          }
        });
        /* collider = ช่วงที่เดินชนได้ (ช่องประตูไม่ใส่ collider → เดินผ่านได้) */
        var cuts = doorsOnLine.map(function (o) { return [o.a, o.b]; });
        subRanges(p.a, p.b, cuts).forEach(function (r) {
          var h2 = L.t / 2;
          if (L.dir === 'x') colliders.push(U.collider(r[0], L.c - h2, r[1], L.c + h2, 0, wallH));
          else colliders.push(U.collider(L.c - h2, r[0], L.c + h2, r[1], 0, wallH));
        });
      });
      /* reveal รอบช่อง (ช่องในด้านกระจกไม่ถูกเพิ่มเข้ามาตั้งแต่แรก) */
      L.opens.forEach(function (o) {
        if (L.parts.some(function (p) { return p.kind === 'glass' && o.a >= p.a - 0.01 && o.b <= p.b + 0.01; })) return;
        reveals(L, o);
      });
    });
    /* ด้านกระจกเว้นว่าง — เก็บไว้ให้โหนด doors + รายงาน */
    lineOrder.forEach(function (L) {
      L.parts.forEach(function (p) {
        if (p.kind === 'glass') metaGlassParts.push({ dir: L.dir, c: L.c, t: L.t, a: p.a, b: p.b, y0: 0, y1: wallH });
      });
    });

    /* ---- 2e) หน้าต่าง: โครงอะลูมิเนียม + กระจก (กลุ่ม glass — ปิดได้ถ้าโหนด doors ทำเอง) */
    winParts.forEach(function (w) {
      var fw = 0.05, fd = 0.10, A = w.a + 0.03, Bv = w.b - 0.03, Y0 = w.y0 + 0.03, Y1 = w.y1 - 0.03;
      var al = MT('metal.aluminium');
      put(G.glass, w.dir, w.c, fd, A, A + fw, Y0, Y1, al, 0);
      put(G.glass, w.dir, w.c, fd, Bv - fw, Bv, Y0, Y1, al, 0);
      put(G.glass, w.dir, w.c, fd, A + fw, Bv - fw, Y1 - fw, Y1, al, 0);
      put(G.glass, w.dir, w.c, fd, A + fw, Bv - fw, Y0, Y0 + fw, al, 0);
      var span = Bv - A - 2 * fw, nm = Math.max(0, Math.round(span / 2.4) - 1);
      for (var k = 1; k <= nm; k++) {
        var mx = A + fw + span * k / (nm + 1);
        put(G.glass, w.dir, w.c, fd, mx - 0.025, mx + 0.025, Y0, Y1, al, 0);
      }
      put(G.glass, w.dir, w.c, 0.012, A + fw, Bv - fw, Y0 + fw, Y1 - fw, MT('glass.dark'), 0);
    });

    /* ---- 2f) facade: ฐาน (plinth) + เสาแนวระหว่างหน้าต่าง (pilaster) ------ */
    (function () {
      var st = MT('stone.grey');
      var plinthY0 = -(slabT), plinthY1 = 0.55;
      SIDES.forEach(function (s) {
        var outs = s.sign;  /* interior อยู่ทาง +sign → ผิว luar ไปทาง -sign */
        var off = -outs * (tExt / 2 + 0.04);
        var cuts = [];
        if (metaEntrance && metaEntrance.side === s.id) cuts.push([metaEntrance.a, metaEntrance.b]);
          subRanges(s.a, s.b, cuts).forEach(function (r) {
          put(G.walls, s.dir, s.c, 0.08, r[0], r[1], plinthY0, plinthY1, st, off);
        });
        /* pilaster ในช่องว่างระหว่างหน้าต่าง */
        var wn = windows.filter(function (w) { return w.side === s.id; })
          .map(function (w) { return [along(s, w.from), along(s, w.to)]; })
          .sort(function (p, q) { return p[0] - q[0]; });
        var gaps = subRanges(s.a, s.b, wn);
        gaps.forEach(function (gp) {
          var wdt = gp[1] - gp[0];
          if (wdt < 0.9) return;
          var cw = Math.min(0.30, wdt - 0.4);
          put(G.walls, s.dir, s.c, 0.07, gp[0] + (wdt - cw) / 2, gp[1] - (wdt - cw) / 2, 0.55, wallH - 0.05, st, -outs * (tExt / 2 + 0.035));
        });
      });
    })();

    /* ---------- 3) พื้น + โครง slab + baseboard --------------------------- */
    /* วัสดุปูพื้น: ใช้ mats.getFloor(name, w, d) เพื่อให้ repeat ของ texture = ขนาดจริง
       (ถ้าใช้ mats.get เฉย ๆ UV 0..1 ต่อแผ่น → ลายไทล์ยืดทั้งโถง เห็นเป็นเส้นตะเข็บดำพาดกลาง) */
    function floorMat(name, w, d) {
      var m = null;
      try { if (MATS && MATS.getFloor) m = MATS.getFloor(name, w, d); } catch (e) { m = null; }
      return m || MT(name);
    }
    var bwX = X1 - X0 + tExt, bdZ = Z1 - Z0 + tExt;
    slabBox(G.floors, X0 - tExt / 2, Z0 - tExt / 2, X1 + tExt / 2, Z1 + tExt / 2,
      -slabT, -FLOOR_T, floorMat('floor.concrete', bwX, bdZ));        /* โครง slab 0.22 (เห็นจากนอก) */
    spaces.forEach(function (sp) {
      slabBox(G.floors, sp.x, sp.z, sp.x + sp.w, sp.z + sp.d, -FLOOR_T, 0,
        floorMat(sp.floor || 'floor.concrete', sp.w, sp.d));          /* วัสดุปูพื้น top = y0 */
    });
    /* baseboard รอบห้อง (ตัดที่ช่องประตู/ด้านกระจก)
       · ฝังหลังบัวเข้าผนัง 3 มม. → ไม่มีผิวระนาบเดียวกัน (กัน z-fight)
       · ยกหัวบัว 0.12 + เส้นเงา stone.grey 0.01 ด้านบน → มองเห็นที่ระดับตา */
    (function () {
      var bb = MT('wall.baseboard'), shLine = MT('stone.grey');
      var bh = 0.13, bt = 0.022, shH = 0.016, shT = 0.016;
      spaces.forEach(function (sp) {
        ['z0', 'z1', 'x0', 'x1'].forEach(function (side) {
          var g = sideGeom(sp, side);
          if (sp.glass && sp.glass.indexOf(side) >= 0) return;        /* ด้านกระจก ไม่มีผนัง → ไม่มีบัว */
          var L = lines[lineKey(g.dir, g.c, g.t)]; if (!L) return;
          var cuts = [];
          L.parts.forEach(function (p) { if (p.kind === 'glass') cuts.push([p.a, p.b]); });
          L.opens.forEach(function (o) { if (o.y0 <= 0.05) cuts.push([o.a, o.b]); });
          var a, b;
          if (g.dir === 'x') { a = sp.x + halfAtX(sp.x); b = sp.x + sp.w - halfAtX(sp.x + sp.w); }
          else { a = sp.z + halfAtZ(sp.z); b = sp.z + sp.d - halfAtZ(sp.z + sp.d); }
          var offB = g.sign * (g.t / 2 + bt / 2 - 0.003);       /* หน้า = ผนัง +19 มม. */
          var offS = g.sign * (g.t / 2 + shT / 2 - 0.003);      /* เส้นเงา ถอยหลังบัว 6 มม. */
          subRanges(a, b, cuts).forEach(function (r) {
            put(G.floors, g.dir, g.c, bt, r[0], r[1], -0.004, bh, bb, offB);
            put(G.floors, g.dir, g.c, shT, r[0], r[1], bh, bh + shH, shLine, offS);
          });
        });
      });
    })();

    /* ---------- 4) ฝ้าแขวน + t-bar + ช่องดวงโคม -------------------------- */
    var lumSize = (plan.ceiling && plan.ceiling.luminaire && plan.ceiling.luminaire.size) || 0.6;
    var lumSlots = [];
    var GRID_ROOMS = ['corridor', 'reception', 'ops'];            /* t-bar เฉพาะ 3 ห้องนี้ (คุม tri) */
    (function () {
      var cm = MT((plan.ceiling && plan.ceiling.mat) || 'wall.paint.ceiling');
      var tm = MT('metal.aluminium');
      var tile = (plan.ceiling && plan.ceiling.tile) || 1.2;
      spaces.forEach(function (sp) {
        var nx = Math.max(1, Math.round(sp.w / 3)), nz = Math.max(1, Math.round(sp.d / 3));
        var xs = [], zs = [], i;
        for (i = 0; i < nx; i++) xs.push(sp.x + sp.w * (i + 0.5) / nx);
        for (i = 0; i < nz; i++) zs.push(sp.z + sp.d * (i + 0.5) / nz);
        xs.forEach(function (x) { zs.forEach(function (z) { lumSlots.push({ room: sp.id, x: x, z: z, size: lumSize, y: ceBot }); }); });
        /* ฝ้าทึบ (ไม่เจาะช่อง): lighting วางแผ่นโคม 0.62×0.02 ที่ y 2.948–2.968 ใต้ผิวฝ้า 2.97 อยู่แล้ว
           ถ้าเจาะจะเห็นโพรง/ทะลุฟ้าเวลาซ่อนดาดฟ้า และขอบช่องจะแตกเป็นเส้นขาว → ฝ้าทึบเนียนสุด */
        slabBox(G.ceilings, sp.x, sp.z, sp.x + sp.w, sp.z + sp.d, ceBot, ceTop, cm);
        /* t-bar บาง (0.022 × 0.014) เว้นช่วงที่ทับแผ่นโคม */
        if (GRID_ROOMS.indexOf(sp.id) >= 0) {
          var hp = lumSize / 2 + 0.02, bw = 0.022, by0 = ceBot - 0.014, by1 = ceBot;
          for (var zz = sp.z + tile; zz < sp.z + sp.d - 0.06; zz += tile) {
            var cz = [];
            zs.forEach(function (zc) {
              if (zz > zc - hp && zz < zc + hp) xs.forEach(function (xc) { cz.push([xc - hp, xc + hp]); });
            });
            subRanges(sp.x, sp.x + sp.w, cz).forEach(function (r) {
              put(G.ceilings, 'x', zz, bw, r[0], r[1], by0, by1, tm, 0);
            });
          }
          for (var xx = sp.x + tile; xx < sp.x + sp.w - 0.06; xx += tile) {
            var cx = [];
            xs.forEach(function (xc) {
              if (xx > xc - hp && xx < xc + hp) zs.forEach(function (zc) { cx.push([zc - hp, zc + hp]); });
            });
            subRanges(sp.z, sp.z + sp.d, cx).forEach(function (r) {
              put(G.ceilings, 'z', xx, bw, r[0], r[1], by0, by1, tm, 0);
            });
          }
        }
      });
    })();

    /* ---------- 5) ดาดฟ้า + parapet + coping ------------------------------ */
    (function () {
      var conc = MT('floor.concrete'), trim = MT('wall.trim'), ext = MT('wall.exterior');
      var roofY1 = wallH + 0.2;
      slabBox(G.roof, X0 - tExt / 2, Z0 - tExt / 2, X1 + tExt / 2, Z1 + tExt / 2, wallH, roofY1, conc);
      var ppH = 0.55, ppT = 0.22, cpT = 0.30, cpH = 0.06, cpO = (cpT - ppT) / 2;
      var o0 = -tExt / 2;                                   /* ผิวนอก */
      var zc0 = Z0 + o0 + ppT / 2, zc1 = Z1 - o0 - ppT / 2;
      var xc0 = X0 + o0 + ppT / 2, xc1 = X1 - o0 - ppT / 2;
      var px0 = X0 + o0, px1 = X1 - o0, pz0 = Z0 + o0 + ppT, pz1 = Z1 - o0 - ppT;
      /* parapet z0 / z1 (ยาวตาม x) + coping ยื่นข้างละ cpO */
      put(G.roof, 'x', zc0, ppT, px0, px1, roofY1, roofY1 + ppH, ext, 0);
      put(G.roof, 'x', zc0, cpT, px0 - cpO, px1 + cpO, roofY1 + ppH, roofY1 + ppH + cpH, trim, 0);
      put(G.roof, 'x', zc1, ppT, px0, px1, roofY1, roofY1 + ppH, ext, 0);
      put(G.roof, 'x', zc1, cpT, px0 - cpO, px1 + cpO, roofY1 + ppH, roofY1 + ppH + cpH, trim, 0);
      /* parapet x0 / x1 (ยาวตาม z) */
      put(G.roof, 'z', xc0, ppT, pz0, pz1, roofY1, roofY1 + ppH, ext, 0);
      put(G.roof, 'z', xc0, cpT, pz0 - cpO, pz1 + cpO, roofY1 + ppH, roofY1 + ppH + cpH, trim, 0);
      put(G.roof, 'z', xc1, ppT, pz0, pz1, roofY1, roofY1 + ppH, ext, 0);
      put(G.roof, 'z', xc1, cpT, pz0 - cpO, pz1 + cpO, roofY1 + ppH, roofY1 + ppH + cpH, trim, 0);
      /* เครื่องปรับอากาศบนดาดฟ้า 2 ชุด (เงาเทาเข้ม ทำให้ยอดตึกอ่านเป็นอาคารจริง) */
      [[X0 + 6.5, Z0 + 6.0], [X0 + 20.0, Z0 + 15.5]].forEach(function (p) {
        var s = 0.9, hgt = 0.85;
        slabBox(G.roof, p[0] - s / 2 - 0.08, p[1] - 0.45 - 0.08, p[0] + s / 2 + 0.08, p[1] + 0.45 + 0.08, roofY1, roofY1 + 0.08, conc);
        slabBox(G.roof, p[0] - s / 2, p[1] - 0.45, p[0] + s / 2, p[1] + 0.45, roofY1 + 0.08, roofY1 + hgt, MT('metal.dark'));
        slabBox(G.roof, p[0] - s / 2 + 0.06, p[1] - 0.45 + 0.06, p[0] + s / 2 - 0.06, p[1] + 0.45 - 0.06, roofY1 + hgt, roofY1 + hgt + 0.03, MT('metal.aluminium'));
      });
    })();

    /* ---------- 6) ภายนอก: กันสาด + เสา + ลานทางเข้า ---------------------- */
    var metaCanopy = null;
    if (plan.entrance) {
      var e = plan.entrance;
      var s0 = along({ dir: sideOf(e.side) ? sideOf(e.side).dir : 'z' }, e.from);
      var s1 = along({ dir: sideOf(e.side) ? sideOf(e.side).dir : 'z' }, e.to);
      var ez0 = Math.min(s0, s1), ez1 = Math.max(s0, s1);
      var cOut = 2.5, cY1 = 2.90, cT = 0.18;   /* ผิวผนังนอก x = -0.12 */
      var cx0 = -cOut, cx1 = 0;                                            /* ฝังเข้าผนัง 0.12 */
      slabBox(G.extras, cx0, ez0 - 0.45, cx1, ez1 + 0.45, cY1 - cT, cY1, MT('wall.trim'));
      /* เสา 2 ต้น */
      var colX = cx0 + 0.15;
      [ez0 + 0.2, ez1 - 0.2].forEach(function (cz) {
        var ch = cY1 - cT;
        var c = U.cyl(0.12, 0.13, ch, 16, MT('metal.aluminium'), colX, ch / 2, cz);
        G.extras.add(c);
        colliders.push(U.collider(colX - 0.14, cz - 0.14, colX + 0.14, cz + 0.14, 0, ch));
      });
      /* fascia กันสาด (แถบขอบ) */
      slabBox(G.extras, cx0 - 0.06, ez0 - 0.51, cx0 + 0.06, ez1 + 0.51, cY1 - cT, cY1 + 0.12, MT('metal.dark'));
      slabBox(G.extras, cx0 - 0.06, ez0 - 0.51, cx1, ez0 - 0.41, cY1 - cT, cY1 + 0.12, MT('metal.dark'));
      slabBox(G.extras, cx0 - 0.06, ez1 + 0.41, cx1, ez1 + 0.51, cY1 - cT, cY1 + 0.12, MT('metal.dark'));
      /* ลานทางเข้า (คอนกรีต) + ธรณีหินใต้ประตู */
      slabBox(G.extras, cx0 - 1.2, ez0 - 1.2, 0, ez1 + 1.2, -0.12, 0, MT('floor.concrete'));
      var es = sideOf(e.side);
      if (es) slabBox(G.extras, X0 - tExt / 2, ez0, X0 + tExt / 2, ez1, -0.02, 0.02, MT('stone.grey'));
      metaCanopy = { x0: cx0, x1: cx1, z0: ez0 - 0.45, z1: ez1 + 0.45, y0: cY1 - cT, y1: cY1, cols: [[colX, ez0 + 0.2], [colX, ez1 - 0.2]] };
    }

    /* ---------- merge (ผนัง/พื้น/ฝ้า/ดาดฟ้า/ภายนอก/กระจก) ------------------ */
    ['walls', 'floors', 'ceilings', 'roof', 'extras', 'glass'].forEach(function (k) {
      var g = G[k];
      if (!g.children.length) { root.remove(g); return; }
      var mg = U.merge(g);
      mg.name = 'structure:' + k;
      mg.userData.kind = k;
      root.remove(g);
      root.add(mg);
      G[k] = mg;
    });

    var stats = { parts: 0, tris: 0 };
    root.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      stats.parts++;
      var g2 = o.geometry;
      stats.tris += Math.round((g2.index ? g2.index.count : (g2.attributes.position ? g2.attributes.position.count : 0)) / 3);
    });

    return {
      group: root,
      colliders: colliders,
      groups: G,
      toggle: function (name, on) { if (G[name]) G[name].visible = !!on; },
      stats: stats,
      meta: {
        wallH: wallH, tExt: tExt, tInt: tInt, ceilY: ceilY, lumSize: lumSize,
        doors: metaDoors,            /* ช่องประตูที่เจาะจริง: {room,side,dir,c,a,b,h,type,glass} */
        glass: metaGlassParts,       /* ด้านที่เว้นว่างให้โหนด doors: {dir,c,t,a,b,y0,y1} */
        windows: winParts,           /* ช่องหน้าต่าง: {dir,c,a,b,y0,y1} */
        entrance: metaEntrance,
        canopy: metaCanopy,
        lumSlots: lumSlots           /* จุดดวงโคม (โหนด lighting วางที่จุดนี้): {room,x,z,size,y} */
      }
    };
  }

  O.structure = { build: build };
})();
