# SIGNALS v2 — ต่อ v2 กับระบบบริษัท (ไฟ / ใครจองห้อง)

หน้า v2 (`index.html`) รับค่าจาก **path → value** ชุดเดียวกับ v1 (ดู `office3d/docs/API.md`)
แล้วเอาไปแสดงในฉากจริง: ไฟห้องติด/ดับ + ป้ายหน้าห้องประชุม (ว่าง/ไม่ว่าง/ใครจอง/ถึงกี่โมง/กี่คน)
และแถวชิปสถานะห้องประชุมบนจอ

## เปิดใช้
- **โหมดเดโม (ค่าเริ่มต้น)** — ไม่ต้องมีเซิร์ฟเวอร์: `plan2.js` → `api:{base:''}` → `lib2/signals.js` จำลองการจอง/ไฟเองทุก 9 วิ
- **ต่อระบบจริง** — 2 ทาง
  1. แก้ `plan2.js`: `api: { base: 'https://HOST', token: 'TOKEN' }`
  2. หรือเปิดด้วย query โดยไม่ต้องแก้ไฟล์: `index.html?api=https://HOST&token=TOKEN`

## endpoint ที่หน้าเว็บเรียก (ฝั่งเรารับค่าอย่างเดียว)
```
GET  /api/state            → { "state": { "/lights/sales": true, "/meeting/meeting1/state": "busy" } }
GET  /api/state/stream     → SSE  event: state  data: { "path": "...", "value": ... }  (หรือ data:{"state":{...}})
POST /api/state            → body { "path": "...", "value": ... }   (ปุ่มในหน้าเว็บใช้ตอนกดสลับไฟ)
Authorization: Bearer <TOKEN> (ถ้าเปิด auth)
```
ถ้า SSE ต่อไม่ได้ หน้าเว็บยังทำงานต่อได้ (อ่าน snapshot ครั้งแรก) — แนะนำให้ polling ฝั่งเซิร์ฟเวอร์ส่ง SSE

## path ที่ v2 ใช้

| path | ชนิด | ผลในฉาก |
|---|---|---|
| `/lights/<roomId>` — reception, sales, meeting1, pantry, meeting2, server, ops, training, corridor | bool | โคมฝ้า + แสงในห้อง หรี่/ติด (ผ่าน `lighting.setSpaceLight`) |
| `/meeting/<roomId>/state` | `'free'` · `'busy'` · `'soon'` | สี LED + ข้อความบนป้ายหน้าห้อง |
| `/meeting/<roomId>/who` | string (ชื่อผู้จอง/ทีม) | บรรทัด "ใครจอง" |
| `/meeting/<roomId>/until` | string `'HH:MM'` | "ถึงกี่โมง" |
| `/meeting/<roomId>/count` | number | "กี่คน" |
| `/door/main`, `/lock/server` ฯลฯ | bool | สงวนไว้ (ยังไม่ผูกกับวัตถุใน v2) |

`<roomId>` = `id` ของห้องใน `plan2.js` (`meeting1`, `meeting2`, `training` สำหรับห้องประชุม)

## จุดต่อในโค้ด
- `lib2/signals.js` — bus + REST/SSE + เดโม (`O3D2.signals.create`)
- `lib2/status.js` — ป้าย 3D หน้าห้องประชุม (canvas texture ภาษาไทย, อัปเดตเมื่อค่ามา)
- `index.html` — ชิปไฟอ่าน/เขียน `/lights/<id>` · แถวสถานะห้องประชุม · ชื่อห้องที่ยืนอยู่บอกการจอง

## ทดสอบเร็ว ๆ (ไม่ต้องมีเซิร์ฟเวอร์จริง)
```js
// ใน console ของหน้า index.html
O3D2.signals // ไม่ exposed — ใช้ช่องทางที่เปิดให้:
// เลือกห้องประชุมแล้วเทียบกับป้ายหน้าห้อง / ชิปบนจอ
```
หรือยิงค่าจาก curl เข้าเซิร์ฟเวอร์ของคุณแล้วดูป้ายเปลี่ยน:
```bash
curl -X POST https://HOST/api/state -H 'Authorization: Bearer TOKEN' \
  -H 'content-type: application/json' \
  -d '{"path":"/meeting/meeting1/state","value":"busy"}'
```
