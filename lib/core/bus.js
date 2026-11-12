/* office3d/bus.js — "ที่เก็บสถานะ" ฝั่งรับสัญญาณอย่างเดียว
   สัญญาจริงตอน deploy (ตรงกับ README):
     GET  /api/state            → {seq, state:{path:value}}
     POST /api/state            → body {path, value}            (หรือ {"path":..,"value":..})
     POST /api/state/batch      → body {updates:[{path,value}]}
     GET  /api/state/stream     → SSE event: state
   ในเดโมนี้ทำงานในหน้าเว็บ แต่ path/ค่าเหมือนกันเป๊ะ → เปลี่ยนฝั่งส่งได้โดยไม่ต้องแก้ฉาก
*/
window.OfficeBus = (function () {
  'use strict';
  var state = {}, subs = [], log = [], seq = 0;

  function clone(v) { try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; } }

  function set(path, value, src) {
    path = String(path || '').trim();
    if (!path) return false;
    state[path] = value;
    seq++;
    var rec = { t: new Date(), path: path, value: clone(value), seq: seq, src: src || 'api' };
    log.unshift(rec);
    while (log.length > 80) log.pop();
    for (var i = 0; i < subs.length; i++) {
      try { subs[i](path, value, rec); }
      catch (e) {
        window.__ERRS = window.__ERRS || [];
        window.__ERRS.push('listener ' + path + ': ' + String((e && e.message) || e) + ' @ ' + String((e && e.stack) || '').split('\n').slice(1, 4).join(' | '));
        console.warn('bus listener', e);
      }
    }
    return true;
  }

  function get(path) { return state[path]; }

  function patch(obj, src) {
    Object.keys(obj || {}).forEach(function (k) { set(k, obj[k], src); });
  }

  function snapshot() {
    var s = {};
    Object.keys(state).forEach(function (k) { s[k] = clone(state[k]); });
    return { seq: seq, state: s, updated: new Date() };
  }

  function subscribe(fn) {
    subs.push(fn);
    return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
  }

  /* รับค่าจากภายนอก (string → JSON ถ้าได้) */
  function parse(v) {
    if (typeof v !== 'string') return v;
    v = v.trim();
    if (v === '') return '';
    try { return JSON.parse(v); } catch (e) { return v; }
  }

  return { set: set, get: get, patch: patch, snapshot: snapshot, subscribe: subscribe, parse: parse, log: function () { return log; } };
})();
