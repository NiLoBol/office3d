/* lib/smarthome/parking.js — ตัวต่อ "ที่จอดรถ" (เซนเซอร์ + ไม้กั้น)
   รับ path /parking/slot/N/occupied (bool) และ /parking/gate (bool)
   รถวิ่งเข้าจากถนน → ผ่านไม้กั้น → เข้าช่อง · ออกกลับทางเดิม
*/
window.O3D = window.O3D || {};
window.O3D.SmartHome = window.O3D.SmartHome || {};
(function () {
  'use strict';
  var CAR_COLORS = [0xf2f4f6, 0x3f6fa8, 0x9b3b36, 0x5f7a5a, 0xc9a13a];

  function ParkingWidget(env) {
    this.env = env || {};
    this.board = env.board;
    this.plan = env.board.plan;
    this.bus = env.bus;
    this.enabled = true;
    this.gate = false;
    this.pool = [];
    this.geos = {};
    var self = this;
    this.board.slots.forEach(function (s) { s.occupied = false; s.car = null; });
    this.unsub = this.bus.subscribe(function (path, value) {
      if (self.onState(path, value) && env.onChange) env.onChange();
    });
  }

  ParkingWidget.prototype.onState = function (path, value) {
    var pk = this.plan.parking;
    if (path === pk.bind.gate) { this.setGate(!!value); return true; }
    for (var i = 0; i < this.board.slots.length; i++) {
      var s = this.board.slots[i];
      if (s.path === path) { this.apply(s, !!value, true); return true; }
    }
    return false;
  };

  ParkingWidget.prototype.apply = function (s, occupied, animate) {
    if (s.occupied === occupied) return;
    s.occupied = occupied;
    if (!this.enabled) {
      if (s.car) { s.car.visible = false; s.car._busy = false; s.car = null; }
      this.updateSensors();
      return;
    }
    if (occupied) {
      if (!s.car) s.car = this.takeCar(s.i);
      var car = s.car;
      car.visible = true;
      if (animate === false || this.instant) {
        car.position.set(s.x, 0, s.z);
        car.rotation.y = s.row === 0 ? Math.PI : 0;
      } else {
        window.Motion.follow(car, this.carInPath(s), {
          speed: 8.5,
          done: function () { car.position.set(s.x, 0, s.z); car.rotation.y = s.row === 0 ? Math.PI : 0; }
        });
      }
    } else {
      var c = s.car;
      s.car = null;
      if (c) {
        if (animate === false || this.instant) { c.visible = false; c._busy = false; }
        else window.Motion.follow(c, this.carOutPath(s), { speed: 8.5, done: function () { c.visible = false; c._busy = false; } });
      }
    }
    this.updateSensors();
  };

  ParkingWidget.prototype.carInPath = function (s) {
    var pk = this.plan.parking, gate = pk.gate;
    return [
      { x: pk.street.x + 8, z: 9.5 + (s.i % 3) * 1.1 },
      { x: gate.x + 1.5, z: 9.5 + (s.i % 3) * 1.1 },
      { x: gate.x, z: 11 },
      { x: s.x, z: 11 },
      { x: s.x, z: s.z }
    ];
  };

  ParkingWidget.prototype.carOutPath = function (s) {
    var pk = this.plan.parking, gate = pk.gate;
    return [
      { x: s.x, z: s.z },
      { x: s.x, z: 11 },
      { x: gate.x, z: 11 },
      { x: pk.street.x + 8, z: 11 }
    ];
  };

  ParkingWidget.prototype.takeCar = function (i) {
    for (var k = 0; k < this.pool.length; k++) {
      if (!this.pool[k]._busy) { this.pool[k]._busy = true; return this.pool[k]; }
    }
    var c = CAR_COLORS[i % CAR_COLORS.length];
    if (!this.geos[c]) this.geos[c] = window.KIT.car(c);
    var mesh = new THREE.Mesh(this.geos[c], this.env.propMaterial);
    mesh.visible = false; mesh._busy = true;
    this.env.scene.add(mesh);
    this.pool.push(mesh);
    return mesh;
  };

  ParkingWidget.prototype.updateSensors = function () {
    var sensors = this.board.sensors;
    if (!sensors) return;
    var col = new THREE.Color();
    for (var i = 0; i < this.board.slots.length; i++) {
      var on = this.enabled && this.board.slots[i].occupied;
      sensors.setColorAt(i, col.setHex(on ? 0xd94a48 : 0x2f8a55));
    }
    if (sensors.instanceColor) sensors.instanceColor.needsUpdate = true;
  };

  ParkingWidget.prototype.setGate = function (open) {
    if (this.gate === open) return;
    this.gate = open;
    var arm = this.board.gateArm;
    if (!arm) return;
    window.Motion.tween(0.55, function (p) { arm.rotation.x = -1.32 * p; });
  };

  ParkingWidget.prototype.setEnabled = function (on) {
    this.enabled = !!on;
    var self = this;
    this.board.slots.forEach(function (s) { self.apply(s, s.occupied, false); });
    this.updateSensors();
  };

  ParkingWidget.prototype.set = function (slotIndex, occupied) {
    var s = this.board.slots[slotIndex];
    if (!s) return false;
    this.bus.set(s.path, !!occupied, 'parking');
    return true;
  };

  ParkingWidget.prototype.freeSlot = function () {
    for (var i = 0; i < this.board.slots.length; i++) if (!this.board.slots[i].occupied) return this.board.slots[i];
    return null;
  };

  ParkingWidget.prototype.occupiedSlot = function () {
    for (var i = 0; i < this.board.slots.length; i++) if (this.board.slots[i].occupied) return this.board.slots[i];
    return null;
  };

  ParkingWidget.prototype.summary = function () {
    var free = 0;
    this.board.slots.forEach(function (s) { if (!s.occupied) free++; });
    return { free: free, total: this.board.slots.length, gate: this.gate, enabled: this.enabled };
  };

  O3D.SmartHome.Parking = ParkingWidget;
})();
