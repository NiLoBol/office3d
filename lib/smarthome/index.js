/* lib/smarthome/index.js — ประกอบตัวต่อทั้งหมดจาก board
   ใช้: var widgets = O3D.createSmartHome({board, bus, scene, propMaterial, onChange});
*/
window.O3D = window.O3D || {};
window.O3D.SmartHome = window.O3D.SmartHome || {};
(function () {
  'use strict';
  window.O3D.createSmartHome = function (env) {
    var w = {};
    if (env.board.lights.length) w.light = new window.O3D.SmartHome.Light(env);
    if (env.board.meetings.length) w.meeting = new window.O3D.SmartHome.Meeting(env);
    if (env.board.slots.length) w.parking = new window.O3D.SmartHome.Parking(env);
    if (env.board.plan && env.board.plan.devices && env.board.plan.devices.length) w.devices = new window.O3D.SmartHome.Devices(env);
    return w;
  };
})();
