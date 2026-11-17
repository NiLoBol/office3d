/* office3d/v2/lib2/status.js — ป้ายหน้าห้องประชุม 3D: ว่าง/ไม่ว่าง · ใครจอง · ถึงกี่โมง · กี่คน
   อ่านค่าจาก O3D2.signals (path เดียวกับ v1):
     /meeting/<roomId>/state  'free' | 'busy' | 'soon'
     /meeting/<roomId>/who    ชื่อผู้จอง (string)
     /meeting/<roomId>/until  'HH:MM'
     /meeting/<roomId>/count  จำนวนคน (number)
   API: O3D2.status.build(ctx) → { group, colliders, hooks:{update(dt), refresh()}, plaques }
*/
(function () {
  var O = window.O3D2 = window.O3D2 || {};

  function build(ctx) {
    var THREE = (ctx && ctx.THREE) || window.THREE;
    var U = ((ctx && ctx.util) || O.util);
    var MATS = ((ctx && ctx.mats) || O.mats);
    var plan = (ctx && ctx.plan) || window.OFFICE2;
    var sig = (ctx && ctx.signals) || null;
    var group = new THREE.Group(); group.name = 'status';

    var WO = 0.62, HO = 0.34, T = 0.028;           /* ขนาดป้าย (ม.) */
    var plaques = [], unsub = [];
    var bedMat = MATS.get('metal.dark');
    var ledFree = new THREE.Color(0x2fd06a), ledBusy = new THREE.Color(0xff5a4a), ledSoon = new THREE.Color(0xffc657);

    function makeCanvas() {
      var c = document.createElement('canvas');
      c.width = 512; c.height = 288;
      var g = c.getContext('2d');
      g.fillStyle = '#0d151d'; g.fillRect(0, 0, c.width, c.height);
      return { c: c, g: g };
    }

    function draw(p) {
      var cv = p.cv, g = cv.g, W = cv.c.width, H = cv.c.height;
      var st = p.state();
      g.fillStyle = '#0d151d'; g.fillRect(0, 0, W, H);
      /* แถบสถานะซ้าย */
      var col = st.state === 'busy' ? '#ff5a4a' : (st.state === 'soon' ? '#ffc657' : '#2fd06a');
      g.fillStyle = col; g.fillRect(0, 0, 12, H);
      /* ชื่อห้อง */
      g.fillStyle = '#eaf4fb';
      g.font = '700 40px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
      g.fillText(st.label, 34, 62);
      /* สถานะ */
      g.font = '700 46px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
      g.fillStyle = col;
      var txt = st.state === 'busy' ? 'ไม่ว่าง' : (st.state === 'soon' ? 'ใกล้ว่าง' : 'ว่าง');
      g.fillText(txt, 34, 132);
      /* ผู้จอง + เวลา + จำนวนคน */
      g.font = '400 30px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
      g.fillStyle = '#b9cddd';
      var l2 = st.state === 'busy'
        ? (st.who || 'ไม่ระบุชื่อ') + ' · ถึง ' + (st.until || '-')
        : 'พร้อมใช้งาน';
      g.fillText(l2, 34, 190);
      g.font = '400 26px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
      g.fillStyle = '#7e97ab';
      g.fillText(st.state === 'busy' ? ('ผู้เข้าร่วม ' + (st.count || 0) + ' คน') : 'กดปุ่มเพื่อจอง', 34, 234);
      /* เส้นคั่น */
      g.strokeStyle = 'rgba(140,170,195,.25)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(34, 254); g.lineTo(W - 24, 254); g.stroke();
      p.tex.needsUpdate = true;
      p.led.material.color.copy(st.state === 'busy' ? ledBusy : (st.state === 'soon' ? ledSoon : ledFree));
    }

    function place(sp) {
      /* ป้ายวางฝั่งโถง ด้านข้างประตู (ไม่บังทางเดิน) */
      var d = sp.door || { side: 'z1', at: sp.w / 2, w: 1.2 };
      var x, z, ry;
      if (d.side === 'z1') { x = sp.x + d.at + d.w / 2 + WO / 2 + 0.12; z = sp.z + sp.d + T / 2 + 0.008; ry = 0; }
      else if (d.side === 'z0') { x = sp.x + d.at + d.w / 2 + WO / 2 + 0.12; z = sp.z - T / 2 - 0.008; ry = Math.PI; }
      else if (d.side === 'x1') { x = sp.x + sp.w + T / 2 + 0.008; z = sp.z + d.at + d.w / 2 + WO / 2 + 0.12; ry = Math.PI / 2; }
      else { x = sp.x - T / 2 - 0.008; z = sp.z + d.at + d.w / 2 + WO / 2 + 0.12; ry = -Math.PI / 2; }
      return { x: x, z: z, ry: ry };
    }

    (plan.rooms || []).forEach(function (sp) {
      if ((sp.furn || '') !== 'meeting') return;
      var at = place(sp);
      var y = 1.45;
      var cv = makeCanvas();
      var tex = new THREE.CanvasTexture(cv.c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = (ctx.renderer && ctx.renderer.capabilities) ? ctx.renderer.capabilities.getMaxAnisotropy() : 4;
      var bg = U.box(WO, HO, T, bedMat, at.x, y, at.z, at.ry);
      var face = new THREE.Mesh(new THREE.PlaneGeometry(WO - 0.03, HO - 0.03),
        new THREE.MeshBasicMaterial({ map: tex, transparent: false }));
      face.position.set(at.x, y, at.z); face.rotation.y = at.ry;
      /* ดันระนาบออกจากแผ่นหลัง 1.5 ซม. ตามทิศที่หัน */
      var nx = Math.sin(at.ry), nz = Math.cos(at.ry);
      face.position.x += nx * (T / 2 + 0.002);
      face.position.z += nz * (T / 2 + 0.002);
      var led = U.cyl(0.018, 0.018, 0.012, 10, MATS.get('led.warm'),
        at.x + Math.cos(at.ry) * (WO / 2 - 0.05) + nx * (T / 2 + 0.01), y + HO / 2 - 0.04,
        at.z - Math.sin(at.ry) * (WO / 2 - 0.05) + nz * (T / 2 + 0.01), 0);
      led.material = led.material.clone();
      led.material.emissive = new THREE.Color(0x2fd06a);
      led.material.emissiveIntensity = 1.2;
      led.rotation.x = Math.PI / 2;
      group.add(bg); group.add(face); group.add(led);

      var p = {
        room: sp.id, label: sp.label, cv: cv, tex: tex, mesh: face, led: led,
        state: function () {
          var s = sig ? sig.get('/meeting/' + sp.id + '/state') : 'free';
          return {
            label: sp.label,
            state: s === 'busy' ? 'busy' : (s === 'soon' ? 'soon' : 'free'),
            who: sig ? (sig.get('/meeting/' + sp.id + '/who') || '') : '',
            until: sig ? (sig.get('/meeting/' + sp.id + '/until') || '') : '',
            count: sig ? (sig.get('/meeting/' + sp.id + '/count') || 0) : 0
          };
        }
      };
      plaques.push(p);
      draw(p);
      if (sig && sig.subscribe) {
        unsub.push(sig.subscribe(function (path) {
          if (path && path.indexOf('/meeting/' + sp.id + '/') === 0) draw(p);
        }));
      }
    });

    return {
      group: group,
      colliders: [],
      plaques: plaques,
      hooks: {
        update: function () { },
        refresh: function () { for (var i = 0; i < plaques.length; i++) draw(plaques[i]); },
        dispose: function () { for (var i = 0; i < unsub.length; i++) try { unsub[i](); } catch (e) { } }
      }
    };
  }

  O.status = { build: build };
})();
