/* lib/smarthome/light.js — ตัวต่อ "ไฟ" (Smart Home)
   ใช้: var L = new O3D.SmartHome.Light({board, bus, onChange});
   รับ path /lights/* → bool · คุมโคม + แสงพื้น (fade)
*/
window.O3D = window.O3D || {};
window.O3D.SmartHome = window.O3D.SmartHome || {};
(function () {
  'use strict';
  var A = new THREE.Color(), B = new THREE.Color();

  function LightWidget(env) {
    this.env = env || {};
    this.board = env.board;
    this.bus = env.bus;
    this.enabled = true;
    this.first = true;
    this.values = {};
    this.v = [];
    var self = this;
    this.board.lights.forEach(function (l) { self.values[l.path] = false; self.v.push(0); });
    this.unsub = this.bus.subscribe(function (path, value) {
      if (self.onState(path, value) && env.onChange) env.onChange();
    });
  }

  LightWidget.prototype.onState = function (path, value) {
    if (!(path in this.values)) return false;
    this.values[path] = !!value;
    return true;
  };

  LightWidget.prototype.pathOf = function (roomId) {
    var out = null;
    this.board.lights.forEach(function (l) { if (l.room === roomId) out = l.path; });
    return out;
  };

  LightWidget.prototype.value = function (path) { return !!this.values[path]; };

  LightWidget.prototype.set = function (path, on) {
    this.bus.set(path, !!on, 'light');
    return true;
  };

  LightWidget.prototype.toggle = function (path) { return this.set(path, !this.values[path]); };

  LightWidget.prototype.setAll = function (on) {
    var self = this;
    this.board.lights.forEach(function (l) { self.bus.set(l.path, !!on, 'light'); });
  };

  LightWidget.prototype.setEnabled = function (on) { this.enabled = !!on; };

  LightWidget.prototype.tick = function (dt) {
    var panels = this.board.panels, glows = this.board.glows;
    if (!panels) return;
    var dirty = false;
    for (var i = 0; i < this.board.lights.length; i++) {
      var l = this.board.lights[i];
      var want = (this.enabled && this.values[l.path]) ? 1 : 0;
      var v = this.v[i];
      if (this.first) v = want;
      if (Math.abs(v - want) < 0.004 && !this.first) continue;
      if (!this.first) {
        v += (want - v) * Math.min(1, dt * 9);
        if (Math.abs(v - want) < 0.01) v = want;
      }
      this.v[i] = v;
      dirty = true;
      A.setRGB(0.12 + 0.88 * v, 0.14 + 0.8 * v, 0.17 + 0.6 * v);
      panels.setColorAt(i, A);
      var g = this.board.glows && this.board.glows[i];
      if (g) { g.visible = v > 0.02; g.material.opacity = v * 0.72; }
    }
    if (dirty && panels.instanceColor) panels.instanceColor.needsUpdate = true;
    this.first = false;
  };

  LightWidget.prototype.summary = function () {
    var on = 0;
    this.board.lights.forEach(function (l) { if (l.on !== false) { } });
    for (var i = 0; i < this.board.lights.length; i++) {
      if (this.enabled && this.values[this.board.lights[i].path]) on++;
    }
    return { on: on, total: this.board.lights.length, enabled: this.enabled };
  };

  O3D.SmartHome.Light = LightWidget;
})();
