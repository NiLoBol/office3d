/* office3d/v2/lib2/lighting.js — ระบบแสงทั้งชั้น (2026-11-17 · v3 "ไม่แบน")
   ─────────────────────────────────────────────────────────────────────────────
   เปลี่ยนจาก v2 (หลังฟีดแบ็กจากภาพระดับตา 1.6 ม.):
   1) แสงแดดจัด + มุมต่ำลง (el 26°, az 30° จากทิศใต้เอียงตะวันออก) → ลำแสงเข้าหน้าต่าง z0/x1 ลึก
      เงาวงกบ/เฟรม/เฟอร์นิเจอร์ตกพื้นชัด (shadow normalBias ต่ำ, shadow camera = อาคาร+ลาน 2048)
   2) ทุก space มี PointLight ของตัวเอง (ห้องใหญ่ 2 · โถง 3) = 14 ดวง, decay 2, distance จำกัดต่อห้อง
      → มี gradient ในห้อง ไม่มีกำแพงเทาแบน · งบ light object 16 (sun + hemi + 14)
   3) hemi ลดลงมาก (day 0.24) ชดเชยด้วย point light + exposure 1.15
   4) รางไฟโถงของจริง: รางอลูมิเนียม + หัวโคมฝังทุก 3 ม. (ไม่ใช่แถบ emissive ลอย)
      แผ่นโคมห้องอื่นมีแผ่นอลูมิเนียมบางรองรับ (อ่านเป็นโคมฝังฝ้า)
   5) กลางคืน: แสงในห้องแรงขึ้น + hemi เย็นจาง → เห็นห้องข้างเคียงผ่านกระจก แต่ยังโทนกลางคืน
   ─────────────────────────────────────────────────────────────────────────────
   API เดิมทั้งหมด: O3D2.lighting.build(ctx) → {group, lights, stats, hooks}
     hooks { update(dt) · setNight(bool) · setSpaceLight(id,on) · setSunAngle(az,el) ·
             refreshShadows() · settle() · state() · dispose() }
   O3D2.lighting.setupRenderer(renderer) · O3D2.lighting.CFG · O3D2.lighting.stats()
   ยึด scene.fog + scene.background (คืนค่าเดิมตอน dispose)
   */
(function () {
  var O = window.O3D2 = window.O3D2 || {};
  var THREE = window.THREE;
  if (!THREE) { console.warn('[lighting] ไม่มี THREE — ข้าม'); return; }

  /* ═════════════════════════════════ 0) CFG ═══════════════════════ */
  var CFG = {
    /* จำนวน PointLight ต่อ space (ทุกห้องมีของจริง) */
    lightCount: { corridor: 3, sales: 2, ops: 2, training: 2, pantry: 2 },
    point: {
      color: 0xffdcae, I: 1.25, decay: 2,
      distSpread: 1.25, distMin: 8, distMax: 18,   /* distance = clamp(max(w,d)*spread) */
      y: 2.62,                                      /* ใต้ฝ้า 0.35 ม. */
      multiK: 0.9                                   /* ห้องที่มีหลายดวง: ลดกำลังต่อดวง */
    },
    panel: {
      size: 0.62, thick: 0.020, ei: 0.58, day: 0.90, night: 0.98,
      dayC: 0xffe4bd, nightC: 0xffb168, trim: 0.80     /* trim = ขนาดแผ่นอลูมิเนียมรอบโคม */
    },
    rail: { w: 0.175, h: 0.055, headW: 0.66, drop: 0.105, ei: 1.0 },  /* รางไฟโถง */
    lineRooms: { corridor: true },
    sun: { az: 30, el: 26, dist: 62, dayI: 2.6, nightI: 0.06, dayC: 0xffeccd, nightC: 0x8fb0e0 },
    hemi: {
      dayS: 0xa9caf0, dayG: 0x8a7d6c, dayI: 0.24,
      nightS: 0x27374f, nightG: 0x17161c, nightI: 0.14
    },
    fog: { dayC: 0xb9c9d8, dayN: 80, dayF: 300, nightC: 0x081019, nightN: 26, nightF: 130 },
    exposure: { day: 1.15, night: 1.25 },
    room: { day: 0.85, night: 1.0 },        /* สเกลไฟในห้อง (day ยังให้แดดเด่นแต่ไม่ดำแบน) */
    fade: 2.2,
    accents: [
      { id: 'reception', x0: 0.35, x1: 7.65, y: 2.72, faceZ: 9.44, mat: 'led.cool' },
      { id: 'pantry', x0: 28.10, x1: 32.70, y: 1.52, faceZ: 9.44, mat: 'led.cool' }
    ],
    glow: { size: 1.55, yOff: 0.175, opacity: 0.55 },
    shadow: { mapSize: 2048, margin: 11, far: 200, bias: -0.0003, normalBias: 0.018, castCap: 140 },
    skyDay: [[0, '#8fb6dc'], [0.55, '#cfe0ef'], [0.80, '#eef3f5'], [1, '#c8d2d8']],
    skyNight: [[0, '#05090f'], [0.55, '#0a131f'], [0.86, '#121b26'], [1, '#090e15']]
  };

  var MAX_LIGHTS = 16;
  var S = null;

  /* ═════════════════════════════════ 1) helper ═══════════════════════ */
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  var _fb = null;
  function fallbackMat() {
    if (!_fb) _fb = new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.85 });
    return _fb;
  }
  function MT(mats, name) {
    var m = (mats && mats.get) ? mats.get(name) : null;
    return m || fallbackMat();
  }
  function cloneEmis(mats, name, color) {
    var base = MT(mats, name);
    var m = base.clone ? base.clone() : new THREE.MeshStandardMaterial({ color: 0xffffff });
    m.name = 'lighting:' + name;
    if (color && m.emissive) m.emissive.set(color);
    if (m.depthWrite === false) m.depthWrite = true;
    return m;
  }
  function srgb(t) {
    if (THREE.sRGBEncoding !== undefined) t.encoding = THREE.sRGBEncoding;
    else if (THREE.SRGBColorSpace !== undefined && t.colorSpace !== undefined) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function mkSky(stops) {
    var c = document.createElement('canvas'); c.width = 4; c.height = 512;
    var g = c.getContext('2d'), lin = g.createLinearGradient(0, 0, 0, 512), i;
    for (i = 0; i < stops.length; i++) lin.addColorStop(stops[i][0], stops[i][1]);
    g.fillStyle = lin; g.fillRect(0, 0, 4, 512);
    var tex = srgb(new THREE.CanvasTexture(c));
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }
  var _glowTex = null;
  function glowTex() {
    if (_glowTex) return _glowTex;
    var n = 64, c = document.createElement('canvas'); c.width = c.height = n;
    var g = c.getContext('2d'), gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    gr.addColorStop(0, 'rgba(255,240,214,0.95)');
    gr.addColorStop(0.35, 'rgba(255,235,205,0.42)');
    gr.addColorStop(0.72, 'rgba(255,230,200,0.10)');
    gr.addColorStop(1, 'rgba(255,230,200,0.0)');
    g.fillStyle = gr; g.fillRect(0, 0, n, n);
    _glowTex = srgb(new THREE.CanvasTexture(c));
    return _glowTex;
  }

  /* ═════════════════════════════════ 2) renderer ═══════════════════════ */
  function setupRenderer(r) {
    if (!r) return null;
    try {
      r.toneMapping = THREE.ACESFilmicToneMapping;
      if (r.toneMappingExposure === undefined || Math.abs(r.toneMappingExposure - 1) < 1e-6) {
        r.toneMappingExposure = CFG.exposure.day;
      }
      if ('outputColorSpace' in r && THREE.SRGBColorSpace !== undefined) r.outputColorSpace = THREE.SRGBColorSpace;
      else if (THREE.sRGBEncoding !== undefined) r.outputEncoding = THREE.sRGBEncoding;
      if (r.shadowMap) { r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; }
      if (r.setPixelRatio && typeof window.devicePixelRatio === 'number') {
        r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      }
      /* texture ของ mats ยังไม่เคยได้ anisotropy (assembler ไม่ได้เรียก) → ผนัง/ฝ้าเป็น moiré */
      if (O.mats && O.mats.attachRenderer) O.mats.attachRenderer(r);
    } catch (e) { console.warn('[lighting] setupRenderer', e); }
    return r;
  }

  /* ═════════════════════════════════ 3) build ═════════════════════════ */
  function build(ctx) {
    ctx = ctx || {};
    var plan = ctx.plan || window.OFFICE2 || { building: { x: 0, z: 0, w: 34, d: 22, wallH: 3.05 }, rooms: [] };
    var mats = ctx.mats || O.mats;
    var util = ctx.util || O.util;
    var renderer = ctx.renderer || null;
    var scene = ctx.scene || null;
    var B = plan.building;
    var ceilY = B.wallH - ((plan.ceiling && plan.ceiling.drop) || 0.06);
    var ctr = new THREE.Vector3(B.x + B.w / 2, 1.3, B.z + B.d / 2);
    var group = new THREE.Group(); group.name = 'lighting';

    setupRenderer(renderer);

    var spaces = (plan.rooms || []).slice();
    if (plan.corridor) spaces.push(plan.corridor);

    var recs = [], byId = {};
    var lights = [], pointLights = [];
    var matsOwned = [], geosOwned = [];
    var prev = { fog: null, background: null };

    /* ---------- 3.1 ฝ้า: แผ่นโคม + แผ่นรอง / รางไฟโถง --------------------- */
    var trims = [], rails = [];
    var ps = CFG.panel.size, pt = CFG.panel.thick;
    var py = ceilY - 0.02 - pt / 2 - 0.002;          /* ใต้ฝ้า 2.948 */
    var Alu = MT(mats, 'metal.aluminium');

    spaces.forEach(function (sp) {
      var nx = Math.max(1, Math.round(sp.w / 3)), nz = Math.max(1, Math.round(sp.d / 3));
      var slots = [], i, j;
      for (i = 0; i < nx; i++) {
        for (j = 0; j < nz; j++) {
          slots.push({ x: sp.x + sp.w * (i + 0.5) / nx, z: sp.z + sp.d * (j + 0.5) / nz });
        }
      }
      var mat = cloneEmis(mats, 'led.warm');
      if (mat.color) mat.color.setHex(0x3c332a);   /* diffuse เข้ม → เห็นสี emissive (อุ่น) เด่น */
      var ei0 = mat.emissiveIntensity || 1;
      var tmp = new THREE.Group();
      var k;

      if (CFG.lineRooms[sp.id]) {
        /* ---- โถง: รางไฟอลูมิเนียม + หัวโคมฝังฝ้าเป็นช่วง ๆ ---- */
        var rw = CFG.rail.w, rh = CFG.rail.h;
        var x0 = sp.x + 1.2, x1 = sp.x + sp.w - 1.2, len = x1 - x0, cz = sp.z + sp.d / 2;
        var railTop = ceilY - 0.022;   /* ใต้ฝ้า (ceilY-0.02) */
        rails.push({ len: len, cx: (x0 + x1) / 2, cz: cz, y: railTop - rh / 2, w: rw, h: rh });
        var headH = CFG.rail.h, drop = CFG.rail.drop;
        slots.forEach(function (s) {
          /* หัวโคม (อลูมิเนียม) + แผ่น diffusor ข้างใน */
          rails.push({ head: true, cx: s.x, cz: cz, y: railTop - rh - headH / 2, w: rw + 0.01, h: headH, len: CFG.rail.headW });
          tmp.add(util.box(CFG.rail.headW - 0.10, 0.014, rw - 0.06, mat,
            s.x, railTop - rh - headH - 0.013, cz));
        });
      } else {
        /* ---- ห้องทั่วไป: แผ่นโคมฝังฝ้า + แผ่นอลูมิเนียมรอง ---- */
        for (k = 0; k < slots.length; k++) {
          tmp.add(util.box(ps, pt, ps, mat, slots[k].x, py, slots[k].z));
          trims.push({ x: slots[k].x, z: slots[k].z, y: ceilY - 0.0235, s: ps / CFG.panel.trim });
        }
      }

      var mg = util.merge(tmp);
      mg.name = 'lum:' + sp.id;
      mg.children.forEach(function (m) { m.castShadow = false; m.receiveShadow = false; m.userData.noShadow = true; });
      group.add(mg);
      matsOwned.push(mat);

      var rec = {
        id: sp.id, sp: sp, slots: slots, mesh: mg, mat: mat, ei0: ei0,
        accent: null, pts: [], on: true, cur: 1, tgt: 1,
        rail: !!CFG.lineRooms[sp.id]
      };
      recs.push(rec); byId[sp.id] = rec;
    });

    /* อลูมิเนียม: แผ่นรองโคม + รางไฟ (รวมเป็น mesh เดียว) */
    if (trims.length || rails.length) {
      var ag = new THREE.Group();
      trims.forEach(function (t) {
        ag.add(util.box(t.s, 0.004, t.s, Alu, t.x, t.y, t.z));
      });
      rails.forEach(function (r) {
        ag.add(util.box(r.len === undefined ? r.w : r.len, r.h, r.w, Alu, r.cx, r.y, r.cz));
      });
      var am = util.merge(ag);
      am.name = 'lighting:alu';
      am.children.forEach(function (m) { m.castShadow = false; m.receiveShadow = true; m.userData.noShadow = true; });
      group.add(am);
    }

    /* ---------- 3.2 ไฟจริงทุกห้อง (PointLight) ---------------------------- */
    function nearestSlot(rec, tx, tz, used) {
      var best = null, bd = 1e9, i, d;
      for (i = 0; i < rec.slots.length; i++) {
        var s = rec.slots[i];
        if (used.indexOf(s) >= 0) continue;
        d = (s.x - tx) * (s.x - tx) + (s.z - tz) * (s.z - tz);
        if (d < bd) { bd = d; best = s; }
      }
      return best || rec.slots[0];
    }
    recs.forEach(function (rec) {
      if (pointLights.length >= MAX_LIGHTS - 2) return;
      var sp = rec.sp, n = CFG.lightCount[sp.id] || 1;
      n = Math.min(n, MAX_LIGHTS - 2 - pointLights.length);
      var area = sp.w * sp.d;
      var I = CFG.point.I * clamp(Math.sqrt(area / 95), 0.72, 1.25);
      if (n > 1) I *= CFG.point.multiK;
      var dist = clamp(Math.max(sp.w, sp.d) * CFG.point.distSpread, CFG.point.distMin, CFG.point.distMax);
      if (n > 1) dist = Math.max(6.5, dist * 0.75);      /* หลายดวง → แต่ละดวงส่องสั้นลง เกิดพูล */
      var used = [], k;
      for (k = 0; k < n; k++) {
        var t = (k + 0.5) / n, tx, tz;
        if (sp.w >= sp.d) { tx = sp.x + sp.w * t; tz = sp.z + sp.d / 2; }
        else { tx = sp.x + sp.w / 2; tz = sp.z + sp.d * t; }
        var slot = nearestSlot(rec, tx, tz, used);
        used.push(slot);
        var pl = new THREE.PointLight(CFG.point.color, I, dist, CFG.point.decay);
        pl.position.set(slot.x, CFG.point.y, slot.z);
        pl.castShadow = false;
        pl.name = 'room:' + rec.id + ':' + k;
        group.add(pl);
        lights.push(pl); pointLights.push(pl);
        rec.pts.push({ light: pl, I: I });
      }
    });

    /* ---------- 3.3 accent LED (led.cool) -------------------------------- */
    var housings = [];
    CFG.accents.forEach(function (a) {
      var rec = byId[a.id];
      var len = a.x1 - a.x0, cx = (a.x0 + a.x1) / 2;
      var zf = a.faceZ, hw = 0.10, hh = 0.085, sw = 0.024, sh = 0.03;
      var zH = zf - hw / 2, zS = zf - hw - sw / 2;
      var m = cloneEmis(mats, a.mat || 'led.cool');
      var sm = util.box(len, sh, sw, m, cx, a.y, zS);
      sm.castShadow = false; sm.receiveShadow = false; sm.userData.noShadow = true;
      group.add(sm);
      matsOwned.push(m);
      housings.push({ len: len, hw: hw, hh: hh, cx: cx, y: a.y + sh / 2 + hh / 2, z: zH });
      if (rec) rec.accent = { mesh: sm, mat: m, ei0: m.emissiveIntensity || 1 };
    });

    /* ---------- 3.4 glow ใต้โคมที่มีไฟจริง --------------------------------- */
    var glowMat = new THREE.MeshBasicMaterial({
      map: glowTex(), transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, opacity: CFG.glow.opacity, fog: false
    });
    glowMat.name = 'lighting:glow';
    glowMat.color.setHex(0xffc477);   /* halo อุ่นรอบโคม */
    matsOwned.push(glowMat);
    var gq = new THREE.Group();
    var gGeo = new THREE.PlaneGeometry(CFG.glow.size, CFG.glow.size);
    geosOwned.push(gGeo);
    function addGlow(x, z) {
      var q = new THREE.Mesh(gGeo, glowMat);
      q.rotation.x = Math.PI / 2;                     /* หันลง (เห็นจากข้างล่าง) */
      q.position.set(x, ceilY - CFG.glow.yOff, z);     /* ใต้ราง/หัวโคม ไม่ตัด geometry */
      q.userData.noShadow = true;
      gq.add(q);
    }
    recs.forEach(function (rec) {
      var sp = rec.sp, cz = sp.z + sp.d / 2;
      if (rec.rail) rec.slots.forEach(function (s) { addGlow(s.x, cz); });
      else rec.slots.forEach(function (s) { addGlow(s.x, s.z); });
    });
    if (gq.children.length) {
      var gm = util.merge(gq); gm.name = 'lighting:glow'; gm.userData.noShadow = true;
      group.add(gm);
    }

    /* ---------- 3.5 ดวงอาทิตย์ + hemi ------------------------------------- */
    var sun = new THREE.DirectionalLight(CFG.sun.dayC, CFG.sun.dayI);
    sun.name = 'sun'; sun.castShadow = true;
    var sc = sun.shadow;
    sc.mapSize.set(CFG.shadow.mapSize, CFG.shadow.mapSize);
    var half = Math.hypot(B.w, B.d) / 2 + CFG.shadow.margin;
    sc.camera.left = -half; sc.camera.right = half;
    sc.camera.top = half; sc.camera.bottom = -half;
    sc.camera.near = 1; sc.camera.far = CFG.shadow.far;
    sc.bias = CFG.shadow.bias; sc.normalBias = CFG.shadow.normalBias;
    sc.autoUpdate = false; sc.needsUpdate = true;
    sun.target.position.copy(ctr);
    group.add(sun); group.add(sun.target);
    lights.push(sun);

    var hemi = new THREE.HemisphereLight(CFG.hemi.dayS, CFG.hemi.dayG, CFG.hemi.dayI);
    hemi.name = 'hemi';
    group.add(hemi); lights.push(hemi);

    /* ---------- 3.6 sky + fog --------------------------------------------- */
    var skyDay = mkSky(CFG.skyDay), skyNight = mkSky(CFG.skyNight);
    var fog = new THREE.Fog(CFG.fog.dayC, CFG.fog.dayN, CFG.fog.dayF);
    if (scene) {
      prev.fog = scene.fog || null;
      prev.background = scene.background;
      scene.fog = fog;
      scene.background = skyDay;
    }

    /* ---------- 3.7 shadow flags ------------------------------------------ */
    function applyShadowFlags(root) {
      if (!root) return 0;
      var cands = [], tmpB = new THREE.Box3(), tmpV = new THREE.Vector3();
      root.updateMatrixWorld(true);
      root.traverse(function (o) {
        if (!o.isMesh || !o.geometry) return;
        o.receiveShadow = true;
        if (o.userData.noShadow) { o.castShadow = false; return; }
        var mat = o.material;
        var trans = !!(mat && (mat.transparent === true || (mat.length && mat[0] && mat[0].transparent === true)));
        if (trans) { o.castShadow = false; return; }
        if (/ceilings/i.test(o.name || '') || /ceilings/i.test(o.parent ? o.parent.name || '' : '')) {
          o.castShadow = false; return;      /* ฝ้า: ไม่ทอดเงา (กัน acne บนฝ้า; ดาดฟ้ายังบังแดด) */
        }
        var g = o.geometry;
        if (!g.boundingBox) { try { g.computeBoundingBox(); } catch (e) { return; } }
        if (!g.boundingBox) return;
        tmpB.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
        tmpB.getSize(tmpV);
        var vol = tmpV.x * tmpV.z * Math.max(0.25, tmpV.y);
        if (vol < 0.05) { o.castShadow = false; return; }
        cands.push({ o: o, vol: vol });
      });
      cands.sort(function (a, b) { return b.vol - a.vol; });
      var n = 0;
      for (var i = 0; i < cands.length; i++) {
        if (i < CFG.shadow.castCap) { cands[i].o.castShadow = true; n++; }
        else cands[i].o.castShadow = false;
      }
      sc.needsUpdate = true;
      return n;
    }
    var casters = applyShadowFlags(scene);

    /* ═════════════ 4) state ═════════════ */
    var st = { night: false, t: 0, tgt: 0, az: CFG.sun.az, el: CFG.sun.el, casters: casters };

    function placeSun(azDeg, elDeg) {
      var az = (azDeg === undefined ? st.az : azDeg) * Math.PI / 180;
      var el = (elDeg === undefined ? st.el : elDeg) * Math.PI / 180;
      st.az = azDeg === undefined ? st.az : azDeg;
      st.el = elDeg === undefined ? st.el : elDeg;
      var dx = Math.sin(az) * Math.cos(el), dy = Math.sin(el), dz = -Math.cos(az) * Math.cos(el);
      var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      sun.position.set(
        ctr.x + dx / len * CFG.sun.dist,
        ctr.y + dy / len * CFG.sun.dist,
        ctr.z + dz / len * CFG.sun.dist);
      sun.target.position.copy(ctr);
      sun.target.updateMatrixWorld();
      sc.needsUpdate = true;
    }

    var cDay = new THREE.Color(CFG.sun.dayC), cNight = new THREE.Color(CFG.sun.nightC);
    var hS1 = new THREE.Color(CFG.hemi.dayS), hS2 = new THREE.Color(CFG.hemi.nightS);
    var hG1 = new THREE.Color(CFG.hemi.dayG), hG2 = new THREE.Color(CFG.hemi.nightG);
    var f1 = new THREE.Color(CFG.fog.dayC), f2 = new THREE.Color(CFG.fog.nightC);
    var pc1 = new THREE.Color(CFG.panel.dayC), pc2 = new THREE.Color(CFG.panel.nightC);

    function applyGlobals(t) {
      sun.intensity = lerp(CFG.sun.dayI, CFG.sun.nightI, t);
      sun.color.copy(cDay).lerp(cNight, t);
      hemi.intensity = lerp(CFG.hemi.dayI, CFG.hemi.nightI, t);
      hemi.color.copy(hS1).lerp(hS2, t);
      hemi.groundColor.copy(hG1).lerp(hG2, t);
      if (renderer) renderer.toneMappingExposure = lerp(CFG.exposure.day, CFG.exposure.night, t);
      fog.color.copy(f1).lerp(f2, t);
      fog.near = lerp(CFG.fog.dayN, CFG.fog.nightN, t);
      fog.far = lerp(CFG.fog.dayF, CFG.fog.nightF, t);
      if (scene) {
        var want = t < 0.5 ? skyDay : skyNight;
        if (scene.background !== want) scene.background = want;
      }
    }

    function applySpace(rec) {
      var roomK = lerp(CFG.room.day, CFG.room.night, st.t);
      var panK = lerp(CFG.panel.day, CFG.panel.night, st.t);
      var c = rec.cur, k;
      for (k = 0; k < rec.pts.length; k++) rec.pts[k].light.intensity = rec.pts[k].I * roomK * c;
      if (rec.mat) {
        rec.mat.emissiveIntensity = rec.ei0 * CFG.panel.ei * panK * (0.30 + 0.70 * c);
        rec.mat.emissive.copy(pc1).lerp(pc2, st.t);
      }
      if (rec.accent) rec.accent.mat.emissiveIntensity = rec.accent.ei0 * panK * (0.18 + 0.82 * c);
    }

    function applyAll() {
      applyGlobals(st.t);
      for (var i = 0; i < recs.length; i++) applySpace(recs[i]);
    }

    placeSun();
    applyAll();
    if (scene) { try { scene.updateMatrixWorld(true); } catch (e) { } }
    sc.needsUpdate = true;

    /* ═════════════ 5) hooks ═════════════ */
    var frames = 0;
    var hooks = {
      update: function (dt) {
        dt = (typeof dt === 'number' && isFinite(dt)) ? Math.min(0.1, Math.max(0, dt)) : 0.016;
        var k = 1 - Math.exp(-CFG.fade * dt), dirty = (Math.abs(st.tgt - st.t) > 1e-4), i, r;
        if (dirty) st.t += (st.tgt - st.t) * k;
        for (i = 0; i < recs.length; i++) {
          r = recs[i];
          if (Math.abs(r.tgt - r.cur) > 1e-4) { r.cur += (r.tgt - r.cur) * k; dirty = true; }
          else if (r.cur !== r.tgt) { r.cur = r.tgt; dirty = true; }
        }
        if (frames < 4) { sc.needsUpdate = true; frames++; }
        if (dirty) applyAll();
      },
      setNight: function (on) { st.night = !!on; st.tgt = on ? 1 : 0; return st.night; },
      setSpaceLight: function (id, on) {
        var key = String(id === undefined || id === null ? '' : id).replace(/^\/lights\//, '');
        var rec = byId[key];
        if (!rec) return false;
        rec.on = on !== false;
        rec.tgt = rec.on ? 1 : 0;
        if (Math.abs(rec.cur - rec.tgt) < 0.001) rec.cur = rec.tgt;
        return true;
      },
      setSunAngle: function (azDeg, elDeg) { placeSun(azDeg, elDeg); applyGlobals(st.t); return st; },
      settle: function () {
        st.t = st.tgt;
        for (var i = 0; i < recs.length; i++) recs[i].cur = recs[i].tgt;
        applyAll(); sc.needsUpdate = true;
        return hooks.state();
      },
      refreshShadows: function () { casters = applyShadowFlags(scene); sc.needsUpdate = true; return casters; },
      state: function () {
        var out = { night: st.night, t: +st.t.toFixed(3), sun: { az: st.az, el: st.el }, spaces: {} };
        for (var i = 0; i < recs.length; i++) out.spaces[recs[i].id] = +recs[i].cur.toFixed(3);
        return out;
      },
      dispose: function () {
        if (group.parent) group.parent.remove(group);
        var i;
        for (i = 0; i < matsOwned.length; i++) { try { matsOwned[i].dispose(); } catch (e) { } }
        for (i = 0; i < geosOwned.length; i++) { try { geosOwned[i].dispose(); } catch (e) { } }
        try { skyDay.dispose(); skyNight.dispose(); } catch (e) { }
        if (scene) {
          if (scene.fog === fog) scene.fog = prev.fog;
          if (scene.background === skyDay || scene.background === skyNight) scene.background = prev.background;
        }
        if (sun.shadow.map && sun.shadow.map.dispose) sun.shadow.map.dispose();
        S = null;
      }
    };

    var tris = 0, meshes = 0;
    group.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      meshes++;
      var g = o.geometry;
      tris += (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) / 3;
    });
    var stats = {
      lights: lights.length, points: pointLights.length, panels: recs.length,
      tris: Math.round(tris), calls: meshes, casters: casters, triBudget: 8000, lightBudget: MAX_LIGHTS
    };

    S = { group: group, lights: lights, stats: stats, hooks: hooks, recs: recs, sun: sun, hemi: hemi };
    return S;
  }

  O.lighting = {
    build: build,
    setupRenderer: setupRenderer,
    CFG: CFG,
    stats: function () { return S ? S.stats : null; },
    lights: function () { return S ? S.lights : []; }
  };
})();
