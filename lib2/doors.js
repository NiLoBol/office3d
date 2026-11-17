/* office3d/v2/lib2/doors.js — ประตู หน้าต่าง กระจกกั้นห้อง (รายละเอียดระดับใกล้)
   API: O3D2.doors.build(ctx) → { group, colliders, meta }   (เรียกครั้งเดียวทั้งฉาก)
        O3D2.doors.H / .SLIDE_H / .cut()  = ค่าที่ structure ต้องใช้เจาะช่องให้ตรงกัน
   โหลดหลัง: three.min.js, plan2.js, lib2/util.js, lib2/materials.js
   หน่วยเมตร · y=0 = ระดับพื้น · x/z ตาม CONTRACT
   หลักการ: ชิ้นของเราทุกชิ้นอยู่ใน "ช่องเจาะ" ที่ structure ทำไว้ (เผื่อ INSET=0.005)
            วงกบ+architrave ปิดรอยต่อให้ดูเนียน และไม่แตะผิวผนัง (ไม่มี z-fighting)
*/
(function () {
  var O = window.O3D2 = window.O3D2 || {};
  var THREE = window.THREE;
  if (!THREE) { if (window.console) console.warn('doors.js: ต้องโหลด three.min.js ก่อน'); return; }

  var INSET = 0.005;        // ระยะเผื่อจากขอบช่องเจาะ
  var FRAME_W = 0.052;      // ความหนาวงกบ (ตามระนาบผนัง)
  var DOOR_H = 2.100;       // ความสูงช่องประตู (structure ต้องเจาะ H นี้)
  var SLIDE_H = 2.100;      // ช่องประตูบานเลื่อนกระจก
  var LEAF_T = 0.040;       // ความหนาบานประตู
  var GLASS_T = 0.012;      // ความหนากระจกSingle
  var IN_SIGN = { z0: 1, z1: -1, x0: -1, x1: 1 };   // ทิศเข้าห้อง เทียบกับ local +z ของผนัง
  var SIDES = ['z0', 'z1', 'x0', 'x1'];

  var S = null;   // สถานะต่อ build 1 ครั้ง

  /* ---------- วัสดุของโหนดเอง ----------
     ซีนรวมไม่มี scene.environment → วัสดุ metalness สูงจะดำและกระจกจะทึบ
     จึงทำวัสดุเองที่โปร่ง/สว่างจริง (parent อนุมัติ) */
  var LOCAL = {};
  var LSPEC = {
    clear:  { c: 0xeaf6fe, o: 0.13, r: 0.05, m: 0.0 },   // กระจกใส (โปร่งจริง)
    faint:  { c: 0xdfeef7, o: 0.05, r: 0.10, m: 0.0 },   // ชั้นในจาง ๆ ของกระจก 2 ชั้น
    frosted:{ c: 0xeaf1f5, o: 0.30, r: 0.50, m: 0.0 },   // กระจกฝ้า
    chrome: { c: 0xeef2f5, o: 1.0,  r: 0.24, m: 0.10 },  // สแตนเลสสว่าง (มือจับ)
    alu:    { c: 0xc9d0d6, o: 1.0,  r: 0.34, m: 0.16 },  // อลูมิเนียมอโนไดซ์ (วงกบ/มัลลิออน/เสา)
    steel:  { c: 0xd2d8dd, o: 1.0,  r: 0.32, m: 0.15 },  // แผ่นกันชน/push bar
    oak:    { c: 0xd2c7b3, o: 1.0,  r: 0.42, m: 0.02 },  // บานไม้ (สีล้วน ไม่มี texture ยืด)
    white:  { c: 0xeae6dc, o: 1.0,  r: 0.38, m: 0.02 },
    edge:   { c: 0x9c8768, o: 1.0,  r: 0.45, m: 0.02 },  // ขอบบาน (stile) เข้มขึ้น
    edgew:  { c: 0xb8b1a1, o: 1.0,  r: 0.42, m: 0.02 }
  };
  var ALIAS = { '__glass': 'clear', '__faint': 'faint', '__frosted': 'frosted',
                '__chrome': 'chrome', '__steel': 'steel',
                '__oak': 'oak', '__white': 'white', '__edge': 'edge', '__edgew': 'edgew',
                '__alu': 'alu' };
  function localMat(key) {
    if (LOCAL[key]) return LOCAL[key];
    var p = LSPEC[key] || LSPEC.clear;
    var m = new THREE.MeshStandardMaterial({ color: p.c, roughness: p.r, metalness: p.m });
    if (p.o < 1) { m.transparent = true; m.opacity = p.o; m.depthWrite = false; m.side = THREE.DoubleSide; }
    m.name = 'o3d.' + key;
    LOCAL[key] = m; return m;
  }

  /* ================= helpers ================= */
  function mat(name) {
    if (ALIAS[name]) return localMat(ALIAS[name]);
    if (name === '__faint') return faintMat();
    if (S.mats && S.mats.get) { var m = S.mats.get(name); if (m) return m; }
    return S.grey;
  }
  function bx(g, w, h, d, name, u, y, n) {
    var m = S.U.box(w, h, d, mat(name), u, y, n);
    g.add(m);
    if (S.parts) S.parts.push({ mat: name, w: w, h: h, d: d, u: u, y: y, n: n, wall: g.userData.wall });
    return m;
  }
  function cylY(g, r, h, name, u, y, n, seg) { var m = S.U.cyl(r, r, h, seg || 10, mat(name), u, y, n); g.add(m); return m; }
  function cylZ(g, r, h, name, u, y, n, seg) {
    var m = new THREE.Mesh(S.U.cylGeo(r, r, h, seg || 10), mat(name));
    m.position.set(u, y, n); m.rotation.x = Math.PI / 2; g.add(m); return m;
  }
  function cylU(g, r, h, name, u, y, n, seg) {
    var m = new THREE.Mesh(S.U.cylGeo(r, r, h, seg || 10), mat(name));
    m.position.set(u, y, n); m.rotation.z = Math.PI / 2; g.add(m); return m;
  }
  function grp(parent) { var g = new THREE.Group(); if (parent) parent.add(g); return g; }

  /* แปลงพิกัด local ของผนัง (u ตามยาว, y ขึ้น, n ตั้งฉาก) → โลก */
  function makeWall(side, uOrigin, plane) {
    var g = new THREE.Group();
    g.userData.wall = { side: side, uOrigin: uOrigin, plane: plane };
    if (side === 'z0' || side === 'z1') { g.position.set(uOrigin, 0, plane); g.rotation.y = 0; }
    else { g.position.set(plane, 0, uOrigin); g.rotation.y = -Math.PI / 2; }
    return g;
  }
  function toWorld(side, uOrigin, plane, u, n) {
    return (side === 'z0' || side === 'z1')
      ? { x: uOrigin + u, z: plane + n }
      : { x: plane - n, z: uOrigin + u };
  }

  /* ความหนาผนังของด้านนั้น: อยู่ขอบอาคาร = tExt */
  function wallT(side, plane, plan) {
    var b = plan.building, e = 0.03;
    if (side === 'z0' && Math.abs(plane - b.z) < e) return b.tExt;
    if (side === 'z1' && Math.abs(plane - (b.z + b.d)) < e) return b.tExt;
    if (side === 'x0' && Math.abs(plane - b.x) < e) return b.tExt;
    if (side === 'x1' && Math.abs(plane - (b.x + b.w)) < e) return b.tExt;
    return b.tInt;
  }
  /* ความหนาซึ่งครึ่งของผนังตั้งฉากที่พิกัด coord (ใช้กันกระจกชนผนังข้าง) */
  function perpT(axis, coord, plan) {
    var b = plan.building, e = 0.03;
    if (axis === 'x' && (Math.abs(coord - b.x) < e || Math.abs(coord - (b.x + b.w)) < e)) return b.tExt;
    if (axis === 'z' && (Math.abs(coord - b.z) < e || Math.abs(coord - (b.z + b.d)) < e)) return b.tExt;
    return b.tInt;
  }

  /* ข้อมูลกำแพงของด้านหนึ่งของห้อง (หรือของอาคาร ถ้าไม่ส่ง room) */
  function wallInfo(room, side, plan) {
    var b = plan.building, plane, uOrigin, len;
    if (!room) {
      if (side === 'z0') { plane = b.z; uOrigin = b.x; len = b.w; }
      else if (side === 'z1') { plane = b.z + b.d; uOrigin = b.x; len = b.w; }
      else if (side === 'x0') { plane = b.x; uOrigin = b.z; len = b.d; }
      else { plane = b.x + b.w; uOrigin = b.z; len = b.d; }
    } else if (side === 'z0') { plane = room.z; uOrigin = room.x; len = room.w; }
    else if (side === 'z1') { plane = room.z + room.d; uOrigin = room.x; len = room.w; }
    else if (side === 'x0') { plane = room.x; uOrigin = room.z; len = room.d; }
    else { plane = room.x + room.w; uOrigin = room.z; len = room.d; }
    return { side: side, plane: plane, uOrigin: uOrigin, len: len,
             t: wallT(side, plane, plan), inSign: IN_SIGN[side] };
  }

  function isGlassSide(room, side) { return !!(room && room.glass && room.glass.indexOf(side) >= 0); }

  /* ============ วงกบ + architrave (กรอบรอบช่อง) ============ */
  function frameSet(g, W, H, T, mn, opt) {
    opt = opt || {};
    var wi = W - 2 * INSET;                       // ความกว้างใช้ได้ในช่องเจาะ
    var depth = Math.max(0.060, T - 0.012);       // ลึกน้อยกว่าผนัง 6 มม. → ไม่แตะผิว
    var headBot = H - INSET - FRAME_W;            // ขอบล่างของหัววงกบ
    var jw = opt.jw || FRAME_W;
    if (opt.jamb !== false) {
      bx(g, jw, headBot, depth, mn, -(wi / 2) + jw / 2, headBot / 2, 0);
      bx(g, jw, headBot, depth, mn, (wi / 2) - jw / 2, headBot / 2, 0);
    }
    if (opt.head !== false) bx(g, wi, FRAME_W, depth, mn, 0, headBot + FRAME_W / 2, 0);
    if (opt.trim !== false) {                     // architrave บนผิวผนังทั้งสองฝั่ง (ยื่น 1.4 ซม.)
      var tw = 0.070, td = 0.014, tz = T / 2 + 0.006, vh = H - 0.030;
      [1, -1].forEach(function (s) {
        bx(g, tw, vh, td, mn, -(wi / 2 + tw / 2), vh / 2, s * tz);
        bx(g, tw, vh, td, mn, (wi / 2 + tw / 2), vh / 2, s * tz);
        bx(g, wi + 2 * tw, 0.080, td, mn, 0, H + 0.010, s * tz);   // หัว (abut พอดี ไม่ซ้อน)
      });
    }
    return { wi: wi, jw: jw, headBot: headBot, depth: depth, top: H - INSET };
  }
  /* แผ่นปิดเหนือวงกบ (สีผนัง) — ถ้า structure เจาะสูงกว่า H จะกลายเป็นผนังต่อเนื่องให้เอง */
  function headerFiller(g, W, T, top) {
    bx(g, W - 2 * INSET, 0.260, Math.max(0.060, T - 0.012), 'wall.paint', 0, top + 0.130, 0);
  }

  /* ============ บานประตู (1 บาน) + อุปกรณ์ ============ */
  /* o = {u, y(กลางบาน), w, h, t, hingeSign(-1/1 = บานพับอยู่ทาง -u/+u),
          matLeaf, kick, hinges(3|2|0), closer, T(หนาผนัง), handleSign (ฝั่งมือจับ +1/-1 ของ n)} */
  function leafBoxes(g, o) {
    var u = o.u, cy = o.y, w = o.w, h = o.h, t = o.t || LEAF_T, T = o.T || 0.12;
    var hs = o.hingeSign < 0 ? -1 : 1;
    var hingeU = u + hs * w / 2;
    var handU = u - hs * w / 2;                  // ขอบอิสระ
    /* บาน: stile/rail ขอบเข้ม + แกนในเว้นร่อง 4 มม. (อ่านเป็นบานจริง และไม่ยืด texture) */
    var isWhite = (o.matLeaf === 'white' || o.matLeaf === '__white');
    var coreKey = isWhite ? '__white' : '__oak', edgeK = isWhite ? '__edgew' : '__edge';
    var sw = 0.052, topR2 = 0.052, botR2 = 0.130;
    var ct = Math.max(0.026, t - 0.008), chh = Math.max(0.05, h - topR2 - botR2);
    bx(g, sw, h, t, edgeK, u - w / 2 + sw / 2, cy, 0);
    bx(g, sw, h, t, edgeK, u + w / 2 - sw / 2, cy, 0);
    bx(g, w - 2 * sw, topR2, t, edgeK, u, cy + h / 2 - topR2 / 2, 0);
    bx(g, w - 2 * sw, botR2, t, edgeK, u, cy - h / 2 + botR2 / 2, 0);
    bx(g, w - 2 * sw, chh, ct, coreKey, u, cy + (botR2 - topR2) / 2, 0);

    /* แผ่นกันชนล่าง (kick plate) ทั้งสองฝั่ง */
    if (o.kick !== false) {
      var kzz = t / 2 + 0.001, ky = cy - h / 2 + 0.085;
      bx(g, w - 0.10, 0.130, 0.004, '__steel', u, ky, kzz);
      bx(g, w - 0.10, 0.130, 0.004, '__steel', u, ky, -kzz);
    }

    /* บานพับ (knuckle + plate) */
    var nH = o.hinges === undefined ? 3 : o.hinges;
    if (nH) {
      var ys = nH >= 3
        ? [cy - h / 2 + 0.30, cy, cy + h / 2 - 0.22]
        : [cy - h / 2 + 0.30, cy + h / 2 - 0.22];
      ys.forEach(function (yy) {
        cylY(g, 0.013, 0.105, 'metal.dark', hingeU, yy, 0, 10);
        bx(g, 0.046, 0.105, 0.005, 'metal.dark', hingeU - hs * 0.034, yy, t / 2 + 0.001);
        bx(g, 0.046, 0.105, 0.005, 'metal.dark', hingeU - hs * 0.034, yy, -t / 2 - 0.001);
      });
    }

    /* มือจับ lever ทั้งสองข้าง (ฝั่งที่โผล่ = ฝั่งห้อง + ฝั่งตรงข้าม) */
    var roseU = handU + hs * 0.072, hy = cy + 0.10;
    [1, -1].forEach(function (s) {
      var fz = t / 2;
      bx(g, 0.058, 0.104, 0.006, 'plastic.black', roseU, hy, s * (fz + 0.001));      // escutcheon เข้ม
      bx(g, 0.064, 0.086, 0.014, '__chrome', roseU, hy, s * (fz + 0.004));          // rose
      bx(g, 0.028, 0.028, 0.042, '__chrome', roseU, hy, s * (fz + 0.030));          // คอ
      bx(g, 0.172, 0.030, 0.026, '__chrome', roseU + hs * 0.072, hy, s * (fz + 0.064)); // lever
      bx(g, 0.032, 0.032, 0.012, '__chrome', roseU, hy - 0.024, s * (fz + 0.020));  // ก้านล็อก
    });

    /* โช้คประตู (door closer) บนหัว + ก้านต่อถึงหัววงกบ (ฝั่งห้อง) */
    if (o.closer) {
      /* โช้คประตู: แขวนใต้หัววงกบ + ก้านลงมาแตะผิวบาน (ฝั่งห้อง) */
      var s = o.handleSign || 1, cz = s * (t / 2 + 0.025), cb = o.headBot || (cy + h / 2);
      bx(g, 0.300, 0.014, 0.058, 'metal.dark', hingeU - hs * 0.150, cb - 0.004, cz);        // แผ่นยึดใต้หัว
      bx(g, 0.260, 0.058, 0.052, '__steel', hingeU - hs * 0.150, cb - 0.040, cz);       // ตัวโช้ค
      bx(g, 0.215, 0.018, 0.030, '__steel', hingeU - hs * 0.290, cb - 0.078, cz);       // ก้าน (แตะผิวบาน)
      bx(g, 0.040, 0.034, 0.034, '__chrome', hingeU - hs * 0.010, cb - 0.040, cz);      // บานพับก้าน
    }

    /* ป้ายหมายเลขห้อง (ฝั่งนอกห้อง) + เลขหลอก */
    if (o.plate !== false && o.plateU !== undefined) {
      var so = o.plateSide || 1, pz = T / 2 + 0.003;
      bx(g, 0.110, 0.052, 0.010, 'plastic.black', o.plateU, 1.520, so * pz);
      bx(g, 0.012, 0.026, 0.003, 'sign.white', o.plateU - 0.020, 1.520, so * (pz + 0.0050));
      bx(g, 0.012, 0.026, 0.003, 'sign.white', o.plateU + 0.004, 1.520, so * (pz + 0.0050));
    }
  }

  /* ============ ประตู swing / swing-lock ============ */
  function buildSwing(root, room, plan, lock) {
    var dr = room.door, side = dr.side, W = dr.w, H = dr.h || DOOR_H;
    var info = wallInfo(room, side, plan);
    var uC = dr.at;
    var g = makeWall(side, info.uOrigin + uC, info.plane);   // local u = 0 = กึ่งกลางประตู
    root.add(g);
    uC = 0;
    var fs = frameSet(g, W, H, info.t, '__alu');
    if (!isGlassSide(room, side)) headerFiller(g, W, info.t, fs.top);

    var leafBot = lock ? 0.014 : 0.006;
    var leafTop = fs.headBot - 0.005;
    var leafH = leafTop - leafBot;
    var leafW = fs.wi - 2 * fs.jw - 0.006;
    var hingeSign = dr.hinge || -1;   // -1 = บานพับทางซ้าย (u ต่ำ)
    var hs = hingeSign < 0 ? -1 : 1;

    leafBoxes(g, {
      u: uC, y: (leafTop + leafBot) / 2, h: leafH, w: leafW, T: info.t,
      hingeSign: hs, matLeaf: lock ? '__white' : '__oak',
      closer: true, headBot: fs.headBot, hinges: 3,
      handleSign: info.inSign,
      plateSide: -info.inSign,
      plateU: uC - hs * (W / 2 + 0.165)          // ป้ายอยู่ฝั่งบานพับ (ฝั่งที่ว่าง)
    });

    if (lock) {
      /* ธรณี */
      bx(g, fs.wi, 0.014, Math.max(0.060, info.t - 0.020), 'stone.grey', uC, 0.007, 0);
      /* ล็อกการ์ด + LED (ฝั่งนอกห้อง) */
      var so = -info.inSign, rz = info.t / 2 + 0.014, ru = uC + hs * (W / 2 + 0.130);
      bx(g, 0.090, 0.130, 0.030, 'plastic.black', ru, 1.120, so * rz);
      bx(g, 0.070, 0.100, 0.006, 'plastic.grey', ru, 1.115, so * (rz + 0.016));
      bx(g, 0.014, 0.010, 0.004, 'led.cool', ru, 1.176, so * (rz + 0.020));
      bx(g, 0.050, 0.016, 0.006, 'plastic.grey', ru, 1.055, so * (rz + 0.016));
    }
    S.meta.doors++;
    bumpType(lock ? 'swing-lock' : 'swing');
  }

  /* ============ ประตู 2 บาน (double) ============ */
  function buildDouble(root, room, plan) {
    var dr = room.door, side = dr.side, W = dr.w, H = dr.h || DOOR_H;
    var info = wallInfo(room, side, plan);
    var uC = dr.at;
    var g = makeWall(side, info.uOrigin + uC, info.plane);   // local u = 0 = กึ่งกลางประตู
    root.add(g);
    uC = 0;
    var fs = frameSet(g, W, H, info.t, '__alu');
    if (!isGlassSide(room, side)) headerFiller(g, W, info.t, fs.top);

    var leafBot = 0.006, leafTop = fs.headBot - 0.005;
    var leafH = leafTop - leafBot, cy = (leafTop + leafBot) / 2;
    var tot = fs.wi - 2 * fs.jw, L = (tot - 0.006) / 2;
    var lu = uC - (0.003 + L / 2), ru = uC + (0.003 + L / 2);
    leafBoxes(g, { u: lu, y: cy, h: leafH, w: L, T: info.t, hingeSign: -1, hinges: 2,
                   closer: true, handleSign: info.inSign, plateSide: -info.inSign,
                   plateU: uC - (W / 2 + 0.165) });
    leafBoxes(g, { u: ru, y: cy, h: leafH, w: L, T: info.t, hingeSign: 1, hinges: 2,
                   closer: false, plate: false });
    /* หลบหลัง (meeting stile) กันแสงลอด */
    bx(g, 0.020, leafH, LEAF_T + 0.004, '__oak', uC, cy, 0);
    S.meta.doors++; bumpType('double');
  }

  /* ============ ประตูบานเลื่อนกระจก ============ */
  function buildSliding(root, room, plan) {
    var dr = room.door, side = dr.side, W = dr.w, H = dr.h || SLIDE_H;
    var info = wallInfo(room, side, plan);
    var uC = dr.at, gi = isGlassSide(room, side);
    var g = makeWall(side, info.uOrigin + uC, info.plane);   // local u = 0 = กึ่งกลางประตู
    root.add(g);
    uC = 0;
    var fs = frameSet(g, W, H, info.t, '__alu', { jamb: !gi, head: !gi, trim: !gi });
    if (!gi) headerFiller(g, W, info.t, fs.top);

    /* ความกว้างว่างระหว่างวงกบ (หรือระหว่างเสากระจกถ้าเป็นผนังกระจก) */
    var openW = gi ? (W - 0.070) : (fs.wi - 2 * fs.jw);
    /* รางบน + รางล่าง (ไกด์พื้น) */
    bx(g, openW, 0.052, 0.075, '__alu', uC, H - INSET - 0.026, 0);
    bx(g, openW, 0.012, 0.080, '__alu', uC, 0.006, 0);
    /* ฝาครอบรางบน */
    bx(g, openW + 0.02, 0.016, 0.085, 'metal.dark', uC, H - INSET - 0.060, 0);

    var leafBot = 0.022, leafTop = H - INSET - 0.062;
    var lh = leafTop - leafBot, ly = (leafTop + leafBot) / 2;
    var lw = openW / 2 + 0.040;                // กว้างต่อบาน (เหลื่อมกลาง 8 ซม.)
    var zA = -0.032, zB = 0.032;
    var uA = uC - openW / 2 + lw / 2;          // บานหลัง (ปิดฝั่งซ้าย)
    var uB = uC + openW / 2 - lw / 2 - 0.420;  // บานหน้า เลื่อนเปิดไปทางซ้าย 42 ซม.

    slideLeaf(g, { u: uA, z: zA, w: lw, h: lh, y: ly, glass: '__frosted', handleSign: info.inSign, handAt: 1 });
    slideLeaf(g, { u: uB, z: zB, w: lw, h: lh, y: ly, glass: '__glass', handleSign: -info.inSign, handAt: 1 });
    S.meta.doors++; bumpType('sliding-glass');
  }

  function slideLeaf(g, o) {
    var w = o.w, h = o.h, u = o.u, y = o.y, z = o.z, t = 0.028;
    var st = 0.040, topR = 0.038, botR = 0.048;
    bx(g, st, h, t, '__alu', u - w / 2 + st / 2, y, z);
    bx(g, st, h, t, '__alu', u + w / 2 - st / 2, y, z);
    bx(g, w - 2 * st, topR, t, '__alu', u, y + h / 2 - topR / 2, z);
    bx(g, w - 2 * st, botR, t, '__alu', u, y - h / 2 + botR / 2, z);
    bx(g, w - 2 * st + 0.004, h - topR - botR, 0.010, o.glass, u, y + (botR - topR) / 2, z);
    /* มือจับตั้ง + สตัด */
    var s = o.handleSign, hx = u + o.handAt * (w / 2 - 0.055);
    var faceN = z + s * (t / 2);
    bx(g, 0.022, 0.026, 0.022, '__chrome', hx, y + 0.190, faceN + s * 0.014);
    bx(g, 0.022, 0.026, 0.022, '__chrome', hx, y - 0.190, faceN + s * 0.014);
    bx(g, 0.032, 0.380, 0.032, '__chrome', hx, y, faceN + s * 0.045);
  }

  /* ============ หน้าต่างภายนอก ============ */
  function buildWindow(root, w, plan) {
    var side = w.side;
    var uC = (w.from + w.to) / 2, W = w.to - w.from;
    var info = wallInfo(null, side, plan);
    var g = makeWall(side, info.uOrigin + uC, info.plane);   // local u = 0 = กึ่งกลางหน้าต่าง
    root.add(g);
    var sill = w.sill === undefined ? 0.95 : w.sill, head = w.head === undefined ? 2.55 : w.head;
    var H = head - sill, T = info.t;
    var wi = W - 2 * INSET, depth = Math.max(0.060, T - 0.012);

    /* วงกบอลูมิเนียม หนา 0.05 */
    var fw = 0.045;
    bx(g, fw, H - INSET, depth, '__alu', -(wi / 2) + fw / 2, sill + (H - INSET) / 2, 0);
    bx(g, fw, H - INSET, depth, '__alu', (wi / 2) - fw / 2, sill + (H - INSET) / 2, 0);
    bx(g, wi, fw, depth, '__alu', 0, head - INSET - fw / 2, 0);
    bx(g, wi, fw, depth, '__alu', 0, sill + INSET + fw / 2, 0);

    /* mullion ทุก ~1.5 ม. */
    var n = Math.max(1, Math.round(W / 1.5));
    var inner = wi - 2 * fw;
    for (var i = 1; i < n; i++) {
      var mu = -(wi / 2) + fw + inner * i / n;
      bx(g, 0.040, H - 2 * fw - 2 * INSET, 0.050, '__alu', mu, (sill + head) / 2, 0);
    }

    /* กระจก 2 ชั้น (นอก = clear, ใน = clear + ชั้นจาง) */
    var gTop = head - INSET - fw, gBot = sill + INSET + fw;
    var gh = gTop - gBot;
    for (var p = 0; p < n; p++) {
      var a = -(wi / 2) + fw + inner * p / n, bw = inner / n;
      var cu = a + bw / 2, gw = bw - 0.03;
      bx(g, gw, gh, 0.006, '__glass', cu, (gTop + gBot) / 2, 0.010);
      bx(g, gw, gh, 0.005, '__faint', cu, (gTop + gBot) / 2, -0.010);
    }

    /* ขอบหิน/ขอบอลูด้านล่าง ยื่นเข้าใน 0.03 (ผิวบนต่ำกว่าขอบช่อง 4 มม. → ไม่ coplanar) */
    bx(g, W + 0.09, 0.028, T + 0.030, 'stone.grey', 0, sill - 0.018, info.inSign * 0.015);

    /* มู่ลี่ (เกล็ด) — เฉพาะห้องฝ่ายขาย/ห้องประชุม/อบรม และบางช่อง */
    var mid = toWorld(side, info.uOrigin, info.plane, uC, info.inSign * 0.35);
    var room = findRoom(plan.rooms, mid.x, mid.z);
    if (room && /sales|meeting|training/.test(room.id) && (S.blindIdx++ % 2 === 0)) {
      var bz = info.inSign * (T / 2 + 0.028);
      bx(g, wi - 0.06, 0.050, 0.062, 'fabric.cream', 0, head - INSET - 0.095, bz);
      var slatW = wi - 0.10, ys = head - INSET - 0.14;
      var step = 0.072, nS = Math.floor((ys - (sill + 0.12)) / step);
      for (var k = 0; k < nS; k++) {
        var m = bx(g, slatW, 0.004, 0.048, 'fabric.cream', 0, ys - k * step, bz);
        m.rotation.x = 0.35;
      }
      bx(g, slatW, 0.020, 0.030, 'fabric.cream', 0, ys - nS * step, bz);  // รางล่าง
    }
    S.meta.windows++;
  }

  /* ============ ทางเข้า (ประตูกระจกบานคู่ + push bar + transom) ============ */
  function buildEntrance(root, plan) {
    var en = plan.entrance, side = en.side;
    var W = en.to - en.from, H = en.h || 2.40;
    var uC = (en.from + en.to) / 2;
    var info = wallInfo(null, side, plan);
    var T = info.t;
    var g = makeWall(side, info.uOrigin + uC, info.plane);   // local u = 0 = กึ่งกลางทางเข้า
    root.add(g);
    var wi = W - 2 * INSET, depth = Math.max(0.060, T - 0.012), fw = 0.045;

    /* ธรณี + วงกบ */
    bx(g, wi, 0.020, Math.max(0.060, T - 0.020), 'stone.grey', 0, 0.010, 0);
    bx(g, fw, H - INSET - 0.020, depth, '__alu', -(wi / 2) + fw / 2, (H - INSET + 0.020) / 2, 0);
    bx(g, fw, H - INSET - 0.020, depth, '__alu', (wi / 2) - fw / 2, (H - INSET + 0.020) / 2, 0);
    bx(g, wi, fw, depth, '__alu', 0, H - INSET - fw / 2, 0);
    /* architrave */
    var tw = 0.075, td = 0.016, tz = T / 2 + 0.006;
    [1, -1].forEach(function (s) {
      bx(g, tw, H - 0.03, td, '__alu', -(wi / 2 + tw / 2), (H - 0.03) / 2, s * tz);
      bx(g, tw, H - 0.03, td, '__alu', (wi / 2 + tw / 2), (H - 0.03) / 2, s * tz);
      bx(g, wi + 2 * tw, 0.080, td, '__alu', 0, H + 0.010, s * tz);
    });

    /* บานคู่ + transom */
    var lw = (wi - 2 * fw - 0.010) / 2;         // กว้างต่อบาน (เว้นกลาง 1 ซม.)
    var lb = 0.022, lt = 2.070, lh = lt - lb, ly = (lt + lb) / 2;
    var lu = -lw / 2 - 0.005, ru = lw / 2 + 0.005;
    /* คาน transom */
    bx(g, wi, 0.050, depth, '__alu', 0, lt + 0.025, 0);
    bx(g, wi - 2 * fw, (H - INSET - fw) - (lt + 0.060), 0.008, '__glass', 0,
       ((lt + 0.060) + (H - INSET - fw)) / 2, 0);

    [lu, ru].forEach(function (uu) {
      var st = 0.045, btR = 0.140;
      var t = 0.048;
      bx(g, st, lh, t, '__alu', uu - lw / 2 + st / 2, ly, 0);
      bx(g, st, lh, t, '__alu', uu + lw / 2 - st / 2, ly, 0);
      bx(g, lw - 2 * st, st, t, '__alu', uu, lt - st / 2, 0);
      bx(g, lw - 2 * st, btR, t, '__alu', uu, lb + btR / 2, 0);
      bx(g, lw - 2 * st + 0.004, lh - st - btR, 0.010, '__glass', uu,
         lb + btR + (lh - st - btR) / 2, 0);
      /* kick zone (แผ่นกันชน) */
      bx(g, lw - 0.09, 0.300, 0.004, '__steel', uu, lb + 0.170, t / 2 + 0.001);
      bx(g, lw - 0.09, 0.300, 0.004, '__steel', uu, lb + 0.170, -t / 2 - 0.001);
      /* push bar แนวนอน ฝั่งออก + brackets */
      var sOut = -info.inSign;
      cylU(g, 0.015, lw - 0.30, '__chrome', uu, 1.020, sOut * (t / 2 + 0.058), 8);
      bx(g, 0.032, 0.032, 0.060, 'metal.dark', uu - (lw - 0.32) / 2, 1.020, sOut * (t / 2 + 0.029));
      bx(g, 0.032, 0.032, 0.060, 'metal.dark', uu + (lw - 0.32) / 2, 1.020, sOut * (t / 2 + 0.029));
      /* มือจับตั้ง ฝั่งใน */
      var sIn = info.inSign, fz = sIn * (t / 2);
      bx(g, 0.024, 0.030, 0.024, '__chrome', uu - 0.02, 0.890, fz + sIn * 0.013);
      bx(g, 0.024, 0.030, 0.024, '__chrome', uu - 0.02, 1.150, fz + sIn * 0.013);
      bx(g, 0.030, 0.380, 0.030, '__chrome', uu - 0.02, 1.020, fz + sIn * 0.038);
    });

    /* พรมเช็ดเท้าด้านใน */
    bx(g, 1.900, 0.012, 1.100, 'rubber', 0, 0.006, info.inSign * (T / 2 + 0.58));
    S.meta.doors++; bumpType('entrance');
  }

  /* ============ กระจกกั้นห้องเต็มชั้น (room.glass) ============ */
  function buildGlassWall(root, room, side, plan) {
    var info = wallInfo(room, side, plan), g = makeWall(side, info.uOrigin, info.plane);
    root.add(g);
    var Hw = plan.building.wallH, T = info.t;
    var axis = (side === 'z0' || side === 'z1') ? 'x' : 'z';
    var e0 = perpT(axis, info.uOrigin, plan) / 2 + 0.005;
    var e1 = perpT(axis, info.uOrigin + info.len, plan) / 2 + 0.005;
    var u0 = e0, u1 = info.len - e1;
    if (u1 - u0 < 0.30) return;

    /* รางล่าง / รางบน */
    bx(g, u1 - u0, 0.048, 0.065, '__alu', (u0 + u1) / 2, 0.024, 0);
    bx(g, u1 - u0, 0.045, 0.065, '__alu', (u0 + u1) / 2, Hw - 0.0225, 0);

    /* ตำแหน่งเสากระจก: ทุก ~1.2 ม. + ขอบช่องประตู (ถ้าด้านนี้มีประตู) */
    var n = Math.max(1, Math.round((u1 - u0) / 1.2));
    var pos = [];
    for (var i = 0; i <= n; i++) pos.push(u0 + (u1 - u0) * i / n);
    var doorZone = null, dH = 0;
    if (room.door && room.door.side === side) {
      dH = room.door.h || DOOR_H;
      var a = room.door.at - room.door.w / 2, b2 = room.door.at + room.door.w / 2;
      a = Math.max(a, u0); b2 = Math.min(b2, u1);
      if (b2 - a > 0.2) { doorZone = [a, b2]; pos.push(a, b2); }
    }
    pos.sort(function (p, q) { return p - q; });
    pos = pos.filter(function (p, i) { return i === 0 || p - pos[i - 1] > 0.02; });

    /* เสา (อลูมิเนียม) */
    for (var j = 0; j < pos.length; j++) {
      bx(g, 0.050, Hw - 0.095, 0.060, '__alu', pos[j], (0.048 + Hw - 0.045) / 2, 0);
    }

    /* บานกระจก + แถบ frosted + คานเหนือประตู */
    for (var k = 0; k < pos.length - 1; k++) {
      var a2 = pos[k] + 0.030, b3 = pos[k + 1] - 0.030, mid = (a2 + b3) / 2, ww = b3 - a2;
      if (ww < 0.06) continue;
      var isDoor = doorZone && a2 >= doorZone[0] - 0.03 && b3 <= doorZone[1] + 0.03;
      if (isDoor) {
        /* เหนือประตู: คาน + กระจก transom */
        bx(g, ww + 0.060, 0.050, 0.060, '__alu', mid, dH + 0.025, 0);
        bx(g, ww, Hw - 0.045 - (dH + 0.050) - 0.010, GLASS_T, '__glass', mid,
           ((dH + 0.050) + (Hw - 0.045)) / 2, 0);
        continue;
      }
      bx(g, ww, Hw - 0.093, GLASS_T, '__glass', mid, (0.048 + Hw - 0.045) / 2, 0);
      /* แถบ frosted กลางบาน สูง 0.20 ที่ระดับตา */
      bx(g, ww - 0.02, 0.200, 0.014, '__frosted', mid, 1.500, 0);   /* แถบฝ้า: ชั้นเดียว */
      /* collider */
      var p1 = toWorld(side, info.uOrigin, info.plane, pos[k], 0);
      var p2 = toWorld(side, info.uOrigin, info.plane, pos[k + 1], 0);
      var cx = (side === 'z0' || side === 'z1');
      var th = Math.max(0.06, T - 0.02);
      S.colliders.push(cx
        ? S.U.collider(p1.x, p1.z - th / 2, p2.x, p1.z + th / 2, 0, Hw)
        : S.U.collider(p1.x - th / 2, p1.z, p1.x + th / 2, p2.z, 0, Hw));
    }
    S.meta.partitions++;
  }

  /* ============ ตัวช่วย ============ */
  function bumpType(t) { S.meta.byType[t] = (S.meta.byType[t] || 0) + 1; }
  function findRoom(rooms, x, z) {
    if (!rooms) return null;
    for (var i = 0; i < rooms.length; i++) {
      var r = rooms[i];
      if (x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d) return r;
    }
    return null;
  }

  /* ================= build ================= */
  function build(ctx) {
    ctx = ctx || {};
    var plan = ctx.plan || window.OFFICE2;
    S = {
      U: ctx.util || O.util,
      mats: ctx.mats || O.mats,
      colliders: [], blindIdx: 0, parts: ctx.debug ? [] : null,
      meta: { doors: 0, windows: 0, partitions: 0, byType: {} },
      grey: new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.8, metalness: 0 }),
      faint: null
    };
    var root = new THREE.Group();
    root.name = 'doors.raw';
    var rooms = plan.rooms || [];

    /* structure สร้างกรอบ+กระจกหน้าต่างของมันเองไว้ในกลุ่มชื่อ 'glass' (สัญญาระบุว่าปิดได้ถ้าโหนด doors ทำเอง)
       → โหนดนี้ทำหน้าต่างครบ (กรอบ/มัลลิออน/กระจก 2 ชั้น/sill/มู่ลี่) จึงซ่อนของ structure ไม่ให้ซ้อนทับจนมืด */
    if (ctx.scene && ctx.scene.traverse) {
      var kill = [];
      ctx.scene.traverse(function (o) {
        if (o.isGroup && o.name && o.name !== 'doors' && /glass/i.test(o.name)) kill.push(o);
      });
      kill.forEach(function (o) { o.visible = false; });
      if (kill.length) S.meta.hidStructureGlass = kill.length;
    }

    rooms.forEach(function (room) { if (room.door) buildDoor(root, room, plan); });
    if (plan.entrance) buildEntrance(root, plan);
    (plan.windows || []).forEach(function (w) { buildWindow(root, w, plan); });
    rooms.forEach(function (room) {
      (room.glass || []).forEach(function (side) { if (SIDES.indexOf(side) >= 0) buildGlassWall(root, room, side, plan); });
    });

    /* fuse: 1 mesh ต่อ 1 material */
    var merged = S.U.merge(root);
    merged.name = 'doors';
    var tri = 0;
    merged.traverse(function (o) { if (o.isMesh) tri += o.geometry.attributes.position.count / 3; });

    var out = {
      parts: S.parts,
      group: merged,
      colliders: S.colliders,
      meta: {
        doors: S.meta.doors, windows: S.meta.windows, partitions: S.meta.partitions,
        byType: S.meta.byType, triangles: tri, drawCalls: merged.children.length, colliders: S.colliders.length,
        hidStructureGlass: S.meta.hidStructureGlass || 0
      }
    };
    S = null;
    return out;
  }

  function buildDoor(root, room, plan) {
    var t = room.door.type;
    if (t === 'swing') buildSwing(root, room, plan, false);
    else if (t === 'swing-lock') buildSwing(root, room, plan, true);
    else if (t === 'double') buildDouble(root, room, plan);
    else if (t === 'sliding-glass') buildSliding(root, room, plan);
    else buildSwing(root, room, plan, false);
  }

  /* วัสดุกระจกจางพิเศษ (ชั้นในของกระจก 2 ชั้น) — สร้างเมื่อใช้ครั้งแรก */
  var _faint = null;
  function faintMat() {
    if (!_faint) {
      _faint = new THREE.MeshStandardMaterial({ color: 0xdceefb, roughness: 0.15, metalness: 0,
        transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false });
      _faint.name = 'o3d.faint.glass';
    }
    return _faint;
  }

  O.doors = {
    H: DOOR_H,
    SLIDE_H: SLIDE_H,
    build: build,
    /* ช่องเจาะที่ structure ต้องทำ (world AABB) */
    cut: function (room, plan) {
      plan = plan || window.OFFICE2;
      var d = room.door, info = wallInfo(room, d.side, plan);
      var u0 = d.at - d.w / 2, u1 = d.at + d.w / 2;
      var h = d.h || DOOR_H;
      var p1 = toWorld(d.side, info.uOrigin, info.plane, u0, 0);
      var p2 = toWorld(d.side, info.uOrigin, info.plane, u1, 0);
      var zx = (d.side === 'z0' || d.side === 'z1');
      return zx
        ? { side: d.side, x0: p1.x, x1: p2.x, z0: p1.z - info.t / 2, z1: p1.z + info.t / 2, y0: 0, y1: h, t: info.t }
        : { side: d.side, z0: p1.z, z1: p2.z, x0: p1.x - info.t / 2, x1: p1.x + info.t / 2, y0: 0, y1: h, t: info.t };
    }
  };
  /* mat() ใช้ได้กับ '__faint' ด้วย */
  var _mat0 = mat;
})();
