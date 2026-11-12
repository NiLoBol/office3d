/* lib/core/api.js — ต่อกับ API จริง (ฝั่งรับสัญญาณ)
   ใช้: OfficeAPI.connect({base:'https://host', token:'...', bus: OfficeBus})
        → GET /api/state ครั้งแรก + ต่อ SSE /api/state/stream
   หรือ OfficeAPI.push({base, token, path, value}) เพื่อส่งค่า
   (API ฝั่งเซิร์ฟเวอร์: ดู docs/API.md)
*/
window.OfficeAPI = (function () {
  'use strict';

  function headers(token) {
    var h = { 'Accept': 'application/json' };
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }

  function connect(opt) {
    opt = opt || {};
    var bus = opt.bus || window.OfficeBus;
    var base = (opt.base || '').replace(/\/$/, '');
    var token = opt.token || '';
    var out = { ok: false, mode: 'off', closed: false };

    if (!base) return out;

    fetch(base + '/api/state', { headers: headers(token) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        var st = (data && data.state) || {};
        Object.keys(st).forEach(function (k) { bus.set(k, st[k], 'api'); });
        out.ok = true; out.mode = 'rest';
        if (opt.onReady) opt.onReady(out);
      })
      .catch(function (e) {
        out.error = String(e.message || e);
        if (opt.onError) opt.onError(out);
      });

    if (window.EventSource) {
      try {
        var es = new EventSource(base + '/api/state/stream' + (token ? '?token=' + encodeURIComponent(token) : ''));
        es.addEventListener('state', function (ev) {
          try {
            var d = JSON.parse(ev.data);
            if (d && d.path) bus.set(d.path, d.value, 'sse');
            else if (d && d.state) Object.keys(d.state).forEach(function (k) { bus.set(k, d.state[k], 'sse'); });
            out.mode = 'sse'; out.ok = true;
          } catch (e) { }
        });
        es.onerror = function () { out.mode = out.ok ? 'sse-retry' : 'off'; };
        out.stream = es;
        out.close = function () { out.closed = true; es.close(); };
      } catch (e) { out.error = String(e.message || e); }
    }
    return out;
  }

  function push(opt) {
    opt = opt || {};
    var base = (opt.base || '').replace(/\/$/, '');
    if (!base) return Promise.reject(new Error('no base url'));
    return fetch(base + '/api/state', {
      method: 'POST',
      headers: (function () { var h = headers(opt.token); h['Content-Type'] = 'application/json'; return h; })(),
      body: JSON.stringify({ path: opt.path, value: opt.value })
    }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  return { connect: connect, push: push };
})();
