/* office3d/v2/lib2/util.js — ตัวช่วย geometry ที่ทุกโมดูลใช้ร่วม
   ต้องโหลดหลัง three.min.js และก่อนโมดูลอื่น */
(function () {
  var O = window.O3D2 = window.O3D2 || {};
  var THREE = window.THREE;
  var cache = {};

  function boxGeo(w, h, d) {
    var k = 'b' + w + '_' + h + '_' + d;
    if (!cache[k]) cache[k] = new THREE.BoxGeometry(w, h, d);
    return cache[k];
  }
  function cylGeo(rt, rb, h, seg) {
    var k = 'c' + rt + '_' + rb + '_' + h + '_' + seg;
    if (!cache[k]) cache[k] = new THREE.CylinderGeometry(rt, rb, h, seg || 12);
    return cache[k];
  }
  function mesh(geo, mat, x, y, z, ry) {
    var m = new THREE.Mesh(geo, mat || O.mats.get('plastic.grey'));
    m.position.set(x || 0, y || 0, z || 0);
    if (ry) m.rotation.y = ry;
    return m;
  }
  var U = {
    boxGeo: boxGeo, cylGeo: cylGeo, mesh: mesh,
    box: function (w, h, d, mat, x, y, z, ry) { return mesh(boxGeo(w, h, d), mat, x, y, z, ry); },
    cyl: function (rt, rb, h, seg, mat, x, y, z, ry) { return mesh(cylGeo(rt, rb, h, seg), mat, x, y, z, ry); },
    plane: function (w, d, mat, x, y, z, ry) {
      var g = cache['p' + w + '_' + d] || (cache['p' + w + '_' + d] = new THREE.PlaneGeometry(w, d));
      var m = mesh(g, mat, x, y, z, 0);
      m.rotation.x = -Math.PI / 2; m.position.y = (y === undefined ? 0 : y);
      if (ry) m.rotation.z = ry;
      return m;
    },
    /* ของกีดขวางแบบกล่อง (y0..y1) */
    collider: function (x0, z0, x1, z1, y0, y1) {
      return { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1),
               y0: y0 === undefined ? 0 : y0, y1: y1 === undefined ? 1.2 : y1 };
    },
    /* เดา collider จาก mesh ใน group (ตัดของที่เล็กกว่า minArea m²) */
    collidersFromGroup: function (root, minArea) {
      var out = [], bb = new THREE.Box3(), minA = minArea === undefined ? 0.04 : minArea;
      root.updateMatrixWorld(true);
      root.traverse(function (o) {
        if (!o.isMesh || !o.geometry || o.userData.noCollide) return;
        o.geometry.computeBoundingBox && o.geometry.computeBoundingBox();
        bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        if ((bb.max.x - bb.min.x) * (bb.max.z - bb.min.z) < minA) return;
        out.push({ x0: bb.min.x, z0: bb.min.z, x1: bb.max.x, z1: bb.max.z, y0: bb.min.y, y1: bb.max.y });
      });
      return out;
    },
    /* ยุบ mesh ที่ material เดียวกันเป็นชิ้นเดียว (ของนิ่ง) — คืน Group ใหม่แทนที่ของเดิม */
    merge: function (root) {
      root.updateMatrixWorld(true);
      var inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
      var buckets = {}, order = [];
      root.traverse(function (o) {
        if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
        var mk = o.material.uuid;
        if (!buckets[mk]) { buckets[mk] = { mat: o.material, pos: [], nor: [], uv: [], hasUV: true }; order.push(mk); }
        var b = buckets[mk];
        var g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        var mtx = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
        g.applyMatrix4(mtx);
        var p = g.attributes.position.array, n = g.attributes.normal ? g.attributes.normal.array : null;
        for (var i = 0; i < p.length; i++) b.pos.push(p[i]);
        if (n) { for (var j = 0; j < n.length; j++) b.nor.push(n[j]); }
        if (g.attributes.uv) { var t = g.attributes.uv.array; for (var q = 0; q < t.length; q++) b.uv.push(t[q]); }
        else { b.hasUV = false; for (var v = 0; v < p.length / 3 * 2; v++) b.uv.push(0); }
        g.dispose();
      });
      var out = new THREE.Group();
      out.name = 'merged';
      order.forEach(function (k) {
        var b = buckets[k];
        var g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
        if (b.nor.length === b.pos.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
        if (b.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
        g.computeBoundingSphere();
        var m = new THREE.Mesh(g, b.mat);
        m.name = 'merged_' + b.mat.name;
        out.add(m);
      });
      return out;
    },
    rnd: function (seed) {
      var s = seed || 1;
      return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    }
  };
  O.util = U;
})();
