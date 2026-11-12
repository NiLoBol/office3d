# office3d — 3D board จากแปลน + ตัวต่อสัญญาณ (Smart Home / ERP)

บอร์ด 3D ที่สร้างจาก **แปลน (plan)** แล้วผูกวัตถุกับ **path ของสถานะ** — ฝั่งนี้เป็นแค่
"ที่รับค่า + ที่แสดงผล" ไม่มี logic ธุรกิจ · ใครจะส่งค่ามาก็ต่อได้ทาง **REST API** หรือ **MCP**
ทุกอย่างเป็น JavaScript ล้วน + three.js ไม่ต้อง build ไม่ต้องมีเซิร์ฟเวอร์สำหรับตัวฉาก

- เดโมออฟฟิศ: `index.html` (8 ห้อง · ห้องประชุม · ที่จอด 10 ช่อง)
- ตัวอย่างใช้ lib แบบบ้าน: `examples/smarthome.html`
- สัญญาณ: `/lights/...` (bool) · `/meeting/.../count` (number) · `/parking/slot/N/occupied` (bool) ฯลฯ

## โครงสร้าง

```
office3d/
  index.html            เดโมออฟฟิศ (ใช้ lib ทั้งหมด)
  plan.js               แปลนตัวอย่าง + path ที่ผูกไว้
  demo/app.js           UI เดโม (การ์ด/คอนโซล/กล้อง/แตะวัตถุ) — ไม่ใช่ lib
  lib/core/
    bus.js              ที่เก็บสถานะ path → ค่า + subscribe (ใช้แทน API ฝั่งรับ)
    api.js              ต่อ API จริง: GET /api/state + SSE /api/state/stream + POST
    board.js            แปลน → ฉาก 3D (ผนัง/ประตู/หน้าต่าง/เฟอร์นิเจอร์/โคม/เซนเซอร์/จุดกด)
    kit.js              "ตัวต่อ" เรขาคณิต: desk / chair / person / car / tree / plant + Builder
    motion.js           การเคลื่อนไหว: follow(เส้นทาง) + tween
  lib/smarthome/
    light.js            ไฟ (path → bool) + fade + โคม/แสงพื้น
    meeting.js          คนในห้องประชุม (path → จำนวน) เดินเข้าที่นั่ง
    parking.js          ช่องจอด + เซนเซอร์ + ไม้กั้น + รถวิ่งเข้า/ออก
    index.js            O3D.createSmartHome({board, bus, scene, propMaterial})
  examples/smarthome.html   บ้าน 4 ห้อง + ไฟ 5 ดวง (ใช้ lib อย่างเดียว)
  docs/API.md           สัญญา REST / SSE / MCP
  docs/LIB.md           วิธีใช้ lib / เพิ่ม widget / schema ของ plan
  server/reference.js   เซิร์ฟเวอร์ตัวอย่าง (Node/Express, in-memory + SSE)
```

## เริ่มใช้

เปิด `index.html` ผ่าน static host (หรือเปิดจาก workspace ของแอป) — ไม่ต้อง build
ถ้าจะฝังในเว็บอื่น: วาง `lib/` กับ `vendor/three.min.js` แล้วเรียกตาม `docs/LIB.md`

```js
// สร้างฉากจากแปลน
var board = O3D.buildBoard(plan);          // คืน group/lights/meetings/slots/picks
scene.add(board.group);

// ตัวต่อ smart home
var w = O3D.createSmartHome({ board, bus: OfficeBus, scene, propMaterial });
OfficeBus.set('/lights/sales', true);      // ← เทียบเท่า POST /api/state
```

```bash
# ฝั่งผู้ส่ง (API จริง)
curl -X POST https://HOST/api/state -H 'Authorization: Bearer TOKEN' \
  -H 'content-type: application/json' -d '{"path":"/meeting/mr1/count","value":6}'
```

## หลักการ

1. **ข้อมูลมาก่อน** — เพิ่มห้อง/เฟอร์นิเจอร์/อุปกรณ์ที่ `plan.js` ไม่ต้องแตะโค้ดฉาก
2. **path เดียวกันทุกช่องทาง** — คอนโซลในเดโม, REST, MCP ใช้ `path → value` ชุดเดียวกัน
3. **ตัวต่อถอดได้** — เปิด/ปิดโมดูลได้ (สวิตช์บนการ์ด) โดยฉากไม่พัง
4. **lib ไม่รู้จักออฟฟิศ** — `lib/core` + `lib/smarthome` ใช้กับบ้าน/ออฟฟิศ/งานแสดงสินค้าได้

## ข้อจำกัด

- ยังไม่รับไฟล์ GLB/GLTF (ต้องเพิ่ม loader) — ตอนนี้ชิ้นส่วนจาก `kit.js` เท่านั้น
- API/MCP ในรีโปนี้เป็น **สัญญา + เซิร์ฟเวอร์ตัวอย่าง** (in-memory) ยังไม่มี auth จริง/ที่เก็บถาวร
- fps ขึ้นกับเครื่อง: เดโม ~12k tri / ~15-25 draw call

## License

MIT — เอาไปใช้/ดัดแปลงได้ (ดู `LICENSE`)
