/* office3d/v2/lib2/walk.js — โหมดเดิน first-person (WebView มือถือ, ไม่มี lib ภายนอก)
   API: O3D2.walk.create({THREE, camera, canvas, colliders, spawn,
        plan?, rooms?, scene?, crosshair?, hud?, eye?, radius?, reach?, speed?, runSpeed?, debug?})
   คืน: { enable(), disable(), toggle(), update(dt), teleport(x,z,yaw), setColliders(fnOrArray),
          getMode(), onInteract(cb), onRoom(cb) }
   เพิ่ม (ไม่บังคับ ใช้กับเทสต์/ทัวร์อัตโนมัติ): setInput(x,z) · getPose() · interact() · setScene(s) · isEnabled()
   หมายเหตุ: onRoom ได้ "ออบเจ็กต์ห้อง" ({id,label,...}) ไม่ใช่แค่ id เพื่อให้หน้าเว็บใช้ sp.label ได้
   ฟิสิกส์เป็นฟังก์ชันล้วน: O3D2.walk._prep(list) · O3D2.walk._slide(pose,dx,dz,list,r)
*/
(function (root) {
  'use strict';
  var O = (root.O3D2 = root.O3D2 || {});
  var EPS = 0.004;      // กันสั่นติดขอบ
  var MAXSTEP = 0.09;   // ซอยก้าวกันทะลุ (m ต่อ sub-step)

  /* ── ฟิสิกส์ (ไม่มี WebGL/DOM → ทดสอบใน console ได้) ─────────────── */

  /* ตัด collider ที่ไม่ต้องชน: ของเตี้ย (y สูง < 0.25) และของเหนือหัว (y0 > 1.55) */
  function prep(list) {
    var out = [], i, b, x0, x1, z0, z1;
    list = list || [];
    for (i = 0; i < list.length; i++) {
      b = list[i];
      if (!b || b.x0 === undefined || b.x1 === undefined || b.z0 === undefined || b.z1 === undefined) continue;
      x0 = b.x0 < b.x1 ? b.x0 : b.x1; x1 = b.x0 < b.x1 ? b.x1 : b.x0;
      z0 = b.z0 < b.z1 ? b.z0 : b.z1; z1 = b.z0 < b.z1 ? b.z1 : b.z0;
      if (x1 - x0 < 0.01 && z1 - z0 < 0.01) continue;              // เสี้ยวศูนย์
      if (b.y0 !== undefined && b.y1 !== undefined) {
        if (b.y1 - b.y0 < 0.25) continue;                         // เตี้ย → ก้าวข้ามได้
        if (b.y0 > 1.55) continue;                                // เหนือหัว → ไม่ชน
      }
      out.push({ x0: x0, z0: z0, x1: x1, z1: z1 });
    }
    return out;
  }

  /* เลื่อนแกน x (ผู้เล่นเป็นวงกลม r → ขยาย AABB แล้วเทสต์จุด) · วน 2 pass กันติดมุม */
  function axisX(px, pz, nx, list, r) {
    var pass, i, b, lo, hi;
    for (pass = 0; pass < 2; pass++) {
      for (i = 0; i < list.length; i++) {
        b = list[i];
        if (pz <= b.z0 - r || pz >= b.z1 + r) continue;            // ไม่ทับกันใน z
        if (nx <= b.x0 - r || nx >= b.x1 + r) continue;            // จุดใหม่ไม่ทับใน x
        lo = b.x0 - r - EPS; hi = b.x1 + r + EPS;
        if (px <= b.x0 - r) nx = lo;                               // มาจากตะวันตก → หยุดที่หน้าผนัง
        else if (px >= b.x1 + r) nx = hi;                          // มาจากออก → หยุดที่หลังผนัง
        else {                                                      // ทับอยู่แล้ว (เช่น teleport เข้าไปในผนัง)
          var penX = Math.min(nx - (b.x0 - r), (b.x1 + r) - nx);
          var penZ = Math.min(pz - (b.z0 - r), (b.z1 + r) - pz);
          if (penX <= penZ) nx = (nx - lo) <= (hi - nx) ? lo : hi;  // ดันออกด้านที่ตื้นสุดในแกน x
        }                                                           // ไม่งั้นปล่อยให้แกน z แก้ (ผนังเตี้ยตาม z)
      }
    }
    return nx;
  }

  /* เลื่อนแกน z (แบบเดียวกัน) */
  function axisZ(px, pz, nz, list, r) {
    var pass, i, b, lo, hi;
    for (pass = 0; pass < 2; pass++) {
      for (i = 0; i < list.length; i++) {
        b = list[i];
        if (px <= b.x0 - r || px >= b.x1 + r) continue;
        if (nz <= b.z0 - r || nz >= b.z1 + r) continue;
        lo = b.z0 - r - EPS; hi = b.z1 + r + EPS;
        if (pz <= b.z0 - r) nz = lo;
        else if (pz >= b.z1 + r) nz = hi;
        else {
          var penZ2 = Math.min(nz - (b.z0 - r), (b.z1 + r) - nz);
          var penX2 = Math.min(px - (b.x0 - r), (b.x1 + r) - px);
          if (penZ2 <= penX2) nz = (nz - lo) <= (hi - nz) ? lo : hi;
        }
      }
    }
    return nz;
  }

  /* ก้าวหนึ่งครั้ง: แยกแกน x แล้ว z (2 pass/แกน) + ซอยก้าวถ้าไกล (คืน true ถ้าถูกบล็อก) */
  function slide(pose, dx, dz, list, r) {
    var steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / MAXSTEP));
    var sx = dx / steps, sz = dz / steps, ox = pose.x, oz = pose.z, i;
    for (i = 0; i < steps; i++) {
      if (sx) pose.x = axisX(pose.x, pose.z, pose.x + sx, list, r);
      if (sz) pose.z = axisZ(pose.x, pose.z, pose.z + sz, list, r);
    }
    return Math.abs(pose.x - ox - dx) > 1e-4 || Math.abs(pose.z - oz - dz) > 1e-4;
  }

  /* ── สร้างคอนโทรลเลอร์ ──────────────────────────────────────────── */
  function create(opts) {
    opts = opts || {};
    var THREE = opts.THREE || root.THREE;
    if (!THREE || !opts.camera || !opts.canvas) throw new Error('walk.create ต้องมี THREE, camera, canvas');
    var camera = opts.camera, canvas = opts.canvas;
    var RAD = opts.radius || 0.28, EYE = opts.eye || 1.62, REACH = opts.reach || 2.0;
    var WSPD = opts.speed || 2.4, RSPD = opts.runSpeed || 4.0;
    var spawn = opts.spawn || { x: 0, z: 0, yaw: 0 };

    var pose = { x: spawn.x || 0, z: spawn.z || 0 };
    var yaw = spawn.yaw || 0, pitch = 0, tYaw = yaw, tPitch = 0;   // tYaw/tPitch = เป้า (ตามด้วย lerp)
    var vel = { x: 0, z: 0 }, bobPh = 0, bobAmp = 0, frame = 0;
    var enabled = false, mode = 'orbit', keys = {}, joy = { x: 0, z: 0, on: false }, sprint = false;
    var saved = null, scene = opts.scene || null, locked = false;
    var solid = [], listSrc = opts.colliders || [], nextScan = 0;
    var interCbs = [], roomCbs = [], curRoom = null, hot = null;
    var ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), clsHot = null;

    /* ห้อง: จาก opts.rooms หรือ plan2 (O.OFFICE2) — ไม่ดึงจากโมดูลอื่น */
    function getRooms() {
      if (opts.rooms) return opts.rooms;
      var p = root.OFFICE2 || opts.plan;
      if (!p) return [];
      return (p.rooms || []).concat(p.corridor ? [p.corridor] : []);
    }
    function roomAt(x, z) {
      var rs = getRooms(), i, r;
      if (curRoom) {  // ยึดห้องเดิมถ้ายังอยู่ในกรอบ (กันสลับตอนยืนในช่องประตู)
        curRoom = null;
      }
      for (i = 0; i < rs.length; i++) {
        r = rs[i];
        if (x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d) return r;
      }
      return null;
    }

    function readColliders(force) {
      var src = listSrc, now = Date.now ? Date.now() : 0;
      if (typeof src === 'function') {
        if (!force && now < nextScan) return;
        nextScan = now + 800;                                  // ฟังก์ชัน → สแกนใหม่ทุก ~0.8 วินาที
        try { src = src(); } catch (e) { src = solid; }
      }
      solid = prep(src || []);
    }

    /* ── HUD ใน DOM (joystick + crosshair + ชื่อห้อง) ───────────── */
    var layer = null, baseEl = null, knobEl = null, crossEl = null, roomEl = null;
    function el(css, id) {
      var d = document.createElement('div');
      d.style.cssText = css;
      if (id) d.id = id;
      return d;
    }
    function buildHud() {
      if (layer || opts.hud === false || !document.body) return;
      layer = el('position:fixed;inset:0;pointer-events:none;z-index:4;' +
        'font:13px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif');
      layer.id = 'o3d-walk-layer';

      if (opts.crosshair !== false) {
        crossEl = document.getElementById('cross');
        if (!crossEl) {
          crossEl = el('position:absolute;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;' +
            'border-radius:50%;border:1.5px solid rgba(255,255,255,.55);box-sizing:border-box;display:none');
          crossEl.id = 'o3d-cross';
          layer.appendChild(crossEl);
          clsHot = true;                                      // crosshair ของเราเอง → ทา CSS เอง
        } else {
          clsHot = false;                                     // ใช้ของหน้า (#cross มีสไตล์ .hot อยู่แล้ว)
        }
      }

      baseEl = el('position:absolute;left:78px;bottom:170px;width:116px;height:116px;border-radius:50%;' +
        'border:2px solid rgba(180,220,245,.30);background:radial-gradient(circle,rgba(210,235,250,.13),rgba(210,235,250,.03));' +
        'transform:translate(-50%,50%);box-sizing:border-box;opacity:0;transition:opacity .15s,left .06s,bottom .06s');
      knobEl = el('position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;' +
        'background:rgba(94,200,255,.42);border:1.5px solid rgba(255,255,255,.6);box-sizing:border-box');
      baseEl.appendChild(knobEl);
      layer.appendChild(baseEl);

      if (!opts.roomEl) {
        roomEl = document.getElementById('room');
        if (!roomEl) {
          roomEl = el('position:absolute;left:50%;top:14px;transform:translateX(-50%);white-space:nowrap;' +
            'background:rgba(9,17,26,.62);border:1px solid rgba(150,190,220,.22);border-radius:999px;' +
            'padding:5px 13px;color:#d7ecfa;opacity:0;transition:.2s');
          layer.appendChild(roomEl);
        }
      } else roomEl = opts.roomEl;

      document.body.appendChild(layer);
      if (crossEl) crossEl.style.display = 'none';
    }
    function hotOn(h) {
      if (!crossEl) return;
      if (clsHot) {
        crossEl.style.borderColor = h ? 'rgba(94,200,255,.95)' : 'rgba(255,255,255,.55)';
        crossEl.style.boxShadow = h ? '0 0 10px rgba(94,200,255,.75)' : 'none';
        crossEl.style.transform = h ? 'scale(1.15)' : 'none';
      } else if (crossEl.classList) crossEl.classList.toggle('hot', !!h);
    }
    function showRoom(sp) {
      if (!roomEl) return;
      if (sp) { roomEl.textContent = sp.label || sp.id; roomEl.style.opacity = 1; roomEl.classList && roomEl.classList.add('show'); }
      else { roomEl.style.opacity = 0; roomEl.classList && roomEl.classList.remove('show'); }
    }
    function knobTo(dx, dy) { knobEl.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)'; }

    /* ── กล้อง ──────────────────────────────────────────────────── */
    function applyCam() {
      camera.position.set(pose.x, EYE + Math.sin(bobPh) * bobAmp, pose.z);
      camera.rotation.order = 'YXZ';
      camera.rotation.set(pitch, yaw, 0);
    }
    function saveCam() {
      saved = { fov: camera.fov, near: camera.near, far: camera.far, order: camera.rotation.order, up: camera.up.clone ? camera.up.clone() : null };
    }
    function walkCam() {
      camera.fov = opts.fov || 72; camera.near = opts.near || 0.05; camera.far = opts.far || 120;
      camera.updateProjectionMatrix();
      camera.rotation.order = 'YXZ';
    }
    function restoreCam() {
      if (!saved) return;
      camera.fov = saved.fov; camera.near = saved.near; camera.far = saved.far;
      camera.updateProjectionMatrix();
      if (saved.order) camera.rotation.order = saved.order;
    }

    /* ── อินพุตชี้ (สัมผัส/เมาส์) ─────────────────────────────────── */
    function cw() { return canvas.clientWidth || root.innerWidth || 390; }
    function ndcOf(cx, cy) {
      var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: cw(), height: canvas.clientHeight || root.innerHeight || 800 };
      return { x: ((cx - rect.left) / (rect.width || 1)) * 2 - 1, y: -((cy - rect.top) / (rect.height || 1)) * 2 + 1 };
    }
    function lookBy(mx, my) {
      var s = 0.0030;                                          // rad ต่อ px (นิ้ว)
      tYaw -= mx * s;
      tPitch -= my * s;
      if (tPitch > 1.32) tPitch = 1.32; else if (tPitch < -1.32) tPitch = -1.32;   // ±75°
    }
    function startJoy(e) {
      joy = { on: true, id: e.pointerId, cx: e.clientX, cy: e.clientY, x0: e.clientX, y0: e.clientY, moved: 0, t: Date.now(), x: 0, z: 0 };
      if (baseEl) {
        var hh = root.innerHeight || 700;
        var cx = Math.min(Math.max(e.clientX, 62), cw() - 62);          // ให้ฐานทั้งวงอยู่ในจอ
        var by = Math.min(Math.max(hh - e.clientY, 62), hh - 62);
        baseEl.style.left = cx + 'px';
        baseEl.style.bottom = by + 'px';
        baseEl.style.transform = 'translate(-50%,50%)';
        baseEl.style.opacity = 1;
      }
      knobTo(0, 0);
    }
    function endJoy() {
      joy.on = false; joy.x = 0; joy.z = 0;
      if (baseEl) {
        baseEl.style.left = '78px'; baseEl.style.bottom = '170px'; baseEl.style.opacity = enabled ? 0.85 : 0;
      }
      knobTo(0, 0);
    }
    function fireTap(cx, cy) {
      var n = ndcOf(cx, cy);
      interact(n.x, n.y);
    }

    var lookDrag = null;
    function onDown(e) {
      if (!enabled) return;
      if (e.pointerType === 'mouse' && e.button) return;
      var touch = e.pointerType !== 'mouse';
      try { canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); } catch (err) { }
      if (touch && !joy.on && e.clientX < cw() * 0.45) { startJoy(e); return; }   // ซีกซ้าย = joystick
      if (!lookDrag) lookDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, x0: e.clientX, y0: e.clientY, t: Date.now(), touch: touch };
    }
    function onMove(e) {
      if (!enabled) return;
      if (joy.on && e.pointerId === joy.id) {
        var dx = e.clientX - joy.cx, dy = e.clientY - joy.cy, lim = 46, m = Math.sqrt(dx * dx + dy * dy);
        if (m > lim) { dx *= lim / m; dy *= lim / m; m = lim; }
        joy.x = dx / lim; joy.z = -dy / lim;                   // ดันขึ้น = เดินหน้า
        joy.moved = Math.max(joy.moved, Math.sqrt((e.clientX - joy.x0) * (e.clientX - joy.x0) + (e.clientY - joy.y0) * (e.clientY - joy.y0)));
        knobTo(dx, dy);
        return;
      }
      if (lookDrag && e.pointerId === lookDrag.id) {
        var mx = e.clientX - lookDrag.x, my = e.clientY - lookDrag.y;
        lookDrag.x = e.clientX; lookDrag.y = e.clientY;
        lookDrag.moved += Math.abs(mx) + Math.abs(my);
        lookBy(mx, my);
      }
    }
    function onUp(e) {
      if (joy.on && e.pointerId === joy.id) {
        var quick = joy.moved < 10 && Date.now() - joy.t < 260;
        var tx = joy.x0, ty = joy.y0;
        endJoy();
        if (quick) fireTap(tx, ty);                           // แตะสั้น = เล็ง/กด object
      }
      if (lookDrag && e.pointerId === lookDrag.id) {
        var d = lookDrag; lookDrag = null;
        if (d.moved < 10 && Date.now() - d.t < 260) fireTap(d.x0, d.y0);
      }
      try { canvas.releasePointerCapture && canvas.releasePointerCapture(e.pointerId); } catch (err) { }
    }
    function onCancel() { endJoy(); lookDrag = null; }

    function onMouseMove(e) { if (enabled && locked) lookBy(e.movementX || 0, e.movementY || 0); }
    function onLockChange() { locked = (document.pointerLockElement === canvas); }
    function onDbl() {                                          // dblclick = ขอล็อกเมาส์ (ไม่แย่งคลิกแรกของหน้า)
      if (!enabled || opts.pointerLock === false) return;
      if (canvas.requestPointerLock) { try { canvas.requestPointerLock(); } catch (e) { } }
    }
    function onTouchMove(e) { if (enabled && e.cancelable) e.preventDefault(); }  // กันจอเลื่อน/ซูม
    function onKey(e, down) {
      var k = (e.key || '').toLowerCase();
      if (e.shiftKey !== undefined) keys.shift = e.shiftKey;
      keys[k] = down;
      if (down && enabled && (k === 'e' || k === 'enter')) interact(0, 0);
      if (down && e.key === 'Shift') keys.shift = true;
    }

    /* ── pick / interact ────────────────────────────────────────── */
    function pickAt(nx, ny) {
      var sc = scene || (root.__office2 && root.__office2.scene) || (camera.parent && camera.parent.isScene ? camera.parent : null);
      if (!sc) return null;
      camera.updateMatrixWorld();                              // ให้ ray ตรงกับกล้องปัจจุบัน (ก่อน render เฟรมนี้)
      if (sc.updateMatrixWorld) sc.updateMatrixWorld();        // และให้ matrix ของวัตถุอัปเดต (กรณีเรียกก่อน render)
      ndc.set(nx || 0, ny || 0);
      ray.setFromCamera(ndc, camera);
      ray.far = REACH;
      var hits = ray.intersectObjects(sc.children, true), i, o, depth;
      for (i = 0; i < hits.length; i++) {
        if (hits[i].distance > REACH || hits[i].object.visible === false) continue;
        o = hits[i].object; depth = 0;
        while (o && depth < 8) {
          if (o.userData && o.userData.path) return o;
          o = o.parent; depth++;
        }
      }
      return null;
    }
    function interact(nx, ny) {
      var o = pickAt(nx === undefined ? 0 : nx, ny === undefined ? 0 : ny);
      if (o) for (var i = 0; i < interCbs.length; i++) try { interCbs[i](o); } catch (e) { }
      return o;
    }

    /* ── วงจรชีวิต ─────────────────────────────────────────────── */
    function enable(opts2) {
      if (enabled) return;
      buildHud();
      readColliders(true);
      saveCam(); walkCam();
      enabled = true; mode = 'walk';
      vel.x = vel.z = 0; bobAmp = 0;
      pose.x = spawn.x || pose.x; pose.z = spawn.z || pose.z;
      yaw = spawn.yaw === undefined ? yaw : spawn.yaw; tYaw = yaw; pitch = tPitch = 0;
      applyCam();
      if (crossEl) crossEl.style.display = 'block';
      if (baseEl) { baseEl.style.left = '78px'; baseEl.style.bottom = '170px'; baseEl.style.opacity = 0.85; }
      if (layer) layer.style.display = 'block';
      if (opts2 && opts2.x !== undefined) teleport(opts2.x, opts2.z, opts2.yaw);
      curRoom = null; emitRoom();
    }
    function disable() {
      if (!enabled) return;
      enabled = false; mode = 'orbit';
      endJoy(); lookDrag = null;
      vel.x = vel.z = 0; bobAmp = 0;
      if (document.exitPointerLock && document.pointerLockElement === canvas) { try { document.exitPointerLock(); } catch (e) { } }
      if (crossEl) crossEl.style.display = 'none';
      if (baseEl) baseEl.style.opacity = 0;
      if (layer) layer.style.display = 'none';
      restoreCam();
      showRoom(null); hotOn(false);
      curRoom = null; hot = null;
      for (var i = 0; i < roomCbs.length; i++) try { roomCbs[i](null); } catch (e) { }
    }
    function toggle() { if (enabled) disable(); else enable(); return mode; }
    function teleport(x, z, yw) {
      pose.x = x; pose.z = z;
      if (yw !== undefined && yw !== null) { yaw = yw; tYaw = yw; }
      pitch = tPitch = 0; vel.x = vel.z = 0; bobAmp = 0; bobPh = 0;
      readColliders(true);
      applyCam(); curRoom = null; emitRoom();
    }
    function emitRoom() {
      var sp = roomAt(pose.x, pose.z);
      if (sp === curRoom) return;
      curRoom = sp;
      showRoom(sp);
      for (var i = 0; i < roomCbs.length; i++) try { roomCbs[i](sp); } catch (e) { }
    }

    /* ── อัปเดตต่อเฟรม ─────────────────────────────────────────── */
    function update(dt) {
      if (!enabled) return;
      dt = dt > 0 ? (dt > 0.06 ? 0.06 : dt) : 1 / 60;
      readColliders(false);

      var fw = joy.z + ((keys.w || keys.arrowup) ? 1 : 0) - ((keys.s || keys.arrowdown) ? 1 : 0);
      var sd = joy.x + ((keys.d || keys.arrowright) ? 1 : 0) - ((keys.a || keys.arrowleft) ? 1 : 0);
      var mag = Math.sqrt(fw * fw + sd * sd);
      if (mag > 1) { fw /= mag; sd /= mag; mag = 1; }
      var spd = (keys.shift || sprint) ? RSPD : WSPD;

      var fx = -Math.sin(yaw), fz = -Math.cos(yaw);            // หน้าตรง
      var rx = Math.cos(yaw), rz = -Math.sin(yaw);             // ขวา (ไม่เอียงตาม pitch)
      var tvx = (fx * fw + rx * sd) * spd, tvz = (fz * fw + rz * sd) * spd;
      var k = 1 - Math.exp((mag > 0.02 ? -9 : -13) * dt);       // accel นุ่ม / decel เร็วกว่า
      vel.x += (tvx - vel.x) * k;
      vel.z += (tvz - vel.z) * k;
      if (Math.abs(vel.x) < 0.004) vel.x = 0;
      if (Math.abs(vel.z) < 0.004) vel.z = 0;

      var dx = vel.x * dt, dz = vel.z * dt, ox = pose.x, oz = pose.z;
      if (dx || dz) {
        var blocked = slide(pose, dx, dz, solid, RAD);
        if (blocked) {                                          // ชนแล้ว → ตัดความเร็วตามแกนที่ติด (ไม่ดันค้าง)
          if (Math.abs(pose.x - ox) < Math.abs(dx) - 0.002) vel.x = 0;
          if (Math.abs(pose.z - oz) < Math.abs(dz) - 0.002) vel.z = 0;
        }
      }

      /* bob เบา ๆ (หยุดเมื่อหยุด) */
      var sp = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
      var amp = sp > 0.15 ? 0.012 * Math.min(1, sp / WSPD) : 0;
      bobAmp += (amp - bobAmp) * (1 - Math.exp(-10 * dt));
      if (sp > 0.05) bobPh += dt * 5.6 * Math.max(0.35, sp / WSPD);
      if (bobAmp < 0.0004 && amp === 0) { bobAmp = 0; bobPh = 0; }

      /* หันนุ่ม ๆ (lerp → ไม่เมาเวลาเหวี่ยง) */
      var ak = 1 - Math.exp(-18 * dt);
      yaw += (tYaw - yaw) * ak;
      pitch += (tPitch - pitch) * ak;
      applyCam();

      emitRoom();

      frame++;
      if (crossEl && (frame % 5 === 0)) {                      // เล็งกลางจอ ~12 ครั้ง/วิ
        var o = pickAt(0, 0);
        var isHot = !!o;
        if (isHot !== !!hot) { hot = o; hotOn(isHot); }
        else hot = o;
      }
    }

    /* ── ฟังอีเวนต์ (ติดครั้งเดียว, ข้างในเช็ก enabled) ───────────── */
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('dblclick', onDbl);
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('contextmenu', function (e) { if (enabled) e.preventDefault(); });
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('pointerlockchange', onLockChange);
    root.addEventListener('keydown', function (e) { onKey(e, true); });
    root.addEventListener('keyup', function (e) { onKey(e, false); });
    if (opts.canvasStyle !== false) {
      canvas.style.touchAction = 'none';                        // ไม่แย่ง pointer กับโหมดภาพรวม (เช็ก enabled ในทุก handler)
      canvas.style.userSelect = 'none';
    }

    return {
      enable: enable, disable: disable, toggle: toggle, update: update,
      teleport: teleport,
      setColliders: function (src) { listSrc = src || []; readColliders(true); },
      getMode: function () { return mode; },
      onInteract: function (cb) { if (cb) interCbs.push(cb); return function () { var i = interCbs.indexOf(cb); if (i >= 0) interCbs.splice(i, 1); }; },
      onRoom: function (cb) { if (cb) roomCbs.push(cb); if (cb && enabled) cb(curRoom); return function () { var i = roomCbs.indexOf(cb); if (i >= 0) roomCbs.splice(i, 1); }; },
      /* ส่วนขยาย (ไม่บังคับ) */
      setInput: function (x, z) { joy.x = x || 0; joy.z = z || 0; },
      setSprint: function (v) { sprint = !!v; },
      getPose: function () { return { x: pose.x, z: pose.z, yaw: yaw, pitch: pitch, room: curRoom ? curRoom.id : null, speed: Math.sqrt(vel.x * vel.x + vel.z * vel.z) }; },
      interact: interact,
      pickAt: pickAt,
      setScene: function (s) { scene = s; },
      isEnabled: function () { return enabled; }
    };
  }

  O.walk = { create: create, _prep: prep, _slide: slide, RADIUS: 0.28, EYE: 1.62 };
})(window);
