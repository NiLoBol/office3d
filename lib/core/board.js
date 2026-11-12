/* lib/core/board.js — แปลน → ฉาก 3D (ผนัง/พื้น/เฟอร์นิเจอร์/โคมไฟ/เซนเซอร์/จุดกด)
   ใช้: var board = O3D.buildBoard(plan); scene.add(board.group);
   คืน: {group, staticMesh, lights[], meetings[], slots[], picks[], labels[], panels, glows, sensors, gateArm}
*/
window.O3D = window.O3D || {};
(function () {
  'use strict';
  var K = window.KIT;
  var C = {
    wall: 0xe9e5dd, glass: 0xa9c9d9, slab: 0xa9a59d, ground: 0x7f9a68,
    asphalt: 0x3f454d, street: 0x333941, line: 0xe4e8eb, trim: 0xb8b0a2
  };

  function buildBoard(plan) {
    var board = {
      plan: plan, group: new THREE.Group(), C: C,
      lights: [], meetings: [], slots: [], picks: [], labels: []
    };
    collect(plan, board);
    var b = new K.Builder();
    floors(b, plan);
    wallsAndOpenings(b, plan);
    plan.rooms.forEach(function (r) {
      if (r.type === 'meeting') meetingRoom(b, r);
      else if (r.type === 'store') storeRoom(b, r);
      else if (r.type === 'empty') {
        b.at(r.x + 1.0, r.z + 1.0, 0); b.part(K.plant()); b.end();
        b.at(r.x + r.w - 1.0, r.z + r.d - 1.0, 0); b.part(K.plant()); b.end();
      }
      else workRoom(b, r);
    });
    corridorProps(b, plan);
    parkingLot(b, plan, board);
    landscape(b);
    var g = b.build();
    var mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.04 }));
    mesh.matrixAutoUpdate = false;
    board.staticMesh = mesh;
    board.group.add(mesh);

    buildLights(board);
    buildSensors(board);
    buildPicks(board);
    buildGate(board);
    return board;
  }

  /* ---------- เก็บของจากแปลน ---------- */
  function collect(plan, board) {
    plan.rooms.forEach(function (r) {
      if (r.bind && r.bind.light) {
        board.lights.push({ id: 'L-' + r.id, room: r.id, path: r.bind.light, x: r.x + r.w / 2, z: r.z + r.d / 2 });
      }
      if (r.type === 'meeting') {
        board.meetings.push({
          id: r.id, room: r, cap: r.cap || 6,
          path: r.bind.count, untilPath: r.bind.until,
          seats: seatsFor(r), people: [], count: 0, until: ''
        });
      }
      board.labels.push({ id: r.id, x: r.x + r.w / 2, z: r.z + r.d / 2, label: r.label });
    });
    (plan.extraLights || []).forEach(function (l) {
      board.lights.push({ id: l.id, room: 'corridor', path: l.bind, x: l.x, z: l.z });
    });
    if (plan.corridor) {
      board.labels.push({ id: 'corridor', x: plan.corridor.x + plan.corridor.w / 2, z: plan.corridor.z + plan.corridor.d / 2, label: plan.corridor.label });
    }
    var pk = plan.parking;
    if (!pk) return;
    var n = pk.cols * pk.rows.length;
    for (var i = 0; i < n; i++) {
      var col = i % pk.cols, row = Math.floor(i / pk.cols);
      var x = pk.area.x + 1.9 + col * 4.0;
      var z = pk.rows[row].z + pk.slotD / 2;
      var back = row === 0 ? pk.rows[0].z + 0.45 : pk.rows[1].z + pk.slotD - 0.45;
      board.slots.push({
        i: i, n: i + 1, row: row, x: x, z: z,
        path: pk.bind.slot.replace('{n}', i + 1),
        sensorX: x + pk.slotW / 2 - 0.3, sensorZ: back,
        occupied: false, car: null
      });
    }
  }

  function seatsFor(room) {
    var cap = room.cap || 6, per = Math.ceil(cap / 2);
    var len = cap <= 6 ? 3.0 : 3.8;
    var cx = room.x + room.w / 2, cz = room.z + room.d / 2;
    var out = [];
    [-1, 1].forEach(function (side) {
      for (var i = 0; i < per; i++) {
        var z = cz - len / 2 + (len / (per + 0.5)) * (i + 0.75);
        out.push({ x: cx + side * 0.86, z: z, ry: side < 0 ? 90 : -90 });
      }
    });
    return out.slice(0, cap);
  }

  function doorSpan(r, d) {
    var w = d.w || 1.2;
    if (d.side === 'z0' || d.side === 'z1') return { a: r.x + r.w / 2 - w / 2, b: r.x + r.w / 2 + w / 2 };
    return { a: r.z + r.d / 2 - w / 2, b: r.z + r.d / 2 + w / 2 };
  }

  function doorPoint(room) {
    var d = room.door, cx = room.x + room.w / 2, cz = room.z + room.d / 2;
    if (d.side === 'z0') return { x: cx, z: room.z - 0.7 };
    if (d.side === 'z1') return { x: cx, z: room.z + room.d + 0.7 };
    if (d.side === 'x0') return { x: room.x - 0.7, z: cz };
    return { x: room.x + room.w + 0.7, z: cz };
  }

  /* ---------- พื้น ---------- */
  function floors(b, plan) {
    var B = plan.building;
    b.box(36, -0.62, 12.5, 88, 0.3, 34, C.ground);
    b.box(B.x + B.w / 2, -0.3, B.z + B.d / 2, B.w + 0.9, 0.3, B.d + 0.9, C.slab);
    plan.rooms.forEach(function (r) {
      b.box(r.x + r.w / 2, 0.0, r.z + r.d / 2, r.w - 0.03, 0.03, r.d - 0.03, r.floor || 0xd3dbe5);
    });
    if (plan.corridor) {
      b.box(plan.corridor.x + plan.corridor.w / 2, 0.0, plan.corridor.z + plan.corridor.d / 2,
        plan.corridor.w - 0.03, 0.03, plan.corridor.d - 0.03, plan.corridor.floor || 0xc9ab84);
    }
  }

  /* ---------- ผนัง + ประตู + หน้าต่าง ---------- */
  function wallsAndOpenings(b, plan) {
    var B = plan.building, cell = 0.5, T = B.wallT, H = B.wallH;
    var HC = {}, VC = {};
    function ky(v) { return Math.round(v * 2); }
    function markH(z, x0, x1) { for (var x = x0; x < x1 - 0.01; x += cell) HC[ky(z) + '|' + ky(x)] = { z: z, x: Math.round(x * 2) / 2 }; }
    function markV(x, z0, z1) { for (var z = z0; z < z1 - 0.01; z += cell) VC[ky(x) + '|' + ky(z)] = { x: x, z: Math.round(z * 2) / 2 }; }
    function clearH(z, a, e) { for (var x = Math.floor(a / cell) * cell; x < e; x += cell) delete HC[ky(z) + '|' + ky(x)]; }
    function clearV(x, a, e) { for (var z = Math.floor(a / cell) * cell; z < e; z += cell) delete VC[ky(x) + '|' + ky(z)]; }

    plan.rooms.forEach(function (r) {
      var x0 = r.x, x1 = r.x + r.w, z0 = r.z, z1 = r.z + r.d;
      markH(z0, x0, x1); markH(z1, x0, x1); markV(x0, z0, z1); markV(x1, z0, z1);
      var d = r.door;
      if (d) {
        var sp = doorSpan(r, d);
        if (d.side === 'z0') clearH(z0, sp.a, sp.b);
        else if (d.side === 'z1') clearH(z1, sp.a, sp.b);
        else if (d.side === 'x0') clearV(x0, sp.a, sp.b);
        else if (d.side === 'x1') clearV(x1, sp.a, sp.b);
      }
    });

    markH(B.z, B.x, B.x + B.w); markH(B.z + B.d, B.x, B.x + B.w);
    markV(B.x, B.z, B.z + B.d); markV(B.x + B.w, B.z, B.z + B.d);
    if (plan.entrance) clearV(B.x + B.w, plan.entrance.from, plan.entrance.to);

    (plan.windows || []).forEach(function (w) {
      var len = w.to - w.from, mid = (w.from + w.to) / 2;
      if (w.side === 'z0' || w.side === 'z1') {
        var z = w.side === 'z0' ? B.z : B.z + B.d;
        clearH(z, w.from, w.to);
        b.box(mid, 0, z, len, 0.9, T, C.wall);
        b.box(mid, 2.2, z, len, H - 2.2, T, C.wall);
        b.box(mid, 0.9, z, len, 1.3, T * 0.55, C.glass);
      } else {
        var x = w.side === 'x0' ? B.x : B.x + B.w;
        clearV(x, w.from, w.to);
        b.box(x, 0, mid, T, 0.9, len, C.wall);
        b.box(x, 2.2, mid, T, H - 2.2, len, C.wall);
        b.box(x, 0.9, mid, T * 0.55, 1.3, len, C.glass);
      }
    });

    plan.rooms.forEach(function (r) {
      var d = r.door; if (!d) return;
      var sp = doorSpan(r, d), len = sp.b - sp.a, mid = (sp.a + sp.b) / 2;
      var jw = 0.1;
      if (d.side === 'z0' || d.side === 'z1') {
        var z = d.side === 'z0' ? r.z : r.z + r.d;
        b.box(mid, 2.1, z, len, H - 2.1, T, C.wall);
        b.box(sp.a - jw / 2, 0, z, jw, 2.1, T + 0.07, C.trim);
        b.box(sp.b + jw / 2, 0, z, jw, 2.1, T + 0.07, C.trim);
      } else {
        var x = d.side === 'x0' ? r.x : r.x + r.w;
        b.box(x, 2.1, mid, T, H - 2.1, len, C.wall);
        b.box(x, 0, sp.a - jw / 2, T + 0.07, 2.1, jw, C.trim);
        b.box(x, 0, sp.b + jw / 2, T + 0.07, 2.1, jw, C.trim);
      }
    });

    if (plan.entrance) {
      b.box(B.x + B.w + 0.6, 2.9, 11.5, 1.6, 0.16, 3.6, 0x99a3ad);
      b.box(B.x + B.w, 2.3, 11.5, T, H - 2.3, 2.2, C.wall);
    }

    emit(HC, true); emit(VC, false);

    function emit(map, horizontal) {
      var groups = {}, k;
      for (k in map) {
        var c = map[k];
        var gk = horizontal ? ky(c.z) : ky(c.x);
        (groups[gk] = groups[gk] || []).push(horizontal ? c.x : c.z);
      }
      Object.keys(groups).forEach(function (g) {
        var vals = groups[g].sort(function (a, c) { return a - c; });
        var i = 0;
        while (i < vals.length) {
          var a = vals[i], e = vals[i];
          while (i + 1 < vals.length && vals[i + 1] - e <= 0.51) { i++; e = vals[i]; }
          var x0 = a, x1 = e + cell, mid = (x0 + x1) / 2, len = x1 - x0;
          if (horizontal) b.box(mid, 0, Number(g) / 2, len + T, H, T, C.wall);
          else b.box(Number(g) / 2, 0, mid, T, H, len + T, C.wall);
          i++;
        }
      });
    }
  }

  /* ---------- เฟอร์นิเจอร์ ---------- */
  function workRoom(b, r) {
    var cx = r.x + r.w / 2, cz = r.z + r.d / 2;
    for (var i = 0; i < 4; i++) {
      var c = i % 2, row = Math.floor(i / 2);
      b.at(cx + (c - 0.5) * 3.2, cz + (row - 0.5) * 3.6, 0);
      b.part(K.desk());
      b.end();
    }
    var zc = r.door.side === 'z0' ? r.z + r.d - 0.45 : r.z + 0.45;
    b.box(cx, 0, zc, Math.min(4.6, r.w * 0.5), 1.0, 0.36, 0xdad3c6);
    b.at(r.x + 0.95, r.z + r.d - 0.95, 0); b.part(K.plant()); b.end();
  }

  function meetingRoom(b, r) {
    var cx = r.x + r.w / 2, cz = r.z + r.d / 2;
    var cap = r.cap || 6, len = cap <= 6 ? 3.0 : 3.8;
    b.box(cx, 0.72, cz, 1.3, 0.07, len, 0xd9cbb4);
    [[-0.5, -1], [0.5, -1], [-0.5, 1], [0.5, 1]].forEach(function (p) {
      b.box(cx + p[0], 0, cz + p[1] * (len / 2 - 0.3), 0.09, 0.72, 0.09, 0x8f8b83);
    });
    seatsFor(r).forEach(function (s) {
      b.at(s.x, s.z, s.ry); b.part(K.chair(0x3c4753)); b.end();
    });
    var wallZ = r.door.side === 'z0' ? r.z + r.d - 0.18 : r.z + 0.18;
    b.box(cx, 1.25, wallZ, 2.3, 1.3, 0.08, 0x1d242b);
    var cabZ = r.door.side === 'z0' ? r.z + 0.4 : r.z + r.d - 0.4;
    b.box(cx, 0, cabZ, 2.0, 0.85, 0.4, 0xdad3c6);
    b.at(r.x + 0.8, r.z + 0.8, 0); b.part(K.plant()); b.end();
  }

  function storeRoom(b, r) {
    var cx = r.x + r.w / 2, cz = r.z + r.d / 2;
    for (var i = 0; i < 3; i++) {
      b.box(r.x + 0.55, 0, r.z + 1.6 + i * 2.6, 0.9, 2.1, 1.8, 0xc9c2b4);
      b.box(r.x + 1.6, 0.9, r.z + 1.6 + i * 2.6, 0.9, 0.7, 1.2, 0xb9a98f);
    }
    b.box(cx + 1.5, 0, cz, 2.2, 0.75, 1.2, 0xd6cec0);
  }

  function corridorProps(b, plan) {
    if (!plan.corridor) return;
    var e = plan.entrance ? plan.entrance.from : 11;
    b.box(38.2, 0, 11.5, 1.6, 1.05, 1.1, 0xd2c9bb);
    b.box(38.2, 1.05, 11.5, 1.75, 0.08, 1.25, 0xece5d8);
    [5, 18, 26, 35].forEach(function (x) { b.at(x, 11.5, 0); b.part(K.plant()); b.end(); });
    b.box(32.5, 0, 10.4, 0.5, 1.1, 0.5, 0xbfc8d0);
  }

  /* ---------- ลานจอด ---------- */
  function parkingLot(b, plan, board) {
    var pk = plan.parking; if (!pk) return;
    var A = pk.area, S = pk.street;
    b.box(A.x + A.w / 2, -0.3, A.z + A.d / 2, A.w, 0.28, A.d, C.asphalt);
    b.box(S.x + S.w / 2, -0.3, S.z + S.d / 2, S.w, 0.26, S.d, C.street);
    b.box(A.x + A.w + 0.4, -0.28, 11.5, 1.2, 0.26, 4.2, 0x7d8288);
    board.slots.forEach(function (s) {
      var hw = pk.slotW / 2, hd = pk.slotD / 2;
      b.box(s.x - hw, -0.03, s.z, 0.09, 0.02, pk.slotD, C.line);
      b.box(s.x + hw, -0.03, s.z, 0.09, 0.02, pk.slotD, C.line);
      b.box(s.x, -0.03, s.z + (s.row === 0 ? -hd : hd), pk.slotW, 0.02, 0.09, C.line);
      b.box(s.sensorX, 0, s.sensorZ, 0.12, 0.38, 0.12, 0x6a7078);
    });
    b.box(41.5, 0, 11.2, 0.18, 2.4, 0.18, 0x7c828a);
    b.box(41.5, 2.3, 11.2, 0.12, 0.7, 1.7, 0x2b7bd6);
    var G = pk.gate;
    b.box(G.x, 0, G.z - 2.1, 0.22, 1.1, 0.22, 0xb5bbc2);
    b.box(G.x, 0, G.z + 2.1, 0.18, 0.9, 0.18, 0x8f959c);
    b.box(S.x + S.w / 2, -0.03, S.z + S.d / 2, 0.12, 0.02, S.d, 0xe8d17a);
  }

  function landscape(b) {
    [[-5, 3], [-5, 20], [4, -3.5], [24, -3.5], [46, 25], [58, 25]].forEach(function (p) {
      b.at(p[0], p[1], 0); b.part(K.tree(4.2 + (Math.abs(p[0]) % 3))); b.end();
    });
  }

  /* ---------- โคมไฟ (instanced) + แสงพื้นแบบ tint (ไม่ใช่ additive จะได้ไม่ขาวจ้า) ---------- */
  function buildLights(board) {
    var n = board.lights.length;
    if (!n) return;
    var tex = glowTexture();
    board.panels = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.07, 1.1), new THREE.MeshBasicMaterial({}), n);
    board.glows = [];
    board.glowGroup = new THREE.Group();
    var d = new THREE.Object3D(), col = new THREE.Color();
    board.lights.forEach(function (l, i) {
      d.scale.set(1, 1, 1);
      d.position.set(l.x, board.plan.building.wallH - 0.14, l.z); d.rotation.set(0, 0, 0);
      d.updateMatrix(); board.panels.setMatrixAt(i, d.matrix);
      var room = null;
      for (var k = 0; k < board.plan.rooms.length; k++) if (board.plan.rooms[k].id === l.room) room = board.plan.rooms[k];
      var rad = room ? Math.min(room.w, room.d) * 0.62 : 3.2;
      l.radius = rad;
      var geo = new THREE.CircleGeometry(rad, 18);
      geo.rotateX(-Math.PI / 2);
      var mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: 0xffb063, opacity: 0, depthWrite: false });
      var m = new THREE.Mesh(geo, mat);
      m.position.set(l.x, 0.07, l.z);
      m.visible = false;
      board.glowGroup.add(m);
      board.glows.push(m);
      board.panels.setColorAt(i, col.setHex(0x232830));
    });
    board.group.add(board.panels);
    board.group.add(board.glowGroup);
  }

  function glowTexture() {
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var g = c.getContext('2d');
    var rad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    rad.addColorStop(0, 'rgba(255,255,255,0.9)');
    rad.addColorStop(0.4, 'rgba(255,255,255,0.32)');
    rad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rad; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  /* ---------- เซนเซอร์ช่องจอด ---------- */
  function buildSensors(board) {
    var n = board.slots.length;
    if (!n) return;
    board.sensors = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.13, 0.13), new THREE.MeshBasicMaterial({}), n);
    var d = new THREE.Object3D(), col = new THREE.Color();
    board.slots.forEach(function (s, i) {
      d.position.set(s.sensorX, 0.44, s.sensorZ);
      d.rotation.set(0, 0, 0);
      d.updateMatrix(); board.sensors.setMatrixAt(i, d.matrix);
      board.sensors.setColorAt(i, col.setHex(0x2f8a55));
    });
    board.group.add(board.sensors);
  }

  /* ---------- พื้นที่กด (โปร่งใส) ---------- */
  function buildPicks(board) {
    board.plan.rooms.forEach(function (r) {
      board.picks.push({ type: 'room', id: r.id, x: r.x + r.w / 2, z: r.z + r.d / 2, w: r.w - 0.4, d: r.d - 0.4 });
    });
    board.slots.forEach(function (s) {
      board.picks.push({ type: 'slot', id: s.i, x: s.x, z: s.z, w: board.plan.parking.slotW - 0.2, d: board.plan.parking.slotD - 0.2 });
    });
    var geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    board.proxy = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }), board.picks.length);
    var d = new THREE.Object3D();
    board.picks.forEach(function (p, i) {
      d.position.set(p.x, 0.24, p.z);
      d.scale.set(p.w, 1, p.d);
      d.updateMatrix(); board.proxy.setMatrixAt(i, d.matrix);
    });
    board.group.add(board.proxy);
  }

  function buildGate(board) {
    var pk = board.plan.parking; if (!pk) return;
    var b = new K.Builder();
    b.box(0, 0, 2.1, 0.1, 0.12, 4.2, 0xd94a48);
    board.gateArm = new THREE.Mesh(b.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 }));
    board.gateArm.position.set(pk.gate.x, 1.05, pk.gate.z - 2.1);
    board.group.add(board.gateArm);
  }

  O3D.buildBoard = buildBoard;
  O3D.seatsFor = seatsFor;
  O3D.doorPoint = doorPoint;
})();
