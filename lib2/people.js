/* =============================================================================
   office3d/v2/lib2/people.js — คนในออฟฟิศที่ "เดินจริง / นั่งจริง" (v2)
   -----------------------------------------------------------------------------
   API:  window.O3D2.people = { build(ctx) }
        → { group, colliders: [], hooks: { update(dt), dispose() }, people: [...] }

   สัญญาณที่อ่าน (ctx.signals):
     /meeting/<roomId>/count   → จำนวนคนที่นั่งในห้องนั้น
     /meeting/<roomId>/state   → 'busy' | 'free' | 'soon'  (busy + count 0 → คนยืนรอหน้าห้อง 2 คน)
     /lights/<roomId>          → false + ไม่มีการจอง = ไม่มีคนนั่ง (ห้องมืด)

   หลักการ
   · geometry สร้างครั้งเดียว 8 ชิ้น + InstancedMesh 8 ก้อน → 8 draw call ทั้งหมด (ไม่ว่ากี่คน)
     สีผิว/เสื้อ/กางเกง/ผม/รองเท้า = instanceColor (คนละสีต่อคน, ไม่ต้องมี material ต่อคน)
   · อนิเมชัน FK ต่อเฟรม: สะโพก/เข่า/ข้อเท้า/ไหล่/ศอก + sin ตามเวลาที่เดิน (ขาแกว่ง แขนสวน ตัวโยก)
     ความสูงสะโพกคำนวณจาก "ขาที่ยาวที่สุด" ทุกเฟรม → เท้าติดพื้นเสมอ (ยืน/เดิน/นั่ง ไม่ลอยไม่จม)
   · นั่ง = lerp pose (สะโพก −90°, เข่า +90°) ไม่กระตุก, ความสูงสะโพกลดเองตามสูตรเดียวกัน
   · หลบผนัง/เฟอร์นิเจอร์: waypoint ตามประตูห้อง + router เลี่ยงกล่อง obstacle
     (Dijkstra บนมุมกล่อง + string-pull) → ไม่เดินทะลุผนัง/โต๊ะประชุม, เข้าห้องทางประตูจริง
     เก้าอี้ในห้องคำนวณจากสูตรเดียวกับ furniture-meeting.js (meeting + training)
   · ไม่ใส่ collider (ไม่บล็อกทางเดินของโหมด walk)
   ============================================================================= */
(function () {
  var O = window.O3D2 = window.O3D2 || {};
  var THREE = window.THREE;
  if (!THREE) return;
  var PI = Math.PI, TAU = PI * 2;

  /* ---------------- ขนาดคน (เมตร, ต้นขา/น่อง/ช่วงตัว) ---------------- */
  var B = {
    hip: 0.95,        /* สูงสะโพกตอนยืนตรง (คำนวณซ้ำทุกเฟรมจากขา) */
    thigh: 0.46, shin: 0.44, foot: 0.05,   /* foot = ข้อเท้าถึงพื้น */
    torso: 0.53,      /* สะโพก → ไหล่บน */
    shX: 0.195, shY: 0.455,                /* ไหล่ (จากสะโพก) */
    upArm: 0.28, foreArm: 0.30,
    headPivot: 0.53, headOff: 0.115,       /* จากสะโพก (neck 0..0.10 → หัว center +0.115) */
    hipX: 0.10,
    sitHip: 0.49      /* = foot + shin (ท่าสะโพก −90°) เก้าอี้สูง 0.475 */
  };

  /* ---------------- geometry (ครั้งเดียว ใช้ร่วมทุกคน) ---------------- */
  function mergeGeos(list) {
    var pos = [], nor = [], i, j, k, g, ng, a, b;
    for (i = 0; i < list.length; i++) {
      g = list[i];
      ng = g.index ? g.toNonIndexed() : g;
      a = ng.attributes.position.array;
      for (j = 0; j < a.length; j++) pos.push(a[j]);
      b = ng.attributes.normal ? ng.attributes.normal.array : null;
      if (b) for (k = 0; k < b.length; k++) nor.push(b[k]);
      ng.dispose && ng !== g && ng.dispose();
      g.dispose && g.dispose();
    }
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (nor.length === pos.length) out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.computeBoundingSphere();
    return out;
  }
  function bx(w, h, d, x, y, z) {
    var g = new THREE.BoxGeometry(w, h, d);
    g.translate(x || 0, y || 0, z || 0);
    return g;
  }

  /* ทุกชิ้น: จุดกำเนิด (origin) อยู่ที่ "ปลายท่อนที่ติดข้อต่อ" และ geometry ยื่นขึ้น (+y)
     → local bbox y ≥ 0 ทุกชิ้น (ตัวตรวจ bbox ไม่เห็นค่าติดลบ = ไม่มีอะไรจมใต้พื้น)
     ตัวคูณ (instance matrix) เป็นตัววางท่อนลงจากข้อต่อ (ดู updateInstances) */
  var GEO = {
    torso: mergeGeos([bx(0.36, 0.30, 0.215, 0, 0.38, 0), bx(0.32, 0.24, 0.20, 0, 0.12, 0)]),   /* y 0..0.53 */
    head: mergeGeos([bx(0.10, 0.10, 0.10, 0, 0.05, 0),                                          /* neck 0..0.10 */
                     bx(0, 0, 0, 0, 0, 0)]),                                                    /* placeholder (แทนที่ด้านล่าง) */
    hair: null,
    thigh: bx(0.155, B.thigh, 0.165, 0, B.thigh / 2, 0),      /* y 0..0.46 (origin = ปลายเข่า) */
    shin: bx(0.13, B.shin, 0.14, 0, B.shin / 2, 0),           /* y 0..0.44 (origin = ปลายข้อเท้า) */
    shoe: bx(0.115, 0.06, 0.26, 0, 0.03, 0.045),              /* y 0..0.06 (origin = พื้นใต้ฝ่าเท้า) */
    sleeve: bx(0.10, B.upArm, 0.115, 0, B.upArm / 2, 0),      /* y 0..0.28 (origin = ปลายศอก) */
    fore: bx(0.085, B.foreArm, 0.09, 0, B.foreArm / 2, 0)     /* y 0..0.30 (origin = ปลายมือ) */
  };
  (function () {
    var sph = new THREE.SphereGeometry(0.11, 6, 3);
    sph.translate(0, B.headOff, 0);                            /* หัว center +0.115, bbox 0.005..0.225 */
    GEO.head = mergeGeos([sph, bx(0.10, 0.10, 0.10, 0, 0.05, 0)]);
    var cap = new THREE.SphereGeometry(0.117, 6, 2, 0, TAU, 0, 1.35);
    cap.translate(0, 0.117, -0.032);                           /* bbox y 0.143..0.234 (≥ 0) */
    GEO.hair = cap;
  })();

  /* ยกทุกชิ้นขึ้น 1 มม. → bbox min = +0.001 (ไม่มีค่าติดลบเลยแม้แต่ -0.00 จาก float32) */
  (function () {
    for (var k in GEO) if (GEO[k] && GEO[k].translate && k !== 'shoe') GEO[k].translate(0, 0.001, 0);
    /* shoe: ฝ่าเท้า y = 0 เป๊ะ (ไม่ยก) → เท้าติดพื้น */
  })();

  /* 8 ชิ้น · per = จำนวน instance ต่อคน · col = คีย์สี */
  var SLOTS = [
    { k: 'torso', g: GEO.torso, per: 1, col: 'shirt', shadow: true },
    { k: 'head', g: GEO.head, per: 1, col: 'skin', shadow: true },
    { k: 'hair', g: GEO.hair, per: 1, col: 'hair', shadow: false },
    { k: 'thigh', g: GEO.thigh, per: 2, col: 'pants', shadow: true },
    { k: 'shin', g: GEO.shin, per: 2, col: 'pants', shadow: false },
    { k: 'shoe', g: GEO.shoe, per: 2, col: 'shoe', shadow: false },
    { k: 'sleeve', g: GEO.sleeve, per: 2, col: 'shirt', shadow: false },
    { k: 'fore', g: GEO.fore, per: 2, col: 'skin', shadow: false }
  ];

  /* ---------------- สี (ดึงจากลิสต์วัสดุของโปรเจกต์ + เฉดผิว/ผม) ---------------- */
  var C_SKIN = ['#e8b898', '#d8a179', '#c1885f', '#9a6b4a', '#f0cbb0'];
  var C_SHIRT = ['#3a4d66', '#8a939c', '#ded8cb', '#5f6c79', '#a37a52', '#6b7a8c', '#b8c2cc', '#6f8a74'];
  var C_PANTS = ['#252a31', '#3a414a', '#4a4238', '#1f2226', '#565d66', '#2e3843'];
  var C_HAIR = ['#1c1a18', '#2b2019', '#443024', '#5c5c60', '#c9b088'];
  var C_SHOE = ['#16181b', '#2e241c', '#2a2a2a', '#3b3b3f'];

  /* =============================================================================
     เก้าอี้ในห้องประชุม/อบรม — สูตรเดียวกับ furniture-meeting.js (ไม่เรียกโมดูลซ้ำ)
     ============================================================================= */
  var IN = 0.06;
  function wallList(room, plan) {
    var bld = plan.building || { x: 0, z: 0, w: 34, d: 22 };
    return [
      { key: 'x0', inner: room.x + IN, normal: 1, axis: 'x', ext: Math.abs(room.x - bld.x) < 0.03, from: room.z + IN, to: room.z + room.d - IN },
      { key: 'x1', inner: room.x + room.w - IN, normal: -1, axis: 'x', ext: Math.abs(room.x + room.w - (bld.x + bld.w)) < 0.03, from: room.z + IN, to: room.z + room.d - IN },
      { key: 'z0', inner: room.z + IN, normal: 1, axis: 'z', ext: Math.abs(room.z - bld.z) < 0.03, from: room.x + IN, to: room.x + room.w - IN },
      { key: 'z1', inner: room.z + room.d - IN, normal: -1, axis: 'z', ext: Math.abs(room.z + room.d - (bld.z + bld.d)) < 0.03, from: room.x + IN, to: room.x + room.w - IN }
    ];
  }
  function winOverlap(W, plan) {
    if (!W.ext) return 0;
    var ov = 0;
    (plan.windows || []).forEach(function (w) {
      if (w.side !== W.key) return;
      var a = Math.max(w.from, W.from), b = Math.min(w.to, W.to);
      if (b - a > 0.02) ov += (b - a);
    });
    return ov;
  }
  function pickWall(walls, room, plan, opt) {
    opt = opt || {};
    var best = null, bestS = 1e9;
    walls.forEach(function (w) {
      var s = 0, ov = winOverlap(w, plan);
      if (ov > 0) s += 900 + ov * 50;
      if (room.glass && room.glass.indexOf(w.key) >= 0) s += 400;
      if (room.door && room.door.side === w.key) s += 300;
      if (opt.depthMin) { var ld = (w.axis === 'x') ? room.w : room.d; if (ld < opt.depthMin) s += 6000; }
      if (opt.spanMin) { var sd = (w.axis === 'x') ? room.d : room.w; if (sd < opt.spanMin) s += 6000; }
      if (s < bestS) { bestS = s; best = w; }
    });
    return best;
  }
  function rectFromPoints(x0, z0, x1, z1) {
    return { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) };
  }

  /* meeting: โต๊ะ stadium ตั้งฉากผนังจอ + เก้าอี้สองข้าง (cap) */
  function meetingSeats(room, plan) {
    var walls = wallList(room, plan);
    var cap = Math.min(10, Math.max(4, room.cap || 8));
    var perSide = Math.ceil(cap / 2), perSideB = cap - perSide;
    var L = Math.max(2.6, perSide * 0.80 + 0.60);
    var W = cap >= 8 ? 1.46 : 1.34;
    var CH = W / 2 + 0.20;
    var wall = pickWall(walls, room, plan, { depthMin: L + 2.0, spanMin: W + 2.6 });
    var nrm = wall.normal, axisX = wall.axis === 'x';
    var spanC = axisX ? room.z + room.d / 2 : room.x + room.w / 2;
    var tabEnd = wall.inner + nrm * 1.10;
    var tX = axisX ? tabEnd + nrm * L / 2 : spanC;
    var tZ = axisX ? spanC : tabEnd + nrm * L / 2;
    var yaw = axisX ? (nrm > 0 ? 0 : PI) : (nrm > 0 ? -PI / 2 : PI / 2);
    var ax = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    var pv = { x: Math.sin(yaw), z: Math.cos(yaw) };
    var seats = [], span = L - 0.84, i, o;
    function offs(n) {
      var list = [];
      if (n <= 1) return [0];
      for (i = 0; i < n; i++) list.push(-span / 2 + span * i / (n - 1));
      return list;
    }
    offs(perSide).forEach(function (q) { seats.push({ off: q, side: -1 }); });
    offs(perSideB).forEach(function (q) { seats.push({ off: q, side: 1 }); });
    var out = [];
    seats.forEach(function (s) {
      var fx = -pv.x * s.side, fz = -pv.z * s.side;      /* หน้าคน = เข้าหาโต๊ะ */
      out.push({
        x: tX + ax.x * s.off + pv.x * s.side * CH,
        z: tZ + ax.z * s.off + pv.z * s.side * CH,
        fx: fx, fz: fz, yaw: Math.atan2(fx, fz)
      });
    });
    var hu = L / 2, hv = CH + 0.28;                      /* โต๊ะ + เก้าอี้ (ครึ่งกล่อง) */
    var blocks = [rectFromPoints(
      tX - Math.abs(ax.x) * hu - Math.abs(pv.x) * hv, tZ - Math.abs(ax.z) * hu - Math.abs(pv.z) * hv,
      tX + Math.abs(ax.x) * hu + Math.abs(pv.x) * hv, tZ + Math.abs(ax.z) * hu + Math.abs(pv.z) * hv)];
    return { seats: out, rects: blocks, wall: wall.key };
  }

  /* training: โต๊ะเรียน 2 แถว × เก้าอี้ (cap) */
  function trainingSeats(room, plan) {
    var walls = wallList(room, plan);
    var cap = Math.min(16, Math.max(6, room.cap || 12));
    var seatsPerRow = Math.min(6, Math.ceil(cap / 2));
    var rows = Math.max(2, Math.ceil(cap / seatsPerRow));
    var tablesPerRow = Math.ceil(seatsPerRow / 3);
    var perTable = Math.ceil(seatsPerRow / tablesPerRow);
    var tLen = perTable * 0.80 + 0.20;
    var rowPitch = 2.20;
    var depthNeed = 1.60 + (rows - 1) * rowPitch + 1.6;
    var wall = pickWall(walls, room, plan, { depthMin: depthNeed, spanMin: tablesPerRow * tLen + 1.4 });
    var nrm = wall.normal, axisX = wall.axis === 'x';
    var spanC = axisX ? room.z + room.d / 2 : room.x + room.w / 2;
    function WP(nOff, sAbs) { return axisX ? { x: wall.inner + nrm * nOff, z: sAbs } : { x: sAbs, z: wall.inner + nrm * nOff }; }
    var chairYaw = Math.atan2(axisX ? -nrm : 0, axisX ? 0 : -nrm);
    var fx = Math.sin(chairYaw), fz = Math.cos(chairYaw);
    var rowLen = tablesPerRow * tLen + (tablesPerRow - 1) * 0.10;
    var out = [], rects = [], i, r;
    for (i = 0; i < rows; i++) {
      var deskC = 1.60 + 0.275 + i * rowPitch;
      var chairC = deskC + 0.475;
      var c0 = WP(deskC - 0.30, spanC - rowLen / 2 - 0.30);
      var c1 = WP(chairC + 0.32, spanC + rowLen / 2 + 0.30);
      rects.push(rectFromPoints(c0.x, c0.z, c1.x, c1.z));
      for (r = 0; r < seatsPerRow; r++) {
        var usable = rowLen - 0.90;
        var so = seatsPerRow > 1 ? (-usable / 2 + usable * r / (seatsPerRow - 1)) : 0;
        var cp = WP(chairC, spanC + so);
        out.push({ x: cp.x, z: cp.z, fx: fx, fz: fz, yaw: chairYaw });
      }
    }
    return { seats: out, rects: rects, wall: wall.key };
  }

  /* =============================================================================
     router 2D เลี่ยงกล่อง (Dijkstra บนมุมกล่อง + string-pull) — เรียกเฉพาะตอนจองที่เท่านั้น
     ============================================================================= */
  function segHitsRect(ax, az, bx, bz, r) {
    var dx = bx - ax, dz = bz - az, t0 = 0, t1 = 1, t, i;
    var P = [-dx, dx, -dz, dz], Q = [ax - r.x0, r.x1 - ax, az - r.z0, r.z1 - az];
    for (i = 0; i < 4; i++) {
      if (Math.abs(P[i]) < 1e-9) { if (Q[i] < 0) return false; }
      else {
        t = Q[i] / P[i];
        if (P[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
        else { if (t < t0) return false; if (t < t1) t1 = t; }
      }
    }
    return true;
  }
  function segFree(ax, az, bx, bz, rects) {
    for (var i = 0; i < rects.length; i++) if (segHitsRect(ax, az, bx, bz, rects[i])) return false;
    return true;
  }
  function route(ax, az, bx, bz, rects) {
    if (segFree(ax, az, bx, bz, rects)) return [];
    var nodes = [{ x: ax, z: az }, { x: bx, z: bz }], i, k, r;
    for (i = 0; i < rects.length; i++) {
      r = rects[i];
      nodes.push({ x: r.x0, z: r.z0 }, { x: r.x1, z: r.z0 }, { x: r.x0, z: r.z1 }, { x: r.x1, z: r.z1 });
    }
    var N = nodes.length, dist = [], prev = [], done = [];
    for (i = 0; i < N; i++) { dist.push(1e9); prev.push(-1); done.push(false); }
    dist[0] = 0;
    for (k = 0; k < N; k++) {
      var u = -1, best = 1e9;
      for (i = 0; i < N; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
      if (u < 0) break;
      if (u === 1) break;
      done[u] = true;
      for (i = 0; i < N; i++) {
        if (done[i] || i === u) continue;
        if (!segFree(nodes[u].x, nodes[u].z, nodes[i].x, nodes[i].z, rects)) continue;
        var d = dist[u] + Math.sqrt(Math.pow(nodes[i].x - nodes[u].x, 2) + Math.pow(nodes[i].z - nodes[u].z, 2));
        if (d < dist[i]) { dist[i] = d; prev[i] = u; }
      }
    }
    if (dist[1] >= 1e9) return [];                        /* หาไม่เจอ → ตรงไป */
    var chain = [], cur = 1;
    while (cur !== -1) { chain.unshift(cur); cur = prev[cur]; }
    chain.shift();                                        /* ตัดจุดเริ่ม */
    var pts = [];
    for (i = 0; i < chain.length; i++) pts.push({ x: nodes[chain[i]].x, z: nodes[chain[i]].z });
    /* string-pull: ตัดจุดกลางที่มองเห็นกันตรง ๆ ออก */
    var outp = [], q = { x: ax, z: az }, idx = 0;
    while (idx < pts.length) {
      var far = idx;
      for (k = pts.length - 1; k > idx; k--) {
        if (segFree(q.x, q.z, pts[k].x, pts[k].z, rects)) { far = k; break; }
      }
      outp.push(pts[far]);
      q = pts[far];
      idx = far + 1;
    }
    return outp;
  }

  /* =============================================================================
     build
     ============================================================================= */
  function build(ctx) {
    var plan = (ctx && ctx.plan) || window.OFFICE2 || { rooms: [] };
    var U = (ctx && ctx.util) || O.util;
    var MATS = (ctx && ctx.mats) || O.mats;
    var sig = (ctx && ctx.signals) || null;
    var cfg = plan.people || {};
    var MAX = Math.min(20, Math.max(1, cfg.max || 14));
    var SPEED = cfg.walkSpeed || 1.15;
    var LANE_A = 10.25, LANE_B = 11.75;                 /* สองเลนในโถง (สลับทิศ) */
    var RESERVE = MAX >= 6 ? 2 : 1;                     /* เก็บคนเดินในโถงไว้เสมอ */
    var WALL_HALF = 0.06;                               /* ครึ่งความหนาผนังภายใน */
    var PR = 0.24;                                      /* รัศมีคนสำหรับ router */

    var group = new THREE.Group();
    group.name = 'people';
    group.userData.bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
    group.userData.people = 0; group.userData.instances = 0;

    /* ---- material + InstancedMesh 8 ก้อน ---- */
    var pmat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0.0 });
    pmat.name = 'people.base';
    var inst = {}, i, s;
    for (i = 0; i < SLOTS.length; i++) {
      s = SLOTS[i];
      var im = new THREE.InstancedMesh(s.g, pmat, MAX * s.per);
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = false;                    /* ห้ามลง shadow map (lighting เบกครั้งเดียว → เงาจะค้าง) */
      im.receiveShadow = false;
      im.name = 'people.' + s.k;
      im.userData.noShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(im);
      inst[s.k] = im;
    }
    var seedRnd = U && U.rnd ? U.rnd(7) : (function () { var x = 1; return function () { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; }; })();
    var PAL = [];
    var _col = new THREE.Color();
    function paintAll() {
      var p, sl, k, base;
      for (p = 0; p < MAX; p++) {
        var pal = {
          skin: C_SKIN[p % C_SKIN.length],
          shirt: C_SHIRT[(p * 3 + 1) % C_SHIRT.length],
          pants: C_PANTS[(p * 2) % C_PANTS.length],
          hair: C_HAIR[(p * 3) % C_HAIR.length],
          shoe: C_SHOE[p % C_SHOE.length],
          s: 0.93 + seedRnd() * 0.14,
          spd: 0.9 + seedRnd() * 0.22
        };
        PAL.push(pal);
        for (var si = 0; si < SLOTS.length; si++) {
          sl = SLOTS[si];
          base = p * sl.per;
          _col.set(pal[sl.col]);
          for (k = 0; k < sl.per; k++) inst[sl.k].setColorAt(base + k, _col);
        }
      }
      for (var si2 = 0; si2 < SLOTS.length; si2++) if (inst[SLOTS[si2].k].instanceColor) inst[SLOTS[si2].k].instanceColor.needsUpdate = true;
    }
    /* ---- เงาแต้มใต้เท้า (contact shadow) — InstancedMesh 1 ก้อน ขยับตามคนทุกเฟรม ---- */
    var shadowMesh;
    (function () {
      var cv = document.createElement('canvas');
      cv.width = 64; cv.height = 64;
      var g2 = cv.getContext('2d');
      var grd = g2.createRadialGradient(32, 32, 1, 32, 32, 31);
      grd.addColorStop(0, 'rgba(0,0,0,0.98)');
      grd.addColorStop(0.45, 'rgba(0,0,0,0.55)');
      grd.addColorStop(0.72, 'rgba(0,0,0,0.22)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g2.fillStyle = grd;
      g2.beginPath(); g2.arc(32, 32, 31, 0, TAU); g2.fill();
      var tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      var geo = new THREE.PlaneGeometry(0.92, 0.54);
      geo.rotateX(-PI / 2);                                   /* ราบกับพื้น */
      var mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.36,
        depthWrite: false, toneMapped: false });
      shadowMesh = new THREE.InstancedMesh(geo, mat, MAX);
      shadowMesh.name = 'people.contactShadow';
      shadowMesh.count = 0;
      shadowMesh.frustumCulled = false;
      shadowMesh.castShadow = false;
      shadowMesh.receiveShadow = false;
      shadowMesh.renderOrder = 3;                             /* วาดทับพื้น (depthWrite false → ไม่ z-fight) */
      shadowMesh.userData.noShadow = true;
      shadowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(shadowMesh);
    })();
    group.userData.noShadow = true;

    paintAll();

    /* ---- ห้องที่มีที่นั่ง (meeting / training) + ประตู + ที่นั่งเรียงตามระยะจากประตู ---- */
    function doorOf(room) {
      var d = room.door;
      if (!d) return null;
      var cx, cz, nx, nz;
      if (d.side === 'z1') { cx = room.x + d.at; cz = room.z + room.d; nx = 0; nz = -1; }
      else if (d.side === 'z0') { cx = room.x + d.at; cz = room.z; nx = 0; nz = 1; }
      else if (d.side === 'x0') { cx = room.x; cz = room.z + d.at; nx = 1; nz = 0; }
      else { cx = room.x + room.w; cz = room.z + d.at; nx = -1; nz = 0; }
      var t = WALL_HALF;
      return {
        x: cx, z: cz, nx: nx, nz: nz, w: d.w || 1.0,
        inX: cx + nx * (t + 0.55), inZ: cz + nz * (t + 0.55),
        outX: cx - nx * (t + 0.50), outZ: cz - nz * (t + 0.50),
        waitX: cx - nx * (t + 0.30), waitZ: cz - nz * (t + 0.30),
        yaw: Math.atan2(-nx, -nz)
      };
    }

    var rooms = [];
    (plan.rooms || []).forEach(function (room) {
      if (room.furn !== 'meeting' && room.furn !== 'training') return;
      var seats = room.furn === 'training' ? trainingSeats(room, plan) : meetingSeats(room, plan);
      var dr = doorOf(room);
      if (!dr || !seats.seats.length) return;
      /* เรียงที่นั่งตามระยะจากประตู (คนไกลประตูได้ที่นั่งไกล) → ord */
      var dists = seats.seats.map(function (st) {
        var dx = st.x - dr.inX, dz = st.z - dr.inZ;
        return { st: st, d: dx * dx + dz * dz };
      });
      dists.sort(function (a, b) { return a.d - b.d; });
      dists.forEach(function (o, n) { o.st.ord = n; });
      seats.seats = dists.map(function (o) { return o.st; });   /* seats[i].ord === i */
      var rects = seats.rects.map(function (r) {
        return { x0: r.x0 - PR, z0: r.z0 - PR, x1: r.x1 + PR, z1: r.z1 + PR };
      });
      var rectsT = seats.rects.map(function (r) {
        return { x0: r.x0 - PR + 0.05, z0: r.z0 - PR + 0.05, x1: r.x1 + PR - 0.05, z1: r.z1 + PR - 0.05 };
      });
      rooms.push({ room: room, id: room.id, seats: seats.seats, rects: rects, rectsT: rectsT,
                   door: dr, wantSeats: 0, wantWait: 0, pathCount: room.bind && room.bind.count });
    });

    /* ---- คน ---- */
    var people = [];
    var T = 0, dirty = true, accA = 0, accS = 0;
    var LOOP = [
      { x: -1.35, z: 11.0 }, { x: 0.70, z: 11.0 },
      { x: 1.90, z: LANE_A }, { x: 28.5, z: LANE_A },
      { x: 28.65, z: 11.0 }, { x: 28.5, z: LANE_B },
      { x: 1.50, z: LANE_B }, { x: 0.70, z: 11.0 }
    ];
    var LOOPR = LOOP.slice().reverse();
    /* จุดเกิดชุดแรก: เรียงตามโถง สลับเลน ห่างกัน ~3.5 ม. */
    var SPAWN = [
      { x: 2.2, z: LANE_A }, { x: 5.5, z: LANE_B }, { x: 9.0, z: LANE_A }, { x: 12.5, z: LANE_B },
      { x: 16.0, z: LANE_A }, { x: 19.5, z: LANE_B }, { x: 23.0, z: LANE_A }, { x: 26.5, z: LANE_B }
    ];

    function num(v, dflt) { v = Number(v); return isFinite(v) ? Math.max(0, Math.round(v)) : (dflt || 0); }
    function sigNum(path, alt) {
      if (!sig) return 0;
      var v = sig.get(path);
      if (v === undefined && alt) v = sig.get(alt);
      return num(v, 0);
    }
    function inCorridor(p) { return p.z > 9.15 && p.z < 12.85; }

    function newPerson(idx) {
      var pal = PAL[idx % MAX];
      var p = {
        id: idx, col: pal, s: pal.s, speed: pal.spd,
        x: -1.35 - idx * 0.85, z: 11.0 + (seedRnd() - 0.5) * 0.5, y: 0, footY: 0, height: 1.705 * pal.s,
        yaw: PI / 2, yawT: PI / 2, phase: seedRnd() * TAU, mode: 'walk', job: null, roam: true,
        wps: null, wi: 0, after: null, dir: 1, jitter: (seedRnd() - 0.5) * 0.16,
        seed: seedRnd() * TAU, sitVar: 0.25 + seedRnd() * 0.35,
        pose: { hipL: 0, hipR: 0, kneeL: 0.05, kneeR: 0.05, ankL: 0, ankR: 0,
                armL: 0, armR: 0, elbL: 0.12, elbR: 0.12, lean: 0.02, roll: 0, twist: 0, head: 0 },
        tg: { hipL: 0, hipR: 0, kneeL: 0.05, kneeR: 0.05, ankL: 0, ankR: 0,
              armL: 0, armR: 0, elbL: 0.12, elbR: 0.12, lean: 0.02, roll: 0, twist: 0, head: 0 }
      };
      people.push(p);
      return p;
    }
    function spawnPerson() {
      if (people.length >= MAX) return null;
      var idx = people.length;
      var p = newPerson(idx);
      /* จุดเกิด: 8 จุดกระจายในโถง (ไม่ซ้ำจุดกัน) · หลังจากนั้นต่อคิวข้างนอกเว้น 1.1 ม. สลับเลน */
      if (idx < SPAWN.length) {
        var q = SPAWN[idx];
        p.x = q.x; p.z = q.z + (q.z > 11 ? -1 : 1) * (0.03 + idx % 3 * 0.05);
      } else {
        p.x = -1.35 - (idx - SPAWN.length) * 1.1;
        p.z = 11.0 + (idx % 2 ? 0.42 : -0.30);
      }
      p.wps = []; p.wi = 0; p.roam = true; p.mode = 'walk';
      startRoam(p, p.x, p.z);
      return p;
    }

    function loopPts(dir) { return dir > 0 ? LOOP : LOOPR; }
    function loopNear(pts, x, z) {
      var best = 0, bd = 1e9;
      for (var k = 0; k < pts.length; k++) {
        var d = (pts[k].x - x) * (pts[k].x - x) + (pts[k].z - z) * (pts[k].z - z);
        if (d < bd) { bd = d; best = k; }
      }
      return best;
    }
    function startRoam(p, x, z) {
      var pts = loopPts(p.dir), start = loopNear(pts, x, z), wps = [];
      for (var k = 1; k <= pts.length; k++) {
        var pt = pts[(start + k) % pts.length];
        wps.push({ x: pt.x, z: pt.z + (pt.z > 9.5 && pt.z < 12.5 ? p.jitter : 0) });
      }
      p.wps = wps; p.wi = 0; p.roam = true; p.after = null; p.mode = 'walk';
    }

    /* ---- กำหนดงาน ---- */
    var seatTaken = {}, waitTaken = {};
    function keyOf(j) { return j.rp.id + ':' + j.seat.ord; }

    function approachOf(rp, seat) {
      return { x: seat.x - seat.fx * 0.62, z: seat.z - seat.fz * 0.62 };
    }

    function assignSeat(p, rp, seat) {
      var d = rp.door, ap = approachOf(rp, seat), mid = route(d.inX, d.inZ, ap.x, ap.z, rp.rectsT);
      p.job = { type: 'seat', rp: rp, seat: seat, x: seat.x, z: seat.z, yaw: seat.yaw };
      var wps = [{ x: d.outX, z: d.outZ }, { x: d.inX, z: d.inZ }];
      for (var k = 0; k < mid.length; k++) wps.push(mid[k]);
      wps.push({ x: ap.x, z: ap.z });
      wps.push({ x: seat.x, z: seat.z });
      p.wps = wps; p.wi = 0; p.roam = false; p.after = null; p.mode = 'walk';
    }
    function assignWait(p, rp, slot) {
      var d = rp.door, lat = (d.w / 2 + 0.30) * (slot === 0 ? -1 : 1);
      var lx = Math.abs(d.nz) > Math.abs(d.nx) ? 1 : 0;
      p.job = { type: 'wait', rp: rp, slot: slot,
                x: d.waitX + lx * lat, z: d.waitZ + (1 - lx) * lat, yaw: d.yaw };
      p.wps = [{ x: d.outX, z: d.outZ }, { x: d.waitX + lx * lat, z: d.waitZ + (1 - lx) * lat }];
      p.wi = 0; p.roam = false; p.after = null; p.mode = 'walk';
    }

    function release(p) {
      var j = p.job;
      p.job = null;
      if (!j) { if (!p.roam) startRoam(p, p.x, p.z); return; }
      if (p.mode === 'sit') {
        var d = j.rp.door, ap = approachOf(j.rp, j.seat);
        var back = route(d.inX, d.inZ, ap.x, ap.z, j.rp.rectsT), wps = [{ x: ap.x, z: ap.z }];
        for (var k = back.length - 1; k >= 0; k--) wps.push(back[k]);
        wps.push({ x: d.inX, z: d.inZ }, { x: d.outX, z: d.outZ });
        p.wps = wps; p.wi = 0; p.mode = 'walk'; p.roam = false; p.after = 'roam';
      } else if (!inCorridor(p)) {
        /* ยังอยู่ในห้อง (กำลังเดินไปเก้าอี้) → ออกทางประตูก่อน กันเดินทะลุผนัง */
        p.wps = [{ x: j.rp.door.inX, z: j.rp.door.inZ }, { x: j.rp.door.outX, z: j.rp.door.outZ }];
        p.wi = 0; p.mode = 'walk'; p.roam = false; p.after = 'roam';
      } else {
        startRoam(p, p.x, p.z);
      }
    }

    function readWants() {
      rooms.forEach(function (rp) {
        var cnt = sigNum('/meeting/' + rp.id + '/count', rp.pathCount);
        var st = sig ? sig.get('/meeting/' + rp.id + '/state') : undefined;
        var lit = sig ? sig.get('/lights/' + rp.id) : undefined;
        var want = cnt > 0 ? Math.min(cnt, rp.seats.length) : 0;
        /* ห้องที่ไฟดับ + ไม่มีการจอง → ไม่มีคนนั่ง */
        if (lit === false && !(cnt > 0)) want = 0;
        rp.wantSeats = want;
        rp.wantWait = (st === 'busy' && !(cnt > 0)) ? 2 : 0;
      });
    }
    function nearestFree(x, z) {
      var best = null, bd = 1e9;
      for (var k = 0; k < people.length; k++) {
        var p = people[k];
        if (p.job || p.mode === 'sit' || !inCorridor(p)) continue;
        var d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    }

    function assign() {
      readWants();
      var total = 0, k, rp, p;
      rooms.forEach(function (r) { total += r.wantSeats + r.wantWait; });
      /* กันคนเต็ม: เหลือคนเดินในโถงอย่างน้อย RESERVE */
      var guard = 0;
      while (total > MAX - RESERVE && guard++ < 200) {
        var big = null;
        rooms.forEach(function (r) {
          var w = r.wantSeats + r.wantWait;
          if (w <= 0) return;
          if (!big || w > big.wantSeats + big.wantWait) big = r;
        });
        if (!big) break;
        if (big.wantSeats >= big.wantWait && big.wantSeats > 0) big.wantSeats--; else if (big.wantWait > 0) big.wantWait--;
        total--;
      }

      /* 1) ปลดคนที่ยังไม่ถึงคิว / ห้องไม่ต้องการแล้ว */
      seatTaken = {}; waitTaken = {};
      for (k = 0; k < people.length; k++) {
        p = people[k];
        var j = p.job;
        if (!j) continue;
        if (j.type === 'seat') {
          if (j.seat.ord < j.rp.wantSeats) seatTaken[keyOf(j)] = p;
          else release(p);
        } else if (j.type === 'wait') {
          if (j.slot < j.rp.wantWait) waitTaken[j.rp.id + ':' + j.slot] = p;
          else release(p);
        }
      }
      /* 2) เติมที่นั่ง/คนรอที่ยังขาด */
      for (k = 0; k < rooms.length; k++) {
        rp = rooms[k];
        var oi, wi;
        for (oi = 0; oi < rp.wantSeats; oi++) {
          var seat = rp.seats[oi];
          if (seatTaken[rp.id + ':' + oi]) continue;
          var cand = nearestFree(rp.door.outX, rp.door.outZ);
          if (!cand) { cand = spawnPerson(); if (!cand) break; }
          assignSeat(cand, rp, seat);
          seatTaken[rp.id + ':' + oi] = cand;
        }
        for (wi = 0; wi < rp.wantWait; wi++) {
          if (waitTaken[rp.id + ':' + wi]) continue;
          var cw = nearestFree(rp.door.outX, rp.door.outZ);
          if (!cw) { cw = spawnPerson(); if (!cw) break; }
          assignWait(cw, rp, wi);
          waitTaken[rp.id + ':' + wi] = cw;
        }
      }
      /* 3) คนเดินในโถง (เติมให้พอ แต่ไม่เกิน MAX) */
      var walkers = 0;
      for (k = 0; k < people.length; k++) if (!people[k].job) walkers++;
      var wantWalk = Math.min(Math.max(0, MAX - total), 12);       /* โถงมีคนเดินเยอะถ้าที่นั่งว่าง */
      wantWalk = Math.max(wantWalk, Math.min(RESERVE, Math.max(0, MAX - total)));
      while (walkers < wantWalk && spawnPerson()) walkers++;
    }

    /* =============================================================================
       ต่อเฟรม: เดิน / ยืน / นั่ง → เขียน instance matrix
       ============================================================================= */
    var mRoot = new THREE.Matrix4(), m1 = new THREE.Matrix4(), m2 = new THREE.Matrix4(),
        m3 = new THREE.Matrix4(), m4 = new THREE.Matrix4(), m5 = new THREE.Matrix4(), m6 = new THREE.Matrix4(),
        m7 = new THREE.Matrix4(), m8 = new THREE.Matrix4(), m9 = new THREE.Matrix4();
    var dummy = new THREE.Object3D();
    function TRS(out, par, x, y, z, rx, ry, rz) {
      dummy.position.set(x, y, z);
      dummy.rotation.set(rx || 0, ry || 0, rz || 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      out.multiplyMatrices(par, dummy.matrix);
      return out;
    }
    function angLerp(a, b, f) {
      var d = (b - a) % TAU;
      if (d > PI) d -= TAU; else if (d < -PI) d += TAU;
      return a + d * f;
    }

    /* ไม่เดินทับคนข้างหน้า (ชะลอ/หยุดรอ) → ระยะห่างขั้นต่ำ ~0.5 ม. */
    function aheadBlocked(p, nx, nz, dx, dz) {
      for (var i = 0; i < people.length; i++) {
        var o = people[i];
        if (o === p) continue;
        var ox = o.x - nx, oz = o.z - nz;
        var along = ox * dx + oz * dz;                  /* ระยะตามทิศที่เดิน */
        var lat = Math.abs(ox * dz - oz * dx);          /* ระยะข้าง */
        if (along > -0.05 && along < 0.75 && lat < 0.34) return true;   /* มีคนขวางข้างหน้า */
      }
      return false;
    }
    function stepMove(p, dt) {
      var budget = p.speed * SPEED * dt, guard = 0;
      while (budget > 1e-4 && p.wi < p.wps.length && guard++ < 24) {
        var wp = p.wps[p.wi];
        var dx = wp.x - p.x, dz = wp.z - p.z, dd = Math.sqrt(dx * dx + dz * dz);
        if (dd < 0.06) { p.wi++; continue; }
        p.yaw = angLerp(p.yaw, Math.atan2(dx, dz), 1 - Math.exp(-7 * dt));
        var step = Math.min(budget, dd);
        if (aheadBlocked(p, p.x + dx / dd * step, p.z + dz / dd * step, dx / dd, dz / dd)) { p.blocked = true; break; }
        p.x += dx / dd * step;
        p.z += dz / dd * step;
        p.phase += step * 5.0;
        budget -= step;
      }
      if (p.wi >= p.wps.length) finishRoute(p);
    }
    function finishRoute(p) {
      if (p.after === 'roam') { p.after = null; startRoam(p, p.x, p.z); return; }
      if (p.job && p.job.type === 'seat') { p.mode = 'sit'; p.yawT = p.job.yaw; p.wps = null; p.wi = 0; return; }
      if (p.job && p.job.type === 'wait') { p.mode = 'stand'; p.yawT = p.job.yaw; p.wps = null; p.wi = 0; return; }
      if (p.roam) startRoam(p, p.x, p.z);
    }

    function walkPose(p) {
      var ph = p.phase, tg = p.tg, sn = Math.sin(ph);
      tg.hipL = 0.40 * sn; tg.hipR = -0.40 * sn;
      tg.kneeL = 0.09 + 0.62 * Math.max(0, Math.sin(ph + 0.9));
      tg.kneeR = 0.09 + 0.62 * Math.max(0, Math.sin(ph + PI + 0.9));
      tg.ankL = -(tg.hipL + tg.kneeL); tg.ankR = -(tg.hipR + tg.kneeR);   /* ฝ่าเท้าขนานพื้น */
      tg.armL = -0.32 * sn; tg.armR = 0.32 * sn;
      tg.elbL = 0.20 + 0.12 * Math.sin(ph + 0.6); tg.elbR = 0.20 - 0.12 * Math.sin(ph + 0.6);
      tg.lean = 0.06; tg.roll = 0.035 * sn; tg.twist = -0.06 * sn; tg.head = -0.02;
    }
    function standPose(p, dt) {
      var t = T + p.seed, tg = p.tg;
      tg.hipL = 0.02; tg.hipR = 0.02;
      tg.kneeL = 0.05; tg.kneeR = 0.05;
      tg.ankL = -0.07; tg.ankR = -0.07;                                   /* = -(hip+knee) → ฝ่าเท้าแนบพื้น */
      tg.armL = 0.04 + 0.035 * Math.sin(t * 1.15); tg.armR = -0.03 + 0.035 * Math.sin(t * 1.15 + 1.3);
      tg.elbL = 0.13 + 0.05 * Math.sin(t * 1.3); tg.elbR = 0.11 + 0.05 * Math.sin(t * 1.1 + 0.8);
      tg.lean = 0.02; tg.roll = 0.006 * Math.sin(t * 0.6); tg.twist = 0.03 * Math.sin(t * 0.9); tg.head = 0;
    }
    function sitPose(p) {
      var tg = p.tg, v = p.sitVar;
      tg.hipL = -PI / 2 + 0.03 * v; tg.hipR = -PI / 2 - 0.02 * v;
      tg.kneeL = -tg.hipL + 0.05; tg.kneeR = -tg.hipR + 0.06;
      tg.ankL = 0; tg.ankR = 0;
      tg.armL = -0.20 - 0.05 * v; tg.armR = -0.16 - 0.05 * v;
      tg.elbL = 0.45 + 0.10 * v; tg.elbR = 0.42 + 0.10 * v;
      tg.lean = -0.06; tg.roll = 0; tg.twist = 0.04 * v; tg.head = 0.03;
    }

    function updateInstances(p, i) {
      var P = p.pose, sc = p.s, base = i, k;
      var reachL = B.thigh * Math.cos(P.hipL) + B.shin * Math.cos(P.hipL + P.kneeL);
      var reachR = B.thigh * Math.cos(P.hipR) + B.shin * Math.cos(P.hipR + P.kneeR);
      var hipY = B.foot + Math.max(reachL, reachR);

      dummy.position.set(p.x, 0, p.z);
      dummy.rotation.set(0, p.yaw, 0);
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      mRoot.copy(dummy.matrix);

      TRS(m1, mRoot, 0, hipY, 0, 0, 0, 0);                       /* สะโพก */
      TRS(m2, m1, 0, 0, 0, P.lean, P.twist, P.roll);             /* ลำตัว */
      TRS(m3, m2, 0, B.headPivot, 0, P.head - P.lean * 0.3, 0, 0);
      inst.torso.setMatrixAt(base, m2);
      inst.head.setMatrixAt(base, m3);
      inst.hair.setMatrixAt(base, m3);
      for (k = 0; k < 2; k++) {
        var sd = k === 0 ? -1 : 1, id = i * 2 + k;
        /* แขน: ไหล่ → ศอก (geometry ขึ้นจากปลาย → ดันลงด้วย T(0,-len,0)) */
        TRS(m4, m2, sd * B.shX, B.shY, 0, k === 0 ? P.armL : P.armR, 0, sd * 0.05);
        TRS(m7, m4, 0, -B.upArm, 0, 0, 0, 0);
        inst.sleeve.setMatrixAt(id, m7);
        TRS(m5, m4, 0, -B.upArm, 0, k === 0 ? P.elbL : P.elbR, 0, 0);
        TRS(m8, m5, 0, -B.foreArm, 0, 0, 0, 0);
        inst.fore.setMatrixAt(id, m8);
        /* ขา: สะโพก → เข่า → ข้อเท้า */
        TRS(m4, m1, sd * B.hipX, 0, 0, k === 0 ? P.hipL : P.hipR, 0, 0);
        TRS(m7, m4, 0, -B.thigh, 0, 0, 0, 0);
        inst.thigh.setMatrixAt(id, m7);
        TRS(m5, m4, 0, -B.thigh, 0, k === 0 ? P.kneeL : P.kneeR, 0, 0);
        TRS(m8, m5, 0, -B.shin, 0, 0, 0, 0);
        inst.shin.setMatrixAt(id, m8);
        TRS(m6, m5, 0, -B.shin, 0, k === 0 ? P.ankL : P.ankR, 0, 0);
        TRS(m9, m6, 0, -B.foot, 0, 0, 0, 0);
        inst.shoe.setMatrixAt(id, m9);
      }
    }

    function stepPerson(p, dt) {
      p.blocked = false;
      if (p.wps && p.wi < p.wps.length) stepMove(p, dt);
      else if (p.wps && p.wi >= p.wps.length) finishRoute(p);
      if (p.mode !== 'walk') p.yaw = angLerp(p.yaw, p.yawT, 1 - Math.exp(-6 * dt));

      var tg = p.tg, mode = p.mode;
      if (mode === 'sit') sitPose(p);
      else if (mode === 'stand' || p.blocked) { standPose(p, dt); mode = 'stand'; }
      else walkPose(p);
      var rate = mode === 'walk' ? 22 : (mode === 'sit' ? 7 : 9);
      var f = 1 - Math.exp(-rate * dt);
      var at = p.pose;
      at.hipL += (tg.hipL - at.hipL) * f; at.hipR += (tg.hipR - at.hipR) * f;
      at.kneeL += (tg.kneeL - at.kneeL) * f; at.kneeR += (tg.kneeR - at.kneeR) * f;
      at.ankL += (tg.ankL - at.ankL) * f; at.ankR += (tg.ankR - at.ankR) * f;
      at.armL += (tg.armL - at.armL) * f; at.armR += (tg.armR - at.armR) * f;
      at.elbL += (tg.elbL - at.elbL) * f; at.elbR += (tg.elbR - at.elbR) * f;
      at.lean += (tg.lean - at.lean) * f; at.roll += (tg.roll - at.roll) * f;
      at.twist += (tg.twist - at.twist) * f; at.head += (tg.head - at.head) * f;
    }

    function update(dt) {
      dt = (typeof dt === 'number' && dt > 0) ? Math.min(dt, 0.1) : 0.016;
      T += dt;
      accA += dt; accS += dt;
      if (dirty || accA > 0.5) { dirty = false; accA = 0; try { assign(); } catch (e) { } }
      var n = people.length, k;
      for (k = 0; k < n; k++) stepPerson(people[k], dt);
      for (k = 0; k < SLOTS.length; k++) {
        inst[SLOTS[k].k].count = n * SLOTS[k].per;
        inst[SLOTS[k].k].userData.instances = n * SLOTS[k].per;
      }
      for (k = 0; k < n; k++) updateInstances(people[k], k);
      for (k = 0; k < SLOTS.length; k++) inst[SLOTS[k].k].instanceMatrix.needsUpdate = true;
      /* เงาใต้เท้า: y = 0.005 (ไม่ z-fight กับพื้น), ตามตำแหน่ง/ทิศ/สเกลของคน */
      for (k = 0; k < n; k++) {
        var qs = people[k];
        dummy.position.set(qs.x, 0.012, qs.z);
        dummy.rotation.set(0, qs.yaw, 0);
        dummy.scale.set(qs.s, 1, qs.s);
        dummy.updateMatrix();
        shadowMesh.setMatrixAt(k, dummy.matrix);
      }
      shadowMesh.count = n;
      shadowMesh.instanceMatrix.needsUpdate = true;
      shadowMesh.userData.instances = n;
      /* world AABB ของคนทั้งกลุ่ม (ให้ตัวตรวจภายนอกใช้แทน geometry bbox ได้) */
      var wb = group.userData.bounds, mx = 0, mnx = 1e9, mnz = 1e9, mxz = -1e9, hh = 0;
      for (k = 0; k < n; k++) {
        var qq = people[k];
        if (qq.x < mnx) mnx = qq.x; if (qq.x > mx) mx = qq.x;
        if (qq.z < mnz) mnz = qq.z; if (qq.z > mxz) mxz = qq.z;
        if (qq.height > hh) hh = qq.height;
      }
      wb.minX = n ? mnx - 0.2 : 0; wb.maxX = n ? mx + 0.2 : 0;
      wb.minZ = n ? mnz - 0.2 : 0; wb.maxZ = n ? mxz + 0.2 : 0;
      wb.minY = 0; wb.maxY = hh;
      group.userData.people = n;
      group.userData.instances = n * (SLOTS.length + 1);
    }

    /* ---- subscribe สัญญาณ → จองใหม่ ---- */
    var unsub = [];
    if (sig && sig.subscribe) {
      unsub.push(sig.subscribe(function (path) {
        if (!path) return;
        if (path.indexOf('/meeting/') === 0 || path.indexOf('/lights/') === 0) dirty = true;
      }));
    }

    /* ---- เริ่ม: จองรอบแรก + วางท่าตั้งต้นให้ตรง (ไม่กระพริบเฟรมแรก) ---- */
    try { assign(); } catch (e) { }
    for (var q = 0; q < people.length; q++) {
      var pp = people[q];
      if (pp.mode === 'walk') walkPose(pp); else if (pp.mode === 'sit') sitPose(pp); else standPose(pp, 0);
      for (var fld in pp.tg) pp.pose[fld] = pp.tg[fld];
      if (pp.mode !== 'walk') pp.yaw = pp.yawT;
    }
    update(0.016);

    var trisPerPerson = 0;
    for (var ti = 0; ti < SLOTS.length; ti++) {
      var gg = SLOTS[ti].g;
      trisPerPerson += ((gg.index ? gg.index.count : gg.attributes.position.count) / 3) * SLOTS[ti].per;
    }

    return {
      group: group,
      colliders: [],
      people: people,
      rooms: rooms,
      stats: function () {
        var seated = 0, wait = 0, k;
        for (k = 0; k < people.length; k++) {
          if (people[k].mode === 'sit') seated++;
          if (people[k].mode === 'stand') wait++;
        }
        var inst2 = 0;
        for (var si2 = 0; si2 < SLOTS.length; si2++) inst2 += SLOTS[si2].per;
        inst2 += 1;                                        /* + contact shadow */
        return {
          people: people.length, seated: seated, waiting: wait, max: MAX, drawCalls: SLOTS.length + 1,
          trisPerPerson: Math.round(trisPerPerson), instances: people.length * inst2,
          trisDrawn: Math.round(trisPerPerson * people.length),
          footY: [0, 0], bounds: group.userData.bounds
        };
      },
      hooks: {
        update: update,
        dispose: function () {
          for (var k = 0; k < unsub.length; k++) try { unsub[k](); } catch (e) { }
          unsub.length = 0;
          if (group.parent) group.parent.remove(group);
          for (var s2 = 0; s2 < SLOTS.length; s2++) { try { inst[SLOTS[s2].k].dispose(); } catch (e) { } }
          try { pmat.dispose(); } catch (e) { }
        }
      }
    };
  }

  O.people = { build: build };
})();
