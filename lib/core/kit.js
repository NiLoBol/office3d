/* office3d/kit.js — "ตัวต่อ" เรขาคณิต: builder รวม mesh + ชิ้นส่วนสำเร็จรูป
   ใช้: var b = new KIT.Builder(); b.box(...); ... scene.add(new THREE.Mesh(b.build(), mat))
   หน่วยเมตร · y=0 = พื้น · หมุนรอบ Y ด้วย b.at(x,z,ry) แล้ว b.end()
*/
window.KIT = (function () {
  'use strict';
  var D2R = Math.PI / 180;

  function Builder() { this.p = []; this.n = []; this.c = []; this.m = null; }

  Builder.prototype.add = function (g, color) {
    if (g.index) g = g.toNonIndexed();
    if (this.m) g.applyMatrix4(this.m);
    var pa = g.attributes.position.array, na = g.attributes.normal.array;
    var n = g.attributes.position.count, col = new THREE.Color(color);
    for (var i = 0; i < n; i++) {
      this.p.push(pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2]);
      this.n.push(na[i * 3], na[i * 3 + 1], na[i * 3 + 2]);
      this.c.push(col.r, col.g, col.b);
    }
    g.dispose();
  };

  /* กล่อง: y = ระดับก้นกล่อง (ไม่ใช่กลาง) */
  Builder.prototype.box = function (x, y, z, sx, sy, sz, color, ry) {
    var g = new THREE.BoxGeometry(sx, sy, sz);
    if (ry) g.rotateY(ry * D2R);
    g.translate(x, y + sy / 2, z);
    this.add(g, color);
    return this;
  };

  /* ทรงกระบอก/ยอดตัด: rTop, rBot, h */
  Builder.prototype.cyl = function (x, y, z, rTop, rBot, h, color, seg) {
    var g = new THREE.CylinderGeometry(rTop, rBot, h, seg || 10);
    g.translate(x, y + h / 2, z);
    this.add(g, color);
    return this;
  };

  Builder.prototype.cone = function (x, y, z, r, h, color, seg) {
    return this.cyl(x, y, z, 0.001, r, h, color, seg);
  };

  Builder.prototype.sph = function (x, y, z, r, color) {
    var g = new THREE.IcosahedronGeometry(r, 1);
    g.translate(x, y, z);
    this.add(g, color);
    return this;
  };

  /* ต่อชิ้นส่วนสำเร็จรูป (geometry ที่มีสีอยู่แล้ว) เข้ากับ builder */
  Builder.prototype.part = function (g) {
    if (g.index) g = g.toNonIndexed();
    if (this.m) g.applyMatrix4(this.m);
    var pa = g.attributes.position.array, na = g.attributes.normal.array;
    var ca = g.attributes.color ? g.attributes.color.array : null;
    var n = g.attributes.position.count;
    for (var i = 0; i < n; i++) {
      this.p.push(pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2]);
      this.n.push(na[i * 3], na[i * 3 + 1], na[i * 3 + 2]);
      if (ca) this.c.push(ca[i * 3], ca[i * 3 + 1], ca[i * 3 + 2]);
      else this.c.push(0.8, 0.8, 0.8);
    }
    g.dispose();
    return this;
  };

  /* ตั้งจุดกำเนิดชิ้นส่วน (หมุนรอบ Y องศา) */
  Builder.prototype.at = function (x, z, ry) {
    this.m = new THREE.Matrix4().makeRotationY((ry || 0) * D2R);
    this.m.setPosition(x, 0, z);
    return this;
  };
  Builder.prototype.end = function () { this.m = null; return this; };

  Builder.prototype.build = function () {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  };

  /* ---------- ชิ้นส่วนสำเร็จรูป (ทุกอันกลับ BufferGeometry) ---------- */

  /* เก้าอี้สำนักงาน — หันหน้า +z */
  function chair(color) {
    var b = new Builder();
    b.box(0, 0.42, 0, 0.46, 0.06, 0.46, color || 0x36404b);
    b.box(0, 0.46, -0.22, 0.46, 0.44, 0.05, color || 0x36404b);
    b.box(-0.19, 0, -0.19, 0.04, 0.42, 0.04, 0x2a3138);
    b.box(0.19, 0, -0.19, 0.04, 0.42, 0.04, 0x2a3138);
    b.box(-0.19, 0, 0.19, 0.04, 0.42, 0.04, 0x2a3138);
    b.box(0.19, 0, 0.19, 0.04, 0.42, 0.04, 0x2a3138);
    return b.build();
  }

  /* โต๊ะทำงาน + จอ + เก้าอี้ — หันหน้า +z */
  function desk() {
    var b = new Builder();
    b.box(0, 0.72, 0, 1.5, 0.06, 0.72, 0xefe7d7);
    b.box(-0.68, 0, -0.3, 0.06, 0.72, 0.06, 0x9498a0);
    b.box(0.68, 0, -0.3, 0.06, 0.72, 0.06, 0x9498a0);
    b.box(-0.68, 0, 0.3, 0.06, 0.72, 0.06, 0x9498a0);
    b.box(0.68, 0, 0.3, 0.06, 0.72, 0.06, 0x9498a0);
    b.box(0, 0.78, 0.2, 0.58, 0.34, 0.05, 0x23292f);   // จอ
    b.box(0, 0.72, 0.24, 0.1, 0.1, 0.06, 0x5a6069);
    b.box(0.48, 0.72, -0.12, 0.22, 0.02, 0.14, 0x2f353c); // คีย์บอร์ด
    b.at(0, -0.62, 0); chair(); b.end();
    return b.build();
  }

  /* คนนั่ง — ตัว geometry อยู่ที่พื้น หน้า +z */
  function person(shirt) {
    var b = new Builder();
    b.box(0, 0.45, 0.1, 0.38, 0.52, 0.26, shirt);
    b.box(0, 0.42, 0.27, 0.34, 0.12, 0.4, 0x2b3038);   // ต้นขา
    b.box(0, 0.0, 0.3, 0.3, 0.42, 0.22, 0x2b3038);     // ขาท่อนล่าง
    b.box(-0.24, 0.62, 0.12, 0.1, 0.42, 0.16, shirt);
    b.box(0.24, 0.62, 0.12, 0.1, 0.42, 0.16, shirt);
    b.sph(0, 1.06, 0.12, 0.12, 0xdcae86);              // หัว
    b.box(0, 1.1, 0.1, 0.24, 0.1, 0.24, 0x2a2320);     // ผม
    return b.build();
  }

  /* รถ — ยาวตามแกน z */
  function car(body) {
    var b = new Builder();
    b.box(0, 0.36, 0, 1.82, 0.46, 4.2, body);
    b.box(0, 0.82, -0.15, 1.62, 0.44, 2.0, body);
    b.box(0, 0.88, -0.15, 1.5, 0.26, 1.92, 0x1b232b);  // กระจก
    b.box(0.6, 0.5, 2.06, 0.3, 0.16, 0.06, 0xffe7a8);
    b.box(-0.6, 0.5, 2.06, 0.3, 0.16, 0.06, 0xffe7a8);
    var wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 10);
    wheel.rotateZ(90 * D2R);
    var wg = wheel.toNonIndexed();
    [[-0.86, 1.35], [0.86, 1.35], [-0.86, -1.35], [0.86, -1.35]].forEach(function (w) {
      var g = wg.clone(); g.translate(w[0], 0.33, w[1]);
      if (g.index) g = g.toNonIndexed();
      b.add(g, 0x1a1c1f);
    });
    wg.dispose();
    return b.build();
  }

  /* ต้นไม้ */
  function tree(h) {
    var b = new Builder();
    b.cyl(0, 0, 0, 0.22, 0.3, h * 0.5, 0x6b4f37, 7);
    b.cone(0, h * 0.4, 0, h * 0.34, h * 0.55, 0x3f6b45, 8);
    b.cone(0, h * 0.62, 0, h * 0.26, h * 0.42, 0x4a7a4f, 8);
    return b.build();
  }

  /* ต้นไม้ในกระถาง */
  function plant() {
    var b = new Builder();
    b.cyl(0, 0, 0, 0.28, 0.22, 0.45, 0xd8d2c6, 8);
    b.cyl(0, 0.45, 0, 0.06, 0.08, 0.5, 0x6b4f37, 6);
    b.sph(0, 1.05, 0, 0.42, 0x3f6b45);
    b.sph(0.18, 0.92, 0.12, 0.3, 0x4a7a4f);
    b.sph(-0.16, 1.12, -0.1, 0.26, 0x4a7a4f);
    return b.build();
  }

  return { Builder: Builder, chair: chair, desk: desk, person: person, car: car, tree: tree, plant: plant };
})();
