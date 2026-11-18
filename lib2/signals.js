/* office3d/v2/lib2/signals.js — ชั้นสัญญาณ (path → value) สำหรับ v2
   สัญญาเดียวกับ v1 (docs/API.md):
     GET  /api/state               → {seq, state:{path:value}}
     GET  /api/state/stream        → SSE event: state  data: {path, value} หรือ {state:{...}}
     POST /api/state               → {path, value}
   ถ้าไม่ใส่ base = โหมดเดโม (จำลองการจอง/ไฟเองในเครื่อง) → ฉากเห็นผลทันทีโดยไม่ต้องมีเซิร์ฟเวอร์
   API: O3D2.signals.create({base, token, demo, onError}) →
        { get, set, subscribe, snapshot, connect, push, sim, mode(), paths }
*/
(function () {
  var O = window.O3D2 = window.O3D2 || {};

  function create(opts) {
    opts = opts || {};
    var base = String(opts.base || '').replace(/\/$/, '');
    var token = opts.token || '';
    var state = {}, subs = [], seq = 0, mode = base ? 'off' : 'demo', es = null, timer = null;

    function emit(p, v, src) {
      for (var i = 0; i < subs.length; i++) {
        try { subs[i](p, v, src); } catch (e) { console.warn('[signals] listener', e); }
      }
    }
    function set(path, value, src) {
      path = String(path || '').trim();
      if (!path) return false;
      state[path] = value; seq++;
      emit(path, value, src || 'local');
      return true;
    }
    function get(p) { return state[p]; }
    function subscribe(fn, now) {
      subs.push(fn);
      if (now) for (var k in state) try { fn(k, state[k], 'init'); } catch (e) { }
      return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
    }
    function snapshot() { var s = {}; for (var k in state) s[k] = state[k]; return s; }
    function hdr(extra) {
      var h = extra || {};
      if (token) h.Authorization = 'Bearer ' + token;
      return h;
    }

    function connect() {
      if (!base) { mode = 'demo'; return { ok: false, mode: mode }; }
      mode = 'rest';
      try {
        fetch(base + '/api/state', { headers: hdr({ Accept: 'application/json' }) })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (d) {
            var st = (d && d.state) || {};
            Object.keys(st).forEach(function (k) { set(k, st[k], 'api'); });
            mode = 'rest';
          })
          .catch(function (e) { mode = 'error'; if (opts.onError) opts.onError(e); });
      } catch (e) { mode = 'error'; }
      if (window.EventSource) {
        try {
          es = new EventSource(base + '/api/state/stream' + (token ? '?token=' + encodeURIComponent(token) : ''));
          es.addEventListener('state', function (ev) {
            try {
              var d = JSON.parse(ev.data);
              if (d && d.path) set(d.path, d.value, 'sse');
              else if (d && d.state) Object.keys(d.state).forEach(function (k) { set(k, d.state[k], 'sse'); });
              mode = 'sse';
            } catch (e) { }
          });
          es.onerror = function () { mode = es && es.readyState === 0 ? 'error' : 'sse'; };
        } catch (e) { }
      }
      return { ok: true, mode: mode };
    }

    function push(path, value) {
      if (!base) { set(path, value, 'local'); return Promise.resolve({ local: true }); }
      return fetch(base + '/api/state', {
        method: 'POST',
        headers: hdr({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ path: path, value: value })
      }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    }

    /* ── เดโม: จำลองคนจองห้อง + ไฟเปิด/ปิด ─────────────────────────── */
    var NAMES = ['คุณสมชาย', 'คุณกนก', 'ทีมขาย A', 'คุณนัท', 'ทีมการตลาด', 'คุณปอ'];
    function hhmm(addMin) {
      var d = new Date(Date.now() + (addMin || 0) * 60000);
      return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    }
    var MEET = ['meeting1', 'meeting2', 'training'];
    function seed() {
      var i;
      for (i = 0; i < MEET.length; i++) {
        var id = MEET[i];
        var busy = (i === 0);
        var who = NAMES[i % NAMES.length];
        set('/meeting/' + id + '/state', busy ? 'busy' : 'free', 'demo');
        set('/meeting/' + id + '/who', busy ? who : '', 'demo');
        set('/meeting/' + id + '/until', busy ? hhmm(35) : '', 'demo');
        set('/meeting/' + id + '/count', busy ? 5 : 0, 'demo');
      }
      ['reception', 'sales', 'meeting1', 'pantry', 'meeting2', 'server', 'ops', 'training', 'corridor'].forEach(function (id, n) {
        set('/lights/' + id, n !== 5, 'demo');       /* server ปิดไฟ (ไม่มีคน) */
      });
      for (var s = 1; s <= 10; s++) set('/parking/slot/' + s + '/occupied', s <= 6, 'demo');
      set('/parking/gate', false, 'demo');
      set('/door/main', false, 'demo');
      set('/lock/server', true, 'demo');
    }
    function tick() {
      var id = MEET[Math.floor(Math.random() * MEET.length)];
      var busy = get('/meeting/' + id + '/state') === 'busy';
      if (busy) {
        set('/meeting/' + id + '/state', 'free', 'demo');
        set('/meeting/' + id + '/who', '', 'demo');
        set('/meeting/' + id + '/until', '', 'demo');
        set('/meeting/' + id + '/count', 0, 'demo');
        set('/lights/' + id, Math.random() > 0.3, 'demo');
      } else {
        set('/meeting/' + id + '/state', 'busy', 'demo');
        set('/meeting/' + id + '/who', NAMES[Math.floor(Math.random() * NAMES.length)], 'demo');
        set('/meeting/' + id + '/until', hhmm(20 + Math.floor(Math.random() * 60)), 'demo');
        set('/meeting/' + id + '/count', 2 + Math.floor(Math.random() * 5), 'demo');
        set('/lights/' + id, true, 'demo');
      }
      if (Math.random() > 0.6) {
        var rid = ['reception', 'sales', 'pantry', 'ops', 'meeting1', 'meeting2'][Math.floor(Math.random() * 6)];
        set('/lights/' + rid, !get('/lights/' + rid), 'demo');
      }
      /* รถเข้า/ออก: สลับช่องจอดทุก tick + ยกไม้กั้นชั่วคราวเมื่อมีรถเข้า */
      var slot = 1 + Math.floor(Math.random() * 10);
      var occ = !!get('/parking/slot/' + slot + '/occupied');
      if (!occ) {
        set('/parking/gate', true, 'demo');
        setTimeout(function () { set('/parking/gate', false, 'demo'); }, 2600);
      }
      set('/parking/slot/' + slot + '/occupied', !occ, 'demo');
    }
    function sim(on) {
      if (on === false) { if (timer) clearInterval(timer); timer = null; return false; }
      seed();
      if (!timer) timer = setInterval(tick, 9000);
      return true;
    }

    var api = { get: get, set: set, subscribe: subscribe, snapshot: snapshot, connect: connect, push: push,
      sim: sim, seed: seed, mode: function () { return mode; }, seq: function () { return seq; },
      base: base, hasApi: !!base };

    if (opts.demo !== false && !base) sim(true);
    else if (base) connect();
    return api;
  }

  O.signals = { create: create, VERSION: 'v2' };
})();
