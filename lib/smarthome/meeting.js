/* lib/smarthome/meeting.js — ตัวต่อ "ห้องประชุม" (ERP occupancy)
   รับ path /meeting/.../count (number) และ .../until (string)
   คนเดินจากประตูไปนั่งเก้าอี้เมื่อจำนวนเพิ่ม และเดินออกเมื่อลด
*/
window.O3D = window.O3D || {};
window.O3D.SmartHome = window.O3D.SmartHome || {};
(function () {
  'use strict';
  var SHIRTS = [0x334b63, 0x3d6b58, 0x6d3a45];

  function MeetingWidget(env) {
    this.env = env || {};
    this.board = env.board;
    this.bus = env.bus;
    this.enabled = true;
    this.counts = {};
    this.untils = {};
    this.pool = [];
    this.geos = {};
    var self = this;
    this.board.meetings.forEach(function (m) {
      self.counts[m.path] = 0;
      if (m.untilPath) self.untils[m.untilPath] = '';
      m.people = [];
      m.count = 0;
    });
    this.unsub = this.bus.subscribe(function (path, value) {
      if (self.onState(path, value) && env.onChange) env.onChange();
    });
  }

  MeetingWidget.prototype.onState = function (path, value) {
    for (var i = 0; i < this.board.meetings.length; i++) {
      var m = this.board.meetings[i];
      if (m.path === path) {
        this.counts[path] = Math.max(0, Number(value) || 0);
        this.apply(m, this.counts[path], true);
        return true;
      }
      if (m.untilPath === path) {
        this.untils[path] = String(value || '');
        m.until = this.untils[path];
        return true;
      }
    }
    return false;
  };

  MeetingWidget.prototype.apply = function (m, n, animate) {
    n = Math.max(0, Math.min(m.cap, Number(n) || 0));
    m.count = n;
    if (!this.enabled) n = 0;
    var self = this;

    if (n > m.people.length) {
      for (var i = m.people.length; i < n; i++) {
        var seat = m.seats[i % m.seats.length];
        var mesh = this.takePerson(i);
        var p = { mesh: mesh, seat: seat };
        m.people.push(p);
        mesh.visible = true;
        mesh.position.set(seat.x, 0, seat.z);
        mesh.rotation.y = seat.ry;
        if (animate !== false && !this.instant) {
          var door = window.O3D.doorPoint(m.room);
          mesh.position.set(door.x, 0, door.z);
          window.Motion.follow(mesh, [{ x: door.x, z: door.z }, { x: seat.x, z: seat.z }], {
            speed: 1.5, bob: 0.035,
            done: (function (mesh, seat) {
              return function () { mesh.position.set(seat.x, 0, seat.z); mesh.rotation.y = seat.ry; };
            })(mesh, seat)
          });
        }
      }
    } else if (n < m.people.length) {
      while (m.people.length > n) {
        var q = m.people.pop();
        this.releasePerson(q.mesh, animate, m.room);
      }
    }
  };

  MeetingWidget.prototype.takePerson = function (i) {
    for (var k = 0; k < this.pool.length; k++) {
      if (!this.pool[k]._busy) { this.pool[k]._busy = true; return this.pool[k]; }
    }
    var c = SHIRTS[i % SHIRTS.length];
    if (!this.geos[c]) this.geos[c] = window.KIT.person(c);
    var mesh = new THREE.Mesh(this.geos[c], this.env.propMaterial);
    mesh.scale.setScalar(1.12);
    mesh.visible = false; mesh._busy = true;
    this.env.scene.add(mesh);
    this.pool.push(mesh);
    return mesh;
  };

  MeetingWidget.prototype.releasePerson = function (mesh, animate, room) {
    if (animate === false) { mesh.visible = false; mesh._busy = false; return; }
    var door = window.O3D.doorPoint(room);
    window.Motion.follow(mesh, [{ x: mesh.position.x, z: mesh.position.z }, { x: door.x, z: door.z }], {
      speed: 1.5, bob: 0.035,
      done: function () { mesh.visible = false; mesh._busy = false; }
    });
  };

  MeetingWidget.prototype.setEnabled = function (on) {
    this.enabled = !!on;
    var self = this;
    this.board.meetings.forEach(function (m) { self.apply(m, self.counts[m.path] || 0, false); });
  };

  MeetingWidget.prototype.set = function (roomId, n) {
    for (var i = 0; i < this.board.meetings.length; i++) {
      var m = this.board.meetings[i];
      if (m.id === roomId) { this.bus.set(m.path, Number(n) || 0, 'meeting'); return true; }
    }
    return false;
  };

  MeetingWidget.prototype.summary = function () {
    var rooms = 0, people = 0;
    for (var i = 0; i < this.board.meetings.length; i++) {
      var m = this.board.meetings[i];
      var n = this.enabled ? (this.counts[m.path] || 0) : 0;
      if (n > 0) { rooms++; people += n; }
    }
    return { rooms: rooms, total: this.board.meetings.length, people: people, enabled: this.enabled };
  };

  O3D.SmartHome.Meeting = MeetingWidget;
})();
