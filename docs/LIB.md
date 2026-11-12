# LIB — วิธีใช้ / ต่อยอด

## 1) สร้างฉากจากแปลน

```js
var board = O3D.buildBoard(plan);
scene.add(board.group);
```

`board` = `{group, staticMesh, lights[], meetings[], slots[], picks[], labels[], panels, glows, sensors, gateArm, plan}`

### schema ของ plan (ย่อ)

```js
{
  building: { x, z, w, d, wallH, wallT },
  corridor: { x, z, w, d, label, floor },          // ไม่มีก็ได้
  entrance: { side:'x1', from, to },                // ช่องเปิดผนังนอก
  windows:  [ { side:'z1', from, to }, ... ],      // side = z0/z1/x0/x1
  rooms: [{
    id, label, type,                                // type: work | meeting | store | empty
    x, z, w, d,
    door: { side:'z0', w:1.3 },                     // side = ด้านที่มีประตู
    cap: 8,                                         // meeting เท่านั้น
    bind: { light:'/lights/sales', count:'/meeting/mr1/count', until:'/meeting/mr1/until' }
  }],
  parking: { area:{x,z,w,d}, cols, slotW, slotD, rows:[{z},{z}], gate:{x,z},
             bind:{ slot:'/parking/slot/{n}/occupied', gate:'/parking/gate' } },
  extraLights: [ { id, x, z, bind:'/lights/corridor' } ]
}
```

- ผนัง/ประตู/หน้าต่าง/พื้น gen จาก rooms + windows อัตโนมัติ (grid 0.5 ม.)
- `type:'empty'` = ห้องเปล่า (ไม่มีเฟอร์นิเจอร์) — ใช้ทำบ้าน/ห้องแสดงสินค้า

## 2) ตัวต่อ Smart Home

```js
var w = O3D.createSmartHome({ board, bus: OfficeBus, scene, propMaterial });
w.light.setAll(true);
w.light.toggle('/lights/it');
w.meeting.set('meeting1', 6);       // เท่ากับ bus.set('/meeting/mr1/count', 6)
w.parking.set(2, true);             // ช่องที่ 3 มีรถ
w.parking.setGate(true);
```

แต่ละตัวมี `summary()` (ไว้ทำ UI), `setEnabled(bool)` (ถอด/ต่อโมดูล), `onState(path,value)`

### เพิ่ม widget เอง

```js
function FanWidget(env) {
  this.env = env; this.board = env.board; this.bus = env.bus;
  var self = this;
  this.mesh = new THREE.Mesh(new THREE.BoxGeometry(.8,.1,.8), new THREE.MeshBasicMaterial({color:0x88ccff}));
  env.scene.add(this.mesh);
  this.unsub = this.bus.subscribe(function(path, value){
    if (path === '/home/fan/on') self.mesh.visible = !!value;
  });
}
O3D.SmartHome.Fan = FanWidget;   // ใช้: new O3D.SmartHome.Fan({board, bus, scene})
```

## 3) ชิ้นส่วน / การเคลื่อนไหว

```js
var b = new KIT.Builder();
b.box(x, yBase, z, sx, sy, sz, 0xRRGGBB);
b.cyl(x, yBase, z, rTop, rBot, h, color, seg);
b.at(x, z, ryAngles); b.part(KIT.desk()); b.end();   // ต่อชิ้นส่วนหมุน/ย้ายได้
```

- ชิ้นส่วนพร้อมใช้: `KIT.desk()`, `KIT.chair(color)`, `KIT.person(shirt)`, `KIT.car(color)`, `KIT.tree(h)`, `KIT.plant()`
- `Motion.follow(obj, [{x,z},...], {speed, bob, done})` — เดิน/วิ่งตามเส้น (หันหน้าตามทิศ)
- `Motion.tween(sec, fn(p), done)` — ไม้กั้น/ไฟ/ของหมุน

## 4) เชื่อม API

ดู `docs/API.md` — `OfficeAPI.connect({base, token, bus})` ใช้ bus เป็นที่เก็บกลาง
ถ้าไม่ต่อ API ก็ใช้ `OfficeBus` ในเครื่อง (เหมือนกันทุก path)

## 5) กับดักที่เจอมาแล้ว

- ประกาศค่าคงที่ (สี/รายการ) **ก่อน** เรียก `boot()` — ตัวแปร `var` ที่ประกาศทีหลังจะยังว่าง
- แท็บถูกซ่อน = `requestAnimationFrame` หยุด → ต้องมี setInterval เดินเวลา/วาดให้ (มีในเดโม)
- `renderer` ต้องสร้างจาก canvas ที่มีขนาดแล้ว ไม่งั้นภาพแรกว่าง
- ถ้าจะเพิ่ม `InstancedMesh.setColorAt` ต้องเรียกหลังสร้าง mesh (มันสร้าง buffer ให้เองด้วย count ตอนนั้น)
- ภาพจาก WebGL จับด้วย screenshot ปกติไม่ได้ (ได้ดำ) — ใช้ html_to_image หรือ `canvas.toDataURL` หลัง `draw()`
