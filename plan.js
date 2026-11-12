/* office3d/plan.js — แปลนตัวอย่าง + "จุดต่อสัญญาณ" (bind path)
   ทั้งหมดเป็นข้อมูล: เปลี่ยนไฟล์นี้ = เปลี่ยนออฟฟิศ · path ใช้กับ API/MCP ตาม README
   หน่วยเมตร · x,z = มุมล่าง (min) ของห้อง · side ของประตู: z0/z1 = ผนังด้าน z ต่ำ/สูง, x0/x1 = ด้าน x ต่ำ/สูง
*/
window.OFFICE_PLAN = {
  name: 'WRIS Office · ชั้น 1 (เดโม)',
  building: { x: 0, z: 0, w: 40, d: 24, wallH: 3.2, wallT: 0.22 },
  corridor: { x: 0, z: 10, w: 40, d: 3, label: 'โถงทางเดิน', floor: 0xc9ab84 },

  rooms: [
    { id: 'sales', label: 'ฝ่ายขาย', type: 'work', floor: 0xd3dbe5,
      x: 0, z: 13, w: 10.5, d: 11, door: { side: 'z0', w: 1.3 },
      bind: { light: '/lights/sales' } },
    { id: 'finance', label: 'บัญชี', type: 'work', floor: 0xd3dbe5,
      x: 10.5, z: 13, w: 9.5, d: 11, door: { side: 'z0', w: 1.3 },
      bind: { light: '/lights/finance' } },
    { id: 'it', label: 'ไอที', type: 'work', floor: 0xd3dbe5,
      x: 20, z: 13, w: 10, d: 11, door: { side: 'z0', w: 1.3 },
      bind: { light: '/lights/it' } },
    { id: 'meeting1', label: 'ห้องประชุม 1', type: 'meeting', floor: 0xdde6ee,
      x: 30, z: 13, w: 10, d: 11, door: { side: 'z0', w: 1.7 }, cap: 8,
      bind: { light: '/lights/meeting1', count: '/meeting/mr1/count', until: '/meeting/mr1/until' } },

    { id: 'support', label: 'บริการลูกค้า', type: 'work', floor: 0xd3dbe5,
      x: 0, z: 0, w: 12, d: 10, door: { side: 'z1', w: 1.3 },
      bind: { light: '/lights/support' } },
    { id: 'meeting2', label: 'ห้องประชุม 2', type: 'meeting', floor: 0xdde6ee,
      x: 12, z: 0, w: 9, d: 10, door: { side: 'z1', w: 1.5 }, cap: 6,
      bind: { light: '/lights/meeting2', count: '/meeting/mr2/count', until: '/meeting/mr2/until' } },
    { id: 'admin', label: 'ธุรการ', type: 'work', floor: 0xd3dbe5,
      x: 21, z: 0, w: 9, d: 10, door: { side: 'z1', w: 1.3 },
      bind: { light: '/lights/admin' } },
    { id: 'store', label: 'สโตร์', type: 'store', floor: 0xd8cfc0,
      x: 30, z: 0, w: 10, d: 10, door: { side: 'z1', w: 1.3 },
      bind: { light: '/lights/store' } }
  ],

  /* ช่องเปิดผนังด้านนอก (ทางเข้าโถง) */
  entrance: { side: 'x1', from: 10.4, to: 12.6 },
  windows: [
    { side: 'z1', from: 2, to: 10 }, { side: 'z1', from: 11.5, to: 19 }, { side: 'z1', from: 21, to: 29 }, { side: 'z1', from: 31, to: 39 },
    { side: 'z0', from: 2, to: 11 }, { side: 'z0', from: 13, to: 20 }, { side: 'z0', from: 22, to: 29 }, { side: 'z0', from: 31, to: 39 },
    { side: 'x0', from: 2, to: 8 }, { side: 'x0', from: 14, to: 22 },
    { side: 'x1', from: 2, to: 8 }, { side: 'x1', from: 15, to: 22 }
  ],

  /* ที่จอดรถ (ด้านตะวันออกของอาคาร) */
  parking: {
    area: { x: 41, z: 2, w: 22, d: 20 },
    cols: 5, slotW: 3.8, slotD: 5.4,
    rows: [{ z: 3.0 }, { z: 15.6 }],
    gate: { x: 61.2, z: 11.0 },
    bind: { gate: '/parking/gate', free: '/parking/free', slot: '/parking/slot/{n}/occupied' },
    street: { x: 64, z: 0, w: 9, d: 24 }
  },

  /* ไฟโถง (นอกห้อง) */
  extraLights: [
    { id: 'corridor-a', x: 12, z: 11.5, bind: '/lights/corridor' },
    { id: 'corridor-b', x: 30, z: 11.5, bind: '/lights/corridor2' }
  ]
};
