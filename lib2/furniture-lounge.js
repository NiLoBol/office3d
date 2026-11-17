/* office3d/v2/lib2/furniture-lounge.js — โซนสาธารณะ (reception / pantry / corridor)
   ─ หน่วยเมตร, y=0 = พื้น, ชิ้นเฟอร์นิเจอร์สร้างใน "local frame" (หันหน้า +z) แล้ววางด้วย ry
   ─ ของทุกชิ้นวางใน rect ของ space โดยคำนวณ "ผิวผนัง" จาก plan.building (tExt/tInt)
   ─ คืน { group (merge แล้ว), colliders } ตาม CONTRACT.md
   Inventories:
     reception 8×9.5   : เคาน์เตอร์ L (slat front + top stone + logo WRIS) + จอ/คีย์บอร์ด/PC +
                         เก้าอี้พนักงาน + โซฟา 3 ที่ + โต๊ะกาแฟกระจก + พรม + ต้นไม้ใหญ่ +
                         ชั้นโบรชัวร์/ตู้ไปรษณีย์ + ภาพติดผนัง ×2 + ไฟติดผนัง ×2 + ถ้วยรางวัล
     pantry 9×9.5      : ตู้ล่าง+ตู้บนชุดครัว (ผนังตะวันตก) + อ่าง/ก๊อก + ไมโครเวฟ + เครื่องชงกาแฟ +
                         ชั้นแก้ว + ตู้เย็น 2 ประตู + ตู้จ่ายน้ำ + ถังขยะแยก 3 + โต๊ะนั่ง 4 + เก้าอี้ 4 +
                         โต๊ะบาร์สูง + สตูล 3 + กระดานประกาศ + นาฬิกา + ต้นไม้
     corridor 34×3     : ป้ายชื่อห้องทุกประตู (atlas) + ป้ายบอกทาง + กระดานประกาศ + ม้านั่ง +
                         ตู้โชว์ + ต้นไม้ 6 + ถังขยะ + extinguisher + EXIT + ตู้จ่ายน้ำ + ร่ม
   งบ: ≤45k tri, ≤40 call — ใช้ util.merge ซึ่งยุบทุก mesh ที่ material เดียวกัน
*/
(function () {
  var O = window.O3D2 = window.O3D2 || {};
  var THREE = window.THREE;

  /* ════════════════════ helpers ════════════════════ */
  var greyMat = null;
  function MT(ctx, name) {
    var m = ctx && ctx.mats && ctx.mats.get ? ctx.mats.get(name) : null;
    if (m) return m;
    if (!greyMat) greyMat = new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.85 });
    return greyMat;
  }
  var GEO = {};
  function gBox(w, h, d) { return new THREE.BoxGeometry(w, h, d); }   /* cache = util.boxGeo */
  function gSphere(r, w, h) { var k = 'S' + r + '|' + w + '|' + h; return GEO[k] || (GEO[k] = new THREE.SphereGeometry(r, w, h)); }
  function gCone(r, h, s) { var k = 'K' + r + '|' + h + '|' + s; return GEO[k] || (GEO[k] = new THREE.ConeGeometry(r, h, s)); }
  function gCyl(rt, rb, h, s, t0, tl) {
    var k = 'C' + rt + '|' + rb + '|' + h + '|' + s + '|' + t0 + '|' + tl;
    return GEO[k] || (GEO[k] = new THREE.CylinderGeometry(rt, rb, h, s, 1, false, t0, tl));
  }
  function gTorus(R, r, rs, ts) { var k = 'T' + R + '|' + r + '|' + rs + '|' + ts; return GEO[k] || (GEO[k] = new THREE.TorusGeometry(R, r, rs, ts)); }

  /* builder: เก็บ mesh ใน local frame */
  function B(ctx) { this.ctx = ctx; this.u = ctx.util; this.g = new THREE.Group(); }
  B.prototype.m = function (geo, mat, x, y, z, rx, ry, rz, order) {
    var m = new THREE.Mesh(geo, MT(this.ctx, mat));
    if (order) m.rotation.order = order;
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    this.g.add(m); return m;
  };
  /* box จากขอบเขต (x0..x1, y0..y1, z0..z1) */
  B.prototype.box = function (mat, x0, x1, y0, y1, z0, z1) {
    var w = Math.abs(x1 - x0), h = Math.abs(y1 - y0), d = Math.abs(z1 - z0);
    var geo = (this.u && this.u.boxGeo) ? this.u.boxGeo(w, h, d) : gBox(w, h, d);
    return this.m(geo, mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  };
  B.prototype.cy = function (mat, rt, rb, y0, y1, x, z, seg, t0, tl) {
    return this.m(gCyl(rt, rb, Math.abs(y1 - y0), seg || 12, t0 || 0, tl || Math.PI * 2), mat, x, (y0 + y1) / 2, z);
  };
  B.prototype.sph = function (mat, r, x, y, z, ws, hs, sy) {
    var m = this.m(gSphere(r, ws || 10, hs || 7), mat, x, y, z);
    if (sy) m.scale.y = sy;
    return m;
  };
  B.prototype.cu = function (mat, w, h, d, x, y, z, ry, rx, rz) {  /* box หมุนได้ (มุม) */
    return this.m((this.u && this.u.boxGeo) ? this.u.boxGeo(w, h, d) : gBox(w, h, d), mat, x, y, z, rx, ry, rz);
  };

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  /* ผิวผนังภายในของ space (คำนวณความหนาจริงจาก plan.building) */
  function wallInsets(space, plan) {
    var ba = (plan && plan.building) || {};
    var tE = ba.tExt || 0.24, tI = ba.tInt || 0.12;
    var bx0 = ba.x || 0, bz0 = ba.z || 0, bx1 = bx0 + (ba.w || 60), bz1 = bz0 + (ba.d || 60);
    var ix0 = Math.abs(space.x - bx0) < 0.002 ? tE / 2 : tI / 2;
    var iz0 = Math.abs(space.z - bz0) < 0.002 ? tE / 2 : tI / 2;
    var ix1 = Math.abs(space.x + space.w - bx1) < 0.002 ? tE / 2 : tI / 2;
    var iz1 = Math.abs(space.z + space.d - bz1) < 0.002 ? tE / 2 : tI / 2;
    return {
      x0: space.x + ix0, x1: space.x + space.w - ix1,
      z0: space.z + iz0, z1: space.z + space.d - iz1
    };
  }

  /* ════════════════ ป้ายข้อความ: canvas texture ตัวเดียว 16 ช่อง (4×4) ════════════════ */
  var ATL = null;
  var CELL_TXT = ['RECEPTION', 'SALES', 'MEETING 1', 'MEETING 2',
                  'PANTRY', 'SERVER', 'OPS', 'TRAINING',
                  'EXIT', 'WRIS', '', '',
                  '', '', '', ''];
  var C_RECEPTION = 0, C_SALES = 1, C_MEETING1 = 2, C_MEETING2 = 3,
      C_PANTRY = 4, C_SERVER = 5, C_OPS = 6, C_TRAINING = 7, C_EXIT = 8, C_LOGO = 9;
  function atlas(ctx) {
    if (ATL) return ATL;
    if (typeof document === 'undefined' || !document.createElement) return null;
    var cols = 4, rows = 4, cw = 256, ch = 64;
    var cv = document.createElement('canvas');
    cv.width = cols * cw; cv.height = rows * ch;
    var g = cv.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#1b222b'; g.fillRect(0, 0, cv.width, cv.height);
    for (var i = 0; i < CELL_TXT.length; i++) {
      var txt = CELL_TXT[i];
      if (!txt) continue;
      var col = i % cols, row = Math.floor(i / cols), X = col * cw, Y = row * ch;
      g.save(); g.translate(X, Y);
      if (i === C_EXIT) {                       /* EXIT: เขียว + ตัวอักษรขาว */
        g.fillStyle = '#1c6f43'; g.fillRect(0, 0, cw, ch);
        g.fillStyle = '#eaf6ee';
        g.beginPath(); g.moveTo(30, ch / 2); g.lineTo(56, 12); g.lineTo(56, ch - 12); g.closePath(); g.fill();
        g.font = 'bold 40px Arial, Helvetica, sans-serif';
        g.textAlign = 'left'; g.textBaseline = 'middle';
        g.fillText('EXIT', 70, ch / 2 + 1);
      } else if (i === C_LOGO) {                /* WRIS: พื้นเข้ม + แถบส้ม */
        g.fillStyle = '#222a34'; g.fillRect(0, 0, cw, ch);
        g.fillStyle = '#e28a3b'; g.fillRect(0, ch - 12, cw, 8);
        g.fillStyle = '#ffffff';
        g.font = 'bold 42px Arial, Helvetica, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('WRIS', cw / 2, ch / 2 - 4);
        g.fillStyle = '#9fb0c0';
        g.font = 'bold 13px Arial, Helvetica, sans-serif';
        g.fillText('OFFICE  ·  RECEPTION', cw / 2, ch - 20);
      } else {                                  /* ป้ายชื่อห้อง */
        g.fillStyle = '#2b3644'; g.fillRect(0, 0, cw, ch);
        g.fillStyle = '#e28a3b'; g.fillRect(0, 0, 9, ch);
        g.fillStyle = '#ffffff';
        g.font = 'bold 34px Arial, Helvetica, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(txt, cw / 2 + 5, ch / 2 + 1);
      }
      g.restore();
    }
    var tex = new THREE.CanvasTexture(cv);
    if (THREE.SRGBColorSpace && 'colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
    else if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    var mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0.0 });
    mat.name = 'sign.atlas';
    ATL = { mat: mat, tex: tex };
    return ATL;
  }
  /* แผ่นป้าย atlas (plane 2 tri, uv ถูก map เข้าช่อง) */
  function atlasPlate(ctx, cell, w, h) {
    var A = atlas(ctx);
    if (!A) return null;
    var col = cell % 4, row = Math.floor(cell / 4);
    var u0 = col / 4, u1 = (col + 1) / 4, v0 = 1 - (row + 1) / 4, v1 = 1 - row / 4;
    var geo = new THREE.PlaneGeometry(w, h);
    var uv = geo.attributes.uv, arr = uv.array;
    for (var i = 0; i < uv.count; i++) {
      arr[i * 2] = u0 + (u1 - u0) * arr[i * 2];
      arr[i * 2 + 1] = v0 + (v1 - v0) * arr[i * 2 + 1];
    }
    uv.needsUpdate = true;
    var m = new THREE.Mesh(geo, A.mat);
    return m;
  }

  /* ════════════════════════ ชิ้นส่วนทั่วไป ════════════════════════ */

  /* เก้าอี้สำนักงาน (หันหน้า +z, ฐาน 5 แฉก) */
  function chairOffice(ctx) {
    var b = new B(ctx), i, a;
    for (i = 0; i < 5; i++) {                                   /* ขา 5 แฉก */
      a = i * Math.PI * 2 / 5 + 0.3;
      b.cu('metal.steel', 0.30, 0.035, 0.05, Math.sin(a) * 0.15, 0.06, Math.cos(a) * 0.15, a);
      b.sph('plastic.black', 0.032, Math.sin(a) * 0.29, 0.033, Math.cos(a) * 0.29, 8, 5);
    }
    b.cy('metal.steel', 0.033, 0.033, 0.06, 0.36, 0, 0, 12);      /* กระบอกลม */
    b.box('fabric.navy', -0.24, 0.24, 0.36, 0.45, -0.23, 0.24);    /* เบาะ */
    b.box('metal.steel', -0.05, 0.05, 0.42, 0.66, -0.27, -0.21);   /* โครงหลัง */
    b.box('fabric.navy', -0.22, 0.22, 0.62, 1.04, -0.28, -0.21);   /* พนัก */
    b.box('metal.steel', -0.20, 0.20, 0.72, 0.76, -0.30, -0.27);   /* คานหลัง */
    b.box('metal.steel', -0.25, -0.19, 0.44, 0.52, -0.10, 0.24);   /* ที่วางแขน ซ */
    b.box('metal.steel', 0.19, 0.25, 0.44, 0.52, -0.10, 0.24);     /* ที่วางแขน ข */
    return b;
  }

  /* เก้าอี้โต๊ะอาหาร (หันหน้า +z) */
  function chairDining(ctx) {
    var b = new B(ctx), i, sx, sz;
    for (i = 0; i < 4; i++) {                                   /* ขา 4 */
      sx = (i === 0 || i === 3) ? -1 : 1; sz = (i < 2) ? -1 : 1;
      b.box('plastic.black', sx * 0.195 - 0.022, sx * 0.195 + 0.022, 0, 0.42, sz * 0.19 - 0.022, sz * 0.19 + 0.022);
    }
    b.box('plastic.black', -0.195, 0.195, 0.14, 0.165, -0.19, -0.16);   /* คานล่าง */
    b.box('fabric.grey', -0.23, 0.23, 0.42, 0.46, -0.22, 0.22);         /* เบาะ 0.46×0.44 */
    b.box('plastic.black', -0.195, -0.17, 0.46, 0.88, -0.26, -0.22);   /* โครงพนัก ซ */
    b.box('plastic.black', 0.17, 0.195, 0.46, 0.88, -0.26, -0.22);     /* โครงพนัก ข */
    b.box('fabric.grey', -0.21, 0.21, 0.62, 0.88, -0.26, -0.225);      /* พนัก */
    return b;
  }

  /* สตูลบาร์ สูง 0.76 */
  function barStool(ctx) {
    var b = new B(ctx);
    b.cy('metal.chrome', 0.20, 0.22, 0, 0.03, 0, 0, 12);           /* ฐาน */
    b.cy('metal.chrome', 0.025, 0.025, 0.03, 0.73, 0, 0, 10);      /* เสา */
    b.m(gTorus(0.145, 0.011, 5, 10), 'metal.chrome', 0, 0.28, 0); /* ราวพักเท้า */
    b.cy('fabric.grey', 0.185, 0.185, 0.73, 0.78, 0, 0, 14);       /* เบาะกลม */
    return b;
  }

  /* โซฟา 3 ที่นั่ง (หันหน้า +z) กว้าง 2.15 ลึก 0.90 */
  function sofa3(ctx) {
    var b = new B(ctx), i;
    for (i = 0; i < 4; i++) {                                      /* ขาเตี้ย */
      var sx = (i < 2) ? -0.9 : 0.9, sz = (i % 2) ? -0.38 : 0.38;
      b.box('metal.steel', sx - 0.02, sx + 0.02, 0, 0.09, sz - 0.02, sz + 0.02);
    }
    b.box('fabric.navy', -0.99, 0.99, 0.09, 0.38, -0.45, 0.45);     /* ฐาน */
    b.box('fabric.navy', -0.99, -0.82, 0.09, 0.66, -0.45, 0.45);    /* ที่วางแขน ซ */
    b.box('fabric.navy', 0.82, 0.99, 0.09, 0.66, -0.45, 0.45);      /* ที่วางแขน ข */
    b.box('fabric.navy', -0.99, 0.99, 0.38, 0.96, -0.45, -0.30);    /* พนักหลัง */
    for (i = 0; i < 3; i++) {                                      /* เบาะนั่ง 3 */
      var cx = (i - 1) * 0.53;
      b.box('fabric.navy', cx - 0.255, cx + 0.255, 0.38, 0.52, -0.42, 0.44);
      b.box('fabric.navy', cx - 0.25, cx + 0.25, 0.52, 0.92, -0.29, -0.20);   /* หมอนหลัง */
    }
    b.cu('fabric.cream', 0.30, 0.30, 0.11, -0.62, 0.58, -0.16, 0.35, -0.28, 0.18);
    b.cu('fabric.cream', 0.30, 0.30, 0.11, 0.62, 0.58, -0.16, -0.35, 0.28, -0.18);
    return b;
  }

  /* โต๊ะกาแฟกระจก 1.0×0.55 + หนังสือ/แจกัน (ยอด 0.42) */
  function coffeeGlass(ctx) {
    var b = new B(ctx), i, sx, sz;
    b.box('glass.clear', -0.50, 0.50, 0.40, 0.416, -0.275, 0.275);   /* ยอดกระจก */
    b.box('metal.steel', -0.46, 0.46, 0.345, 0.365, -0.235, -0.215);/* คานล่าง ซ */
    b.box('metal.steel', -0.46, 0.46, 0.345, 0.365, 0.215, 0.235);  /* คานล่าง ข */
    for (i = 0; i < 4; i++) {
      sx = (i < 2) ? -0.46 : 0.46; sz = (i % 2) ? -0.225 : 0.225;
      b.box('metal.steel', sx - 0.016, sx + 0.016, 0, 0.40, sz - 0.016, sz + 0.016);
    }
    b.box('paper', -0.22, 0.10, 0.416, 0.436, -0.14, 0.06);         /* นิตยสาร */
    b.cu('paper', 0.26, 0.014, 0.20, 0.16, 0.424, 0.05, 0.4);
    b.cy('ceramic', 0.045, 0.06, 0.416, 0.60, 0.30, -0.10, 10);     /* แจกัน */
    b.sph('plant.leaf', 0.09, 0.30, 0.63, -0.10, 8, 6, 0.8);         /* ดอกไม้ */
    return b;
  }

  /* พรม (ศูนย์กลาง = จุดวาง) */
  function rug(ctx, w, d, mat) {
    var b = new B(ctx);
    b.box(mat || 'fabric.cream', -w / 2, w / 2, 0, 0.011, -d / 2, d / 2);
    return b;
  }

  /* ต้นไม้กระถาง (บุช) — pot 0.34 / สูง ~0.75 */
  function plantBush(ctx, scale) {
    var b = new B(ctx), s = scale || 1;
    b.cy('ceramic', 0.17 * s, 0.13 * s, 0, 0.34 * s, 0, 0, 12);
    b.cy('soil', 0.155 * s, 0.155 * s, 0.30 * s, 0.335 * s, 0, 0, 12);
    b.cy('plant.leaf', 0.02, 0.035, 0.33 * s, 0.52 * s, 0, 0, 6);
    var i, a, y;
    for (i = 0; i < 9; i++) {                                        /* ใบหลายชั้น */
      a = i * 2 * Math.PI / 9 + 0.4;
      y = (0.44 + (i % 3) * 0.11) * s;
      b.m(gBox(0.075 * s, 0.012, 0.21 * s), 'plant.leaf',
          Math.sin(a) * 0.15 * s, y, Math.cos(a) * 0.15 * s, -0.55 + (i % 2) * 0.35, a, 0, 'YXZ');
    }
    b.sph('plant.leaf', 0.15 * s, 0, 0.60 * s, 0, 8, 6, 0.75);
    b.sph('plant.leaf', 0.11 * s, 0.10 * s, 0.48 * s, 0.06 * s, 7, 5, 0.7);
    return b;
  }

  /* ต้นไม้ใหญ่ (ficus สูง ~1.95) */
  function plantTree(ctx) {
    var b = new B(ctx), i, a, y;
    b.cy('ceramic', 0.24, 0.19, 0, 0.46, 0, 0, 14);
    b.cy('soil', 0.225, 0.225, 0.41, 0.445, 0, 0, 14);
    b.cy('wood.oak', 0.045, 0.065, 0.43, 1.32, 0, 0, 8);             /* ลำต้น */
    for (i = 0; i < 3; i++) {                                         /* กิ่ง */
      a = i * 2.1 + 0.2;
      b.m(gCyl(0.018, 0.028, 0.5, 6), 'wood.oak', Math.sin(a) * 0.12, 1.36, Math.cos(a) * 0.12, 0.35, a, 0, 'YXZ');
    }
    b.sph('plant.leaf', 0.36, 0.16, 1.36, 0.06, 10, 7, 0.62);         /* พุ่ม 3 ชั้น */
    b.sph('plant.leaf', 0.30, -0.20, 1.55, -0.10, 10, 7, 0.60);
    b.sph('plant.leaf', 0.26, 0.06, 1.72, 0.14, 9, 6, 0.62);
    for (i = 0; i < 10; i++) {                                        /* ใบชายพุ่ม */
      a = i * 0.63;
      y = 1.30 + (i % 4) * 0.16;
      b.m(gBox(0.10, 0.012, 0.28), 'plant.leaf',
          Math.sin(a) * 0.28, y, Math.cos(a) * 0.28, -0.45 - (i % 3) * 0.12, a, 0, 'YXZ');
    }
    return b;
  }

  /* ภาพติดผนัง (origin = ผิวผนัง, ยื่นออก +z) w×h */
  function wallArt(ctx, w, h) {
    var b = new B(ctx), t = 0.045;
    b.box('wood.oak', -w / 2, w / 2, -h / 2, -h / 2 + t, 0, 0.035);
    b.box('wood.oak', -w / 2, w / 2, h / 2 - t, h / 2, 0, 0.035);
    b.box('wood.oak', -w / 2, -w / 2 + t, -h / 2, h / 2, 0, 0.035);
    b.box('wood.oak', w / 2 - t, w / 2, -h / 2, h / 2, 0, 0.035);
    b.box('paper', -w / 2 + t, w / 2 - t, -h / 2 + t, h / 2 - t, 0.004, 0.018);
    b.box('fabric.navy', -w / 4, w / 6, -h / 4, h / 5, 0.018, 0.022);   /* ลายในภาพ */
    b.box('fabric.navy', w / 8, w / 3, -h / 6, h / 8, 0.018, 0.021);
    return b;
  }

  /* ไฟติดผนัง (up-light) origin = ผิวผนัง */
  function sconce(ctx) {
    var b = new B(ctx);
    b.box('metal.steel', -0.05, 0.05, -0.11, 0.11, 0, 0.018);          /* แผ่นติดผนัง */
    b.box('metal.steel', -0.045, 0.045, -0.05, 0.16, 0.018, 0.10);     /* ตัวโคม */
    b.box('screen.on', -0.035, 0.035, -0.045, 0.15, 0.10, 0.115);      /* หลอด (คูลไวท์) */
    b.box('metal.steel', -0.05, 0.05, 0.145, 0.165, 0.018, 0.10);       /* ฝาปิดบน */
    return b;
  }

  /* ถ้วยรางวัล สูง 0.26 */
  function trophy(ctx) {
    var b = new B(ctx);
    b.box('wood.oak', -0.07, 0.07, 0, 0.045, -0.07, 0.07);
    b.cy('metal.steel', 0.012, 0.016, 0.045, 0.11, 0, 0, 8);
    b.cy('metal.steel', 0.062, 0.03, 0.11, 0.24, 0, 0, 12);
    b.cy('metal.steel', 0.062, 0.062, 0.235, 0.245, 0, 0, 12);
    return b;
  }

  /* ถังขยะ สูง 0.61 */
  function binCan(ctx, label) {
    var b = new B(ctx);
    b.cy('bin.grey', 0.16, 0.14, 0, 0.56, 0, 0, 12);
    b.cy('bin.grey', 0.17, 0.17, 0.56, 0.60, 0, 0, 12);
    b.cy('metal.dark', 0.10, 0.10, 0.60, 0.612, 0, 0, 10);              /* ฝาเปิด */
    if (label !== false) b.box('accent.orange', -0.035, 0.035, 0.28, 0.40, 0.15, 0.162);
    return b;
  }

  /* ม้านั่งยาว (origin = ผิวผนัง, ยื่น +z) len×0.42 สูง 0.47 */
  function bench(ctx, len) {
    var b = new B(ctx), h = len / 2;
    b.box('metal.dark', -h + 0.03, -h + 0.09, 0, 0.40, 0.02, 0.40);      /* ขาเหล็ก ซ */
    b.box('metal.dark', h - 0.09, h - 0.03, 0, 0.40, 0.02, 0.40);
    b.box('metal.dark', -h + 0.06, h - 0.06, 0.34, 0.38, 0.05, 0.36);    /* คาน */
    b.box('wood.oak', -h, h, 0.38, 0.44, 0.02, 0.42);                   /* ยอดไม้ */
    b.box('wood.oak', -h + 0.05, h - 0.05, 0.44, 0.465, 0.04, 0.40);     /* ขอบไม้ */
    return b;
  }

  /* กระดานประกาศ (origin = ผิวผนัง) w×h */
  function noticeBoard(ctx, w, h) {
    var b = new B(ctx), i;
    b.box('sign.white', -w / 2, w / 2, -h / 2, h / 2, 0.004, 0.024);
    b.box('accent.orange', -w / 2, w / 2, h / 2 - 0.05, h / 2, 0.024, 0.03);   /* หัวแถบ */
    for (i = 0; i < 3; i++) {
      var x = -w / 2 + 0.16 + i * (w - 0.32) / 3;
      b.cu('paper', 0.17, 0.21, 0.004, x + 0.085, 0.10, 0.026, (i - 1) * 0.05);
      b.cu('accent.orange', 0.17, 0.022, 0.006, x + 0.085, 0.19, 0.028, (i - 1) * 0.05);
    }
    return b;
  }

  /* นาฬิกาแขวน (origin = ผิวผนัง) r=0.17 */
  function clock(ctx) {
    var b = new B(ctx);
    b.m(gCyl(0.17, 0.17, 0.035, 16, 0, Math.PI * 2), 'metal.dark', 0, 0, 0, Math.PI / 2, 0, 0);
    b.m(gCyl(0.155, 0.155, 0.008, 16), 'sign.white', 0, 0, 0.02, Math.PI / 2, 0, 0);
    b.box('plastic.black', -0.008, 0.008, 0, 0.10, 0.024, 0.032);         /* เข็มยาว */
    b.cu('plastic.black', 0.014, 0.006, 0.075, 0.03, 0.05, 0.028, 0, 0, -0.9);
    return b;
  }

  /* ตู้โชว์ + ของรางวัล (origin = ผิวผนัง) len×0.40 */
  function displayCabinet(ctx, len) {
    var b = new B(ctx), h = len / 2, i;
    b.box('wood.oak', -h, h, 0, 0.88, 0.02, 0.42);                       /* ตู้ล่าง */
    b.box('metal.dark', -h, h, 0.40, 0.44, 0.40, 0.44);                  /* บันไดบาน */
    b.box('wood.oak', -h, h, 0.42, 0.46, 0.34, 0.40);
    b.box('glass.clear', -h, h, 0.46, 1.42, 0.39, 0.405);                /* ผนังหน้า */
    b.box('glass.clear', -h, -h + 0.008, 0.46, 1.42, 0.02, 0.405);        /* ผนังข้าง */
    b.box('glass.clear', h - 0.008, h, 0.46, 1.42, 0.02, 0.405);
    b.box('wood.oak', -h, h, 1.42, 1.47, 0.02, 0.42);                    /* ยอดตู้ */
    b.box('wood.oak', -h, h, 0.88, 0.92, 0.02, 0.40);                    /* ชั้นใน */
    for (i = 0; i < 3; i++) {                                            /* ของโชว์ */
      var x = -h + 0.22 + i * (len - 0.44) / 2;
      b.box('metal.steel', x - 0.05, x + 0.05, 0.92, 0.96, 0.14, 0.24);
      b.cy('metal.steel', 0.045, 0.02, 0.96, 1.14, x, 0.19, 10);
      b.box('sign.white', x - 0.06, x + 0.06, 0.88, 0.92, 0.12, 0.26);    /* ป้ายชื่อ */
    }
    return b;
  }

  /* ถังดับเพลิง (origin = ผิวผนัง) */
  function extinguisher(ctx) {
    var b = new B(ctx);
    b.cy('accent.orange', 0.053, 0.053, 0.10, 0.52, 0, 0.10, 10);
    b.cy('accent.orange', 0.053, 0.045, 0.06, 0.10, 0, 0.10, 10);
    b.cy('metal.dark', 0.055, 0.055, 0, 0.06, 0, 0.10, 10);
    b.box('metal.dark', -0.035, 0.035, 0.52, 0.60, 0.12, 0.18);            /* วาล์ว */
    b.box('metal.dark', -0.09, 0.09, 0.60, 0.62, 0.11, 0.16);              /* ที่บีบ */
    b.box('sign.white', -0.04, 0.04, 0.30, 0.40, 0.155, 0.16);              /* ป้าย */
    b.box('metal.dark', -0.06, 0.06, 0.62, 1.16, 0.02, 0.06);               /* ขายึดผนัง */
    b.cy('metal.dark', 0.014, 0.014, 0.10, 0.62, 0.075, 0.16, 6);          /* สายฉีด */
    return b;
  }

  /* ตู้จ่ายน้ำ (origin = ผิวผนัง) 0.36×0.34 สูง 1.06 */
  function waterDispenser(ctx) {
    var b = new B(ctx);
    b.box('metal.steel', -0.18, 0.18, 0, 1.00, 0.02, 0.36);
    b.box('metal.dark', -0.18, 0.18, 0.92, 1.00, 0.02, 0.36);            /* ฝา */
    b.box('metal.dark', -0.17, 0.17, 0.50, 0.60, 0.355, 0.375);          /* รางรับน้ำ */
    b.box('metal.dark', -0.10, -0.03, 0.62, 0.70, 0.30, 0.36);           /* ก๊อก ซ */
    b.box('metal.dark', 0.03, 0.10, 0.62, 0.70, 0.30, 0.36);             /* ก๊อก ข */
    b.box('sign.white', -0.14, 0.14, 0.72, 0.86, 0.355, 0.365);           /* ป้าย */
    b.cy('ceramic', 0.04, 0.04, 1.00, 1.10, 0.10, 0.28, 8);               /* แก้วซ้อน */
    b.cy('glass.clear', 0.05, 0.05, 1.00, 1.09, -0.10, 0.28, 8);
    b.cy('metal.steel', 0.055, 0.055, 0.98, 1.02, 0, 0.26, 10);              /* ฝาตู้ */
    b.cy('glass.clear', 0.13, 0.055, 1.02, 1.38, 0, 0.26, 12);              /* ขวดน้ำกลับหัว */
    b.cy('metal.dark', 0.05, 0.05, 1.38, 1.41, 0, 0.26, 8);
    return b;
  }

  /* ════════════════════════ เคาน์เตอร์ต้อนรับ L (reception) ════════════════════════ */
  function counterL(ctx) {
    var b = new B(ctx);
    var OX = -1.72, OZ = -0.30;             /* center ของมุมโค้ง */
    /* ── ท็อปหิน 0.04 (4 ชิ้น ไม่ซ้อนกัน → ไม่ z-fight) ── */
    b.box('stone.grey', -1.72, 2.08, 1.04, 1.08, -0.70, 0.04);          /* A แนวยาว */
    b.box('stone.grey', -2.08, -1.72, 1.04, 1.08, -2.98, -0.30);        /* B ฝั่งตะวันตก */
    b.box('stone.grey', -1.72, -1.36, 1.04, 1.08, -2.98, -0.70);        /* C ท้ายกลับ */
    b.m(gCyl(0.34, 0.34, 0.04, 10, 1.5 * Math.PI, 0.5 * Math.PI), 'stone.grey', OX, 1.06, OZ);
    /* ── ตัวตู้ (โครง wood.oak) ── */
    b.box('wood.oak', -1.72, 2.02, 0.02, 1.04, -0.64, -0.06);           /* A */
    b.box('wood.oak', -2.02, -1.72, 0.02, 1.04, -2.92, -0.30);          /* B */
    b.box('wood.oak', -1.72, -1.42, 0.02, 1.04, -2.92, -0.64);          /* C */
    b.m(gCyl(0.24, 0.24, 1.02, 10, 1.5 * Math.PI, 0.5 * Math.PI), 'wood.oak', OX, 0.53, OZ);
    b.box('wood.oak', -2.02, 2.02, 0, 0.02, -0.66, 0.0);                 /* ฐานล่าง (กันช่องลอย) */
    /* ── ด้านหน้าตะแกรง (เดินตามเส้นโค้ง) ── */
    var pts = [], x, i, th, R2 = 0.295;
    for (x = 2.05; x > OX; x -= 0.02) pts.push([x, -0.005, 0, 1]);
    for (i = 1; i <= 16; i++) {
      th = Math.PI / 2 + (Math.PI / 2) * (i / 16);
      pts.push([OX + R2 * Math.cos(th), OZ + R2 * Math.sin(th), Math.cos(th), Math.sin(th)]);
    }
    var seg = [], total = 0, j;
    for (j = 1; j < pts.length; j++) {
      var dx = pts[j][0] - pts[j - 1][0], dz = pts[j][1] - pts[j - 1][1];
      var l = Math.sqrt(dx * dx + dz * dz);
      seg.push({ d: total, l: l, x0: pts[j - 1][0], z0: pts[j - 1][1], nx: pts[j][2], nz: pts[j][3] });
      total += l;
    }
    var pitch = 0.148, k = 0, si = 0;
    while (k * pitch <= total) {
      var d = k * pitch;
      while (si < seg.length - 1 && d > seg[si].d + seg[si].l) si++;
      var s = seg[si], t = (d - s.d) / (s.l || 1);
      var px = s.x0 + (pts[si + 1][0] - s.x0) * t, pz = s.z0 + (pts[si + 1][1] - s.z0) * t;
      b.cu('wood.oak', 0.058, 0.94, 0.035, px, 0.53, pz, Math.atan2(s.nx, s.nz));
      k++;
    }
    /* ── ป้ายโลโก้ WRIS ด้านหน้า ── */
    var logo = atlasPlate(ctx, C_LOGO, 1.70, 0.42);
    if (logo) { logo.position.set(0.16, 0.63, 0.026); b.g.add(logo); }
    /* ── ชั้นวางใต้ (ฝั่งพนักงาน) + เอกสาร ── */
    b.box('wood.oak', -1.58, -0.42, 0.30, 0.34, -0.92, -0.62);
    b.box('wood.oak', -1.58, -0.42, 0.64, 0.68, -0.92, -0.62);
    b.box('wood.oak', -1.58, -1.54, 0.34, 0.68, -0.92, -0.62);            /* ข้างชั้น */
    b.box('wood.oak', -0.46, -0.42, 0.34, 0.68, -0.92, -0.62);
    for (i = 0; i < 3; i++) b.box('paper', -1.48 + i * 0.17, -1.34 + i * 0.17, 0.34, 0.60, -0.88, -0.68);
    b.box('metal.steel', -0.92, -0.56, 0.68, 0.71, -0.90, -0.64);          /* ถาด */
    b.box('paper', -0.90, -0.60, 0.71, 0.78, -0.88, -0.66);
    /* ── จอ / คีย์บอร์ด / PC หลังเคาน์เตอร์ (หันไปหาพนักงาน = -z) ── */
    b.box('metal.steel', 0.28, 0.62, 1.08, 1.095, -0.50, -0.34);          /* ฐานจอ */
    b.box('metal.steel', 0.41, 0.49, 1.095, 1.30, -0.44, -0.40);          /* คอจอ */
    b.box('plastic.black', 0.16, 0.74, 1.20, 1.54, -0.46, -0.435);        /* ขอบจอ */
    b.box('screen.on', 0.19, 0.71, 1.23, 1.51, -0.470, -0.466);           /* จอติด */
    b.box('plastic.black', 0.06, 0.52, 1.08, 1.092, -0.30, -0.14);        /* คีย์บอร์ด */
    b.box('plastic.black', 0.80, 0.90, 1.08, 1.092, -0.26, -0.16);        /* เมาส์ */
    b.box('paper', -0.20, 0.24, 1.08, 1.086, -0.36, -0.06);               /* กระดาษ */
    b.box('plastic.black', 1.34, 1.52, 0, 0.42, -1.06, -0.88);            /* PC tower */
    b.box('metal.steel', 1.36, 1.50, 0.30, 0.315, -0.884, -0.878);
    return b;
  }

  /* ชั้นวางโบรชัวร์ + ตู้ไปรษณีย์ (origin = ผิวผนัง, ยื่น +z) */
  function brochureStand(ctx) {
    var b = new B(ctx), i;
    b.box('wood.oak', -0.20, -0.18, 0, 1.44, 0.02, 0.32);           /* ข้าง */
    b.box('wood.oak', 0.18, 0.20, 0, 1.44, 0.02, 0.32);
    b.box('wood.oak', -0.20, 0.20, 1.42, 1.46, 0.02, 0.32);         /* ยอด */
    for (i = 0; i < 3; i++) {
      var y = 0.28 + i * 0.42;
      b.box('wood.oak', -0.18, 0.18, y, y + 0.022, 0.03, 0.31);
      b.box('paper', -0.14, 0.02, y + 0.022, y + 0.20, 0.06, 0.28);
      b.box('paper', 0.04, 0.15, y + 0.022, y + 0.17, 0.08, 0.27);
    }
    b.box('metal.steel', -0.16, 0.16, 1.12, 1.40, 0.04, 0.20);      /* ตู้ไปรษณีย์ */
    b.box('plastic.black', -0.10, 0.10, 1.24, 1.28, 0.198, 0.204);  /* ช่องใส่จดหมาย */
    b.box('paper', -0.12, 0.12, 1.14, 1.22, 0.198, 0.204);
    return b;
  }

  /* ════════════════════════ ชุดครัว / pantry ════════════════════════ */
  /* ตู้ล่าง (origin = ผิวผนัง, ยาวตามแกน x, ยื่น +z 0.64) */
  function kitchenBase(ctx, L) {
    var b = new B(ctx), h = L / 2, n, i, w;
    b.box('plastic.black', -h + 0.02, h - 0.02, 0, 0.10, 0.06, 0.56);        /* คิ้วล่าง (กันช่องลอย) */
    b.box('wood.white', -h, h, 0.10, 0.86, 0.0, 0.60);                      /* ตัวตู้ */
    b.box('stone.grey', -h - 0.02, h + 0.02, 0.86, 0.90, 0.0, 0.64);        /* ท็อปหิน */
    b.box('wood.white', -h, h, 0.10, 0.12, 0.58, 0.60);                     /* ขอบบนบาน */
    n = Math.max(2, Math.round(L / 0.62)); w = L / n;
    for (i = 0; i < n; i++) {
      var x0 = -h + i * w + 0.005, x1 = -h + (i + 1) * w - 0.005;
      b.box('wood.white', x0, x1, 0.12, 0.84, 0.60, 0.619);                 /* บานตู้ */
      b.box('metal.chrome', x1 - 0.09, x1 - 0.03, 0.76, 0.795, 0.619, 0.629);/* มือจับ */
    }
    return b;
  }

  /* เกาะกลางห้อง (origin = กลาง footprint) len×dep สูง 0.92 */
  function kitchenIsland(ctx, len, dep) {
    var b = new B(ctx), h = len / 2, d = dep / 2, i, zz;
    b.box('plastic.black', -h + 0.06, h - 0.06, 0, 0.10, -d + 0.06, d - 0.06);   /* คิ้วล่าง */
    b.box('wood.white', -h, h, 0.10, 0.88, -d, d);                              /* ตัวตู้ */
    b.box('stone.grey', -h - 0.03, h + 0.03, 0.88, 0.92, -d - 0.03, d + 0.03);   /* ท็อปหิน */
    for (i = 0; i < 2; i++) {                                                   /* บาน 2 ด้าน × 2 บาน */
      zz = i ? d : -d;
      var zf = i ? d + 0.019 : -d - 0.019;
      b.box('wood.white', -h + 0.02, -0.015, 0.13, 0.86, Math.min(zz, zf), Math.max(zz, zf));
      b.box('wood.white', 0.015, h - 0.02, 0.13, 0.86, Math.min(zz, zf), Math.max(zz, zf));
      b.box('metal.dark', 0.09, 0.16, 0.72, 0.755, i ? zf : zf - 0.012, i ? zf + 0.012 : zf);
      b.box('metal.dark', -0.16, -0.09, 0.72, 0.755, i ? zf : zf - 0.012, i ? zf + 0.012 : zf);
    }
    return b;
  }

  /* ตู้บน (origin = ผิวผนัง) */
  function upperCab(ctx, L) {
    var b = new B(ctx), h = L / 2, n, i, w;
    b.box('wood.white', -h, h, 1.45, 2.25, 0.0, 0.34);
    b.box('wood.white', -h, h, 1.45, 2.25, 0.34, 0.355);
    n = Math.max(2, Math.round(L / 0.5)); w = L / n;
    for (i = 0; i < n; i++) {
      var x0 = -h + i * w + 0.005, x1 = -h + (i + 1) * w - 0.005;
      b.box('metal.chrome', x0 + 0.05, x0 + 0.09, 1.50, 1.56, 0.355, 0.365);
      b.box('metal.chrome', x1 - 0.09, x1 - 0.05, 1.50, 1.56, 0.355, 0.365);
    }
    return b;
  }

  /* ชั้นวางแก้ว/ถ้วยกาแฟ (origin = ผิวผนัง) */
  function cupShelf(ctx, L) {
    var b = new B(ctx), h = L / 2, i;
    b.box('wood.white', -h, h, 1.50, 1.525, 0.0, 0.30);
    b.box('wood.white', -h, -h + 0.02, 1.42, 1.525, 0.0, 0.30);
    b.box('wood.white', h - 0.02, h, 1.42, 1.525, 0.0, 0.30);
    for (i = 0; i < 5; i++) b.cy('ceramic', 0.036, 0.030, 1.525, 1.60, -h + 0.09 + i * 0.10, 0.13, 10);
    for (i = 0; i < 3; i++) b.cy('glass.clear', 0.032, 0.028, 1.525, 1.615, -h + 0.14 + i * 0.10, 0.24, 10);
    return b;
  }

  /* อ่างล้าง + ก๊อก (origin = ผิวผนัง, วางบนท็อป y=0.90) */
  function sinkUnit(ctx) {
    var b = new B(ctx);
    b.box('metal.chrome', -0.27, 0.27, 0.0, 0.010, 0.03, 0.62);            /* แผ่นสแตนเลสบนท็อป */
    b.box('metal.chrome', -0.21, 0.21, 0.010, 0.042, 0.17, 0.20);          /* ขอบอ่าง */
    b.box('metal.chrome', -0.21, 0.21, 0.010, 0.042, 0.52, 0.55);
    b.box('metal.chrome', -0.21, -0.18, 0.010, 0.042, 0.20, 0.52);
    b.box('metal.chrome', 0.18, 0.21, 0.010, 0.042, 0.20, 0.52);
    b.box('metal.chrome', -0.18, 0.18, 0.008, 0.012, 0.20, 0.52);          /* ก้นอ่างสแตนเลส */
    b.cy('metal.dark', 0.024, 0.024, 0.012, 0.018, 0, 0.36, 10);            /* ท่อน้ำทิ้ง */
    b.cy('metal.chrome', 0.018, 0.020, 0.010, 0.30, 0, 0.09, 10);           /* ก๊อก */
    b.m(gCyl(0.014, 0.014, 0.18, 8), 'metal.chrome', 0, 0.30, 0.18, Math.PI / 2, 0, 0);
    b.box('metal.chrome', -0.02, 0.02, 0.22, 0.235, 0.06, 0.09);            /* มือหมุน */
    return b;
  }

  /* ไมโครเวฟ (origin = ผิวผนัง, วางบนท็อป) */
  function microwaveOven(ctx) {
    var b = new B(ctx);
    b.box('plastic.black', -0.25, 0.25, 0, 0.32, 0.16, 0.50);
    b.box('glass.clear', -0.20, 0.08, 0.05, 0.27, 0.498, 0.503);            /* ประตู */
    b.box('sign.white', 0.12, 0.20, 0.22, 0.26, 0.498, 0.503);              /* ปุ่ม */
    b.box('metal.steel', 0.10, 0.22, 0.05, 0.09, 0.498, 0.502);
    return b;
  }

  /* เครื่องชงกาแฟ (origin = ผิวผนัง) */
  function coffeeMaker(ctx) {
    var b = new B(ctx);
    b.box('plastic.black', -0.16, 0.16, 0, 0.34, 0.10, 0.36);
    b.box('metal.steel', -0.15, 0.15, 0.28, 0.36, 0.20, 0.40);              /* หัวจ่าย */
    b.cy('metal.dark', 0.010, 0.010, 0.19, 0.30, 0, 0.37, 8);               /* พวย */
    b.box('metal.dark', -0.08, 0.08, 0.012, 0.024, 0.36, 0.50);             /* ถาดรอง */
    b.cy('ceramic', 0.032, 0.028, 0.024, 0.10, 0, 0.42, 10);                /* แก้ว */
    b.box('glass.clear', -0.10, 0.10, 0.34, 0.44, 0.14, 0.32);              /* ถังน้ำ */
    b.box('sign.white', -0.13, -0.03, 0.20, 0.26, 0.358, 0.364);
    return b;
  }

  /* ตู้เย็น 2 ประตู (origin = ผิวผนัง, ลึก 0.72, สูง 1.86) — บานขาวสว่าง อ่านเป็นตู้เย็นชัด ── */
  function fridgeUnit(ctx) {
    var b = new B(ctx);
    b.box('metal.steel', -0.46, 0.46, 0.06, 1.84, 0.0, 0.70);                 /* ตัวตู้ */
    b.box('metal.steel', -0.46, 0.46, 1.84, 1.86, 0.0, 0.70);                 /* ฝาบน */
    b.box('plastic.black', -0.42, 0.42, 0, 0.06, 0.03, 0.66);                  /* ฐาน/คิ้วล่าง */
    /* บานบน (ตู้เย็น) + บานล่าง (ช่องแช่แข็ง) — ผิวขาวสว่าง */
    b.box('sign.white', -0.44, 0.44, 0.645, 1.815, 0.70, 0.734);
    b.box('sign.white', -0.44, 0.44, 0.085, 0.600, 0.70, 0.734);
    /* ขอบยางบาง (เส้นเข้มรอบบาน) */
    b.box('metal.dark', -0.44, 0.44, 0.645, 0.655, 0.734, 0.739);
    b.box('metal.dark', -0.44, 0.44, 1.805, 1.815, 0.734, 0.739);
    b.box('metal.dark', -0.44, -0.430, 0.645, 1.815, 0.734, 0.739);
    b.box('metal.dark', 0.430, 0.44, 0.645, 1.815, 0.734, 0.739);
    b.box('metal.dark', -0.44, 0.44, 0.085, 0.095, 0.734, 0.739);
    b.box('metal.dark', -0.44, 0.44, 0.590, 0.600, 0.734, 0.739);
    b.box('metal.dark', -0.44, -0.430, 0.085, 0.600, 0.734, 0.739);
    b.box('metal.dark', 0.430, 0.44, 0.085, 0.600, 0.734, 0.739);
    b.box('metal.dark', -0.44, 0.44, 0.600, 0.645, 0.700, 0.740);               /* ร่องกลางบาน */
    /* มือจับแนวตั้ง 2 อัน */
    b.box('plastic.black', 0.300, 0.338, 0.20, 0.55, 0.740, 0.772);
    b.box('plastic.black', 0.300, 0.338, 0.72, 1.74, 0.740, 0.772);
    b.box('plastic.black', 0.316, 0.324, 0.20, 0.55, 0.728, 0.740);
    b.box('plastic.black', 0.316, 0.324, 0.72, 1.74, 0.728, 0.740);
    b.box('metal.steel', -0.46, 0.46, 0.055, 0.065, 0.70, 0.72);                /* ขอบล่างประตู */
    return b;
  }

  /* โต๊ะนั่ง 4 ที่ (กลม dia 1.04 สูง 0.76) */
  function diningTable(ctx) {
    var b = new B(ctx);
    b.cy('wood.white', 0.52, 0.52, 0.72, 0.76, 0, 0, 20);
    b.cy('metal.chrome', 0.055, 0.085, 0.06, 0.72, 0, 0, 12);
    b.cy('metal.chrome', 0.30, 0.32, 0.02, 0.06, 0, 0, 14);
    b.cy('metal.chrome', 0.28, 0.28, 0, 0.02, 0, 0, 14);
    return b;
  }

  /* โต๊ะบาร์สูง (ยาวตามแกน x) */
  function barTable(ctx, L) {
    var b = new B(ctx), h = L / 2, s;
    b.box('wood.white', -h, h, 1.02, 1.07, -0.33, 0.33);
    for (s = -1; s <= 1; s += 2) {
      var x = s * (h - 0.18);
      b.cy('metal.chrome', 0.020, 0.020, 0, 1.02, x, -0.24, 8);
      b.cy('metal.chrome', 0.020, 0.020, 0, 1.02, x, 0.24, 8);
      b.box('metal.chrome', x - 0.02, x + 0.02, 0.20, 0.24, -0.26, 0.26);
      b.box('metal.steel', x - 0.03, x + 0.03, 0, 0.02, -0.26, 0.26);
    }
    return b;
  }

  /* ════════════════════════ โถงทางเดิน ════════════════════════ */
  var CELL_OF = { reception: 0, sales: 1, meeting1: 2, meeting2: 3, pantry: 4, server: 5, ops: 6, training: 7 };

  function corridorDoors(plan) {
    var out = [];
    ((plan && plan.rooms) || []).forEach(function (rm) {
      var d = rm.door; if (!d) return;
      var w = d.w || 1.0;
      if (d.side === 'z1') out.push({ id: rm.id, c: rm.x + (d.at || 0), w: w, side: 'z0' });      /* ผนังใต้โถง */
      else if (d.side === 'z0') out.push({ id: rm.id, c: rm.x + (d.at || 0), w: w, side: 'z1' }); /* ผนังเหนือโถง */
    });
    return out;
  }

  /* ป้ายชื่อห้อง (origin = ผิวผนัง) */
  function signPlate(ctx, cell, w, h) {
    var b = new B(ctx);
    b.box('sign.white', -w / 2 - 0.03, w / 2 + 0.03, -h / 2 - 0.03, h / 2 + 0.03, 0.0, 0.016);
    var p = atlasPlate(ctx, cell, w, h);
    if (p) { p.position.set(0, 0, 0.017); b.g.add(p); }
    return b;
  }

  /* ป้าย EXIT (origin = ผิวผนัง) */
  function exitSign(ctx) {
    var b = new B(ctx);
    b.box('sign.white', -0.28, 0.28, -0.13, 0.13, 0.0, 0.020);
    var p = atlasPlate(ctx, C_EXIT, 0.50, 0.22);
    if (p) { p.position.set(0, 0, 0.021); b.g.add(p); }
    return b;
  }

  /* ป้ายบอกทาง (directory board 4 ห้อง) */
  function directoryBoard(ctx) {
    var b = new B(ctx), cells = [C_RECEPTION, C_PANTRY, C_TRAINING, C_OPS], i;
    b.box('sign.white', -0.62, 0.62, -0.32, 0.32, 0.006, 0.028);
    b.box('accent.orange', -0.62, 0.62, 0.24, 0.31, 0.028, 0.034);          /* หัวแถบ */
    b.box('wood.oak', -0.64, 0.64, -0.345, -0.32, 0.0, 0.034);              /* ขอบล่าง */
    b.box('wood.oak', -0.64, 0.64, 0.32, 0.345, 0.0, 0.034);                /* ขอบบน */
    for (i = 0; i < 4; i++) {
      var col = i % 2, row = Math.floor(i / 2);
      var p = atlasPlate(ctx, cells[i], 0.52, 0.13);
      if (p) { p.position.set(col ? 0.28 : -0.28, row ? -0.19 : -0.02, 0.031); b.g.add(p); }
    }
    return b;
  }

  /* ที่วางร่ม */
  function umbrellaStand(ctx) {
    var b = new B(ctx), i;
    b.cy('metal.steel', 0.15, 0.14, 0.02, 0.62, 0, 0, 12);
    b.cy('metal.steel', 0.15, 0.15, 0, 0.02, 0, 0, 12);
    b.cy('metal.dark', 0.155, 0.155, 0.62, 0.645, 0, 0, 12);
    for (i = 0; i < 3; i++) {
      var a = i * 2.1 + 0.4;
      b.m(gCyl(0.011, 0.011, 0.62, 6), 'metal.dark', Math.sin(a) * 0.06, 0.34, Math.cos(a) * 0.06, 0.09, a, 0.04, 'YXZ');
      b.box('accent.orange', -0.02, 0.02, 0.92, 0.97, -0.05, 0.05);
    }
    return b;
  }

  /* ════════════════════════ Room: วางชิ้นส่วน + collider ════════════════════════ */
  function Room(ctx, space) {
    this.ctx = ctx; this.space = space;
    this.U = (ctx && ctx.util) || (O.util);
    this.rect = wallInsets(space, ctx && ctx.plan);
    this.g = new THREE.Group();
    this.g.name = 'lounge:' + ((space && space.id) || '?');
    this.cols = []; this.pieces = 0; this.warns = [];
  }
  Room.prototype.col = function (x0, z0, x1, z1, y0, y1) {
    if (!this.U || !this.U.collider) return;
    this.cols.push(this.U.collider(x0, z0, x1, z1, y0 === undefined ? 0 : y0, y1 === undefined ? 1.0 : y1));
  };
  Room.prototype.place = function (b, x, z, ry, opt) {
    if (!b) return null;
    opt = opt || {};
    b.g.position.set(x, isNum(opt.y) ? opt.y : 0, z);
    if (ry) b.g.rotation.y = ry;
    this.g.add(b.g);
    this.g.updateMatrixWorld(true);
    var bb = new THREE.Box3().setFromObject(b.g);
    /* ตรวจอัตโนมัติ: ชิ้นส่วนต้องอยู่ใน rect ของห้อง (ไม่ทะลุผนัง) */
    var r = this.rect, tol = 0.03;
    if (bb.min.x < r.x0 - tol || bb.max.x > r.x1 + tol || bb.min.z < r.z0 - tol || bb.max.z > r.z1 + tol) {
      this.warns.push('ล้ำผนัง: ' + (b.g.name || 'piece') + ' bb(' +
        [bb.min.x, bb.min.z, bb.max.x, bb.max.z].map(function (v) { return v.toFixed(2); }).join('|') + ')');
    }
    if (opt.col) {
      if (opt.col.length && isNum(opt.col[0])) this.col(opt.col[0], opt.col[1], opt.col[2], opt.col[3], opt.col[4], opt.col[5]);
      else opt.col.forEach(function (c) { this.col(c[0], c[1], c[2], c[3], c[4], c[5]); }, this);
    } else if (opt.collide) {
      this.col(bb.min.x, bb.min.z, bb.max.x, bb.max.z, bb.min.y, bb.max.y);
    }
    this.pieces++;
    return bb;
  };
  /* วางชิ้นที่ติดผนัง: side = z0|z1|x0|x1, along = พิกัดตามแนวผนัง */
  Room.prototype.wall = function (b, side, along, opt) {
    if (!b) return null;
    opt = opt || {};
    var r = this.rect, gap = isNum(opt.gap) ? opt.gap : 0.025;   /* ≥ baseboard 0.019 */
    if (side === 'z0') return this.place(b, along, r.z0 + gap, 0, opt);
    if (side === 'z1') return this.place(b, along, r.z1 - gap, Math.PI, opt);
    if (side === 'x0') return this.place(b, r.x0 + gap, along, Math.PI / 2, opt);
    return this.place(b, r.x1 - gap, along, -Math.PI / 2, opt);
  };
  Room.prototype.fitsX = function (c, hw) {
    var r = this.rect, h = hw === undefined ? 0.45 : hw;
    return (c - h) >= r.x0 + 0.01 && (c + h) <= r.x1 - 0.01;
  };

  /* ════════════════════════ reception 8×9.5 ════════════════════════ */
  function buildReception(R) {
    var ctx = R.ctx;
    R.place(counterL(ctx), 4.60, 4.42, 0, {
      col: [[2.50, 3.70, 6.74, 4.47, 0, 1.08],
            [2.50, 1.42, 3.28, 3.72, 0, 1.08]]
    });
    R.place(chairOffice(ctx), 5.15, 2.55, 0, { collide: true });
    R.place(sofa3(ctx), 7.30, 6.70, -Math.PI / 2, { y: 0.011, collide: true });
    R.place(coffeeGlass(ctx), 6.12, 6.70, -Math.PI / 2, { y: 0.011, collide: true });
    R.place(rug(ctx, 2.83, 2.70), 6.365, 6.70, 0, {});
    R.place(plantTree(ctx), 1.15, 8.50, 0, { collide: true });
    R.wall(brochureStand(ctx), 'x1', 3.20, { col: [[7.55, 2.98, 7.94, 3.42, 0, 1.46]] });
    R.wall(wallArt(ctx, 0.74, 0.80), 'z1', 6.50, { y: 1.90 });
    R.wall(wallArt(ctx, 0.62, 0.78), 'x1', 8.55, { y: 1.90 });
    R.wall(sconce(ctx), 'x1', 4.30, { y: 1.90 });
    R.wall(sconce(ctx), 'z1', 2.30, { y: 1.90 });
    R.place(trophy(ctx), 6.05, 4.02, 0.4, { y: 1.08 });
  }

  /* ════════════════════════ pantry 9×9.5 ════════════════════════ */
  function buildPantry(R) {
    var ctx = R.ctx, r = R.rect;
    /* ── ชุดครัวผนังใต้ (หันหน้าเข้าหาประตู) + แนวตะวันตกเป็นมุม L ── */
    R.wall(kitchenBase(ctx, 3.24), 'z0', 26.68, { gap: 0.02, col: [[25.04, 0.12, 28.32, 0.82, 0, 0.92]] });
    R.wall(kitchenBase(ctx, 1.84), 'x0', 1.68, { gap: 0.02, col: [[25.04, 0.72, 25.74, 2.62, 0, 0.92]] });
    R.wall(upperCab(ctx, 0.84), 'z0', 25.48, { gap: 0.02 });          /* ตู้บน ผนังใต้ (ช่วงไม่มีหน้าต่าง) */
    R.wall(upperCab(ctx, 1.10), 'x0', 1.45, { gap: 0.02 });           /* ตู้บน ผนังตะวันตก */
    R.wall(cupShelf(ctx, 0.55), 'x0', 2.33, { gap: 0.02 });           /* ชั้นแก้ว/ถ้วย */
    R.wall(microwaveOven(ctx), 'z0', 27.97, { gap: 0.02, y: 0.90 });
    R.wall(coffeeMaker(ctx), 'z0', 26.90, { gap: 0.02, y: 0.90 });
    /* ── เกาะกลางห้อง + อ่างล้าง/ก๊อก (เห็นชัดจากประตู) ── */
    R.place(kitchenIsland(ctx, 1.70, 0.75), 28.30, 4.33, 0, { collide: true });
    R.place(sinkUnit(ctx), 27.85, 4.03, 0, { y: 0.92 });
    /* ── ตู้เย็น 2 ประตู (ต่อท้ายชุดครัว) ── */
    R.wall(fridgeUnit(ctx), 'z0', 28.88, { gap: 0.02, col: [[28.40, 0.12, 29.36, 0.86, 0, 1.87]] });
    /* ── ตู้จ่ายน้ำ + ถังขยะแยก 3 ใบ ── */
    R.place(waterDispenser(ctx), 30.20, 4.30, 0, { collide: true });
    R.place(binCan(ctx, true), 30.75, 0.35, 0, { collide: true });
    R.place(binCan(ctx, true), 31.13, 0.35, 0, { collide: true });
    R.place(binCan(ctx, true), 31.51, 0.35, 0, { collide: true });
    /* ── โต๊ะนั่ง 4 ที่ + เก้าอี้ 4 ── */
    R.place(diningTable(ctx), 29.95, 2.90, 0, { collide: true });
    R.place(chairDining(ctx), 29.23, 2.90, Math.PI / 2, { collide: true });
    R.place(chairDining(ctx), 30.67, 2.90, -Math.PI / 2, { collide: true });
    R.place(chairDining(ctx), 29.95, 2.18, 0, { collide: true });
    R.place(chairDining(ctx), 29.95, 3.62, Math.PI, { collide: true });
    /* ── โต๊ะบาร์สูง + สตูล 3 (ใกล้ประตู) ── */
    R.place(barTable(ctx, 1.40), 29.00, 6.55, 0, { collide: true });
    R.place(barStool(ctx), 28.55, 7.15, Math.PI, { collide: true });
    R.place(barStool(ctx), 29.00, 7.15, Math.PI, { collide: true });
    R.place(barStool(ctx), 29.45, 7.15, Math.PI, { collide: true });
    /* ── กระดานประกาศ (ผนังเหนือ ข้างประตู) + นาฬิกา (เหนือหน้าต่างผนังใต้) ── */
    R.wall(noticeBoard(ctx, 1.50, 0.90), 'z1', 28.90, { y: 1.70 });
    R.wall(clock(ctx), 'z0', 29.30, { y: 2.78 });
    /* ── ต้นไม้ ── */
    R.place(plantBush(ctx, 1.0), 27.70, 3.30, 0.6, { collide: true });
  }

  /* ════════════════════════ corridor 34×3 ════════════════════════ */
  function buildCorridor(R) {
    var ctx = R.ctx, r = R.rect, fit = R.fitsX.bind(R);
    /* ── ป้ายชื่อห้องทุกประตู (ข้างประตู ฝั่ง x น้อย) ── */
    corridorDoors(ctx.plan).forEach(function (d) {
      var cell = CELL_OF[d.id];
      if (cell === undefined) return;
      var cx = d.c - d.w / 2 - 0.62;
      if (!fit(cx, 0.36)) return;
      R.wall(signPlate(ctx, cell, 0.60, 0.15), d.side, cx, { y: 1.50 });
    });
    /* ── ผนังใต้ (z0): ม้านั่ง + กระดานประกาศ + ที่วางร่ม ── */
    if (fit(3.20, 0.86)) R.wall(bench(ctx, 1.70), 'z0', 3.20, { col: [[2.35, 9.57, 4.05, 9.99, 0, 0.49]] });
    if (fit(6.80, 0.82)) R.wall(noticeBoard(ctx, 1.60, 0.90), 'z0', 6.80, { y: 1.70 });
    if (fit(1.60, 0.18)) R.place(umbrellaStand(ctx), 1.60, r.z0 + 0.17, 0, { collide: true });
    /* ── ผนังเหนือ (z1): ป้ายบอกทาง + ตู้โชว์ ── */
    if (fit(16.50, 0.66)) R.wall(directoryBoard(ctx), 'z1', 16.50, { y: 1.62 });
    if (fit(6.00, 0.62)) R.wall(displayCabinet(ctx, 1.20), 'z1', 6.00, { col: [[5.38, 12.00, 6.62, 12.44, 0, 1.47]] });
    /* ── ต้นไม้ริมทาง 6 ── */
    var plants = [[8.60, 'z0'], [15.40, 'z0'], [24.60, 'z0'], [12.30, 'z1'], [22.00, 'z1'], [31.60, 'z1']];
    plants.forEach(function (p) {
      if (!fit(p[0], 0.22)) return;
      var z = p[1] === 'z0' ? r.z0 + 0.31 : r.z1 - 0.31;
      R.place(plantBush(ctx, 1.0), p[0], z, (p[0] * 0.7) % 3, { collide: true });
    });
    /* ── ถังขยะ 2 ใบ (ผนังเหนือ) ── */
    if (fit(13.45, 0.18)) R.place(binCan(ctx, false), 13.45, r.z1 - 0.22, 0, { collide: true });
    if (fit(13.82, 0.18)) R.place(binCan(ctx, false), 13.82, r.z1 - 0.22, 0, { collide: true });
    /* ── ถังดับเพลิง + EXIT + ตู้จ่ายน้ำ ── */
    if (fit(23.30, 0.12)) R.wall(extinguisher(ctx), 'z1', 23.30, {});
    if (fit(0.75, 0.32)) R.wall(exitSign(ctx), 'z1', 0.75, { y: 2.20 });
    if (fit(33.10, 0.32)) R.wall(exitSign(ctx), 'z0', 33.10, { y: 2.20 });
    if (fit(32.40, 0.20)) R.wall(waterDispenser(ctx), 'z0', 32.40, { col: [[32.22, 9.57, 32.58, 9.93, 0, 1.06]] });
  }

  /* ════════════════════════ export ════════════════════════ */
  function buildRoom(space, ctx) {
    if (!space || !ctx) return null;
    var U = ctx.util || O.util || null;
    var R = new Room(ctx, space);
    var kind = space.furn;
    try {
      if (kind === 'reception') buildReception(R);
      else if (kind === 'pantry') buildPantry(R);
      else if (kind === 'corridor') buildCorridor(R);
    } catch (e) {
      R.warns.push('build error: ' + (e && e.message ? e.message : e));
    }
    var merged;
    try {
      merged = (U && U.merge) ? U.merge(R.g) : R.g;
    } catch (e2) {
      R.warns.push('merge error: ' + (e2 && e2.message ? e2.message : e2));
      merged = R.g;
    }
    merged.name = 'lounge:' + (space.id || '?');
    var tri = 0, calls = 0;
    merged.traverse(function (o) {
      if (!o.isMesh) return;
      calls++;
      tri += (o.geometry && o.geometry.attributes.position) ? o.geometry.attributes.position.count / 3 : 0;
      o.receiveShadow = true;
      o.castShadow = false;                 /* เงาให้ structural/lighting จัดการ (งบ 40 mesh) */
    });
    return {
      group: merged,
      colliders: R.cols,
      info: { id: space.id, pieces: R.pieces, triangles: tri, drawCalls: calls, warns: R.warns.slice(0, 8) }
    };
  }

  O.furnitureLounge = {
    types: ['reception', 'pantry', 'corridor'],
    buildRoom: buildRoom
  };
})();
