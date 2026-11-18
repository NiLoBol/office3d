/* office3d/v2/lib2/parking.js — ลานจอดรถ + ถนน + รถยนต์มีอนิเมชัน (ด้านตะวันออกของอาคาร)
   API:  window.O3D2.parking = { build(ctx) → { group, colliders, hooks:{update(dt)}, cars, meta, stats } }
   ctx = { THREE, plan, mats, util, renderer, scene }   (ไม่ scene.add เอง — assembler ใส่ให้)

   ที่มา: plan.parking = { x, z, w, d, cols, rows, slotW, slotD, gap, gate:{x,z},
                           street:{x,z,w,d}, bind:{gate,slot,free} }
   - ลาน = คอนกรีต x..x+w / z..z+d · 2 แถว × cols ช่อง · ทางวิ่ง 6 ม. กลางลาน (z = gate.z)
   - street.x ตีความเป็น "ขอบตะวันตก" ของถนน (56.5..65.5) · ทางลาดเชื่อม x1..street.x (มีไม้กั้นที่ gate.x)
   - สัญญาณ: /parking/slot/{n}/occupied (true = มีรถจอด) · /parking/gate (true = ยกค้าง)
     ไม่มีสัญญาณ = fallback: ช่อง 1..6 มีรถจอด, อีก 4 ช่องว่าง + รถวิ่งบนถนน 2 คัน

   งบ: ทุกอย่างในลาน (พื้น/เส้น/เสา/ไม้กั้น/ต้นไม้/ป้าย) = 1 mesh (vertex color) + แขนไม้กั้น 1 mesh
       รถ 1 คัน = 1 mesh (vertex color + attribute aEmis = ไฟหน้า/ท้ายเรืองแสง) → 14 mesh ทั้งโมดูล
   โครงไฟล์:
     0) helper (สี/vertex-builder/geometries)   1) layout ช่องจอด   2) พื้นลาน+ถนน+ของประกอบ
     3) รถ (geometry ต่อสไตล์+สี)                4) คลังรถ/สถานะ     5) ทางวิ่ง (entry/exit/loop)
     6) ไม้กั้น/ไฟสัญญาณ                          7) hooks.update     8) colliders/meta/stats
*/
(function () {
  var O = window.O3D2 = window.O3D2 || {};

  function build(ctx) {
    var THREE = (ctx && ctx.THREE) || window.THREE;
    var U = (ctx && ctx.util) || O.util || null;
    var plan = (ctx && ctx.plan) || window.OFFICE2 || {};
    var P = plan.parking || {};
    var sig = (ctx && ctx.signals) || null;

    /* ══════════════════ 0) helper ══════════════════ */
    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
    function angDiff(a, b) {
      var d = (b - a) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      return d;
    }
    function angTo(cur, tgt, step) {
      var d = angDiff(cur, tgt);
      if (Math.abs(d) <= step) return tgt;
      return cur + (d > 0 ? step : -step);
    }

    var CO = {};
    function C(hex) {
      var c = CO[hex];
      if (!c) {
        c = CO[hex] = new THREE.Color(hex);
        if (c.convertSRGBToLinear) c.convertSRGBToLinear();
      }
      return c;
    }

    var GC = {};
    function gBox(w, h, d) {
      var k = 'b' + w + '_' + h + '_' + d;
      if (!GC[k]) GC[k] = new THREE.BoxGeometry(w, h, d).toNonIndexed();
      return GC[k];
    }
    function gCyl(rt, rb, h, seg) {
      var k = 'c' + rt + '_' + rb + '_' + h + '_' + seg;
      if (!GC[k]) GC[k] = new THREE.CylinderGeometry(rt, rb, h, seg).toNonIndexed();
      return GC[k];
    }
    function gSph(r, ws, hs) {
      var k = 's' + r + '_' + ws + '_' + hs;
      if (!GC[k]) GC[k] = new THREE.SphereGeometry(r, ws, hs).toNonIndexed();
      return GC[k];
    }

    /* vertex-color builder: เก็บ position/normal/color/aEmis แล้วรวมเป็น geometry เดียว */
    function VB() { this.p = []; this.n = []; this.c = []; this.e = []; this.tri = 0; }
    VB.prototype.add = function (g, color, x, y, z, o) {
      o = o || {};
      var m = new THREE.Matrix4();
      var eu = new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0, 'XYZ');
      var q = new THREE.Quaternion().setFromEuler(eu);
      m.compose(new THREE.Vector3(x || 0, y || 0, z || 0), q,
        new THREE.Vector3(o.sx || 1, o.sy || 1, o.sz || 1));
      var el = m.elements;
      var nm = new THREE.Matrix3().getNormalMatrix(m), nel = nm.elements;
      var P0 = g.attributes.position.array, N0 = g.attributes.normal ? g.attributes.normal.array : null;
      var cr = color.r, cg = color.g, cb = color.b;
      var em = o.emis, er = em ? em[0] : 0, eg = em ? em[1] : 0, eb = em ? em[2] : 0;
      var p = this.p, n = this.n, c = this.c, e = this.e, i;
      for (i = 0; i < P0.length; i += 3) {
        var px = P0[i], py = P0[i + 1], pz = P0[i + 2];
        p.push(el[0] * px + el[4] * py + el[8] * pz + el[12],
               el[1] * px + el[5] * py + el[9] * pz + el[13],
               el[2] * px + el[6] * py + el[10] * pz + el[14]);
        if (N0) {
          var nx = N0[i], ny = N0[i + 1], nz = N0[i + 2];
          var tx = nel[0] * nx + nel[3] * ny + nel[6] * nz;
          var ty = nel[1] * nx + nel[4] * ny + nel[7] * nz;
          var tz = nel[2] * nx + nel[5] * ny + nel[8] * nz;
          var l = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
          n.push(tx / l, ty / l, tz / l);
        }
        c.push(cr, cg, cb);
        e.push(er, eg, eb);
      }
      this.tri += P0.length / 9;
      return this;
    };
    VB.prototype.geo = function () {
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
      g.setAttribute('aEmis', new THREE.Float32BufferAttribute(this.e, 3));
      g.computeBoundingSphere();
      return g;
    };
    VB.prototype.mesh = function (mat, name) {
      var m = new THREE.Mesh(this.geo(), mat);
      m.name = name || 'mesh';
      return m;
    };

    /* วัสดุ vertex-color + aEmis (patch เบา ๆ: emissive ต่อจุด = ไฟหน้า/ท้าย/ดวงโคมเรืองแสง
       ถ้า three เวอร์ชันอื่นไม่มี string นี้ การแทนที่จะไม่เกิด → ไฟแค่สว่างไม่เรือง (ไม่พัง) */
    function vertexMat(rough, metal) {
      var m = new THREE.MeshStandardMaterial({
        vertexColors: true, color: 0xffffff, roughness: rough, metalness: metal
      });
      m.onBeforeCompile = function (sh) {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute vec3 aEmis;\nvarying vec3 vEmis;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmis = aEmis;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vEmis;')
          .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive + vEmis;');
      };
      return m;
    }
    var matSite = vertexMat(0.84, 0.04);
    var matCar = vertexMat(0.42, 0.30);

    /* ══════════════════ 1) layout ══════════════════ */
    var X0 = P.x !== undefined ? P.x : 36, Z0 = P.z !== undefined ? P.z : 2;
    var W = P.w || 18, D = P.d || 20;
    var X1 = X0 + W, Z1 = Z0 + D;
    var COLS = P.cols || 5, ROWS = P.rows || 2;
    var SW = P.slotW || 3.0, SD = P.slotD || 5.2, GP = P.gap === undefined ? 0.5 : P.gap;
    var AISLE_W = 6.0;
    var gateX = (P.gate && P.gate.x) || (X1 + 1.0);
    var aisleZ = (P.gate && P.gate.z) || (Z0 + D / 2);
    /* ทางวิ่งกลางลานต้องพอดี: 2 แถว + ทางวิ่ง ≤ D */
    var aisleMin = Z0 + 0.2 + SD + AISLE_W / 2;
    var aisleMax = Z1 - 0.2 - SD - AISLE_W / 2;
    if (aisleMax > aisleMin) aisleZ = clamp(aisleZ, aisleMin, aisleMax);

    var cellW = COLS * SW + (COLS - 1) * GP;
    var mx = (W - cellW) / 2;
    function cellX(c) { return X0 + mx + c * (SW + GP); }

    var rowZ = [aisleZ - AISLE_W / 2 - SD / 2, aisleZ + AISLE_W / 2 + SD / 2];
    if (ROWS === 1) rowZ = [aisleZ - AISLE_W / 2 - SD / 2];

    var SLOTS = [];            /* index 1..n */
    (function () {
      for (var r = 0; r < ROWS; r++) {
        for (var c = 0; c < COLS; c++) {
          var n = r * COLS + c + 1;
          SLOTS[n] = {
            n: n, row: r, col: c,
            x: cellX(c) + SW / 2, z: rowZ[r],
            yaw: r === 0 ? Math.PI : 0,               /* แถวใต้หันลง (จอดหน้าฝั่งถนนใน), แถวเหนือหันขึ้น */
            x0: cellX(c), x1: cellX(c) + SW,
            z0: rowZ[r] - SD / 2, z1: rowZ[r] + SD / 2,
            zAisle: rowZ[r] + (r === 0 ? SD / 2 : -SD / 2)
          };
        }
      }
    })();
    var NSLOT = ROWS * COLS;          /* SLOTS[0] ว่าง → ใช้จำนวนจริง ไม่ใช่ .length */

    /* ถนน: street.x = ขอบตะวันตก */
    var ST = P.street || { x: X1 + 2.5, z: 0, w: 9, d: 22 };
    var SX0 = ST.x, SX1 = ST.x + ST.w, SZ0 = ST.z || 0, SZ1 = (ST.z || 0) + (ST.d || 22);
    var laneN = SX0 + (SX1 - SX0) * 0.27;      /* เลนขึ้น (เหนือ) */
    var laneS = SX0 + (SX1 - SX0) * 0.73;      /* เลนลง (ใต้) */
    var apronZ0 = aisleZ - 2.6, apronZ1 = aisleZ + 4.8;   /* ทางลาด + ลานหน้าไม้กั้น (วางป้าย P) */
    var gateZpost = aisleZ + 1.35;             /* เสาตั้งที่ขอบเหนือทางวิ่ง · แขนนอนขวางที่ z ≈ 12 (ตาม plan) */
    var ARM_LEN = 2.40;                        /* แขนกั้น 2.4 ม. กวาดขวางทางวิ่ง 1.8 ม. + กันรอบ */

    /* ══════════════════ 2) ลาน + ถนน + ของประกอบ (vertex mesh เดียว) ══════════════════ */
    var vb = new VB();
    var CCON = C(0x6b6e72);      /* แอสฟัลต์/คอนกรีตเข้มของลาน → เส้นขาวตัดชัดแม้เห็นจากไกล */
    var CSIDE = C(0xb6b8b2);     /* ทางเท้า/ขอบลาน (คอนกรีตอ่อน) */
    var CASPH = C(0x484b50);     /* แอสฟัลต์ถนน */
    var CWHITE = C(0xffffff);
    var CCURB = C(0xa4a7a2);
    var CDARK = C(0x4a5157);
    var CPOST = C(0x2c3238);
    var CRED = C(0xd23a2c);
    var CBLUE = C(0x1c5fa8);
    var CSIGN = C(0xf2f4f6);
    var CTRUNK = C(0x6b5a48);
    var CLEAF = C(0x487244);
    var CLEAF2 = C(0x537f3f);
    var CSHRUB = C(0x3d663b);
    var CGRND = C(0x6f7268);

    /* พื้นลาน */
    vb.add(gBox(W, 0.20, D), CCON, X0 + W / 2, -0.10, Z0 + D / 2);
    /* ทางเดินเท้าระหว่างอาคารกับลาน (ยกขึ้น 2 ซม.) */
    vb.add(gBox(1.8, 0.22, D + 2), CSIDE, X0 - 0.9, -0.09, Z0 + D / 2);
    /* ทางลาดเข้า/ออก (ลาน → ถนน) */
    vb.add(gBox(SX0 - X1 + 0.02, 0.20, apronZ1 - apronZ0), CCON,
      (X1 + SX0) / 2, -0.10, (apronZ0 + apronZ1) / 2);
    /* ถนน */
    vb.add(gBox(SX1 - SX0, 0.20, SZ1 - SZ0), CASPH, (SX0 + SX1) / 2, -0.10, (SZ0 + SZ1) / 2);
    /* ขอบถนนด้านออก (เว้นช่องทางลาด) */
    vb.add(gBox(0.22, 0.30, apronZ0 - SZ0), CCURB, SX1 - 0.11, 0.0, (SZ0 + apronZ0) / 2);
    vb.add(gBox(0.22, 0.30, SZ1 - apronZ1), CCURB, SX1 - 0.11, 0.0, (apronZ1 + SZ1) / 2);
    /* ขอบลานด้านใต้/เหนือ (กันรถไหลออก) */
    vb.add(gBox(W, 0.22, 0.20), CCURB, X0 + W / 2, 0.0, Z0 + 0.10);
    vb.add(gBox(W, 0.22, 0.20), CCURB, X0 + W / 2, 0.0, Z1 - 0.10);

    var LY = 0.012;                  /* ความหนาเส้นสี */
    var LWD = 0.12;                  /* ความกว้างเส้นจอด (ตามสเปก) */
    var LINY = 0.011;                /* กึ่งกลางเส้น: ขอบล่าง 5 มม. จากผิวลาน กัน z-fight */
    /* เรืองจาง (aEmis) — สำคัญ: เงาของรถที่จอดทอดผ่านเส้น ทำให้เส้นหายไปถ้าไม่มีแสงของตัวเอง */
    var LEMIS = [0.36, 0.36, 0.32];
    function paintLine(w, len, x, z, opt) {
      opt = opt || {};
      opt.emis = LEMIS;
      vb.add(gBox(w, LY, len), CWHITE, x, LINY, z, opt);
    }
    /* เส้นกลางถนน (ประ) + เส้นขอบถนน */
    var dz;
    for (dz = SZ0 + 1.6; dz < SZ1 - 1.0; dz += 4.2) paintLine(LWD, 2.4, (SX0 + SX1) / 2, dz);
    paintLine(LWD, SZ1 - SZ0 - 1.0, SX0 + 0.45, (SZ0 + SZ1) / 2);
    paintLine(LWD, SZ1 - SZ0 - 1.0, SX1 - 0.45, (SZ0 + SZ1) / 2);

    /* เส้นช่องจอด: วาด "ครบทุกช่องทั้ง 2 แถว" (ยูรอบช่อง = ขอบ 2 ข้าง + หัวช่อง)
       ไม่ขึ้นกับว่าช่องนั้นมีรถจอดหรือไม่ · รวมอยู่ใน mesh เดียวของลาน (vertex color + aEmis) */
    (function () {
      var n, s, zEnd;
      for (n = 1; n <= NSLOT; n++) {
        s = SLOTS[n];
        paintLine(LWD, SD, s.x0, s.z);                   /* ขอบตะวันตกของช่อง */
        paintLine(LWD, SD, s.x1, s.z);                   /* ขอบตะวันออกของช่อง */
        zEnd = s.z + (s.row === 0 ? -(SD / 2 - 0.07) : (SD / 2 - 0.07));
        paintLine(SW - LWD, LWD, s.x, zEnd);             /* หัวช่อง (ด้านติดขอบลาน) */
      }
      paintLine(LWD, 4.6, SX0 - 0.35, aisleZ);           /* เส้นหยุดก่อนออกถนน */
    })();
    /* (ไม่มีแผ่นพื้นช่อง: ยึดผิวยางมะตอยเข้มเส้นเดียวกับลาน เพื่อให้เส้นขาวตัดชัดที่สุด) */
    /* ลูกศรบนทางวิ่ง (ชี้ตะวันตก = ทางเข้า) */
    [[44.0, 'w'], [48.5, 'w']].forEach(function (a) {
      var ax = a[0], s = a[1] === 'w' ? -1 : 1;
      paintLine(1.0, LWD, ax, aisleZ + 1.6);
      paintLine(0.5, LWD, ax + s * 0.28, aisleZ + 1.6 + 0.22, { ry: s * 0.5 });
      paintLine(0.5, LWD, ax + s * 0.28, aisleZ + 1.6 - 0.22, { ry: -s * 0.5 });
    });

    /* ป้าย P — สร้างในพิกัดโลคัล (บอร์ดหันหน้า +x) แล้วหมุน ry รอบจุดตั้งเสา */
    function pSign(px, pz, ry) {
      var c = Math.cos(ry), s = Math.sin(ry);
      function put(geo, col, lx, lyy, lz, o) {
        o = o || {};
        o.ry = (o.ry || 0) + ry;
        vb.add(geo, col, px + (lx * c + lz * s), lyy, pz + (-lx * s + lz * c), o);
      }
      put(gCyl(0.06, 0.06, 2.55, 8), CPOST, 0, 1.27, 0);
      put(gBox(0.10, 1.36, 1.06), CSIGN, 0, 2.06, 0, { emis: [0.30, 0.30, 0.28] });  /* บอร์ดขาว 2 หน้า (เรืองจาง ให้อ่านได้ทั้งสองด้าน) */
      [1, -1].forEach(function (d) {
        put(gBox(0.03, 0.90, 0.15), CBLUE, d * 0.06, 1.86, -d * 0.22);   /* stem */
        put(gBox(0.03, 0.14, 0.38), CBLUE, d * 0.06, 2.24, -d * 0.09);   /* top */
        put(gBox(0.03, 0.46, 0.15), CBLUE, d * 0.06, 2.01, d * 0.06);   /* right */
        put(gBox(0.03, 0.14, 0.38), CBLUE, d * 0.06, 1.78, -d * 0.09);   /* mid */
      });
    }
    pSign(X1 + 0.95, aisleZ + 3.60, 0);              /* ข้างไม้กั้น (หันหน้า ±x) */
    pSign(X0 + 1.60, Z0 + 0.95, Math.PI / 2);        /* มุมลานด้านใต้ (หันหน้า ±z เห็นจากกล้องมุมสูง) */

    /* ป้าย P ใหญ่ (เสา 4.4 ม.) ที่ขอบลานด้านเหนือ — หันหน้า ±z ให้เห็นชัดจากกล้องมุมสูง */
    (function () {
      var sx = X0 + 0.85, sz = Z1 - 0.85, ph = 4.40;
      var bw = 1.90, bh = 2.16, by = ph - 0.12 - bh / 2, S = 1.34;
      vb.add(gCyl(0.10, 0.13, ph, 12), CPOST, sx, ph / 2, sz);
      vb.add(gBox(bw, bh, 0.10), CSIGN, sx, by, sz, { emis: [0.42, 0.42, 0.39] });  /* บอร์ดขาว หน้า ±z (เรืองจาง) */
      vb.add(gBox(bw + 0.06, bh + 0.06, 0.04), CPOST, sx, by, sz);       /* กรอบหลังบอร์ด */
      [1, -1].forEach(function (d) {
        var fz = sz + d * 0.062;
        var gp = function (w, h, ux, uy) {
          vb.add(gBox(w * S, h * S, 0.03), CBLUE, sx + ux * S, by + uy * S, fz);
        };
        gp(0.20, 1.30, -0.38, 0.00);      /* stem */
        gp(0.76, 0.18, -0.02, 0.55);      /* top */
        gp(0.16, 0.45, 0.32, 0.325);      /* right */
        gp(0.72, 0.16, -0.04, 0.05);      /* mid */
      });
      vb.add(gBox(0.16, 0.36, 0.16), C(0xffe9b0), sx, ph + 0.16, sz, { emis: [0.9, 0.82, 0.5] });
    })();

    /* เสาไฟ 2 ต้น (ฝั่งอาคาร) + ดวงโคม (aEmis) */
    var LAMP = [{ x: X0 - 0.30, z: rowZ[0] }, { x: X0 - 0.30, z: rowZ[ROWS - 1] }];
    LAMP.forEach(function (L) {
      vb.add(gCyl(0.05, 0.075, 4.4, 8), CDARK, L.x, 2.2, L.z);
      vb.add(gBox(0.06, 0.06, 0.60), CDARK, L.x, 0.03, L.z);
      vb.add(gBox(0.52, 0.055, 0.10), CDARK, L.x + 0.26, 4.34, L.z);
      vb.add(gBox(0.80, 0.10, 0.28), CDARK, L.x + 0.56, 4.30, L.z);
      vb.add(gBox(0.68, 0.02, 0.22), C(0xfff1d6), L.x + 0.56, 4.24, L.z,
        { emis: [0.95, 0.82, 0.58] });
    });

    /* ต้นไม้ 4 + พุ่ม 5 (ด้านข้างลาน) */
    var tr = [[X0 + 4.5, Z0 + 0.95], [X0 + 13.5, Z0 + 0.95], [X0 + 4.5, Z1 - 0.95], [X0 + 13.5, Z1 - 0.95]];
    tr.forEach(function (t, i) {
      vb.add(gCyl(0.06, 0.10, 1.50, 8), CTRUNK, t[0], 0.75, t[1]);
      vb.add(gSph(0.62, 8, 6), CLEAF, t[0], 1.94, t[1]);
      vb.add(gSph(0.44, 7, 5), CLEAF2, t[0] + 0.26, 2.34, t[1] - 0.18);
    });
    [[X0 + 7.2, Z0 + 0.8], [X0 + 10.8, Z0 + 0.8], [X0 + 7.2, Z1 - 0.8],
      [X0 + 10.8, Z1 - 0.8], [X1 - 0.9, aisleZ - 4.4]].forEach(function (s) {
      vb.add(gSph(0.30, 6, 4), CSHRUB, s[0], 0.26, s[1]);
    });
    /* แปลงดินใต้ต้นไม้/พุ่ม (กันดูเหมือนลอย) */
    [[X0 + 4.5, Z0 + 0.95], [X0 + 13.5, Z0 + 0.95], [X0 + 4.5, Z1 - 0.95], [X0 + 13.5, Z1 - 0.95]].forEach(function (t) {
      vb.add(gBox(1.1, 0.06, 1.1), CGRND, t[0], 0.03, t[1]);
    });

    /* เสาไม้กั้น + ตู้คุม + เสารองปลายแขน (ให้เห็นชัดจากกล้องมุมสูง) */
    vb.add(gBox(0.46, 0.16, 0.46), CDARK, gateX, 0.08, gateZpost);                    /* ฐานเสา */
    vb.add(gCyl(0.11, 0.13, 1.42, 12), CPOST, gateX, 0.79, gateZpost);                /* เสา */
    vb.add(gBox(0.30, 0.12, 0.30), CRED, gateX, 1.44, gateZpost);                     /* หัวเสาแดง */
    vb.add(gBox(0.46, 1.05, 0.34), CPOST, gateX + 0.05, 0.52, gateZpost + 0.60);      /* ตู้ควบคุม */
    vb.add(gBox(0.34, 0.10, 0.24), C(0xffe9b0), gateX + 0.05, 1.06, gateZpost + 0.60,
      { emis: [0.85, 0.76, 0.46] });
    vb.add(gBox(0.40, 0.26, 0.03), CSIGN, gateX + 0.05, 0.80, gateZpost + 0.780);     /* ป้ายบนตู้ */
    vb.add(gBox(0.36, 0.10, 0.06), CRED, gateX + 0.05, 0.80, gateZpost + 0.795);

    function ly(h) { return h / 2 + 0.001; }

    var siteMesh = vb.mesh(matSite, 'parking:site');
    siteMesh.receiveShadow = true;

    var root = new THREE.Group();
    root.name = 'parking';
    root.add(siteMesh);

    /* ══════════════════ 6a) แขนไม้กั้น (mesh แยก เพราะต้องหมุน) ══════════════════ */
    var armVB = new VB();
    (function () {
      var seg = 5, segL = (ARM_LEN - 0.16) / seg, i;
      for (i = 0; i < seg; i++) {
        var zc = -0.16 - segL * (i + 0.5);
        /* แถบสะท้อนแสง: ขาว/แดง สลับ (เรืองจาง เพื่อให้เห็นชัดทั้งที่อยู่ในเงาและกล้องมุมสูง) */
        armVB.add(gBox(0.14, 0.17, segL - 0.004), C(i % 2 ? 0xd23a2c : 0xf2f4f6), 0, 0, zc,
          { emis: i % 2 ? [0.34, 0.05, 0.03] : [0.24, 0.24, 0.22] });
      }
      armVB.add(gCyl(0.13, 0.13, 0.17, 12), CPOST, 0, 0, -0.02, { rz: Math.PI / 2 });
      armVB.add(gBox(0.15, 0.19, 0.18), CRED, 0, 0, -ARM_LEN + 0.09, { emis: [0.34, 0.05, 0.03] });
      armVB.add(gBox(0.08, 0.09, 0.08), C(0xffe2a0), 0, 0.13, -ARM_LEN + 0.22, { emis: [0.9, 0.5, 0.3] });
    })();
    var armMesh = armVB.mesh(matCar, 'parking:gate-arm');
    armMesh.position.set(gateX, 1.02, gateZpost);
    root.add(armMesh);

    /* ══════════════════ 3) รถ: geometry ต่อ (สไตล์, สี) ══════════════════ */
    var STYLES = {
      sedan: { L: 4.55, W: 1.80, belt: 0.76, wr: 0.33, wz: 1.38, cabL: 2.15, cabZ: -0.28,
               glassH: 0.42, hoodL: 1.32, hoodZ: 1.44, trunkL: 0.96, rails: false, roofFrac: 0.56 },
      hatch: { L: 4.10, W: 1.76, belt: 0.78, wr: 0.32, wz: 1.24, cabL: 2.30, cabZ: -0.42,
               glassH: 0.44, hoodL: 1.06, hoodZ: 1.34, trunkL: 0.62, rails: false, roofFrac: 0.60 },
      suv:   { L: 4.72, W: 1.92, belt: 0.86, wr: 0.38, wz: 1.44, cabL: 2.55, cabZ: -0.44,
               glassH: 0.48, hoodL: 1.22, hoodZ: 1.52, trunkL: 0.70, rails: true, roofFrac: 0.62 }
    };
    var carGeos = {};
    function carGeo(styleKey, hex) {
      var key = styleKey + '|' + hex;
      if (carGeos[key]) return carGeos[key];
      var S = STYLES[styleKey] || STYLES.sedan;
      var v = new VB();
      var paint = C(hex), glass = C(0x1b2329), tire = C(0x141618), rim = C(0xb9bfc4);
      var dark = C(0x2b3036), plate = C(0xe4e6dc);
      var Wc = S.W, L = S.L, wr = S.wr, belt = S.belt, y0 = 0.24;
      var cabTop = belt + S.glassH;

      /* ตัวถังล่าง (ยาวเต็มคัน) */
      v.add(gBox(Wc, belt - y0, L - 0.06), paint, 0, (y0 + belt) / 2, 0);
      /* ฝากระโปรง + ฝาท้าย */
      v.add(gBox(Wc - 0.10, 0.09, S.hoodL), paint, 0, belt + 0.05, S.hoodZ, { rx: -0.05 });
      v.add(gBox(Wc - 0.12, 0.09, S.trunkL), paint, 0, belt + 0.05, -(L / 2 - S.trunkL / 2 - 0.06));
      /* ห้องโดยสาร: กระจกเข้มแถบรอบ + หลังคา + กระจกหน้า/หลังเอียง + เสา */
      var roofL = S.cabL * (S.roofFrac || 0.58), runH = (S.cabL - roofL) / 2;
      var wLen = Math.sqrt(runH * runH + S.glassH * S.glassH) + 0.03;
      var wAng = Math.atan2(runH, S.glassH);
      v.add(gBox(Wc - 0.20, S.glassH, roofL), glass, 0, belt + S.glassH / 2, S.cabZ);
      v.add(gBox(Wc - 0.30, 0.10, roofL), paint, 0, cabTop + 0.05, S.cabZ);
      v.add(gBox(Wc - 0.26, wLen, 0.06), glass, 0, belt + S.glassH / 2,
        S.cabZ + roofL / 2 + runH / 2, { rx: -wAng });
      v.add(gBox(Wc - 0.26, wLen, 0.06), glass, 0, belt + S.glassH / 2,
        S.cabZ - roofL / 2 - runH / 2, { rx: wAng });
      /* เสา A/C เอียงตามกระจก (สีตัวถัง) */
      [[S.cabZ + roofL / 2 + runH / 2, -wAng], [S.cabZ - roofL / 2 - runH / 2, wAng]].forEach(function (zz) {
        v.add(gBox(0.10, wLen, 0.10), paint, Wc / 2 - 0.13, belt + S.glassH / 2, zz[0], { rx: zz[1] });
        v.add(gBox(0.10, wLen, 0.10), paint, -(Wc / 2 - 0.13), belt + S.glassH / 2, zz[0], { rx: zz[1] });
      });
      /* กันชนหน้า/หลัง + กระจัง */
      v.add(gBox(Wc + 0.01, 0.21, 0.19), dark, 0, 0.42, L / 2 - 0.10);
      v.add(gBox(Wc + 0.01, 0.21, 0.19), dark, 0, 0.42, -L / 2 + 0.10);
      v.add(gBox(Wc - 0.55, 0.14, 0.05), dark, 0, belt - 0.13, L / 2 - 0.045);
      /* ไฟหน้า (ขาวนวล · aEmis) + ไฟท้าย (แดง · aEmis) */
      v.add(gBox(0.30, 0.13, 0.09), C(0xf6f0da), Wc / 2 - 0.26, belt - 0.09, L / 2 - 0.03,
        { emis: [0.80, 0.72, 0.50] });
      v.add(gBox(0.30, 0.13, 0.09), C(0xf6f0da), -(Wc / 2 - 0.26), belt - 0.09, L / 2 - 0.03,
        { emis: [0.80, 0.72, 0.50] });
      v.add(gBox(0.26, 0.12, 0.08), C(0xa8332a), Wc / 2 - 0.24, belt - 0.10, -L / 2 + 0.03,
        { emis: [0.70, 0.05, 0.03] });
      v.add(gBox(0.26, 0.12, 0.08), C(0xa8332a), -(Wc / 2 - 0.24), belt - 0.10, -L / 2 + 0.03,
        { emis: [0.70, 0.05, 0.03] });
      /* ป้ายทะเบียน + กระจกข้าง */
      v.add(gBox(0.34, 0.11, 0.02), plate, 0, 0.44, L / 2 + 0.035);
      v.add(gBox(0.34, 0.11, 0.02), plate, 0, 0.44, -L / 2 - 0.035);
      v.add(gBox(0.10, 0.08, 0.16), paint, Wc / 2 + 0.04, belt + 0.08, S.cabZ + S.cabL / 2 - 0.10);
      v.add(gBox(0.10, 0.08, 0.16), paint, -(Wc / 2 + 0.04), belt + 0.08, S.cabZ + S.cabL / 2 - 0.10);
      /* ราวหลังคา (บางรุ่น) */
      if (S.rails) {
        v.add(gBox(0.05, 0.06, roofL - 0.24), dark, Wc / 2 - 0.36, cabTop + 0.13, S.cabZ);
        v.add(gBox(0.05, 0.06, roofL - 0.24), dark, -(Wc / 2 - 0.36), cabTop + 0.13, S.cabZ);
      }
      /* ล้อ 4 + ยาง + ดุม */
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (s) {
        var wx = s[0] * (Wc / 2 - 0.12), wzp = s[1] * S.wz;
        v.add(gCyl(wr, wr, 0.24, 16), tire, wx, wr, wzp, { rz: Math.PI / 2 });
        v.add(gCyl(wr * 0.58, wr * 0.58, 0.256, 10), rim, wx, wr, wzp, { rz: Math.PI / 2 });
        v.add(gCyl(wr * 0.30, wr * 0.30, 0.262, 8), dark, wx, wr, wzp, { rz: Math.PI / 2 });
      });
      carGeos[key] = v.geo();
      return carGeos[key];
    }

    /* ══════════════════ 4) คลังรถ ══════════════════ */
    var cars = [], bySlot = {};
    var CAR_COLORS = {
      slot1: ['sedan', 0xe9edf0], slot2: ['hatch', 0xb23a33], slot3: ['suv', 0xb5b9bd],
      slot4: ['sedan', 0x27384f], slot5: ['hatch', 0x8fb0c4], slot6: ['suv', 0xe4e6e3],
      slot7: ['sedan', 0x3b4046], slot8: ['hatch', 0xc9c3b0], slot9: ['sedan', 0x1f2427],
      slot10: ['suv', 0x4a4f57], street1: ['sedan', 0x394046], street2: ['hatch', 0xa9583e]
    };

    function addCar(id, spec, slot) {
      var g = carGeo(spec[0], spec[1]);
      var m = new THREE.Mesh(g, matCar);
      m.name = 'car:' + id;
      m.castShadow = true;
      root.add(m);
      var car = {
        id: id, mesh: m, slot: slot, state: 'gone', pending: false,
        path: null, seg: 1, d: 0, speed: 2.3, turn: 2.4,
        x: 0, z: 0, yaw: 0, wait: 0, arrived: false
      };
      cars.push(car);
      if (slot) bySlot[slot] = car;
      return car;
    }
    function place(car) {
      car.mesh.position.set(car.x, 0, car.z);
      car.mesh.rotation.y = car.yaw;
    }

    /* รถในช่อง (คันละ 1 คัน ต่อช่อง 1..10) */
    (function () {
      for (var n = 1; n <= NSLOT; n++) {
        var id = 'slot' + n;
        var car = addCar(id, CAR_COLORS[id] || ['sedan', 0xdddddd], n);
        var s = SLOTS[n];
        car.x = s.x; car.z = s.z; car.yaw = s.yaw;
        car.state = 'gone'; car.mesh.visible = false;
        place(car);
      }
    })();

    /* รถวิ่งถนน 2 คัน (วนไป-กลับในถนน) */
    var LOOP = (function () {
      var ch = 1.15, zn = SZ0 + 1.6, zf = SZ1 - 1.6;
      return [
        { x: laneN, z: zn }, { x: laneN, z: zf - ch },
        { x: laneN + ch, z: zf }, { x: laneS - ch, z: zf },
        { x: laneS, z: zf - ch }, { x: laneS, z: zn + ch },
        { x: laneS - ch, z: zn }, { x: laneN + ch, z: zn }
      ];
    })();
    var LOOP_LEN = (function () {
      var t = 0, i, a, b;
      for (i = 0; i < LOOP.length; i++) {
        a = LOOP[i]; b = LOOP[(i + 1) % LOOP.length];
        t += Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
      }
      return t;
    })();

    var streetCars = [];
    [['street1', LOOP_LEN * 0.0], ['street2', LOOP_LEN * 0.5]].forEach(function (sc) {
      var car = addCar(sc[0], CAR_COLORS[sc[0]], null);
      car.state = 'street'; car.speed = 1.55; car.turn = 2.0;
      car.mesh.visible = true;
      car.path = LOOP; car.seg = 1; car.d = 0; car.yaw = 0;
      car.x = LOOP[0].x; car.z = LOOP[0].z;
      advance(car, sc[1] / car.speed + 0.0001, true);
      place(car);
      streetCars.push(car);
    });

    /* ══════════════════ 5) เส้นทางวิ่ง ══════════════════ */
    function entryPts(slot) {
      var pts = [];
      var startX = SX1 - 0.6;                        /* เริ่มจากเลนนอกของถนน */
      pts.push({ x: startX, z: aisleZ });
      pts.push({ x: gateX + 1.5, z: aisleZ });
      pts.push({ x: gateX - 1.5, z: aisleZ });
      var xt = Math.min(slot.x + 2.2, X1 - 1.2);
      if (xt > gateX - 2.0) pts.push({ x: xt, z: aisleZ });
      var sgn = slot.row === 0 ? -1 : 1;
      pts.push({ x: Math.max(slot.x + 0.95, xt - 0.9), z: aisleZ + sgn * 1.05 });
      pts.push({ x: slot.x + 0.20, z: aisleZ + sgn * 2.45 });
      pts.push({ x: slot.x, z: slot.z });
      return pts;
    }
    function exitPts(slot) {
      var sgn = slot.row === 0 ? 1 : -1;             /* ถอยออกคนละทาง (ตามที่หันหน้าเข้าไป) */
      var pts = [{ x: slot.x, z: slot.z }];
      pts.push({ x: slot.x, z: aisleZ + sgn * 0.35, back: true });
      pts.push({ x: slot.x + 0.35, z: aisleZ - sgn * 0.55 });
      pts.push({ x: slot.x + 1.35, z: aisleZ - sgn * 0.85 });
      pts.push({ x: slot.x + 2.55, z: aisleZ - sgn * 0.55 });
      pts.push({ x: slot.x + 3.75, z: aisleZ - sgn * 0.05 });
      pts.push({ x: gateX - 1.5, z: aisleZ });
      pts.push({ x: gateX + 1.5, z: aisleZ });
      pts.push({ x: SX1 + 3.0, z: aisleZ });
      return pts;
    }

    /* เดินตามเส้นทาง (closed = วน) · รองรับถอยหลัง (จุดมี back:true) */
    function advance(car, dt, closed) {
      var pts = car.path;
      if (!pts || pts.length < 2) return;
      var n = pts.length, remain = car.speed * dt, guard = 0;
      while (remain > 1e-6 && guard++ < 64) {
        var i = car.seg;
        if (i >= n) {
          if (closed) { car.seg = 1; car.d = 0; i = 1; }
          else { car.arrived = true; break; }
        }
        var a = pts[i - 1], b = pts[i];
        var dx = b.x - a.x, dz = b.z - a.z;
        var len = Math.sqrt(dx * dx + dz * dz) || 1e-4;
        var left = len - car.d;
        if (remain < left) { car.d += remain; remain = 0; }
        else { remain -= left; car.d = 0; car.seg = i + 1; }
      }
      var idx = car.seg >= n ? n - 1 : car.seg;
      if (idx < 1) idx = 1;
      var a2 = pts[idx - 1], b2 = pts[idx];
      var dx2 = b2.x - a2.x, dz2 = b2.z - a2.z;
      var l2 = Math.sqrt(dx2 * dx2 + dz2 * dz2) || 1e-4;
      var f = clamp(car.d / l2, 0, 1);
      car.x = a2.x + dx2 * f; car.z = a2.z + dz2 * f;
      if (!closed && car.seg >= n) { car.x = pts[n - 1].x; car.z = pts[n - 1].z; }
      var tgt = Math.atan2(dx2, dz2) + (b2.back ? Math.PI : 0);
      car.yaw = angTo(car.yaw, tgt, car.turn * dt);
    }

    function startEntry(car) {
      var slot = SLOTS[car.slot];
      if (!slot) return;
      car.path = entryPts(slot);
      car.seg = 1; car.d = 0; car.arrived = false;
      car.speed = 2.30; car.turn = 2.4;
      car.x = car.path[0].x; car.z = car.path[0].z;
      car.yaw = -Math.PI / 2;
      car.state = 'entering';
      car.mesh.visible = true;
      place(car);
    }
    function startExit(car) {
      var slot = SLOTS[car.slot];
      if (!slot) return;
      car.path = exitPts(slot);
      car.seg = 1; car.d = 0; car.arrived = false;
      car.speed = 1.85; car.turn = 2.2;
      car.x = slot.x; car.z = slot.z; car.yaw = slot.yaw;
      car.state = 'leaving';
      car.mesh.visible = true;
      place(car);
    }

    /* ══════════════════ 7) สถานะ/สัญญาณ/ไม้กั้น ══════════════════ */
    var st = { gateHold: false, gateOpen: 0, free: 0 };
    var colliders = [];
    if (U) {
      colliders.push(U.collider(gateX - 0.23, gateZpost - 0.23, gateX + 0.23, gateZpost + 0.23, 0, 1.6));
      colliders.push(U.collider(gateX - 0.20, gateZpost + 0.41, gateX + 0.29, gateZpost + 0.79, 0, 1.1));
      colliders.push(U.collider(X1 + 0.85, aisleZ + 3.50, X1 + 1.05, aisleZ + 3.70, 0, 2.6));
      colliders.push(U.collider(X0 + 1.50, Z0 + 0.85, X0 + 1.70, Z0 + 1.05, 0, 2.6));
      LAMP.forEach(function (L) {
        colliders.push(U.collider(L.x - 0.12, L.z - 0.12, L.x + 0.12, L.z + 0.12, 0, 4.4));
      });
    }
    /* collider ตัวรถที่จอด (อัปเดต y1 ตามสถานะ — ของว่างจะถูก walk ข้าม) */
    var carCols = {};
    (function () {
      for (var n = 1; n <= NSLOT; n++) {
        var s = SLOTS[n];
        var cc = U ? U.collider(s.x - 0.95, s.z - 2.30, s.x + 0.95, s.z + 2.30, 0, 0)
          : { x0: s.x - 0.95, z0: s.z - 2.30, x1: s.x + 0.95, z1: s.z + 2.30, y0: 0, y1: 0 };
        carCols[n] = cc;
        colliders.push(cc);
      }
    })();

    function setColliderState(n) {
      var car = bySlot[n], cc = carCols[n];
      if (!cc) return;
      if (car && car.state === 'parked') { cc.y1 = 1.45; cc.y0 = 0; }
      else { cc.y0 = 0; cc.y1 = 0; }
    }

    function applySlot(n, on) {
      var car = bySlot[n];
      if (!car) return;
      car.pending = !!on;
      if (car.pending && car.state === 'gone') car.wait = 0.35 + Math.random() * 1.1;
      if (!car.pending && car.state === 'parked') startExit(car);
      setColliderState(n);
    }
    function setOccupied(n, on) {
      var path = '/parking/slot/' + n + '/occupied';
      if (sig && sig.set) sig.set(path, !!on);
      applySlot(n, !!on);
    }
    function setGate(on) { st.gateHold = !!on; if (sig && sig.set) sig.set('/parking/gate', !!on); }

    /* ค่าเริ่มต้น: อ่านจากสัญญาณถ้ามี ไม่งั้น fallback = 6 คันจอด */
    (function () {
      for (var n = 1; n <= NSLOT; n++) {
        var v = sig && sig.get ? sig.get('/parking/slot/' + n + '/occupied') : undefined;
        var on = (v === undefined || v === null) ? (n <= 6) : !!v;
        var car = bySlot[n], s = SLOTS[n];
        car.pending = on;
        car.state = on ? 'parked' : 'gone';
        car.mesh.visible = on;
        car.x = s.x; car.z = s.z; car.yaw = s.yaw;
        place(car);
        setColliderState(n);
      }
      if (sig && sig.get && sig.get('/parking/gate') !== undefined) st.gateHold = !!sig.get('/parking/gate');
    })();

    if (sig && sig.subscribe) {
      sig.subscribe(function (path, value) {
        if (!path) return;
        var m = /\/parking\/slot\/(\d+)\/occupied$/.exec(path);
        if (m) applySlot(parseInt(m[1], 10), !!value);
        else if (/\/parking\/gate$/.test(path)) st.gateHold = !!value;
        else if (/\/parking\/free$/.test(path)) st.free = +value || 0;
      });
    }

    /* ไม่ให้รถเข้าถนนตอนมีรถวิ่งผ่านหน้าทางเข้า (กันทับกัน) */
    function clearToEnter() {
      for (var i = 0; i < streetCars.length; i++) {
        var c = streetCars[i];
        if (c.z > aisleZ - 3.6 && c.z < aisleZ + 3.6 && c.x > SX0 - 1.0 && c.x < SX1 + 1.0) return false;
      }
      return true;
    }

    function update(dt) {
      if (!(dt > 0)) dt = 0.016;
      if (dt > 0.06) dt = 0.06;
      var i, car, n;

      /* ไม้กั้น: ยกเมื่อมีรถใกล้ หรือถูกสั่งค้างยก */
      var near = false;
      for (i = 0; i < cars.length; i++) {
        car = cars[i];
        if (car.slot === null || car.state === 'gone' || car.state === 'parked') continue;
        if (Math.abs(car.x - gateX) < 6.0 && Math.abs(car.z - aisleZ) < 2.6) near = true;
      }
      var goal = (st.gateHold || near) ? 1 : 0;
      st.gateOpen += (goal - st.gateOpen) * Math.min(1, dt * (st.gateHold ? 5.0 : 3.6));
      if (st.gateOpen < 0.004) st.gateOpen = 0;
      if (st.gateOpen > 0.995) st.gateOpen = 1;
      armMesh.rotation.x = st.gateOpen * 0.889 * (Math.PI / 2);   /* ยกขึ้น ~80° (rotation.x = เงยขึ้นฟ้า) */
      var gateReady = st.gateOpen > 0.66;

      /* รถวิ่งถนน */
      for (i = 0; i < streetCars.length; i++) {
        car = streetCars[i];
        advance(car, dt, true);
        place(car);
      }

      /* รถในช่อง */
      for (i = 0; i < NSLOT; i++) {
        car = bySlot[i + 1];
        if (!car) continue;
        if (car.state === 'gone') {
          if (car.pending) {
            car.wait -= dt;
            if (car.wait <= 0 && clearToEnter()) startEntry(car);
          }
          continue;
        }
        if (car.state === 'parked') {
          if (!car.pending) startExit(car);
          continue;
        }
        /* หยุดรอไม้กั้นถ้ากำลังจะผ่านและยังยกไม่พอ */
        var atGate = Math.abs(car.x - gateX) < 2.2 && Math.abs(car.z - aisleZ) < 2.0;
        if (atGate && !gateReady) { place(car); continue; }

        advance(car, dt, false);
        place(car);
        if (car.arrived) {
          car.arrived = false;
          if (car.state === 'entering') {
            car.state = 'parked'; car.mesh.visible = true;
            if (!car.pending) startExit(car);
          } else if (car.state === 'leaving') {
            car.state = 'gone'; car.mesh.visible = false;
            if (car.pending) { car.wait = 0.6 + Math.random() * 1.2; }
          }
        }
        setColliderState(car.slot);
      }
      return st;
    }

    /* ══════════════════ 8) คืนค่า ══════════════════ */
    root.updateMatrixWorld(true);
    var stats = { tris: 0, meshes: 0 };
    root.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      var g = o.geometry;
      var cnt = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0);
      stats.tris += Math.round(cnt / 3);
      if (o.visible) stats.meshes++;
    });
    stats.cars = cars.length;
    stats.parked = (function () {
      var k = 0, j;
      for (j = 1; j <= NSLOT; j++) if (bySlot[j] && bySlot[j].state === 'parked') k++;
      return k;
    })();

    var hooks = {
      update: update,
      setOccupied: setOccupied,
      setGate: setGate,
      state: function () { return st; },
      getColliders: function () { return colliders; },
      cars: function () { return cars; }
    };

    var meta = {
      lot: { x0: X0, z0: Z0, x1: X1, z1: Z1 },
      aisle: { z: aisleZ, w: AISLE_W, from: aisleZ - AISLE_W / 2, to: aisleZ + AISLE_W / 2 },
      slots: SLOTS, aisleZ: aisleZ,
      gate: { x: gateX, z: gateZpost, post: gateZpost },
      street: { x0: SX0, x1: SX1, z0: SZ0, z1: SZ1, lanes: [laneN, laneS] },
      apron: { x0: X1, x1: SX0, z0: apronZ0, z1: apronZ1 },
      fallbackParked: 6
    };

    return { group: root, colliders: colliders, hooks: hooks, cars: cars, meta: meta, stats: stats };
  }

  O.parking = { build: build, VERSION: 'v2' };
})();
