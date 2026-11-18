/* office3d/v2/plan2.js — แปลนออฟฟิศ v2 (หน่วยเมตร, y=0 = ระดับพื้น finished floor)
   x: ตะวันตก → ออก · z: ใต้ → เหนือ
   ห้องเขียนด้วย "เส้นกึ่งกลางผนัง": x,z = มุม min · w,d = กว้าง/ลึก
   ผนังภายนอก tExt=0.24 · ผนังภายใน tInt=0.12 · สูง wallH
   ประตู: side = ด้านที่เจาะ (z0=ใต้, z1=เหนือ, x0=ตะวันตก, x1=ออก) · at = ระยะจากมุม min ตามแนวด้านนั้น
   หน้าต่าง: side + from,to ตามแนวเดียวกับประตู · sill/head = ระดับขอบล่าง/บน
*/
window.OFFICE2 = {
  name: 'WRIS Office · ชั้น 1',
  building: { x: 0, z: 0, w: 34, d: 22, wallH: 3.05, tExt: 0.24, tInt: 0.12, slab: 0.22 },
  entrance: { side: 'x0', from: 9.8, to: 12.2, type: 'double-glass', h: 2.4 },
  spawn: { x: 2.0, z: 11.0, yaw: -Math.PI / 2 },
  /* ชั้นสัญญาณ: ใส่ base/token ของระบบบริษัท (GET /api/state + SSE /api/state/stream)
     เว้น base = โหมดเดโมจำลองการจอง/ไฟในเครื่อง · override ได้ทาง ?api=URL&token=... */
  api: { base: 'https://controller-office3d.131199999.xyz', token: '', demo: true },
  corridor: { id: 'corridor', label: 'โถงทางเดิน', x: 0, z: 9.5, w: 34, d: 3,
    floor: 'floor.tile.polished', furn: 'corridor' },

  rooms: [
    { id: 'reception', label: 'ต้อนรับ', x: 0, z: 0, w: 8, d: 9.5, floor: 'floor.tile.polished',
      furn: 'reception', door: { side: 'z1', at: 5.0, w: 1.0, type: 'swing' },
      bind: { light: '/lights/reception' } },
    { id: 'sales', label: 'ฝ่ายขาย', x: 8, z: 0, w: 10, d: 9.5, floor: 'floor.carpet.grey',
      furn: 'work', desks: 8, door: { side: 'z1', at: 5.0, w: 1.0, type: 'swing' },
      bind: { light: '/lights/sales' } },
    { id: 'meeting1', label: 'ห้องประชุม 1', x: 18, z: 0, w: 7, d: 9.5, floor: 'floor.carpet.blue',
      furn: 'meeting', cap: 8, glass: ['z1'], door: { side: 'z1', at: 3.4, w: 1.6, type: 'sliding-glass' },
      bind: { light: '/lights/meeting1', count: '/meeting/mr1/count' } },
    { id: 'pantry', label: 'ครัว/พัก', x: 25, z: 0, w: 9, d: 9.5, floor: 'floor.tile.polished',
      furn: 'pantry', door: { side: 'z1', at: 2.0, w: 1.0, type: 'swing' },
      bind: { light: '/lights/pantry' } },

    { id: 'meeting2', label: 'ห้องประชุม 2', x: 0, z: 12.5, w: 7, d: 9.5, floor: 'floor.carpet.blue',
      furn: 'meeting', cap: 6, glass: ['z0'], door: { side: 'z0', at: 3.4, w: 1.6, type: 'sliding-glass' },
      bind: { light: '/lights/meeting2', count: '/meeting/mr2/count' } },
    { id: 'server', label: 'ห้องเซิร์ฟเวอร์', x: 7, z: 12.5, w: 6.5, d: 9.5, floor: 'floor.tile.dark',
      furn: 'server', door: { side: 'z0', at: 3.0, w: 0.9, type: 'swing-lock' },
      bind: { light: '/lights/server', lock: '/lock/server' } },
    { id: 'ops', label: 'ปฏิบัติการ', x: 13.5, z: 12.5, w: 11.5, d: 9.5, floor: 'floor.carpet.grey',
      furn: 'work', desks: 10, door: { side: 'z0', at: 5.5, w: 1.0, type: 'swing' },
      bind: { light: '/lights/ops' } },
    { id: 'training', label: 'ห้องอบรม', x: 25, z: 12.5, w: 9, d: 9.5, floor: 'floor.carpet.blue',
      furn: 'training', cap: 12, door: { side: 'z0', at: 4.0, w: 1.8, type: 'double' },
      bind: { light: '/lights/training' } }
  ],

  windows: [
    { side: 'z0', from: 1.5, to: 7.0, sill: 0.95, head: 2.55, type: 'fixed' },
    { side: 'z0', from: 9.0, to: 17.0, sill: 0.95, head: 2.55, type: 'fixed' },
    { side: 'z0', from: 19.0, to: 24.0, sill: 0.95, head: 2.55, type: 'fixed' },
    { side: 'z0', from: 26.0, to: 33.0, sill: 0.95, head: 2.55, type: 'fixed' },
    { side: 'z1', from: 1.0, to: 6.0, sill: 0.95, head: 2.55, type: 'fixed' },
    { side: 'z1', from: 14.5, to: 24.0, sill: 0.95, head: 2.55, type: 'fixed' },
    { side: 'z1', from: 26.0, to: 33.0, sill: 0.95, head: 2.55, type: 'fixed' },
    { side: 'x0', from: 1.5, to: 7.5, sill: 0.95, head: 2.55, type: 'fixed' },
    { side: 'x0', from: 13.5, to: 20.0, sill: 0.95, head: 2.55, type: 'fixed' },
    { side: 'x1', from: 1.0, to: 8.0, sill: 0.95, head: 2.55, type: 'fixed' },
    { side: 'x1', from: 13.0, to: 20.0, sill: 0.95, head: 2.55, type: 'fixed' }
  ],

  ceiling: { tile: 1.2, mat: 'wall.paint.ceiling', drop: 0.06, luminaire: { size: 0.6, mat: 'led.warm' } },

  /* ลานจอดรถ + ถนน ด้านตะวันออกของอาคาร (สำหรับโมดูล parking) */
  parking: {
    x: 36, z: 2, w: 18, d: 20, cols: 5, rows: 2, slotW: 3.0, slotD: 5.2, gap: 0.5,
    gate: { x: 55.0, z: 12.0 }, street: { x: 56.5, z: 0, w: 9, d: 22 },
    bind: { gate: '/parking/gate', free: '/parking/free', slot: '/parking/slot/{n}/occupied' }
  },

  /* จุดเดินของคน (โหมด people) — เส้นทางในโถง + ทางเข้าอาคาร */
  people: {
    spawn: { x: 1.2, z: 11.0 },
    max: 14,
    walkSpeed: 1.15,
    bind: { meeting: '/meeting/{id}/count' }
  },

  devices: [
    { id: 'door-main', type: 'door', label: 'ประตูหน้า', path: '/door/main', x: 1.2, z: 11.0 },
    { id: 'ac-sales', type: 'climate', label: 'แอร์ฝ่ายขาย', path: '/climate/sales', x: 9.0, z: 1.2 },
    { id: 'lock-server', type: 'lock', label: 'ล็อกห้องเซิร์ฟเวอร์', path: '/lock/server', x: 10.2, z: 13.2 }
  ]
};
