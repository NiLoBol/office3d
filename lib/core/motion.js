/* office3d/motion.js — เครื่องมือการเคลื่อนไหว: เดินตามเส้น (รถ/คน) + tween (ไม้กั้น/ไฟ)
   obj ที่ follow ได้: THREE.Object3D ที่หันหน้า +z ตอน rotation.y = 0
*/
window.Motion = (function () {
  'use strict';
  var movers = [], tweens = [];

  function ease(p) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }

  function follow(obj, pts, opt) {
    opt = opt || {};
    var segs = [], total = 0;
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      var d = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
      segs.push({ a: a, b: b, d: d, cum: total });
      total += d;
    }
    if (!segs.length) { if (opt.done) opt.done(); return null; }
    var m = { obj: obj, segs: segs, total: total, dist: 0, speed: opt.speed || 5,
      done: opt.done, bob: opt.bob || 0, y: opt.y || 0 };
    obj.visible = true;
    obj.position.set(segs[0].a.x, m.y, segs[0].a.z);
    if (segs[0].d > 0.01) obj.rotation.y = Math.atan2(segs[0].b.x - segs[0].a.x, segs[0].b.z - segs[0].a.z);
    movers.push(m);
    return m;
  }

  function tween(dur, apply, done) {
    var t = { el: 0, dur: dur || 0.3, apply: apply, done: done };
    apply(0);
    tweens.push(t);
    return t;
  }

  function update(dt) {
    for (var i = movers.length - 1; i >= 0; i--) {
      var m = movers[i];
      m.dist += m.speed * dt;
      var d = Math.min(m.dist, m.total);
      var s = m.segs[m.segs.length - 1];
      for (var k = 0; k < m.segs.length; k++) {
        if (d <= m.segs[k].cum + m.segs[k].d + 0.0001) { s = m.segs[k]; break; }
      }
      var p = s.d ? Math.min(1, (d - s.cum) / s.d) : 1;
      var x = s.a.x + (s.b.x - s.a.x) * p;
      var z = s.a.z + (s.b.z - s.a.z) * p;
      m.obj.position.set(x, m.y + (m.bob ? Math.abs(Math.sin(d * 2.4)) * m.bob : 0), z);
      if (s.d > 0.02) m.obj.rotation.y = Math.atan2(s.b.x - s.a.x, s.b.z - s.a.z);
      if (m.dist >= m.total) {
        movers.splice(i, 1);
        if (m.done) m.done(m);
      }
    }
    for (var j = tweens.length - 1; j >= 0; j--) {
      var t = tweens[j];
      t.el += dt;
      var q = t.dur ? Math.min(1, t.el / t.dur) : 1;
      t.apply(ease(q));
      if (q >= 1) { tweens.splice(j, 1); if (t.done) t.done(); }
    }
  }

  return { follow: follow, tween: tween, update: update, ease: ease, active: function () { return movers.length; } };
})();
