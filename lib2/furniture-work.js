/* office3d/v2/lib2/furniture-work.js — ชุดทำงาน open plan (furn 'work') + ห้องเซิร์ฟเวอร์ (furn 'server')
   window.O3D2.furnitureWork = { types: ['work','server'], buildRoom(room, ctx) }
   หน่วยเมตร · y = 0 = พื้น · สร้างใน local coords (0,0 = กึ่งกลางห้อง) แล้วเลื่อน group ไป (room.x+w/2, 0, room.z+d/2)
   - ไม่ใส่ group ลง scene เอง (assembler ทำ) · คืน { group, colliders, stats }
   - วัสดุใช้ชื่อจาก CONTRACT เท่านั้น · ชิ้นเล็กจำนวนมากรวมด้วย util.merge ต่อห้อง
*/
(function () {
  var O = window.O3D2 = window.O3D2 || {};
  if (!window.THREE) return;
  var THREE = window.THREE;

  /* ── ขนาดหลัก (เมตร) ─────────────────────────────────────── */
  var W = {
    L: 3.00,          // bench 2 ที่นั่ง (pitch 1.5) → ยาว 3.00
    SEAT: 0.75,       // x ของที่นั่งจากกลาง bench
    DP: 0.72,         // ลึกโต๊ะ
    TOP: 0.74,        // ระดับผิวโต๊ะ
    GAP: 0.05,        // ระยะระหว่าง bench ในแถว
    CHAIR: 1.10,      // เก้าอี้ = กลางโต๊ะ + 1.10 (0.36 ครึ่งโต๊ะ + 0.74 ระยะถอย)
    POD_HALF: 1.43,   // ครึ่งลึก pod (โต๊ะชนกันกลาง + เก้าอี้ 2 ฝั่ง)
    WALK: 1.05,       // ทางเดินระหว่าง pod (≥1.0 ตามโจทย์)
    MARG: 0.36,       // ถอยจากเส้นกึ่งกลางผนัง
    DOOR: 1.55        // ระยะปลอดประตู (ลึกจากเส้นกึ่งกลางผนัง)
  };

  /* ── kit: ผูก ctx ของการเรียกครั้งนั้น (วัสดุ fallback ได้) ── */
  var SHARED = null;
  function shared() {
    if (SHARED) return SHARED;
    SHARED = {
      sph: new THREE.SphereGeometry(1, 8, 5),
      plane: new THREE.PlaneGeometry(0.515, 0.285)   // จอ 24" (16:9 โดยประมาณ)
    };
    return SHARED;
  }
  function makeKit(ctx) {
    var U = (ctx && ctx.util) || O.util;
    var mats = (ctx && ctx.mats) || O.mats;
    var sh = shared();
    function mat(name) { try { return mats && mats.get ? mats.get(name) : null; } catch (e) { return null; } }
    var kit = {
      THREE: THREE, U: U, mats: mats, mat: mat, sph: sh.sph,
      debug: !!(ctx && ctx.debugParts),
      box: function (g, w, h, d, name, x, y, z, ry) {
        var q = U.box(w, h, d, mat(name), x, y, z, ry); g.add(q); return q;
      },
      cyl: function (g, rt, rb, h, seg, name, x, y, z, ry) {
        var q = U.cyl(rt, rb, h, seg, mat(name), x, y, z, ry); g.add(q); return q;
      },
      boxR: function (g, w, h, d, name, x, y, z, rx, ry, rz) {
        var q = new THREE.Mesh(U.boxGeo(w, h, d), mat(name));
        q.position.set(x, y, z); q.rotation.set(rx || 0, ry || 0, rz || 0); g.add(q); return q;
      },
      /* จอ: plane หัน +z (ผู้ใช้อยู่ฝั่ง +z) */
      face: function (g, name, x, y, z, ry) {
        var q = new THREE.Mesh(sh.plane, mat(name));
        q.position.set(x, y, z); if (ry) q.rotation.y = ry; g.add(q); return q;
      },
      /* ใบไม้/ก้อนกลม: sphere 1 หน่วย ย่อตาม scale */
      blob: function (g, name, x, y, z, r) {
        var q = new THREE.Mesh(sh.sph, mat(name));
        q.position.set(x, y, z); q.scale.set(r, r, r); g.add(q); return q;
      },
      grp: function (parent, x, y, z, ry) {
        var g = new THREE.Group(); g.position.set(x || 0, y || 0, z || 0);
        if (ry) g.rotation.y = ry; parent.add(g); return g;
      }
    };
    return kit;
  }

  /* ── ชิ้นส่วน: จอ 24" (ฐาน + ขาตั้ง + ขอบ + จอ on/off) ───── */
  function addMonitor(kit, parent, x, z, on) {
    var g = kit.grp(parent, x, W.TOP + 0.002, z);
    kit.cyl(g, 0.095, 0.105, 0.016, 12, 'plastic.black', 0, 0.008, 0);          // ฐาน
    kit.box(g, 0.048, 0.24, 0.036, 'metal.dark', 0, 0.136, 0);                  // ขาตั้ง
    kit.box(g, 0.55, 0.327, 0.02, 'plastic.black', 0, 0.4195, 0.005);           // ขอบ/ตัวเครื่อง
    kit.face(g, on ? 'screen.on' : 'screen.off', 0, 0.4195, 0.0165);            // จอ (หัน +z)
    kit.box(g, 0.30, 0.05, 0.012, 'metal.aluminium', 0, 0.60, -0.004);          // ฝาหลัง/ขอบล่าง
    return g;
  }

  /* ── ชิ้นส่วน: เก้าอี้สำนักงาน (หัน +z = หันหลังไปทาง -z) ── */
  function addChair(kit, parent, x, z, s) {
    var g = kit.grp(parent, x, 0, z, s > 0 ? Math.PI : 0);
    /* ฐาน 5 แฉก + ลูกล้อ */
    kit.cyl(g, 0.058, 0.062, 0.05, 10, 'metal.dark', 0, 0.045, 0);
    for (var i = 0; i < 5; i++) {
      var a = i * Math.PI * 2 / 5, c = Math.cos(a), sn = Math.sin(a);
      kit.box(g, 0.30, 0.035, 0.048, 'metal.dark', c * 0.145, 0.045, sn * 0.145, -a);
      kit.cyl(g, 0.027, 0.027, 0.026, 6, 'plastic.black', c * 0.30, 0.027, sn * 0.30);
    }
    /* กระบอกปรับสูง + แผ่นรองเบาะ */
    kit.cyl(g, 0.032, 0.038, 0.24, 10, 'metal.aluminium', 0, 0.19, 0);
    kit.box(g, 0.30, 0.035, 0.26, 'metal.dark', 0, 0.34, 0);
    /* เบาะนั่ง */
    kit.box(g, 0.50, 0.095, 0.48, 'fabric.grey', 0, 0.41, 0);
    /* พนักพิงตาข่าย + โครง */
    kit.boxR(g, 0.05, 0.46, 0.05, 'metal.dark', 0, 0.60, -0.235, -0.10, 0, 0);
    kit.boxR(g, 0.44, 0.05, 0.04, 'metal.dark', 0, 0.545, -0.215, -0.10, 0, 0);
    kit.boxR(g, 0.46, 0.50, 0.045, 'fabric.mesh', 0, 0.78, -0.262, -0.10, 0, 0);
    /* ที่ทับแขน */
    [-1, 1].forEach(function (k) {
      kit.box(g, 0.055, 0.03, 0.25, 'plastic.black', k * 0.275, 0.645, -0.02);
      kit.box(g, 0.03, 0.175, 0.03, 'metal.dark', k * 0.275, 0.55, -0.03);
    });
    return g;
  }

  /* ── ชิ้นส่วน: ฉากกั้นโต๊ะต่ำ (วางคร่อมขอบหลังโต๊ะ, สูง 0.35 เหนือผิว) ── */
  function addDeskScreen(kit, g, len) {
    var z = -W.DP / 2;
    kit.box(g, len, 0.008, 0.12, 'metal.aluminium', 0, W.TOP + 0.004, z);              // ฐานหนีบ
    kit.box(g, len, 0.34, 0.045, 'fabric.grey', 0, W.TOP + 0.178, z);                  // แผง
    kit.box(g, len, 0.022, 0.055, 'metal.aluminium', 0, W.TOP + 0.359, z);             // ขอบบน
  }

  /* ── ชิ้นส่วน: bench 2 ที่นั่ง + ของบนโต๊ะ + pedestal + ถังขยะ + สายไฟ ── */
  function addBench(kit, parent, xc, zc, s, opt) {
    var g = kit.grp(parent, xc, 0, zc, s < 0 ? Math.PI : 0);
    var L = W.L, DP = W.DP, TOP = W.TOP;
    /* ── ท็อป + ขอบ ── */
    kit.box(g, L, 0.03, DP, 'wood.laminate', 0, TOP - 0.015, 0);
    kit.box(g, L - 0.03, 0.036, 0.014, 'metal.aluminium', 0, TOP - 0.016, DP / 2 - 0.007);
    kit.box(g, L - 0.03, 0.036, 0.014, 'metal.aluminium', 0, TOP - 0.016, -DP / 2 + 0.007);
    /* ── ขา panel metal.dark 2 ข้าง ── */
    [-1, 1].forEach(function (k) {
      kit.box(g, 0.06, 0.71, 0.64, 'metal.dark', k * (L / 2 - 0.10), 0.355, 0);
      kit.box(g, 0.09, 0.014, 0.66, 'metal.dark', k * (L / 2 - 0.10), 0.007, 0);   // ฐานกันสั่น
    });
    /* ── คานกลาง + cable tray + ปลั๊กพ่วง ── */
    kit.box(g, L - 0.30, 0.07, 0.05, 'metal.aluminium', 0, 0.675, 0);
    kit.box(g, L - 0.50, 0.05, 0.26, 'metal.aluminium', 0, 0.575, 0);
    kit.box(g, L - 0.50, 0.03, 0.012, 'metal.aluminium', 0, 0.60, 0.13);
    kit.box(g, L - 0.50, 0.03, 0.012, 'metal.aluminium', 0, 0.60, -0.13);
    kit.box(g, 0.90, 0.04, 0.07, 'plastic.grey', 0.25, 0.622, 0.02);
    /* ── สายไฟลงพื้น ── */
    kit.box(g, 0.018, 0.56, 0.018, 'cable.black', -0.62, 0.28, -0.06);
    kit.box(g, 0.018, 0.012, 0.44, 'cable.black', -0.62, 0.006, 0.16);
    /* ── pedestal 3 ลิ้นชัก + กุญแจ ── */
    var px = 1.10;
    kit.box(g, 0.42, 0.60, 0.55, 'wood.laminate', px, 0.30, 0);
    for (var d = 0; d < 3; d++) {
      var y = 0.115 + d * 0.185;
      kit.box(g, 0.38, 0.165, 0.02, 'wood.laminate', px, y, 0.286);
      kit.box(g, 0.20, 0.018, 0.022, 'metal.dark', px, y, 0.302);
    }
    kit.cyl(g, 0.011, 0.011, 0.02, 8, 'metal.dark', px + 0.15, 0.53, 0.30);
    /* ── ถังขยะใต้โต๊ะ ── */
    kit.cyl(g, 0.155, 0.13, 0.34, 10, 'plastic.grey', -1.12, 0.17, 0);
    kit.cyl(g, 0.162, 0.162, 0.012, 10, 'plastic.grey', -1.12, 0.346, 0);
    /* ── โทรศัพท์บนโต๊ะ (ใช้ร่วมกันกลาง bench) ── */
    kit.box(g, 0.17, 0.03, 0.16, 'plastic.black', 0, TOP + 0.017, -0.05);
    kit.box(g, 0.155, 0.045, 0.055, 'plastic.black', 0, TOP + 0.055, -0.12);
    kit.box(g, 0.05, 0.004, 0.03, 'plastic.grey', 0, TOP + 0.033, 0.03);
    /* ── ของต่อคน 2 ที่ ── */
    for (var si = 0; si < 2; si++) {
      var sx = si === 0 ? -W.SEAT : W.SEAT, fl = opt.seats[si];
      if (fl.dual) {
        addMonitor(kit, g, sx - 0.30, -0.18, fl.on);
        addMonitor(kit, g, sx + 0.30, -0.18, !fl.on);
      } else {
        addMonitor(kit, g, sx, -0.18, fl.on);
      }
      /* คีย์บอร์ด + ปุ่ม + เมาส์ + แผ่นรอง */
      kit.box(g, 0.44, 0.018, 0.14, 'plastic.black', sx, TOP + 0.0125, 0.205);
      kit.box(g, 0.415, 0.004, 0.115, 'plastic.grey', sx, TOP + 0.0235, 0.205);
      kit.box(g, 0.20, 0.004, 0.26, 'plastic.black', sx + 0.32, TOP + 0.0025, 0.20);
      kit.box(g, 0.055, 0.026, 0.10, 'plastic.black', sx + 0.32, TOP + 0.0155, 0.20);
      /* แก้ว + กระดาษ + การ์ดพนักงาน + ป้ายชื่อ */
      kit.cyl(g, 0.040, 0.034, 0.09, 10, 'plastic.grey', sx - 0.30, TOP + 0.0475, 0.28);
      kit.box(g, 0.21, 0.018, 0.20, 'paper', sx - 0.42, TOP + 0.0105, 0.06);
      kit.box(g, 0.09, 0.003, 0.055, 'paper', sx - 0.44, TOP + 0.0025, 0.30);
      kit.box(g, 0.14, 0.006, 0.05, 'paper', sx, TOP + 0.004, 0.335);
      kit.boxR(g, 0.14, 0.06, 0.004, 'paper', sx, TOP + 0.036, 0.335, -0.16, 0, 0);
    }
    /* ── ฉากกั้นโต๊ะต่ำ (บางตัว) ── */
    if (opt.screen) addDeskScreen(kit, g, L - 0.26);
    return g;
  }

  /* ── ชิ้นส่วน: ต้นไม้เล็ก + ถังขยะลอย (ใช้ในห้อง work) ───── */
  function addPlant(kit, parent, x, z, sc) {
    var g = kit.grp(parent, x, 0, z);
    sc = sc || 1;
    kit.cyl(g, 0.155 * sc, 0.12 * sc, 0.30 * sc, 10, 'plant.pot', 0, 0.15 * sc, 0);
    kit.cyl(g, 0.14 * sc, 0.14 * sc, 0.016, 10, 'plant.pot', 0, 0.30 * sc, 0);
    kit.blob(g, 'plant.leaf', 0, 0.52 * sc, 0, 0.16 * sc);
    kit.blob(g, 'plant.leaf', 0.10 * sc, 0.44 * sc, 0.05 * sc, 0.11 * sc);
    kit.blob(g, 'plant.leaf', -0.09 * sc, 0.46 * sc, -0.06 * sc, 0.10 * sc);
    kit.blob(g, 'plant.leaf', 0.02 * sc, 0.62 * sc, -0.03 * sc, 0.09 * sc);
    return g;
  }

  /* ── รวบรวม AABB ของชิ้นก่อน merge (ใช้ตรวจด้วย dev harness) ── */
  function collectParts(root) {
    var out = [], bb = new THREE.Box3();
    root.updateMatrixWorld(true);
    root.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      o.geometry.computeBoundingBox();
      bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      out.push({ m: (o.material && o.material.name) || '?',
                 x0: bb.min.x, y0: bb.min.y, z0: bb.min.z,
                 x1: bb.max.x, y1: bb.max.y, z1: bb.max.z });
    });
    return out;
  }

  /* ── แจกจำนวน bench ต่อแถว ─────────────────────────────── */
  function distribute(n, k) {
    var out = [], base = Math.floor(n / k), rem = n % k;
    for (var i = 0; i < k; i++) out.push(base + (i >= k - rem ? 1 : 0));
    return out;
  }

  /* ── ผัง open plan: คำนวณจาก w/d/desks + ประตู ──────────── */
  function layoutWork(room) {
    var rw = room.w, rd = room.d;
    var nB = Math.max(2, Math.ceil(((room.desks || 8) / 2)));
    var xMin = -rw / 2 + W.MARG, xMax = rw / 2 - W.MARG;
    var zMin = -rd / 2 + W.MARG, zMax = rd / 2 - W.MARG;
    var door = room.door;
    if (door) {
      if (door.side === 'z0') zMin = Math.max(zMin, -rd / 2 + W.DOOR);
      else if (door.side === 'z1') zMax = Math.min(zMax, rd / 2 - W.DOOR);
      else if (door.side === 'x0') xMin = Math.max(xMin, -rw / 2 + W.DOOR);
      else if (door.side === 'x1') xMax = Math.min(xMax, rw / 2 - W.DOOR);
    }
    var usableW = xMax - xMin, band = zMax - zMin;
    var maxPerRow = Math.max(1, Math.floor((usableW + W.GAP) / (W.L + W.GAP)));
    var podD = 2 * W.POD_HALF, best = null;
    for (var P = 1; P <= 3; P++) {
      var need = P * podD + (P - 1) * W.WALK;
      if (need > band + 0.02) continue;
      var rows = 2 * P;
      if (rows > nB) continue;
      var per = distribute(nB, rows);
      if (Math.max.apply(null, per) > maxPerRow) continue;
      var minPer = Math.min.apply(null, per);
      var score = (minPer >= 2 ? 10 : 0) + minPer + need / band;
      if (!best || score > best.score) best = { P: P, need: need, per: per, rows: rows, score: score };
    }
    if (!best) {                     /* ห้องเล็กมาก: 1 pod เรียงให้พอดี */
      best = { P: 1, need: podD, per: distribute(nB, 2), rows: 2, score: 0 };
      if (Math.max.apply(null, best.per) > maxPerRow) {
        best.per = [Math.min(nB, maxPerRow), Math.max(0, nB - Math.min(nB, maxPerRow))];
      }
    }
    var zc = (zMin + zMax) / 2, zStart = zc - best.need / 2;
    var pods = [];
    for (var i = 0; i < best.P; i++) pods.push(zStart + podD / 2 + i * (podD + W.WALK));
    var ing = [], ri = 0;
    pods.forEach(function (pcz) {
      ing.push({ z: pcz - 0.36, s: -1, n: best.per[ri++] || 0 });
      ing.push({ z: pcz + 0.36, s: 1, n: best.per[ri++] || 0 });
    });
    return {
      rows: ing, pods: pods, podsN: best.P, xCenter: (xMin + xMax) / 2,
      rect: { xMin: xMin, xMax: xMax, zMin: zMin, zMax: zMax },
      band: band, walkway: best.P > 1 ? W.WALK : Math.max(0, (band - podD) / 2),
      bench: nB, perRow: maxPerRow, doors: door ? door.side : null
    };
  }

  /* ── ห้อง work ─────────────────────────────────────────── */
  function buildWork(kit, room) {
    var root = new THREE.Group(), cols = [];
    var rw = room.w, rd = room.d, cx = room.x + rw / 2, cz = room.z + rd / 2;
    var L = layoutWork(room);
    function col(x0, z0, x1, z1, y0, y1) {
      cols.push({ x0: Math.min(x0, x1) + cx, z0: Math.min(z0, z1) + cz,
                  x1: Math.max(x0, x1) + cx, z1: Math.max(z0, z1) + cz, y0: y0, y1: y1 });
    }
    var seatNo = 0, benchNo = 0, chairN = 0, deskN = 0;
    L.rows.forEach(function (row, ridx) {
      if (!row.n) return;
      var len = row.n * W.L + (row.n - 1) * W.GAP;
      var x0 = L.xCenter - len / 2 + W.L / 2;
      for (var b = 0; b < row.n; b++) {
        var xc = x0 + b * (W.L + W.GAP);
        var seats = [];
        for (var k = 0; k < 2; k++) {
          seats.push({ dual: (seatNo % 5 !== 2), on: (seatNo % 3 !== 0) });
          seatNo++;
        }
        addBench(kit, root, xc, row.z, row.s, { seats: seats, screen: row.s < 0 && (b % 3 !== 2) });
        benchNo++; deskN += 2;
        col(xc - W.L / 2, row.z - W.DP / 2, xc + W.L / 2, row.z + W.DP / 2, 0, W.TOP + 0.34);
        for (k = 0; k < 2; k++) {
          var sx = xc + (k === 0 ? -W.SEAT : W.SEAT);
          var chz = row.z + row.s * W.CHAIR;
          addChair(kit, root, sx, chz, row.s);
          col(sx - 0.30, chz - 0.30, sx + 0.30, chz + 0.30, 0, 1.03);   /* collider เล็กเท่าฐาน */
          chairN++;
        }
      }
    });
    /* ── ต้นไม้มุมห้อง + ต้นไม้เล็กปลายแถว ── */
    var R = L.rect, plants = 0;
    [[R.xMin + 0.24, R.zMin + 0.24, 1.0], [R.xMax - 0.24, R.zMin + 0.24, 1.0],
     [R.xMin + 0.24, R.zMax - 0.24, 1.0], [R.xMax - 0.24, R.zMax - 0.24, 1.0]
    ].forEach(function (p) {
      addPlant(kit, root, p[0], p[1], p[2]); plants++;
      col(p[0] - 0.19, p[1] - 0.19, p[0] + 0.19, p[1] + 0.19, 0, 0.66);
    });
    /* ต้นไม้เล็กบนโต๊ะ (ปลายแถวแรกของ pod แรก) */
    if (L.podsN >= 1) {
      var row0 = L.rows[0], len0 = row0.n * W.L + (row0.n - 1) * W.GAP;
      var pxp = L.xCenter - len0 / 2 - 0.30;
      if (pxp > R.xMin + 0.15) {
        addPlant(kit, root, pxp, row0.z, 0.55); plants++;
        col(pxp - 0.12, row0.z - 0.12, pxp + 0.12, row0.z + 0.12, 0, 0.4);
      }
    }
    /* ── รวม mesh (ของชิ้นเล็กเยอะ) ── */
    var parts = kit.debug ? collectParts(root) : null;
    var merged = kit.U.merge ? kit.U.merge(root) : root;
    merged.position.set(cx, 0, cz);
    merged.name = 'furnitureWork:' + (room.id || 'work');
    merged.traverse(function (o) {
      if (!o.isMesh) return;
      var n = (o.material && o.material.name) || '';
      o.castShadow = /wood.laminate|metal.dark|fabric.mesh|fabric.grey|plant.leaf/.test(n);
    });
    return {
      group: merged, colliders: cols,
      parts: parts,
      stats: { kind: 'work', benches: benchNo, desks: deskN, chairs: chairN, plants: plants,
               pods: L.podsN, walkway: +L.walkway.toFixed(2), rows: L.rows.length,
               door: L.doors, layout: L }
    };
  }

  /* ── ชิ้นส่วน: ตู้แร็ค 19" ───────────────────────────────── */
  function addRack(kit, parent, x, z, seed) {
    var g = kit.grp(parent, x, 0, z);
    var w = 0.60, d = 0.85, h = 2.00, rnd = kit.U.rnd ? kit.U.rnd(seed) : function () { return 0.5; };
    /* โครง */
    [-1, 1].forEach(function (sx) {
      [-1, 1].forEach(function (sz) {
        kit.box(g, 0.045, h, 0.045, 'metal.dark', sx * (w / 2 - 0.0225), h / 2, sz * (d / 2 - 0.0225));
      });
      kit.box(g, 0.012, h - 0.10, d - 0.04, 'metal.dark', sx * (w / 2 - 0.006), h / 2, 0);   /* ผนังข้าง */
    });
    kit.box(g, w, 0.04, d, 'metal.dark', 0, h - 0.02, 0);
    kit.box(g, w, 0.05, d, 'metal.dark', 0, 0.025, 0);
    /* เซิร์ฟเวอร์ + LED + พัดลม ภายใน */
    for (var i = 0; i < 9; i++) {
      var y = 0.17 + i * 0.175, r = rnd();
      kit.box(g, w - 0.14, 0.06, d - 0.24, 'plastic.black', 0, y, 0.02);
      if (i % 3 === 0) kit.box(g, 0.03, 0.04, 0.03, 'metal.aluminium', 0.18, y, -0.29);
      kit.box(g, 0.014, 0.009, 0.005, r > 0.55 ? 'led.cool' : 'led.warm', -0.20, y, -0.30);
      kit.box(g, 0.014, 0.009, 0.005, r > 0.25 ? 'led.cool' : 'plant.leaf', -0.17, y, -0.30);
      if (i % 2 === 0) kit.box(g, 0.014, 0.009, 0.005, 'led.cool', -0.14, y, -0.30);
    }
    /* พัดลม 2 ตัวบน + แผงสายสี */
    [-0.15, 0.15].forEach(function (fx) {
      var fan = new THREE.Mesh(kit.U.cylGeo ? kit.U.cylGeo(0.06, 0.06, 0.02, 10) : new THREE.CylinderGeometry(0.06, 0.06, 0.02, 10), kit.mat('plastic.grey'));
      fan.position.set(fx, 1.78, -0.34); fan.rotation.x = Math.PI / 2; g.add(fan);
    });
    [[-0.20, 'cable.black'], [-0.13, 'cable.black'], [-0.06, 'accent.orange'],
     [0.01, 'led.cool'], [0.08, 'plastic.grey'], [0.15, 'cable.black']].forEach(function (c, i) {
      kit.box(g, 0.022, 0.86, 0.022, c[1], c[0], 0.82, -0.26 + (i % 2) * 0.01);
    });
    /* PDU แนวตั้ง + บานกระจกโปร่ง + ขอบบาน */
    kit.box(g, 0.09, 0.70, 0.05, 'metal.aluminium', w / 2 - 0.07, 1.05, -0.20);
    kit.box(g, w - 0.10, h - 0.14, 0.012, 'glass.clear', 0, h / 2, -d / 2 + 0.02);
    kit.box(g, w - 0.06, 0.03, 0.03, 'metal.dark', 0, h - 0.07, -d / 2 + 0.02);
    kit.box(g, 0.03, h - 0.10, 0.03, 'metal.dark', -(w / 2 - 0.05), h / 2, -d / 2 + 0.02);
    kit.box(g, 0.03, h - 0.10, 0.03, 'metal.dark', (w / 2 - 0.05), h / 2, -d / 2 + 0.02);
    return g;
  }

  /* ── ห้องเซิร์ฟเวอร์ ────────────────────────────────────── */
  function buildServer(kit, room) {
    var root = new THREE.Group(), cols = [];
    var rw = room.w, rd = room.d, cx = room.x + rw / 2, cz = room.z + rd / 2;
    var FH = 0.035;                                   /* พื้นยก */
    var xMin = -rw / 2 + 0.10, xMax = rw / 2 - 0.10, zMin = -rd / 2 + 0.10, zMax = rd / 2 - 0.10;
    var fw = xMax - xMin, fd = zMax - zMin;
    function col(x0, z0, x1, z1, y0, y1) {
      cols.push({ x0: Math.min(x0, x1) + cx, z0: Math.min(z0, z1) + cz,
                  x1: Math.max(x0, x1) + cx, z1: Math.max(z0, z1) + cz, y0: y0, y1: y1 });
    }
    /* ── พื้นยก tile 0.6 + ร่อง ── */
    kit.box(root, fw, FH, fd, 'floor.tile.dark', 0, FH / 2, 0);
    var gx, gz;
    for (gx = xMin + 0.6; gx < xMax - 0.06; gx += 0.6)
      kit.box(root, 0.012, 0.006, fd, 'metal.dark', gx, FH + 0.003, 0);
    for (gz = zMin + 0.6; gz < zMax - 0.06; gz += 0.6)
      kit.box(root, fw, 0.006, 0.012, 'metal.dark', 0, FH + 0.003, gz);
    /* ขอบพื้นยก */
    kit.box(root, fw + 0.06, 0.05, 0.03, 'metal.aluminium', 0, 0.025, zMin - 0.015);
    kit.box(root, fw + 0.06, 0.05, 0.03, 'metal.aluminium', 0, 0.025, zMax + 0.015);
    kit.box(root, 0.03, 0.05, fd + 0.06, 'metal.aluminium', xMin - 0.015, 0.025, 0);
    kit.box(root, 0.03, 0.05, fd + 0.06, 'metal.aluminium', xMax + 0.015, 0.025, 0);

    /* ── ตู้แร็ค 19" 3 ตู้ ชิดผนังเหนือ ── */
    var rackZ = zMax - 0.06 - 0.425, racks = [-0.07, 0.55, 1.17];
    racks.forEach(function (rx2, i) {
      addRack(kit, root, rx2, rackZ, 11 + i * 7);
      col(rx2 - 0.31, rackZ - 0.44, rx2 + 0.31, rackZ + 0.44, 0, 2.0);
    });
    /* ── UPS ตัวใหญ่ ── */
    var ux = -1.55, uz = zMax - 0.75;
    kit.box(root, 0.55, 0.86, 0.62, 'metal.dark', ux, FH + 0.43, uz);
    kit.box(root, 0.50, 0.34, 0.02, 'plastic.black', ux, FH + 0.66, uz - 0.315);   /* หน้าจอ/แผงควบคุม */
    kit.box(root, 0.20, 0.10, 0.012, 'led.cool', ux, FH + 0.40, uz - 0.322);
    kit.box(root, 0.02, 0.02, 0.008, 'led.cool', ux - 0.16, FH + 0.74, uz - 0.322);
    kit.box(root, 0.02, 0.02, 0.008, 'led.warm', ux - 0.12, FH + 0.74, uz - 0.322);
    [[-0.20, -0.24], [0.20, -0.24], [-0.20, 0.24], [0.20, 0.24]].forEach(function (w) {
      kit.cyl(root, 0.035, 0.035, 0.03, 8, 'plastic.black', ux + w[0], FH + 0.015, uz + w[1]);
    });
    col(ux - 0.30, uz - 0.34, ux + 0.30, uz + 0.34, 0, 0.92);

    /* ── แอร์ห้องเย็นแบบตั้งพื้น (หันหน้า +x) ── */
    var ag = kit.grp(root, xMin + 0.28, FH, -0.6);
    kit.box(ag, 0.45, 1.85, 0.55, 'plastic.white', 0, 0.925, 0);
    kit.box(ag, 0.47, 0.30, 0.57, 'plastic.grey', 0, 1.55, 0);                 /* ช่องลมบน */
    for (var v = 0; v < 5; v++)
      kit.box(ag, 0.004, 0.02, 0.50, 'plastic.grey', 0.226, 1.44 + v * 0.055, 0);
    kit.box(ag, 0.012, 0.16, 0.20, 'plastic.black', 0, 1.05, 0);               /* จอแสดงผล */
    kit.box(ag, 0.014, 0.02, 0.012, 'led.cool', 0, 1.10, 0.02);
    kit.box(ag, 0.40, 0.05, 0.50, 'plastic.grey', 0, 0.03, 0);
    col(ag.position.x - 0.24, ag.position.z - 0.30, ag.position.x + 0.24, ag.position.z + 0.30, 0, 1.90);

    /* ── บันไดเล็ก 2 ขั้น ── */
    var lx = 2.05, lz = zMax - 0.60;
    [-1, 1].forEach(function (k) {
      kit.box(root, 0.03, 0.62, 0.03, 'metal.aluminium', lx + k * 0.20, FH + 0.31, lz - 0.16);
      kit.box(root, 0.03, 0.30, 0.03, 'metal.aluminium', lx + k * 0.20, FH + 0.15, lz + 0.18);
    });
    kit.box(root, 0.46, 0.03, 0.20, 'metal.aluminium', lx, FH + 0.30, lz - 0.10);
    kit.box(root, 0.46, 0.03, 0.20, 'metal.aluminium', lx, FH + 0.60, lz + 0.06);
    kit.box(root, 0.44, 0.03, 0.05, 'plastic.grey', lx, FH + 0.612, lz + 0.06);
    col(lx - 0.24, lz - 0.30, lx + 0.24, lz + 0.28, 0, 0.65);

    /* ── ladder cable tray บนเพดาน + มัดสาย ── */
    var tz = 2.42, tx = 0.55, tl = rd - 1.9;
    [-0.23, 0.23].forEach(function (dx) {
      kit.box(root, 0.045, 0.035, tl, 'metal.aluminium', tx + dx, tz, 0);
    });
    for (var t = -tl / 2 + 0.2; t <= tl / 2 - 0.1; t += 0.35)
      kit.box(root, 0.48, 0.02, 0.03, 'metal.aluminium', tx, tz, t);
    kit.box(root, 0.30, 0.06, tl - 0.30, 'cable.black', tx, tz + 0.045, 0);
    [-tl / 2 + 0.25, tl / 2 - 0.25].forEach(function (dz2) {
      kit.box(root, 0.03, 3.05 - tz, 0.03, 'metal.aluminium', tx, (3.05 + tz) / 2, dz2);
    });

    /* ── ป้ายห้ามเข้า + ไฟสถานะ ── */
    var signZ = zMin - 0.012, signX = 0.95;
    kit.box(root, 0.32, 0.24, 0.014, 'plastic.white', signX, 1.52, signZ);
    kit.cyl(root, 0.082, 0.082, 0.008, 12, 'accent.orange', signX, 1.56, signZ + 0.010, 0);
    root.children[root.children.length - 1].rotation.x = Math.PI / 2;
    kit.box(root, 0.145, 0.028, 0.006, 'plastic.white', signX, 1.56, signZ + 0.016);
    kit.box(root, 0.16, 0.22, 0.07, 'plastic.black', signX - 0.44, 1.42, signZ + 0.04);
    kit.box(root, 0.02, 0.02, 0.008, 'led.cool', signX - 0.44, 1.50, signZ + 0.08);
    kit.box(root, 0.02, 0.02, 0.008, 'led.warm', signX - 0.44, 1.46, signZ + 0.08);
    kit.box(root, 0.02, 0.02, 0.008, 'led.cool', signX - 0.44, 1.42, signZ + 0.08);
    /* ป้ายที่ตัวตู้แร็ค */
    kit.box(root, 0.28, 0.10, 0.008, 'plastic.grey', 0.55, 1.05, rackZ - 0.44);

    /* ── มัดสายไฟบนพื้น + ทางเข้าออก ── */
    kit.box(root, 0.34, 0.05, 1.30, 'cable.black', -1.55, FH + 0.028, zMax - 1.85);
    kit.box(root, 0.34, 0.05, 1.10, 'cable.black', 0.55, FH + 0.028, zMax - 1.15);
    kit.box(root, 0.10, 0.06, 2.00, 'cable.black', 1.55, FH + 0.032, zMax - 1.55);

    var parts = kit.debug ? collectParts(root) : null;
    var merged = kit.U.merge ? kit.U.merge(root) : root;
    merged.position.set(cx, 0, cz);
    merged.name = 'furnitureWork:server';
    merged.traverse(function (o) {
      if (!o.isMesh) return;
      var n = (o.material && o.material.name) || '';
      o.castShadow = /metal.dark|plastic.white|floor.tile.dark/.test(n);
    });
    return {
      group: merged, colliders: cols,
      parts: parts,
      stats: { kind: 'server', racks: 3, tray: tz, raised: FH,
               tiles: Math.round(fw / 0.6) + '/' + Math.round(fd / 0.6) }
    };
  }

  /* ── API ───────────────────────────────────────────────── */
  var api = {
    types: ['work', 'server'],
    buildRoom: function (room, ctx) {
      var kit = makeKit(ctx || {});
      if (!room) return { group: new THREE.Group(), colliders: [] };
      if (room.furn === 'server' || (room.id || '').indexOf('server') >= 0) return buildServer(kit, room);
      return buildWork(kit, room);
    },
    /* ให้ dev harness เรียกดูผังได้ */
    layoutWork: layoutWork,
    dims: W
  };
  O.furnitureWork = api;
})();
