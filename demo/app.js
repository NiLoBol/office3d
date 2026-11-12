/* demo/app.js — หน้าเดโม: ใช้ lib/core + lib/smarthome เท่านั้น (ไม่มีความรู้เรื่องออฟฟิศอยู่ใน lib) */
(function () {
  'use strict';
  var P = window.OFFICE_PLAN, BUS = window.OfficeBus, MO = window.Motion, K = window.KIT;
  var D2R = Math.PI / 180;

  window.__ERRS = [];
  window.addEventListener('error', function (e) { window.__ERRS.push(String((e && e.message) || e)); });

  var scene, cam, renderer, board, widgets, propMat, hemi, d1, d2, amb, nightMode = false;
  var raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  var cv, stageEl, labelsEl, cardsEl, popEl, toastEl, statEl;
  var theta = 0.3, phi = 0.8, dist = 88, target = new THREE.Vector3(33, 0, 12);
  var labelsOn = true, autoOn = false, autoTimer = null, seeding = false;
  var lastT = 0, fpsAcc = 0, fpsN = 0, fps = 0;

  boot();

  function boot() {
    cv = document.getElementById('cv');
    stageEl = document.getElementById('stage');
    labelsEl = document.getElementById('labels');
    cardsEl = document.getElementById('cards');
    popEl = document.getElementById('pop');
    toastEl = document.getElementById('toast');
    statEl = document.getElementById('stat');

    if (!window.THREE) return fail('ไม่พบ three.js');
    try {
      renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
    } catch (e) { return fail('WebGL ใช้ไม่ได้: ' + e.message); }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

    scene = new THREE.Scene();
    cam = new THREE.PerspectiveCamera(38, 1, 0.4, 900);
    hemi = new THREE.HemisphereLight(0xdcebff, 0x3a4550, 0.55); scene.add(hemi);
    d1 = new THREE.DirectionalLight(0xfff0d8, 1.15); d1.position.set(50, 80, 34); scene.add(d1);
    d2 = new THREE.DirectionalLight(0x9dc2ff, 0.3); d2.position.set(-40, 45, -46); scene.add(d2);
    amb = new THREE.AmbientLight(0xffffff, 0.05); scene.add(amb);
    if (THREE.ACESFilmicToneMapping) { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; }
    propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.12 });

    board = O3D.buildBoard(P);
    scene.add(board.group);
    widgets = O3D.createSmartHome({ board: board, bus: BUS, scene: scene, propMaterial: propMat, onChange: refreshUI });

    buildLabels();
    bindUI();
    resize();
    seed();
    refreshUI();
    window.addEventListener('resize', resize);
    requestAnimationFrame(loop);
    setInterval(function () { if (document.hidden) { MO.update(0.6); widgets.light && widgets.light.tick(0.6); drawOnce(); updateLabels(); } }, 600);

    window.Office3D = {
      set: function (p, v) { return BUS.set(p, v, 'api'); },
      get: function (p) { return BUS.get(p); },
      state: function () { return BUS.snapshot(); },
      plan: function () { return P; },
      widgets: function () { return widgets; },
      board: function () { return board; }
    };
    window.__dbg = { renderer: renderer, scene: scene, cam: cam, draw: drawOnce,
      settle: function (sec) {
        var n = Math.max(1, Math.round((sec || 10) / 0.1));
        for (var i = 0; i < n; i++) { MO.update(0.1); widgets.light && widgets.light.tick(0.1); }
        drawOnce(); updateLabels(); return MO.active();
      } };
    window.__probe = probe;
  }

  function fail(msg) {
    var el = document.getElementById('fallback');
    if (el) { el.style.display = 'flex'; el.textContent = msg; }
    if (statEl) statEl.textContent = msg;
  }

  function probe() {
    var info = renderer ? renderer.info.render : { calls: 0, triangles: 0 };
    return {
      errs: window.__ERRS, fps: fps, calls: info.calls, tri: info.triangles,
      dist: +dist.toFixed(1), lights: board.lights.length, meets: board.meetings.length, slots: board.slots.length,
      state: BUS.snapshot().state, anim: MO.active()
    };
  }

  /* ---------------- ข้อมูลตั้งต้น ---------------- */
  function seed() {
    var s = {};
    s['/lights/sales'] = true;
    s['/lights/it'] = true;
    s['/lights/corridor'] = true;
    s['/lights/corridor2'] = true;
    s['/lights/meeting1'] = true;
    s['/meeting/mr1/count'] = 5;
    s['/meeting/mr1/until'] = '17:30';
    s['/meeting/mr2/count'] = 0;
    s['/parking/gate'] = false;
    s['/door/main'] = true;
    s['/climate/sales'] = true;
    s['/sensor/entry'] = false;
    s['/lock/store'] = false;
    [1, 2, 4, 7, 9].forEach(function (n) { s['/parking/slot/' + n + '/occupied'] = true; });
    seeding = true;
    if (widgets.meeting) widgets.meeting.instant = true;
    if (widgets.parking) widgets.parking.instant = true;
    if (widgets.light) widgets.light.instant = true;
    BUS.patch(s, 'seed');
    seeding = false;
    if (widgets.meeting) widgets.meeting.instant = false;
    if (widgets.parking) widgets.parking.instant = false;
    if (widgets.light) widgets.light.instant = false;
  }

  /* ---------------- ป้ายชื่อห้อง ---------------- */
  function buildLabels() {
    labelsEl.innerHTML = board.labels.map(function (r, i) {
      return '<div class="lb" id="lb' + i + '">' + r.label + '</div>';
    }).join('');
  }

  function labelText(id) {
    for (var i = 0; i < board.meetings.length; i++) {
      var m = board.meetings[i];
      if (m.id === id && widgets.meeting) {
        var n = widgets.meeting.counts[m.path] || 0;
        return m.room.label + (n ? ' · ' + n + ' คน' : '');
      }
    }
    for (var j = 0; j < board.labels.length; j++) if (board.labels[j].id === id) return board.labels[j].label;
    return '';
  }

  function updateLabels() {
    labelsEl.style.display = labelsOn ? 'block' : 'none';
    if (!labelsOn) return;
    var rect = cv.getBoundingClientRect(), v = new THREE.Vector3();
    var kids = labelsEl.children;
    for (var i = 0; i < kids.length; i++) {
      var rl = board.labels[i];
      if (!rl) continue;
      v.set(rl.x, 2.55, rl.z).project(cam);
      var vis = v.z < 1 && v.z > -1;
      kids[i].style.display = vis ? 'block' : 'none';
      if (!vis) continue;
      var sx = (v.x * 0.5 + 0.5) * rect.width;
      var sy = (-v.y * 0.5 + 0.5) * rect.height;
      kids[i].style.transform = 'translate(-50%,-50%) translate(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px)';
      kids[i].textContent = labelText(rl.id);
    }
  }

  /* ---------------- UI ---------------- */
  var CARDS = [
    { id: 'light', ico: '💡', name: 'ไฟ', src: 'Smart Home', st: 'st-light',
      acts: '<button data-act="light-on">เปิดทั้งหมด</button><button data-act="light-off">ปิดทั้งหมด</button>' },
    { id: 'meeting', ico: '👥', name: 'ห้องประชุม', src: 'WRIS ERP', st: 'st-meeting',
      acts: '<button data-act="meet-mr1">ห้อง 1</button><button data-act="meet-mr2">ห้อง 2</button>' },
    { id: 'parking', ico: '🅿️', name: 'ที่จอดรถ', src: 'Sensor API', st: 'st-parking',
      acts: '<button data-act="car-in">รถเข้า</button><button data-act="car-out">รถออก</button>' }
  ];

  function drawCards() {
    cardsEl.innerHTML = CARDS.map(function (c) {
      return '<div class="card" data-mod="' + c.id + '">' +
        '<div class="ico">' + c.ico + '</div>' +
        '<div class="mid"><div class="nm">' + c.name + ' <span class="badge">' + c.src + '</span></div>' +
        '<div class="st" id="' + c.st + '">—</div><div class="acts">' + c.acts + '</div></div>' +
        '<label class="sw"><input type="checkbox" data-mod="' + c.id + '" checked><span></span></label>' +
        '</div>';
    }).join('');
  }

  function refreshUI() {
    var L = widgets.light ? widgets.light.summary() : { on: 0, total: 0, enabled: false };
    var M = widgets.meeting ? widgets.meeting.summary() : { rooms: 0, total: 0, people: 0, enabled: false };
    var Pk = widgets.parking ? widgets.parking.summary() : { free: 0, total: 0, gate: false, enabled: false };
    var el;
    el = document.getElementById('st-light');
    if (el) el.textContent = 'เปิด ' + L.on + '/' + L.total + ' ดวง';
    el = document.getElementById('st-meeting');
    if (el) el.textContent = 'ประชุม ' + M.rooms + '/' + M.total + ' ห้อง · ' + M.people + ' คน';
    el = document.getElementById('st-parking');
    if (el) el.textContent = 'ว่าง ' + Pk.free + '/' + Pk.total + ' ช่อง' + (Pk.gate ? ' · ไม้กั้นเปิด' : '');

    renderDevices();

    ['light', 'meeting', 'parking'].forEach(function (id) {
      var card = document.querySelector('.card[data-mod="' + id + '"]');
      if (card && widgets[id]) card.classList.toggle('off', !widgets[id].enabled);
      var sw = document.querySelector('input[data-mod="' + id + '"]');
      if (sw && widgets[id]) sw.checked = widgets[id].enabled;
    });
    renderLog();
  }

  function renderDevices() {
    var host = document.getElementById('devices');
    if (!host) return;
    if (!widgets.devices) { host.innerHTML = ''; return; }
    host.innerHTML = widgets.devices.list.map(function (d) {
      var v = widgets.devices.values[d.path];
      var on = v === true || (typeof v === 'number' && v > 0);
      var txt = (v === null || v === undefined) ? '—' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
      return '<button class="chip' + (on ? ' on' : '') + '" data-path="' + d.path + '"><b>' + d.label + '</b><span>' + txt + '</span></button>';
    }).join('');
  }

  function renderLog() {    var el = document.getElementById('log');
    if (!el) return;
    var rows = BUS.log().slice(0, 6).map(function (e) {
      var val = JSON.stringify(e.value);
      if (val && val.length > 26) val = val.slice(0, 26) + '…';
      return '<div class="lg"><span class="t">' + e.t.toTimeString().slice(0, 8) + '</span><code>' + e.path + '</code><span class="v">' + val + '</span></div>';
    });
    el.innerHTML = rows.join('') || '<div class="lg empty">ยังไม่มีสัญญาณเข้ามา</div>';
  }

  function applyNight() {
    hemi.intensity = nightMode ? 0.12 : 0.55;
    d1.intensity = nightMode ? 0.16 : 1.15;
    d2.intensity = nightMode ? 0.06 : 0.3;
    amb.intensity = nightMode ? 0.015 : 0.05;
  }

  function bindUI() {
    document.getElementById('btnReset').addEventListener('click', function () {
      theta = 0.3; phi = 0.8; dist = 88; target.set(33, 0, 12);
    });
    document.getElementById('btnNight').addEventListener('click', function () {
      nightMode = !nightMode;
      this.classList.toggle('on', nightMode);
      document.body.classList.toggle('night', nightMode);
      applyNight();
    });
    document.getElementById('btnLabels').addEventListener('click', function () {
      labelsOn = !labelsOn; this.classList.toggle('on', labelsOn);
    });
    document.getElementById('btnSim').addEventListener('click', function () {
      autoOn = !autoOn; this.classList.toggle('on', autoOn);
      if (autoOn) { autoTimer = setInterval(simTick, 8000); simTick(); }
      else if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    });
    document.getElementById('send').addEventListener('click', function () {
      var p = document.getElementById('path').value.trim();
      if (!p) return;
      BUS.set(p, BUS.parse(document.getElementById('val').value), 'console');
    });
    document.getElementById('copy').addEventListener('click', function () {
      var txt = JSON.stringify(BUS.snapshot().state, null, 1), b = this;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { b.textContent = 'คัดลอกแล้ว ✓'; setTimeout(function () { b.textContent = 'คัดลอก state'; }, 1500); });
      }
    });
    document.getElementById('popX').addEventListener('click', hidePop);
    var devHost = document.getElementById('devices');
    if (devHost) devHost.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-path]') : null;
      if (b && widgets.devices) widgets.devices.toggle(b.dataset.path);
    });
    cardsEl.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-act]') : null;
      if (b) doAction(b.dataset.act);
    });
    cardsEl.addEventListener('change', function (e) {
      var sw = e.target;
      if (!sw || !sw.dataset || !sw.dataset.mod) return;
      var w = widgets[sw.dataset.mod];
      if (w) w.setEnabled(sw.checked);
      refreshUI();
    });
    popEl.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-act]') : null;
      if (b) doAction(b.dataset.act);
    });
  }

  function doAction(act) {
    if (act === 'light-on' && widgets.light) widgets.light.setAll(true);
    else if (act === 'light-off' && widgets.light) widgets.light.setAll(false);
    else if (act === 'meet-mr1' && widgets.meeting) widgets.meeting.set('meeting1', (widgets.meeting.counts['/meeting/mr1/count'] || 0) ? 0 : 6);
    else if (act === 'meet-mr2' && widgets.meeting) widgets.meeting.set('meeting2', (widgets.meeting.counts['/meeting/mr2/count'] || 0) ? 0 : 4);
    else if (act === 'car-in' && widgets.parking) {
      var f = widgets.parking.freeSlot();
      if (f) { BUS.set(P.parking.bind.gate, true, 'ui'); widgets.parking.set(f.i, true); setTimeout(function () { BUS.set(P.parking.bind.gate, false, 'ui'); }, 2600); }
    } else if (act === 'car-out' && widgets.parking) {
      var o = widgets.parking.occupiedSlot();
      if (o) { BUS.set(P.parking.bind.gate, true, 'ui'); widgets.parking.set(o.i, false); setTimeout(function () { BUS.set(P.parking.bind.gate, false, 'ui'); }, 2600); }
    } else if (act === 'toggle-light') {
      if (popEl.dataset.light && widgets.light) widgets.light.toggle(popEl.dataset.light);
      showRoom(popEl.dataset.room);
    } else if (act === 'toggle-slot' && widgets.parking) {
      widgets.parking.set(Number(popEl.dataset.slot), !board.slots[Number(popEl.dataset.slot)].occupied);
      showSlot(Number(popEl.dataset.slot));
    } else if (act === 'meet-toggle' && widgets.meeting) {
      var mp = popEl.dataset.meetPath;
      widgets.meeting.set(popEl.dataset.room, (widgets.meeting.counts[mp] || 0) ? 0 : Number(popEl.dataset.cap));
      showRoom(popEl.dataset.room);
    }
    refreshUI();
  }

  /* ---------------- ป๊อปอัป ---------------- */
  function showRoom(id) {
    var r = null, m = null;
    P.rooms.forEach(function (x) { if (x.id === id) r = x; });
    board.meetings.forEach(function (x) { if (x.id === id) m = x; });
    if (!r) return;
    popEl.dataset.room = r.id;
    popEl.dataset.light = r.bind ? r.bind.light : '';
    document.getElementById('popT').textContent = r.label;
    var html = '';
    if (r.bind && r.bind.light) {
      var on = widgets.light && widgets.light.value(r.bind.light);
      html += '<div class="kv">ไฟ: <b>' + (on ? 'เปิด' : 'ปิด') + '</b> · path <code>' + r.bind.light + '</code></div>';
    }
    if (m) {
      var n = widgets.meeting ? (widgets.meeting.counts[m.path] || 0) : 0;
      popEl.dataset.meetPath = m.path;
      popEl.dataset.cap = m.cap;
      html += '<div class="kv">คนในห้อง <b>' + n + '/' + m.cap + '</b>' + (m.until ? ' · ถึง ' + m.until : '') + ' · path <code>' + m.path + '</code></div>';
    }
    document.getElementById('popD').innerHTML = html;
    var acts = '';
    if (r.bind && r.bind.light) acts += '<button data-act="toggle-light">' + (widgets.light && widgets.light.value(r.bind.light) ? 'ปิดไฟห้องนี้' : 'เปิดไฟห้องนี้') + '</button>';
    if (m) acts += '<button data-act="meet-toggle">' + ((widgets.meeting && (widgets.meeting.counts[m.path] || 0)) ? 'เลิกประชุม' : 'เริ่มประชุม') + '</button>';
    document.getElementById('popA').innerHTML = acts;
    popEl.classList.remove('hidden');
  }

  function showSlot(i) {
    var s = board.slots[i]; if (!s) return;
    popEl.dataset.slot = i;
    document.getElementById('popT').textContent = 'ช่องจอด ' + s.n;
    document.getElementById('popD').innerHTML =
      '<div class="kv">เซนเซอร์: <b>' + (s.occupied ? 'มีรถ' : 'ว่าง') + '</b> · path <code>' + s.path + '</code></div>';
    document.getElementById('popA').innerHTML =
      '<button data-act="toggle-slot">' + (s.occupied ? 'จำลองรถออก' : 'จำลองรถเข้า') + '</button>';
    popEl.classList.remove('hidden');
  }

  function hidePop() { popEl.classList.add('hidden'); }
  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toastEl.classList.remove('show'); }, 1600);
  }

  /* ---------------- จำลองผู้ส่งข้อมูล ---------------- */
  function simTick() {
    var r = Math.random();
    if (r < 0.45 && widgets.parking) {
      var free = widgets.parking.freeSlot(), occ = widgets.parking.occupiedSlot();
      if (free && Math.random() < 0.65) {
        BUS.set(P.parking.bind.gate, true, 'sim');
        widgets.parking.set(free.i, true);
        setTimeout(function () { BUS.set(P.parking.bind.gate, false, 'sim'); }, 2600);
      } else if (occ) {
        BUS.set(P.parking.bind.gate, true, 'sim');
        widgets.parking.set(occ.i, false);
        setTimeout(function () { BUS.set(P.parking.bind.gate, false, 'sim'); }, 2600);
      }
    } else if (r < 0.78 && widgets.meeting) {
      var m = board.meetings[Math.floor(Math.random() * board.meetings.length)];
      var n = Math.floor(Math.random() * (m.cap + 1));
      widgets.meeting.set(m.id, n);
      BUS.set(m.untilPath, n ? '17:30' : '', 'sim');
    } else if (widgets.light) {
      var l = board.lights[Math.floor(Math.random() * board.lights.length)];
      widgets.light.toggle(l.path);
    }
  }

  /* ---------------- กล้อง + ลูป ---------------- */
  function resize() {
    var r = cv.getBoundingClientRect(), w = Math.max(260, r.width), h = Math.max(240, r.height);
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }

  function drawOnce() {
    var sp = Math.sin(phi);
    cam.position.set(target.x + dist * sp * Math.sin(theta), target.y + dist * Math.cos(phi), target.z + dist * sp * Math.cos(theta));
    cam.lookAt(target);
    renderer.render(scene, cam);
  }

  function loop(now) {
    requestAnimationFrame(loop);
    var t = now || 0;
    var dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0.016;
    lastT = t;
    MO.update(dt);
    if (widgets.light) widgets.light.tick(dt);
    drawOnce();
    updateLabels();
    fpsAcc += dt; fpsN++;
    if (fpsAcc >= 0.6) {
      fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0;
      var info = renderer.info.render;
      statEl.innerHTML = fps + ' fps · ' + (info.triangles || 0).toLocaleString() + ' tri · ' + info.calls + ' calls';
    }
  }

  /* ---------------- แตะวัตถุ ---------------- */
  var dragging = false, pinch = 0, moved = 0, pts = {};
  cv.addEventListener('pointerdown', function (e) {
    cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
    pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    moved = 0; dragging = true;
    if (Object.keys(pts).length === 2) pinch = 1;
  });
  cv.addEventListener('pointermove', function (e) {
    if (!(e.pointerId in pts)) return;
    var ks = Object.keys(pts), p = pts[e.pointerId];
    if (ks.length >= 2) {
      var p1 = pts[ks[0]], p2 = pts[ks[1]];
      var d0 = Math.sqrt((p1.x - p2.x) * (p1.x - p2.x) + (p1.y - p2.y) * (p1.y - p2.y)) + 0.01;
      p.x = e.clientX; p.y = e.clientY;
      p1 = pts[ks[0]]; p2 = pts[ks[1]];
      var d1 = Math.sqrt((p1.x - p2.x) * (p1.x - p2.x) + (p1.y - p2.y) * (p1.y - p2.y)) + 0.01;
      dist = Math.max(38, Math.min(160, dist * d0 / d1));
      pinch = 1; return;
    }
    var dx = e.clientX - p.x, dy = e.clientY - p.y;
    moved += Math.abs(dx) + Math.abs(dy);
    p.x = e.clientX; p.y = e.clientY;
    theta -= dx * 0.007;
    phi = Math.max(0.22, Math.min(1.32, phi - dy * 0.006));
  });
  cv.addEventListener('pointerup', function (e) {
    delete pts[e.pointerId];
    if (dragging && moved < 14 && !pinch) tapAt(e.clientX, e.clientY);
    dragging = Object.keys(pts).length > 0; pinch = 0;
  });
  cv.addEventListener('pointercancel', function (e) { delete pts[e.pointerId]; dragging = false; pinch = 0; });
  cv.addEventListener('wheel', function (e) {
    e.preventDefault();
    dist = Math.max(38, Math.min(160, dist * (1 + Math.sign(e.deltaY) * 0.12)));
  }, { passive: false });

  function tapAt(cx, cy) {
    var r = cv.getBoundingClientRect();
    pointer.x = ((cx - r.left) / r.width) * 2 - 1;
    pointer.y = -((cy - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(pointer, cam);
    var hits = raycaster.intersectObjects([board.panels, board.proxy], false);
    if (!hits.length) { hidePop(); return; }
    var h = hits[0];
    if (h.object === board.panels && h.instanceId != null) {
      var l = board.lights[h.instanceId];
      if (widgets.light) widgets.light.toggle(l.path);
      showToast((BUS.get(l.path) ? 'เปิดไฟ · ' : 'ปิดไฟ · ') + l.path);
      hidePop(); return;
    }
    var p = board.picks[h.instanceId];
    if (!p) return;
    if (p.type === 'room') showRoom(p.id); else showSlot(p.id);
  }

  drawCards();
  refreshUI();
})();
