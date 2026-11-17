/* ===========================================================================
   office3d/v2/lib2/furniture-meeting.js
   เฟอร์นิเจอร์ห้องประชุม (meeting · cap 6–8) และห้องอบรม (training · cap 12)
   ---------------------------------------------------------------------------
   API:  window.O3D2.furnitureMeeting = { types:['meeting','training'], buildRoom(room, ctx) }
   buildRoom(room, ctx) → { group, colliders }   (ไม่ scene.add เอง — assembler ทำ)
   หน่วยเมตร · y=0 = พื้น · ไม่สร้างผนัง/ฝ้า/ประตู (structure ทำ)
   ผัง:
     meeting  — ผนังจอ = ผนังที่ไม่มีหน้าต่าง/กระจก/ประตู (เลือกอัตโนมัติจาก plan2)
                โต๊ะประชุม stadium (ท็อปหนา 0.04 + ขอบ + 2 เสากลาง) โต๊ะตั้งฉากกับจอ
                เก้าอี้ = cap (เบาะ+พิง+ที่ทับแขน+ฐาน 5 แฉก+ลูกล้อ) + ของรายที่นั่ง
                จอ 65" + กล้อง + codec, whiteboard, credenza ใต้จอ, speakerphone,
                rug, ถังขยะ, ปลั๊กบนโต๊ะ, ป้ายสถานะว่าง/ไม่ว่างข้างประตู
     training — จอ 120" ผนังหน้า + โปรเจกเตอร์แขวน, โต๊ะเรียน 2 แถว × 2 ตัว (6 ที่นั่ง/แถว),
                เก้าอี้เลคเชอร์ 12, โพเดียม, กระดาน flip, โต๊ะครู + เก้าอี้, ทางเดินกลาง ≥1.0 ม.
   =========================================================================== */
(function () {
  var THREE = window.THREE;
  var O = window.O3D2 = window.O3D2 || {};
  var PI = Math.PI;

  var IN = 0.06;        // ผนัง t=0.12 → ผิวในถอย 0.06 จากเส้นกึ่งกลาง
  var TOPY = 0.75;      // ผิวโต๊ะประชุม/โต๊ะเรียน
  var RUGY = 0.004;     // พรมยกจากพื้นกัน z-fight

  /* ------------------------------- kit ---------------------------------- */
  function kit(ctx) {
    var U = ctx.util, mats = ctx.mats;
    var K = { U: U, mats: mats };
    K.mat = function (n) {
      var m = (mats && mats.get) ? mats.get(n) : null;
      return m || (mats && mats.get ? mats.get('plastic.grey') : null);
    };
    K.bx = function (g, w, h, d, m, x, y, z, ry) {
      var o = U.box(w, h, d, m, x, y, z, ry); g.add(o); return o;
    };
    K.cy = function (g, rt, rb, h, seg, m, x, y, z) {
      var o = U.cyl(rt, rb, h, seg, m, x, y, z); g.add(o); return o;
    };
    K.put = function (p, o, x, y, z, ry) {
      o.position.set(x || 0, y || 0, z || 0);
      if (ry) o.rotation.y = ry;
      p.add(o); return o;
    };
    return K;
  }

  /* ------------------------- ผนัง 4 ด้านของห้อง ------------------------- */
  function wallList(room, plan) {
    var bld = plan.building;
    return [
      { key: 'x0', inner: room.x + IN, normal: 1, axis: 'x', ext: Math.abs(room.x - bld.x) < 0.03,
        from: room.z + IN, to: room.z + room.d - IN, ry: PI / 2 },
      { key: 'x1', inner: room.x + room.w - IN, normal: -1, axis: 'x', ext: Math.abs(room.x + room.w - (bld.x + bld.w)) < 0.03,
        from: room.z + IN, to: room.z + room.d - IN, ry: -PI / 2 },
      { key: 'z0', inner: room.z + IN, normal: 1, axis: 'z', ext: Math.abs(room.z - bld.z) < 0.03,
        from: room.x + IN, to: room.x + room.w - IN, ry: 0 },
      { key: 'z1', inner: room.z + room.d - IN, normal: -1, axis: 'z', ext: Math.abs(room.z + room.d - (bld.z + bld.d)) < 0.03,
        from: room.x + IN, to: room.x + room.w - IN, ry: PI }
    ];
  }

  /* ความยาวที่หน้าต่างบานใหญ่ทับผนังนี้ (0 = ไม่มี) */
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

  /* เลือกผนัง: หลีกหน้าต่าง > กระจก > ประตู แล้วดูว่าของที่ต้องวาง "พอดี" ไหม
     opt.depthMin = ต้องยาวพอตามแนว normal · opt.spanMin = ต้องยาวพอตามแนวผนัง
     opt.bonus = {key: +ส่วนเพิ่ม} (เช่น +60 เพื่อไม่ให้ซ้ำกับผนังที่เลือกแล้ว) */
  function pickWall(walls, room, plan, door, opt) {
    opt = opt || {};
    var best = null, bestS = 1e9;
    walls.forEach(function (w) {
      var s = 0;
      if (winOverlap(w, plan) > 0) s += 900 + winOverlap(w, plan) * 50;
      if (room.glass && room.glass.indexOf(w.key) >= 0) s += 400;
      if (door && door.side === w.key) s += 300;
      if (opt.depthMin) {
        var lenDim = (w.axis === 'x') ? room.w : room.d;
        if (lenDim < opt.depthMin) s += 6000;
      }
      if (opt.spanMin) {
        var spanDim = (w.axis === 'x') ? room.d : room.w;
        if (spanDim < opt.spanMin) s += 6000;
      }
      if (opt.bonus && opt.bonus[w.key]) s += opt.bonus[w.key];
      if (s < bestS) { bestS = s; best = w; }
    });
    return best;
  }

  /* ประตู → ช่วงเปิด (เส้น 2 มิติ) ใช้เช็กเขตปลอด 1.0 ม. */
  function doorRange(room, door) {
    if (!door) return null;
    var w = door.w || 0.9, a = door.at || 1.0;
    if (door.side === 'z0' || door.side === 'z1') {
      return { horiz: 'x', a0: room.x + a - w / 2, a1: room.x + a + w / 2,
               b: door.side === 'z0' ? room.z : room.z + room.d };
    }
    return { horiz: 'z', a0: room.z + a - w / 2, a1: room.z + a + w / 2,
             b: door.side === 'x0' ? room.x : room.x + room.w };
  }
  function distToDoor(px, pz, d) {
    if (!d) return 99;
    var along = d.horiz === 'x' ? px : pz;
    var perp = d.horiz === 'x' ? pz : px;
    var da = along < d.a0 ? d.a0 - along : (along > d.a1 ? along - d.a1 : 0);
    var db = Math.abs(perp - d.b);
    return Math.sqrt(da * da + db * db);
  }

  /* --------------------------- เก้าอี้ประชุม --------------------------- */
  function chairMeeting(K) {
    var g = new THREE.Group();
    var dark = K.mat('metal.dark'), fab = K.mat('fabric.navy');
    var i, a, ca, sa, o;
    K.cy(g, 0.05, 0.055, 0.035, 12, dark, 0, 0.10, 0);                 // hub 0.082..0.118
    for (i = 0; i < 5; i++) {                                          // ฐาน 5 แฉก
      a = i * 2 * PI / 5 + 0.35; ca = Math.cos(a); sa = Math.sin(a);
      K.bx(g, 0.29, 0.032, 0.05, dark, ca * 0.145, 0.082, sa * 0.145, -a);
      o = K.cy(g, 0.026, 0.026, 0.024, 8, dark, ca * 0.275, 0.032, sa * 0.275);  // ลูกล้อ
      o.rotation.z = PI / 2;
    }
    K.cy(g, 0.028, 0.036, 0.32, 10, dark, 0, 0.26, 0);                 // กระบอก 0.10..0.42
    K.bx(g, 0.48, 0.06, 0.46, fab, 0, 0.445, 0);                       // เบาะ 0.415..0.475
    o = K.bx(g, 0.45, 0.50, 0.055, fab, 0, 0.72, -0.205);              // พิงหลัง 0.47..0.97
    o.rotation.x = -0.10;
    [-1, 1].forEach(function (s) {                                     // ที่ทับแขน
      K.bx(g, 0.038, 0.17, 0.035, dark, s * 0.247, 0.545, -0.075);
      K.bx(g, 0.05, 0.028, 0.28, dark, s * 0.247, 0.644, -0.045);
    });
    return g;
  }

  /* --------------------------- เก้าอี้เลคเชอร์ -------------------------- */
  function chairLecture(K) {
    var g = new THREE.Group();
    var steel = K.mat('metal.steel'), fab = K.mat('fabric.navy');
    var lx = 0.20, lz = 0.19, lh = 0.44;
    [[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]].forEach(function (p) {
      K.bx(g, 0.032, lh, 0.032, steel, p[0], lh / 2, p[1]);
    });
    K.bx(g, 0.46, 0.055, 0.44, fab, 0, 0.4675, 0);                     // เบาะ 0.44..0.495
    var b = K.bx(g, 0.44, 0.40, 0.045, fab, 0, 0.68, -0.19);           // พิง 0.48..0.88
    b.rotation.x = -0.11;
    K.bx(g, 0.42, 0.03, 0.03, steel, 0, 0.44, 0.0);                    // คานใต้เบาะ
    return g;
  }

  /* ------------------------- โต๊ะประชุม (stadium) ----------------------- */
  function halfW(x, L, W) {              // ครึ่งความกว้างของท็อปที่ตำแหน่ง x
    var R = W / 2, f = Math.max(0.001, L - W) / 2, ax = Math.abs(x);
    if (ax <= f) return R;
    var d = ax - f, r2 = R * R - d * d;
    return r2 > 0 ? Math.sqrt(r2) : 0;
  }
  function stadium(K, g, L, W, m, yTop, t) {
    var R = W / 2, flat = Math.max(L - W, 0.02);
    K.bx(g, flat, t, W, m, 0, yTop - t / 2, 0);
    K.cy(g, R, R, t, 20, m, -flat / 2, yTop - t / 2, 0);
    K.cy(g, R, R, t, 20, m, flat / 2, yTop - t / 2, 0);
  }

  function meetingTable(K, tg, L, W) {
    var wal = K.mat('wood.walnut'), steel = K.mat('metal.steel'), dark = K.mat('metal.dark');
    var i;
    stadium(K, tg, L, W, wal, TOPY, 0.04);                       // ท็อป 0.71..0.75
    stadium(K, tg, L - 0.035, W - 0.035, dark, TOPY - 0.04, 0.03); // ขอบ 0.68..0.71
    // 2 เสากลาง + ฐาน + คาน
    [-1, 1].forEach(function (s) {
      var x = s * Math.max(0.55, L / 2 - 0.62);
      K.bx(tg, 0.16, 0.62, 0.26, steel, x, 0.37, 0);            // 0.06..0.68
      K.bx(tg, 0.60, 0.06, 0.42, steel, x, 0.03, 0);            // 0..0.06
    });
    K.bx(tg, Math.max(0.8, L - 1.4), 0.09, 0.12, steel, 0, 0.62, 0);
    // grommet ครอบสายไฟ (กลางโต๊ะ)
    K.cy(tg, 0.105, 0.105, 0.014, 16, dark, -0.34, TOPY + 0.004, 0);
    K.cy(tg, 0.058, 0.058, 0.008, 16, steel, -0.34, TOPY + 0.011, 0);
    // speakerphone กลางโต๊ะ
    K.cy(tg, 0.125, 0.13, 0.034, 12, dark, 0.34, TOPY + 0.017, 0);
    for (i = 0; i < 3; i++) {
      var an = i * 2 * PI / 3 + 0.5;
      K.cy(tg, 0.016, 0.016, 0.008, 6, steel, 0.34 + Math.cos(an) * 0.085, TOPY + 0.036, Math.sin(an) * 0.085);
    }
    K.bx(tg, 0.075, 0.006, 0.018, K.mat('led.cool'), 0.34, TOPY + 0.036, 0.062);
    // ปลั๊ก/ที่ชาร์จบนโต๊ะ 2 จุด
    [-1, 1].forEach(function (s) {
      K.bx(tg, 0.13, 0.013, 0.07, steel, s * 1.15, TOPY + 0.006, 0);
      K.bx(tg, 0.03, 0.015, 0.02, K.mat('led.cool'), s * 1.15, TOPY + 0.009, 0.024);
    });
  }

  /* ---------------------------- โต๊ะเรียน ------------------------------ */
  function trainingDesk(K, len) {
    var g = new THREE.Group();                       // local x = ยาว, z = ลึก
    var lam = K.mat('wood.laminate'), steel = K.mat('metal.steel'), dark = K.mat('metal.dark');
    K.bx(g, len, 0.04, 0.55, lam, 0, TOPY - 0.02, 0);              // 0.71..0.75
    K.bx(g, len - 0.03, 0.03, 0.53, dark, 0, TOPY - 0.055, 0);     // ขอบ 0.68..0.71
    [-1, 1].forEach(function (sx) {
      [-1, 1].forEach(function (sz) {
        K.bx(g, 0.04, 0.71, 0.04, steel, sx * (len / 2 - 0.16), 0.355, sz * 0.215);
      });
    });
    K.bx(g, len - 0.7, 0.03, 0.03, steel, 0, 0.30, 0);
    return g;
  }

  /* ------------------------------- จอ 65" ------------------------------ */
  function tv65(K) {                                  // หลังชิดผนัง z=0 หัน +z
    var g = new THREE.Group();
    var dark = K.mat('metal.dark'), steel = K.mat('metal.steel'), on = K.mat('screen.on'), cool = K.mat('led.cool');
    K.bx(g, 0.32, 0.28, 0.02, steel, 0, 0, 0.01);      // แผ่นยึดผนัง 0..0.02
    K.bx(g, 0.09, 0.09, 0.018, dark, 0, 0, 0.027);     // แขน 0.018..0.036
    K.bx(g, 1.50, 0.87, 0.032, dark, 0, 0, 0.052);     // ขอบจอ 0.036..0.068
    K.bx(g, 1.44, 0.795, 0.008, on, 0, 0, 0.072);      // ผิวจอ 0.068..0.076
    K.bx(g, 0.30, 0.016, 0.010, steel, 0, 0.35, 0.054);   // แถบเรียบใต้ขอบจอ
    // กล้องประชุม (ใต้จอ + ขายึด)
    K.bx(g, 0.05, 0.045, 0.03, steel, 0, -0.446, 0.052);
    K.bx(g, 0.17, 0.05, 0.05, dark, 0, -0.472, 0.058);
    var lens = K.cy(g, 0.014, 0.014, 0.02, 10, steel, 0, -0.472, 0.086);
    lens.rotation.x = PI / 2;
    K.bx(g, 0.012, 0.012, 0.005, cool, 0.062, -0.472, 0.084);
    return g;
  }

  /* ---------------------------- whiteboard ----------------------------- */
  function whiteboard(K, wm) {                        // หลังชิดผนัง z=0 หัน +z
    var g = new THREE.Group();
    var white = K.mat('sign.white'), steel = K.mat('metal.steel'), dark = K.mat('metal.dark');
    var fab = K.mat('fabric.grey'), org = K.mat('accent.orange');
    var w = wm || 1.9, h = 1.2;
    K.bx(g, w, h, 0.025, white, 0, 0, 0.0125);                    // 0..0.025
    K.bx(g, w + 0.06, 0.032, 0.035, steel, 0, h / 2 + 0.016, 0.0175);
    K.bx(g, w + 0.06, 0.032, 0.035, steel, 0, -h / 2 - 0.016, 0.0175);
    K.bx(g, 0.032, h + 0.064, 0.035, steel, -w / 2 - 0.016, 0, 0.0175);
    K.bx(g, 0.032, h + 0.064, 0.035, steel, w / 2 + 0.016, 0, 0.0175);
    K.bx(g, w + 0.10, 0.028, 0.10, steel, 0, -h / 2 - 0.10, 0.05);   // ถาด
    [-0.55, -0.40, -0.25].forEach(function (x, i) {
      var o = K.cy(g, 0.011, 0.011, 0.13, 8, i === 1 ? dark : org, x, -h / 2 - 0.072, 0.055);
      o.rotation.z = PI / 2;
    });
    K.bx(g, 0.13, 0.03, 0.055, fab, 0.48, -h / 2 - 0.072, 0.05);      // แปรงลบ
    return g;
  }

  /* ------------------------------ credenza ---------------------------- */
  function credenza(K, len, dep, hh, opt) {            // หลังชิดผนัง z=0 หัน +z
    opt = opt || {};
    var g = new THREE.Group();
    var wal = K.mat('wood.walnut'), steel = K.mat('metal.steel');
    var d = dep || 0.45, h = hh || 0.72;
    K.bx(g, len, 0.04, d, wal, 0, h - 0.02, d / 2);                    // ท็อป h-0.04..h
    K.bx(g, len - 0.07, h - 0.17, d - 0.03, wal, 0, 0.10 + (h - 0.17) / 2, d / 2 + 0.005);  // ตัวตู้ 0.10..h-0.04
    [-1, 1].forEach(function (s) {
      [-1, 1].forEach(function (q) {
        K.bx(g, 0.035, 0.10, 0.035, steel, s * (len / 2 - 0.10), 0.05, d / 2 + q * (d / 2 - 0.06));
      });
    });
    [-1, 1].forEach(function (s) {                                     // มือจับ
      K.bx(g, 0.018, 0.10, 0.018, steel, s * 0.30, h - 0.22, d + 0.012);
    });
    /* ของวางบนท็อป (local coords) */
    if (opt.jug) {
      var jx = -len / 2 + 0.34;
      K.cy(g, 0.068, 0.074, 0.22, 12, K.mat('ceramic'), jx, h + 0.11, d / 2 + 0.02);
      [-0.06, 0.06, 0.18].forEach(function (dx) {
        K.cy(g, 0.030, 0.033, 0.085, 10, K.mat('ceramic'), jx + dx, h + 0.0425, d / 2 - 0.07);
      });
    }
    if (opt.codec) {
      K.bx(g, 0.26, 0.055, 0.20, K.mat('metal.dark'), len / 2 - 0.30, h + 0.0275, d / 2);
      K.bx(g, 0.05, 0.008, 0.012, K.mat('led.cool'), len / 2 - 0.30, h + 0.058, d / 2 + 0.075);
    }
    if (opt.tissue) K.bx(g, 0.20, 0.075, 0.11, K.mat('paper'), 0.02, h + 0.0375, d / 2 - 0.05);
    return g;
  }

  /* ------------------------------ โพเดียม ------------------------------ */
  function lectern(K) {                                // หัน +z, หลัง z=0
    var g = new THREE.Group();
    var wal = K.mat('wood.walnut'), steel = K.mat('metal.steel'), cool = K.mat('led.cool');
    K.bx(g, 0.46, 0.04, 0.40, steel, 0, 0.02, 0.20);                   // ฐาน 0..0.04
    K.bx(g, 0.40, 0.76, 0.28, wal, 0, 0.42, 0.17);                     // ตัว 0.04..0.80
    var top = K.bx(g, 0.50, 0.03, 0.34, wal, 0, 0.815, 0.19);          // ท็อปเอียง
    top.rotation.x = -0.20;
    K.bx(g, 0.50, 0.05, 0.02, steel, 0, 0.80, 0.345);                  // ขอบกันหลุด
    K.bx(g, 0.19, 0.006, 0.018, cool, 0.12, 0.826, 0.155);             // ไฟอ่านหนังสือ
    return g;
  }

  /* ---------------------------- กระดาน flip ---------------------------- */
  function flipBoard(K) {                              // หัน +z, หลัง z=0
    var g = new THREE.Group();
    var steel = K.mat('metal.steel'), paper = K.mat('paper'), dark = K.mat('metal.dark');
    K.bx(g, 0.035, 1.78, 0.035, steel, -0.36, 0.89, 0.06);
    K.bx(g, 0.035, 1.78, 0.035, steel, 0.36, 0.89, 0.06);
    K.bx(g, 0.03, 1.60, 0.03, steel, 0, 0.80, -0.16);                  // ขาหลัง
    K.bx(g, 0.72, 0.03, 0.03, steel, 0, 0.62, -0.05);                  // คานหลัง→หน้า
    K.bx(g, 0.74, 0.05, 0.045, dark, 0, 1.74, 0.075);                  // คาน掛บน
    K.bx(g, 0.68, 0.88, 0.012, paper, 0, 1.27, 0.10);                  // กระดาษ
    K.bx(g, 0.74, 0.026, 0.06, steel, 0, 0.82, 0.115);                 // ถาดปากกา
    return g;
  }

  /* ---------------------------- จอ 120" ------------------------------- */
  function projScreen(K) {                             // หลังชิดผนัง z=0 หัน +z
    var g = new THREE.Group();
    var dark = K.mat('metal.dark'), on = K.mat('screen.on'), steel = K.mat('metal.steel');
    K.bx(g, 2.72, 0.11, 0.11, dark, 0, 0.755, 0.055);                 // กล่องม้วนจอ
    K.bx(g, 2.56, 1.44, 0.014, on, 0, 0, 0.031);                      // จอ
    K.bx(g, 2.58, 0.03, 0.035, steel, 0, -0.728, 0.036);              // คานล่าง
    [-1, 1].forEach(function (s) {
      K.bx(g, 0.09, 0.09, 0.05, steel, s * 0.95, 0.755, 0.012);       // ขายึดผนัง
    });
    return g;
  }

  /* ---------------------------- โปรเจกเตอร์ ---------------------------- */
  function projector(K) {                              // เลนส์อยู่ local +z
    var g = new THREE.Group();
    var dark = K.mat('metal.dark'), steel = K.mat('metal.steel'), cool = K.mat('led.cool');
    K.cy(g, 0.018, 0.018, 0.31, 8, steel, 0, 0.215, 0);               // เสาแขวน
    K.bx(g, 0.13, 0.02, 0.13, steel, 0, 0.375, 0);                    // แผ่นติดฝ้า
    K.bx(g, 0.34, 0.10, 0.24, dark, 0, 0, 0);                         // ตัวเครื่อง
    var lens = K.cy(g, 0.028, 0.028, 0.028, 10, steel, 0.09, 0, 0.128);
    lens.rotation.x = PI / 2;
    K.bx(g, 0.012, 0.012, 0.005, cool, -0.13, 0.02, 0.122);
    return g;
  }

  /* ------------------------------- ถังขยะ ------------------------------ */
  function binMesh(K) {
    var g = new THREE.Group();
    var steel = K.mat('metal.steel'), dark = K.mat('metal.dark');
    K.cy(g, 0.13, 0.112, 0.32, 14, steel, 0, 0.16, 0);
    K.cy(g, 0.135, 0.135, 0.02, 14, dark, 0, 0.33, 0);
    return g;
  }

  /* -------------------------------- ต้นไม้ ---------------------------- */
  function plantMesh(K) {
    var g = new THREE.Group();
    var pot = K.mat('plant.pot'), leaf = K.mat('plant.leaf');
    K.cy(g, 0.125, 0.10, 0.30, 14, pot, 0, 0.15, 0);
    var sg = new THREE.SphereGeometry(1, 10, 7);
    [[0, 0.56, 0, 0.21], [0.13, 0.66, 0.06, 0.15], [-0.11, 0.70, -0.05, 0.14], [0.02, 0.82, 0.01, 0.11]]
      .forEach(function (b) {
        var m = new THREE.Mesh(sg, leaf);
        m.position.set(b[0], b[1], b[2]);
        m.scale.setScalar(b[3]);
        g.add(m);
      });
    return g;
  }

  /* ------------------------- ป้ายสถานะว่าง/ไม่ว่าง ---------------------- */
  function signPanel(K) {                              // หลังชิดผนัง z=0 หัน +z
    var g = new THREE.Group();
    var white = K.mat('sign.white'), steel = K.mat('metal.steel');
    var cool = K.mat('led.cool'), org = K.mat('accent.orange');
    K.bx(g, 0.21, 0.145, 0.022, white, 0, 0, 0.011);                  // แผ่น 0..0.022
    K.bx(g, 0.225, 0.018, 0.026, steel, 0, 0.062, 0.013);
    K.bx(g, 0.15, 0.014, 0.026, steel, 0, -0.012, 0.013);             // แถบ (ไม่ใช้ตัวอักษร)
    var lc = K.cy(g, 0.020, 0.020, 0.008, 10, cool, -0.045, -0.048, 0.027);
    lc.rotation.x = PI / 2;
    var lo = K.cy(g, 0.020, 0.020, 0.008, 10, org, 0.045, -0.048, 0.027);
    lo.rotation.x = PI / 2;
    return g;
  }

  /* ============================ ห้องประชุม ============================== */
  function buildMeeting(room, ctx, K, root, cols) {
    var plan = ctx.plan;
    var walls = wallList(room, plan);
    var door = room.door || null;
    var dr = doorRange(room, door);
    var cap = Math.min(10, Math.max(4, room.cap || 8));
    var perSide = Math.ceil(cap / 2), perSideB = cap - perSide;
    var L = Math.max(2.6, perSide * 0.80 + 0.60);
    var W = cap >= 8 ? 1.46 : 1.34;
    var CH = W / 2 + 0.20;                    // ระยะศูนย์เก้าอี้จากแกนโต๊ะ

    // ผนังจอ: ยาวพอสำหรับโต๊ะ (L+2.0 ตามแนว normal) + เก้าอี้ (W+2.6 ตามแนวผนัง)
    var wall = pickWall(walls, room, plan, door, { depthMin: L + 2.0, spanMin: W + 2.6 });
    var nrm = wall.normal, axisX = wall.axis === 'x';
    var spanC = axisX ? room.z + room.d / 2 : room.x + room.w / 2;      // ศูนย์กลางตามแนวผนัง
    var perpC = spanC;
    var tabEnd = wall.inner + nrm * 1.10;                               // credenza 0.45 + ยืน 0.65
    var tX = axisX ? tabEnd + nrm * L / 2 : spanC;
    var tZ = axisX ? spanC : tabEnd + nrm * L / 2;
    var yaw = axisX ? (nrm > 0 ? 0 : PI) : (nrm > 0 ? -PI / 2 : PI / 2);
    var ax = { x: Math.cos(yaw), y: -Math.sin(yaw) };                   // local +x ในโลก
    var pv = { x: Math.sin(yaw), y: Math.cos(yaw) };                    // local +z ในโลก
    // แปลง (ระยะจากผิวผนัง, ระยะตามแนวผนัง) → พิกัดโลก
    function WP(nOff, sAbs) {
      return axisX ? { x: wall.inner + nrm * nOff, z: sAbs } : { x: sAbs, z: wall.inner + nrm * nOff };
    }

    /* --- โต๊ะ + ของบนโต๊ะ + เก้าอี้ (สร้างใน local frame ของโต๊ะ) --- */
    var tg = new THREE.Group();
    K.put(root, tg, tX, 0, tZ, yaw);
    meetingTable(K, tg, L, W);

    // พรมใต้โต๊ะ (คลุมลูกล้อทุกตัว)
    var rugL = L + 1.3, rugW = 2 * CH + 0.62;
    var rug = K.U.plane(rugL, rugW, K.mat('fabric.grey'), 0, RUGY, 0);
    tg.add(rug);

    var seats = [], i, off;
    var span = L - 0.84;
    function seatOffs(n) {
      var out = [];
      if (n <= 1) return [0];
      for (i = 0; i < n; i++) out.push(-span / 2 + span * i / (n - 1));
      return out;
    }
    seatOffs(perSide).forEach(function (o) { seats.push({ off: o, side: -1 }); });
    seatOffs(perSideB).forEach(function (o) { seats.push({ off: o, side: 1 }); });

    var paper = K.mat('paper'), darkM = K.mat('metal.dark'), glass = K.mat('ceramic');
    seats.forEach(function (s) {
      // เก้าอี้
      var ch = chairMeeting(K);
      K.put(tg, ch, s.off, RUGY, s.side * CH, s.side < 0 ? 0 : PI);
      // สมุด + ปากกา + แก้วน้ำ
      var padPv = Math.min(0.50, halfW(s.off, L, W) - 0.20);
      K.bx(tg, 0.24, 0.006, 0.30, paper, s.off, TOPY + 0.003, s.side * padPv);
      K.bx(tg, 0.13, 0.009, 0.009, darkM, s.off - 0.02, TOPY + 0.010, s.side * padPv - 0.05);
      var cupX = Math.max(-L / 2 + 0.25, Math.min(L / 2 - 0.25, s.off + 0.34));
      var cupPv = Math.min(0.60, halfW(cupX, L, W) - 0.07);
      K.cy(tg, 0.031, 0.034, 0.10, 12, glass, cupX, TOPY + 0.05, s.side * cupPv);
    });

    // collider โต๊ะ + เก้าอี้ (พิกัดโลก)
    if (axisX) cols.push(K.U.collider(tX - L / 2, tZ - W / 2, tX + L / 2, tZ + W / 2, 0, TOPY));
    else cols.push(K.U.collider(tX - W / 2, tZ - L / 2, tX + W / 2, tZ + L / 2, 0, TOPY));
    seats.forEach(function (s) {
      var wx = tX + ax.x * s.off + pv.x * s.side * CH;
      var wz = tZ + ax.y * s.off + pv.y * s.side * CH;
      cols.push(K.U.collider(wx - 0.28, wz - 0.28, wx + 0.28, wz + 0.28, 0, 0.97));
    });

    /* --- จอ 65" + credenza ใต้จอ + codec --- */
    var tvP = WP(0, perpC);
    K.put(root, tv65(K), tvP.x, 1.30, tvP.z, wall.ry);
    var crL = Math.min(1.8, (axisX ? room.d : room.w) - 0.9);
    var crP = WP(0, perpC);
    // credenza ใต้จอ: เหยือก+แก้ว + กล่อง codec/VDO + ทิชชู
    K.put(root, credenza(K, crL, 0.45, 0.72, { jug: true, codec: true, tissue: true }), crP.x, 0, crP.z, wall.ry);
    var crCol = axisX ? { x0: Math.min(wall.inner, wall.inner + nrm * 0.45), x1: Math.max(wall.inner, wall.inner + nrm * 0.45),
                          z0: perpC - crL / 2, z1: perpC + crL / 2 }
                      : { z0: Math.min(wall.inner, wall.inner + nrm * 0.45), z1: Math.max(wall.inner, wall.inner + nrm * 0.45),
                          x0: perpC - crL / 2, x1: perpC + crL / 2 };
    cols.push(K.U.collider(crCol.x0, crCol.z0, crCol.x1, crCol.z1, 0, 0.72));

    /* --- credenza ที่ 2 (station น้ำ/ของใช้) ปลายห้องฝั่งประตู — เติมพื้นที่ว่าง --- */
    var w2 = null, s2 = 1e9;
    walls.forEach(function (w) {
      var oppK = { x0: 'x1', x1: 'x0', z0: 'z1', z1: 'z0' }[wall.key];
      var s = (w.key === wall.key) ? 80 : 0;
      if (w.key === oppK) s -= 150;                       // ชอบผนังตรงข้ามจอ
      if (winOverlap(w, plan) > 0) s += 40 + winOverlap(w, plan) * 20;
      if (room.glass && room.glass.indexOf(w.key) >= 0) s += 500;
      if (door && door.side === w.key) s += 320;
      if (s < s2) { s2 = s; w2 = w; }
    });
    if (w2) {
      var dSign = door ? ({ z1: 1, z0: -1, x1: 1, x0: -1 }[door.side] || 1) : 1;
      var sAxis = (w2.axis === 'x') ? 'z' : 'x';
      var dAxis = door ? (door.side.charAt(0) === 'z' ? 'z' : 'x') : 'z';
      var sign2 = (dAxis === sAxis) ? dSign : 1;
      var sLen = Math.min(1.7, (w2.to - w2.from) - 1.3);
      var sC2 = (w2.from + w2.to) / 2;
      var along2 = sC2 + sign2 * ((w2.to - w2.from) / 2 - 0.55 - sLen / 2);
      along2 = Math.max(w2.from + sLen / 2 + 0.12, Math.min(w2.to - sLen / 2 - 0.12, along2));
      var p2 = (w2.axis === 'x') ? { x: w2.inner, z: along2 } : { x: along2, z: w2.inner };
      K.put(root, credenza(K, sLen, 0.45, 0.72, { jug: true }), p2.x, 0, p2.z, w2.ry);
      var c2 = (w2.axis === 'x')
        ? { x0: Math.min(w2.inner, w2.inner + w2.normal * 0.45), x1: Math.max(w2.inner, w2.inner + w2.normal * 0.45),
            z0: along2 - sLen / 2, z1: along2 + sLen / 2 }
        : { z0: Math.min(w2.inner, w2.inner + w2.normal * 0.45), z1: Math.max(w2.inner, w2.inner + w2.normal * 0.45),
            x0: along2 - sLen / 2, x1: along2 + sLen / 2 };
      cols.push(K.U.collider(c2.x0, c2.z0, c2.x1, c2.z1, 0, 0.72));
    }

    /* --- whiteboard: ผนังตรงข้ามจอถ้าว่าง ไม่งั้นผนังข้างจอ --- */
    var wbWall = null, wbS = 1e9;
    walls.forEach(function (w) {
      if (door && door.side === w.key) return;
      var s = 0;
      if (winOverlap(w, plan) > 0) s += 900;
      if (room.glass && room.glass.indexOf(w.key) >= 0) s += 500;
      if (w.key === wall.key) s += 60;
      var spanDim = (w.axis === 'x') ? room.d : room.w;
      if (spanDim < 2.15) s += 6000;
      if (s < wbS) { wbS = s; wbWall = w; }
    });
    var wbAlong;
    var wbDim = (wbWall.axis === 'x') ? room.d : room.w;
    if (wbWall.key === wall.key) {
      var off2 = 0.9 + 0.15 + 0.95 + 0.06;
      var lowRoom = perpC - off2 - wbWall.from;
      var highRoom = wbWall.to - (perpC + off2);
      wbAlong = perpC + (highRoom >= lowRoom ? off2 : -off2);
    } else {
      wbAlong = (wbWall.from + wbWall.to) / 2;
    }
    wbAlong = Math.max(wbWall.from + 1.0, Math.min(wbWall.to - 1.0, wbAlong));
    var wbP = (wbWall.axis === 'x') ? { x: wbWall.inner, z: wbAlong } : { x: wbAlong, z: wbWall.inner };
    K.put(root, whiteboard(K, 1.9), wbP.x, 1.52, wbP.z, wbWall.ry);

    /* --- ถังขยะ + ต้นไม้ (มุมห้อง เลี่ยงเขตประตู 1.15 ม.) --- */
    var ix0 = room.x + 0.30, ix1 = room.x + room.w - 0.30;
    var iz0 = room.z + 0.30, iz1 = room.z + room.d - 0.30;
    var corners = [{ x: ix0, z: iz0 }, { x: ix1, z: iz0 }, { x: ix0, z: iz1 }, { x: ix1, z: iz1 }];
    var binAt = corners[0], binD = 99, farAt = corners[0], farD = -1;
    corners.forEach(function (c) {
      var dd = distToDoor(c.x, c.z, dr);
      if (dd >= 1.15 && dd < binD) { binD = dd; binAt = c; }
      if (dd > farD) { farD = dd; farAt = c; }
    });
    if (binD > 90) binAt = corners[0];
    K.put(root, binMesh(K), binAt.x, 0, binAt.z, 0);
    cols.push(K.U.collider(binAt.x - 0.15, binAt.z - 0.15, binAt.x + 0.15, binAt.z + 0.15, 0, 0.34));
    var plAt = farAt;
    K.put(root, plantMesh(K), plAt.x, 0, plAt.z, 0);
    cols.push(K.U.collider(plAt.x - 0.14, plAt.z - 0.14, plAt.x + 0.14, plAt.z + 0.14, 0, 1.0));

    /* --- ป้ายสถานะว่าง/ไม่ว่าง ข้างประตู (ในห้อง) --- */
    if (door) {
      var dp = (door.side === 'z0' || door.side === 'z1')
        ? { x: room.x + door.at + (door.w || 0.9) / 2 + 0.30, z: door.side === 'z0' ? room.z + IN : room.z + room.d - IN,
            ry: door.side === 'z0' ? 0 : PI }
        : { x: door.side === 'x0' ? room.x + IN : room.x + room.w - IN, z: room.z + door.at + (door.w || 0.9) / 2 + 0.30,
            ry: door.side === 'x0' ? PI / 2 : -PI / 2 };
      K.put(root, signPanel(K), dp.x, 1.42, dp.z, dp.ry);
    }
  }

  /* ============================= ห้องอบรม ============================== */
  function buildTraining(room, ctx, K, root, cols) {
    var plan = ctx.plan, walls = wallList(room, plan), door = room.door || null, dr = doorRange(room, door);
    var cap = Math.min(16, Math.max(6, room.cap || 12));
    var seatsPerRow = Math.min(6, Math.ceil(cap / 2));
    var rows = Math.max(2, Math.ceil(cap / seatsPerRow));
    var tablesPerRow = Math.ceil(seatsPerRow / 3);          // ≤3 ที่นั่ง/โต๊ะ
    var perTable = Math.ceil(seatsPerRow / tablesPerRow);
    var tLen = perTable * 0.80 + 0.20;                      // cap12 → 2.6 ม.
    var rowPitch = 2.20;                                  // ทางเดินระหว่างแถว ≈1.2 ม.
    var depthNeed = 1.60 + (rows - 1) * rowPitch + 1.6;

    var wall = pickWall(walls, room, plan, door, { depthMin: depthNeed, spanMin: tablesPerRow * tLen + 1.4 });
    var nrm = wall.normal, axisX = wall.axis === 'x';
    var spanC = axisX ? room.z + room.d / 2 : room.x + room.w / 2;
    function WP(nOff, sAbs) {
      return axisX ? { x: wall.inner + nrm * nOff, z: sAbs } : { x: sAbs, z: wall.inner + nrm * nOff };
    }
    var deskYaw = axisX ? -PI / 2 : 0;                    // แกนยาวของโต๊ะตามแนวผนัง
    var chairYaw = Math.atan2(axisX ? -nrm : 0, axisX ? 0 : -nrm);   // หันเข้าหาผนังหน้า

    /* --- จอ 120" + โปรเจกเตอร์ --- */
    var scP = WP(0, spanC);
    K.put(root, projScreen(K), scP.x, 1.55, scP.z, wall.ry);
    var prP = WP(3.30, spanC);
    K.put(root, projector(K), prP.x, 2.62, prP.z, Math.atan2(axisX ? nrm : 0, axisX ? 0 : nrm));

    /* --- โต๊ะเรียน 2 แถว --- */
    var rowLen = tablesPerRow * tLen + (tablesPerRow - 1) * 0.10;
    var i, t, r;
    for (i = 0; i < rows; i++) {
      var deskC = 1.60 + 0.275 + i * rowPitch;            // nOff ถึงศูนย์กลางโต๊ะ
      var chairC = deskC + 0.475;                        // เก้าอี้ทิ่มใต้โต๊ะ 3 ซม.
      for (t = 0; t < tablesPerRow; t++) {
        var sC = spanC - rowLen / 2 + tLen / 2 + t * (tLen + 0.10);
        var dp = WP(deskC, sC);
        K.put(root, trainingDesk(K, tLen), dp.x, 0, dp.z, deskYaw);
        if (axisX) cols.push(K.U.collider(dp.x - 0.275, dp.z - tLen / 2, dp.x + 0.275, dp.z + tLen / 2, 0, TOPY));
        else cols.push(K.U.collider(dp.x - tLen / 2, dp.z - 0.275, dp.x + tLen / 2, dp.z + 0.275, 0, TOPY));
      }
      /* เก้าอี้: กระจายเท่ากันตลอดความยาวแถว (จำนวน = seatsPerRow) */
      for (r = 0; r < seatsPerRow; r++) {
        var usable = rowLen - 0.90;
        var so = seatsPerRow > 1 ? (-usable / 2 + usable * r / (seatsPerRow - 1)) : 0;
        var cp = WP(chairC, spanC + so);
        K.put(root, chairLecture(K), cp.x, 0, cp.z, chairYaw);
        cols.push(K.U.collider(cp.x - 0.27, cp.z - 0.27, cp.x + 0.27, cp.z + 0.27, 0, 0.90));
      }
    }

    /* --- โพเดียม + กระดาน flip (หน้า, ซ้าย-ขวาของจอ) --- */
    var lecS = Math.min(spanC + 2.95, wall.to - 0.9);
    var lecP = WP(0.45, lecS);
    K.put(root, lectern(K), lecP.x, 0, lecP.z, wall.ry);
    cols.push(axisX
      ? K.U.collider(lecP.x - 0.22, lecP.z - 0.26, lecP.x + 0.22, lecP.z + 0.26, 0, 1.0)
      : K.U.collider(lecP.x - 0.26, lecP.z - 0.22, lecP.x + 0.26, lecP.z + 0.22, 0, 1.0));
    var flS = Math.max(spanC - 2.95, wall.from + 0.9);
    var flP = WP(0.32, flS);
    K.put(root, flipBoard(K), flP.x, 0, flP.z, wall.ry);
    cols.push(axisX
      ? K.U.collider(flP.x - 0.20, flP.z - 0.40, flP.x + 0.20, flP.z + 0.40, 0, 1.8)
      : K.U.collider(flP.x - 0.40, flP.z - 0.20, flP.x + 0.40, flP.z + 0.20, 0, 1.8));

    /* --- โต๊ะครู + เก้าอี้ (ท้ายห้อง) --- */
    var depthDim = axisX ? room.w : room.d;
    var tOff = depthDim - 0.12 - 0.35;                    // ชิดผนังท้าย
    var tdP = WP(tOff, spanC);
    K.put(root, trainingDesk(K, 1.40), tdP.x, 0, tdP.z, deskYaw);   // โต๊ะครู 1.4 ม.
    if (axisX) cols.push(K.U.collider(tdP.x - 0.275, tdP.z - 0.70, tdP.x + 0.275, tdP.z + 0.70, 0, TOPY));
    else cols.push(K.U.collider(tdP.x - 0.70, tdP.z - 0.275, tdP.x + 0.70, tdP.z + 0.275, 0, TOPY));
    var tcP = WP(tOff - 0.45, spanC);
    K.put(root, chairMeeting(K), tcP.x, 0, tcP.z, chairYaw);
    cols.push(K.U.collider(tcP.x - 0.28, tcP.z - 0.28, tcP.x + 0.28, tcP.z + 0.28, 0, 0.97));

    /* --- credenza station น้ำ ท้ายห้อง (เติมพื้นที่ว่าง) --- */
    var bwall = null;
    walls.forEach(function (w) {
      var oppKey = { x0: 'x1', x1: 'x0', z0: 'z1', z1: 'z0' }[wall.key];
      if (w.key === oppKey) bwall = w;
    });
    if (bwall) {
      var sLen2 = Math.min(1.6, (bwall.to - bwall.from) - 1.4);
      var dSign2 = door ? ({ z1: 1, z0: -1, x1: 1, x0: -1 }[door.side] || 1) : 1;
      var sAxis2 = (bwall.axis === 'x') ? 'z' : 'x';
      var dAxis2 = door ? (door.side.charAt(0) === 'z' ? 'z' : 'x') : 'z';
      var sign3 = (dAxis2 === sAxis2) ? dSign2 : 1;
      var sC3 = (bwall.from + bwall.to) / 2;
      var along3 = sC3 + sign3 * ((bwall.to - bwall.from) / 2 - 0.55 - sLen2 / 2);
      along3 = Math.max(bwall.from + sLen2 / 2 + 0.15, Math.min(bwall.to - sLen2 / 2 - 0.15, along3));
      var p3 = (bwall.axis === 'x') ? { x: bwall.inner, z: along3 } : { x: along3, z: bwall.inner };
      K.put(root, credenza(K, sLen2, 0.45, 0.72, { jug: true }), p3.x, 0, p3.z, bwall.ry);
      var c3 = (bwall.axis === 'x')
        ? { x0: Math.min(bwall.inner, bwall.inner + bwall.normal * 0.45), x1: Math.max(bwall.inner, bwall.inner + bwall.normal * 0.45),
            z0: along3 - sLen2 / 2, z1: along3 + sLen2 / 2 }
        : { z0: Math.min(bwall.inner, bwall.inner + bwall.normal * 0.45), z1: Math.max(bwall.inner, bwall.inner + bwall.normal * 0.45),
            x0: along3 - sLen2 / 2, x1: along3 + sLen2 / 2 };
      cols.push(K.U.collider(c3.x0, c3.z0, c3.x1, c3.z1, 0, 0.72));
    }

    /* --- ถังขยะ + ต้นไม้ --- */
    var ix0 = room.x + 0.30, ix1 = room.x + room.w - 0.30;
    var iz0 = room.z + 0.30, iz1 = room.z + room.d - 0.30;
    var corners = [{ x: ix0, z: iz0 }, { x: ix1, z: iz0 }, { x: ix0, z: iz1 }, { x: ix1, z: iz1 }];
    var binAt = corners[0], binD = 99, farAt = corners[0], farD = -1;
    corners.forEach(function (c) {
      var dd = distToDoor(c.x, c.z, dr);
      if (dd >= 1.15 && dd < binD) { binD = dd; binAt = c; }
      if (dd > farD) { farD = dd; farAt = c; }
    });
    if (binD > 90) binAt = corners[1];
    K.put(root, binMesh(K), binAt.x, 0, binAt.z, 0);
    cols.push(K.U.collider(binAt.x - 0.15, binAt.z - 0.15, binAt.x + 0.15, binAt.z + 0.15, 0, 0.34));
    K.put(root, plantMesh(K), farAt.x, 0, farAt.z, 0);
    cols.push(K.U.collider(farAt.x - 0.14, farAt.z - 0.14, farAt.x + 0.14, farAt.z + 0.14, 0, 1.0));
  }

  /* ------------------------------- API --------------------------------- */
  O.furnitureMeeting = {
    types: ['meeting', 'training'],
    buildRoom: function (room, ctx) {
      var K = kit(ctx);
      var root = new THREE.Group();
      root.name = 'furn.' + (room.id || room.furn || 'room');
      var cols = [];
      var kind = (room.furn === 'training') ? 'training' : 'meeting';
      if (kind === 'training') buildTraining(room, ctx, K, root, cols);
      else buildMeeting(room, ctx, K, root, cols);
      var merged = ctx.util.merge(root);
      merged.name = root.name;
      return { group: merged, colliders: cols,
               meta: { kind: kind, cap: room.cap, rooms: room.id } };
    }
  };
})();
