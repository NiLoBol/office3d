# API / MCP — สัญญาสัญญาณ

ฝั่งเรา **รับค่าอย่างเดียว**: `path → JSON value` เก็บค่าล่าสุดไว้ แล้วให้ฉาก 3D อ่าน
ไม่มีคำสั่งควบคุมอุปกรณ์ในสัญญานี้ — ผู้ส่งเป็นคนตัดสินใจว่าจะส่งอะไร

## REST

```
GET  /api/state                 → {"seq":12,"state":{"/lights/sales":true,...}}
POST /api/state                 body {"path":"/lights/sales","value":true}
POST /api/state/batch           body {"updates":[{"path":"/meeting/mr1/count","value":6}]}
GET  /api/state/stream          SSE — event: state  data: {"path":..,"value":..}
```

- ทุก request: `Authorization: Bearer <TOKEN>` (ถ้าเปิด auth)
- ค่าเป็น JSON ได้ทุกชนิด: bool / number / string / object
- `seq` ใช้เทียบว่าเป็นค่าล่าสุดหรือไม่ (ฝั่งรับเก็บค่าล่าสุดเท่านั้น)

```bash
curl -H 'Authorization: Bearer TOKEN' https://HOST/api/state
curl -X POST https://HOST/api/state -H 'Authorization: Bearer TOKEN' \
  -H 'content-type: application/json' \
  -d '{"path":"/parking/slot/3/occupied","value":true}'
```

## MCP (ให้ AI ส่งค่า)

ครอบ API เดียวกัน 3 tool:

| tool | args | ผล |
|---|---|---|
| `office_state_get` | – | snapshot ทั้งหมด |
| `office_state_set` | `{path, value}` | ตั้ง 1 ค่า |
| `office_state_patch` | `{updates:[{path,value}]}` | หลายค่าในครั้งเดียว |

ตัวอย่าง config (HTTP MCP):
```json
{ "mcpServers": { "office3d": { "url": "https://HOST/mcp", "headers": { "Authorization": "Bearer TOKEN" } } } }
```

## path ที่เดโมผูกไว้ (มาจาก `plan.js`)

| path | ชนิด | ผลในฉาก |
|---|---|---|
| `/lights/sales` … `/lights/store`, `/lights/meeting1/2`, `/lights/corridor`, `/lights/corridor2` | bool | โคมเพดาน + แสงพื้น fade |
| `/meeting/mr1/count` (0–8) · `/meeting/mr2/count` (0–6) | number | คนนั่ง/เดินเข้า-ออก |
| `/meeting/mr1/until` · `/meeting/mr2/until` | string | เวลาสิ้นสุดในป๊อปอัป |
| `/parking/slot/1..10/occupied` | bool | รถวิ่งเข้าช่อง + สีเซนเซอร์ |
| `/parking/gate` | bool | ไม้กั้นเปิด/ปิด |

path กำหนดที่ `plan.js` (`bind: {light, count, until, slot, gate}`) — เพิ่มได้เองในไฟล์เดียว

## เซิร์ฟเวอร์ตัวอย่าง

`server/reference.js` (Node 18+, Express):

```bash
npm i express
TOKEN=secret node server/reference.js   # http://localhost:8787
```

เก็บ state ใน memory (รีสตาร์ทหาย) + กระจาย SSE ให้ทุก client
ตอนใช้จริงเปลี่ยนที่เก็บเป็น Redis/Mongo/DB ของ WRIS และใส่ auth ที่แข็งกว่า bearer ธรรมดา

## ฝั่งรับในเบราว์เซอร์

```js
// ต่อ API จริง (GET + SSE)
var c = OfficeAPI.connect({ base: 'https://HOST', token: 'TOKEN', bus: OfficeBus,
  onReady: function(x){ console.log('connected', x.mode); },
  onError: function(e){ console.warn(e.error); } });

// ส่งค่าออก (เช่นปุ่มในหน้าเรา)
OfficeAPI.push({ base:'https://HOST', token:'TOKEN', path:'/lights/it', value:true });
```

ถ้าไม่ใส่ base = ใช้ bus ในเครื่อง (เดโม) — โค้ดฉากไม่ต้องเปลี่ยน
