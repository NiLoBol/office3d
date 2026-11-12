/* lib/smarthome/device.js — "อุปกรณ์" แบบ config-driven
   ใช้: plan.devices = [{id,type,label,path,x,z}] + new O3D.SmartHome.Devices({plan,bus,scene})
   ไม่ต้องเขียนโค้ดต่ออุปกรณ์ใหม่: เพิ่มบรรทัดใน plan → ได้หมุด 3D + สถานะ + ปุ่มสั่งงาน
   type: light | door | climate | sensor | lock | generic (กำหนดสีตอน on/off)
*/
window.O3D = window.O3D || {};
window.O3D.SmartHome = window.O3D.SmartHome || {};
(function () {
  'use strict';
  var ON = { light: 0xffc16b, door: 0x58d68d, climate: 0x5ec8ff, sensor: 0xe8615a, lock: 0x58d68d, generic: 0x8adf9a };
  var OFF = 0x3a424c;

  function Devices(env) {
    this.env = env || {};
    this.bus = env.bus;
    this.plan = env.plan || (env.board && env.board.plan) || {};
    this.list = (this.plan.devices || []).slice();
    this.values = {};
    this.enabled = true;
    var self = this;
    if (!this.list.length) return;

    var geo = new THREE.BoxGeometry(0.34, 0.34, 0.34);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.15 }), this.list.length);
    var d = new THREE.Object3D(), col = new THREE.Color();
    this.list.forEach(function (dev, i) {
      d.position.set(dev.x, 1.15, dev.z);
      d.rotation.set(0, 0, 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      self.mesh.setMatrixAt(i, d.matrix);
      self.mesh.setColorAt(i, col.setHex(OFF));
      self.values[dev.path] = null;
    });
    (env.scene || new THREE.Scene()).add(this.mesh);

    this.unsub = this.bus.subscribe(function (path, value) {
      if (self.onState(path, value) && env.onChange) env.onChange();
    });
  }

  Devices.prototype.onState = function (path, value) {
    var hit = false;
    for (var i = 0; i < this.list.length; i++) {
      if (this.list[i].path === path) { this.values[path] = value; hit = true; break; }
    }
    if (hit) this.paint();
    return hit;
  };

  Devices.prototype.paint = function () {
    var col = new THREE.Color();
    for (var i = 0; i < this.list.length; i++) {
      var dev = this.list[i], v = this.values[dev.path];
      var on = this.enabled && (v === true || (typeof v === 'number' && v > 0) || (typeof v === 'string' && v !== '' && v !== 'off' && v !== 'false'));
      col.setHex(on ? (ON[dev.type] || ON.generic) : OFF);
      this.mesh.setColorAt(i, col);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  };

  Devices.prototype.setEnabled = function (on) { this.enabled = !!on; this.paint(); };

  Devices.prototype.set = function (path, value) { this.bus.set(path, value, 'device'); };

  Devices.prototype.toggle = function (path) { this.bus.set(path, !this.values[path], 'device'); };

  Devices.prototype.value = function (path) { return this.values[path]; };

  Devices.prototype.summary = function () {
    var on = 0;
    for (var i = 0; i < this.list.length; i++) {
      var v = this.values[this.list[i].path];
      if (this.enabled && (v === true || (typeof v === 'number' && v > 0))) on++;
    }
    return { on: on, total: this.list.length, enabled: this.enabled };
  };

  O3D.SmartHome.Devices = Devices;
})();
