/* office3d controller — ตัวคุมสัญญาณของฉาก 3D (REST + SSE + UI)
   ไม่ต้องใช้ dependency ภายนอก (node:http ล้วน) · เก็บ state ใน memory
   GET  /                     หน้า UI ตัวคุม
   GET  /api/state            → {seq, state:{path:value}}
   POST /api/state            {path, value}
   POST /api/state/batch      {updates:[{path,value}]}
   GET  /api/state/stream     SSE event: state  data:{path,value} (หรือ {state:{...}} ตอนต่อครั้งแรก)
   DELETE /api/state          ล้างค่า (เฉพาะ demo)
*/
'use strict';
const http = require('http');
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.CONTROLLER_TOKEN || '';          /* ถ้าตั้ง = ต้องส่ง Bearer */

let state = {};
let seq = 0;
const clients = new Set();

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
}
function auth(req) {
  if (!TOKEN) return true;
  const h = req.headers['authorization'] || '';
  const q = new URL(req.url, 'http://x').searchParams.get('token') || '';
  return h === 'Bearer ' + TOKEN || q === TOKEN;
}
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}
function broadcast(path, value) {
  const msg = 'event: state\ndata: ' + JSON.stringify({ path, value }) + '\n\n';
  for (const c of clients) { try { c.write(msg); } catch (e) { } }
}
function setPath(path, value, src) {
  path = String(path || '').trim();
  if (!path) return false;
  state[path] = value; seq++;
  broadcast(path, value);
  return true;
}

const UI = `<!doctype html><html lang="th"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Office3D · ตัวคุม</title>
<style>
:root{--bg:#0a1017;--panel:#111c26;--line:#23323f;--txt:#e7f0f7;--dim:#8ea3b6;--acc:#5ec8ff;--ok:#2fd06a;--bad:#ff5a4a;--gold:#ffc657}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(120% 70% at 50% 0%,#152435,#0a1017 65%);color:var(--txt);
font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:12px 12px 30px}
h1{font-size:17px;margin:4px 0 2px}h1 em{font-style:normal;color:var(--acc)}
.sub{color:var(--dim);font-size:11.5px;margin-bottom:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:11px 12px;margin-bottom:10px}
.card h2{font-size:13px;margin:0 0 9px;font-weight:700}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:7px}
.btn{border:1px solid var(--line);background:#17262f;color:var(--txt);border-radius:10px;min-height:42px;padding:0 10px;
font:inherit;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:6px}
.btn.on{border-color:#2c5a3a;background:#12301f;color:#bff0cf}
.btn:active{transform:scale(.98)}
.badge{font-size:10px;color:var(--dim)}
.row{display:flex;gap:7px;align-items:center;margin-top:8px;flex-wrap:wrap}
input,select{background:#0d1820;border:1px solid var(--line);color:var(--txt);border-radius:9px;min-height:38px;padding:0 9px;font:inherit;font-size:12px}
#log{font:11px/1.5 ui-monospace,monospace;color:#9fd0ea;white-space:pre-wrap;max-height:150px;overflow:auto;margin-top:6px}
.dz{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--ok);margin-right:6px}
</style>
<h1>WRIS <em>Office 3D</em> · ตัวคุมสัญญาณ</h1>
<div class="sub">สัญญาณที่ส่งจากที่นี่จะไปโผล่ในฉากที่ <b>office3d.131199999.xyz</b> (path → value ตัวเดียวกับ v1)</div>

<div class="card"><h2>💡 ไฟรายห้อง</h2><div class="grid" id="lights"></div></div>
<div class="card"><h2>🚪 ห้องประชุม · ใครจอง</h2><div id="meet"></div></div>
<div class="card"><h2>🅿 ลานจอด + ไม้กั้น</h2><div class="grid" id="park"></div>
<div class="row"><button class="btn" id="gate" style="min-width:150px">ไม้กั้น: ปิด</button><button class="btn" id="fill" style="min-width:150px">ให้รถเข้าทุกช่อง (เดโม)</button></div></div>
<div class="card"><h2>📡 สถานะ</h2><div id="stat" class="sub">…</div><div id="log"></div></div>

<script>
var LIGHTS=[['reception','ต้อนรับ'],['sales','ฝ่ายขาย'],['meeting1','ห้องประชุม 1'],['pantry','ครัว/พัก'],['meeting2','ห้องประชุม 2'],['server','ห้องเซิร์ฟเวอร์'],['ops','ปฏิบัติการ'],['training','ห้องอบรม'],['corridor','โถงทางเดิน']];
var MEET=['meeting1','meeting2','training'];
var state={}, seq=0;
function $(s){return document.querySelector(s)}
function log(t){var e=$('#log');e.textContent=(new Date().toLocaleTimeString('th-TH'))+'  '+t+'\\n'+e.textContent;}
function val(p,d){return state[p]===undefined?d:state[p]}
function post(path,value){return fetch('/api/state',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:path,value:value})}).then(function(r){return r.json()}).then(function(j){log(path+' → '+JSON.stringify(value));return j})}
function render(){
  var g=$('#lights');g.innerHTML='';
  LIGHTS.forEach(function(l){var on=val('/lights/'+l[0],true);var b=document.createElement('button');b.className='btn'+(on?' on':'');b.innerHTML='<span>💡 '+l[1]+'</span><span class="badge">'+(on?'เปิด':'ปิด')+'</span>';
    b.onclick=function(){post('/lights/'+l[0],!on)};g.appendChild(b)});
  var m=$('#meet');m.innerHTML='';
  MEET.forEach(function(id){
    var st=val('/meeting/'+id+'/state','free'),who=val('/meeting/'+id+'/who',''),until=val('/meeting/'+id+'/until',''),n=val('/meeting/'+id+'/count',0);
    var busy=st==='busy';
    var d=document.createElement('div');d.className='row';
    d.innerHTML='<span class="dz" style="background:'+(busy?'var(--bad)':'var(--ok)')+'"></span><b style="min-width:120px">'+id+'</b>'+
      '<span style="color:var(--dim);font-size:12px">'+(busy?(who||'—')+' · ถึง '+(until||'-')+' · '+n+' คน':'ว่าง')+'</span>';
    var b1=document.createElement('button');b1.className='btn';b1.style.minWidth='130px';b1.textContent=busy?'✅ ปล่อยห้อง':'📌 จองห้อง';
    b1.onclick=function(){
      if(busy){post('/meeting/'+id+'/state','free');post('/meeting/'+id+'/who','');post('/meeting/'+id+'/until','');post('/meeting/'+id+'/count',0)}
      else{var who=prompt('จองโดย (ชื่อ/ทีม):','ทีมขาย A')||'ทีมขาย A';var ho=prompt('ถึงกี่โมง (HH:MM):',(function(){var d=new Date(Date.now()+3600000);return ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2)})())||'—';var cn=prompt('จำนวนคน:',4)||4;
        post('/meeting/'+id+'/state','busy');post('/meeting/'+id+'/who',who);post('/meeting/'+id+'/until',ho);post('/meeting/'+id+'/count',+cn||4);}
    };
    d.appendChild(b1);
    for(var k=1;k<=6;k++){ (function(k2){var b=document.createElement('button');b.className='btn';b.style.minWidth='46px';b.textContent=k2;
      b.onclick=function(){post('/meeting/'+id+'/state',k2>0?'busy':'free');post('/meeting/'+id+'/count',k2);post('/meeting/'+id+'/who',busy?(who||'ทีม'):'ทีม');};d.appendChild(b)})(k); }
    m.appendChild(d);
  });
  var p=$('#park');p.innerHTML='';
  for(var i=1;i<=10;i++){(function(n){var occ=val('/parking/slot/'+n+'/occupied',false);var b=document.createElement('button');b.className='btn'+(occ?' on':'');b.innerHTML='<span>🅿 ช่อง '+n+'</span><span class="badge">'+(occ?'มีรถ':'ว่าง')+'</span>';
    b.onclick=function(){post('/parking/slot/'+n+'/occupied',!occ)};p.appendChild(b)})(i)}
  var gv=val('/parking/gate',false);var gb=$('#gate');gb.textContent='ไม้กั้น: '+(gv?'ยก':'ปิด');gb.className='btn'+(gv?' on':'');
  $('#fill').onclick=function(){for(var n=1;n<=8;n++)post('/parking/slot/'+n+'/occupied',true)};
}
function boot(){
  fetch('/api/state').then(function(r){return r.json()}).then(function(j){
    seq=j.seq||0;state=j.state||{};var s=$('#stat');s.textContent='seq '+seq+' · '+Object.keys(state).length+' path · เชื่อมต่อแล้ว';
    render();
  }).catch(function(e){$('#stat').textContent='อ่าน state ไม่ได้: '+e.message});
  if(window.EventSource){var es=new EventSource('/api/state/stream');
    es.addEventListener('state',function(ev){try{var d=JSON.parse(ev.data);if(d.path){state[d.path]=d.value;seq++;render();}
      else if(d.state){state=d.state;render();}}catch(e){}});
    es.onerror=function(){$('#stat').textContent='SSE หลุด — กำลังต่อใหม่…'};}
  $('#gate').onclick=function(){post('/parking/gate',!val('/parking/gate',false))};
}
boot();
</script></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(UI);
  }
  if (url.pathname === '/health') return send(res, 200, { ok: true, seq, paths: Object.keys(state).length });
  if (url.pathname === '/api/state') {
    if (url.pathname && req.method === 'GET' && url.searchParams.get('stream') === '1') {
      /* SSE ทาง query ก็ได้ */
    }
    if (req.method === 'GET' && url.pathname !== '/api/state/stream') {
      if (!auth(req)) return send(res, 401, { error: 'unauthorized' });
      return send(res, 200, { seq, state });
    }
    if (req.method === 'DELETE') { state = {}; seq = 0; return send(res, 200, { ok: true }); }
  }
  if (url.pathname === '/api/state/stream') {
    if (!auth(req)) return send(res, 401, { error: 'unauthorized' });
    res.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive', 'x-accel-buffering': 'no'
    });
    res.write('event: state\ndata: ' + JSON.stringify({ state }) + '\n\n');
    clients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { } }, 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }
  if (url.pathname === '/api/state/batch' && req.method === 'POST') {
    if (!auth(req)) return send(res, 401, { error: 'unauthorized' });
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      let j = {}; try { j = JSON.parse(body || '{}'); } catch (e) { return send(res, 400, { error: 'bad json' }); }
      (j.updates || []).forEach(u => setPath(u.path, u.value, 'api'));
      send(res, 200, { ok: true, seq });
    });
    return;
  }
  if (url.pathname === '/api/state' && req.method === 'POST') {
    if (!auth(req)) return send(res, 401, { error: 'unauthorized' });
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      let j = {}; try { j = JSON.parse(body || '{}'); } catch (e) { return send(res, 400, { error: 'bad json' }); }
      if (!j.path) return send(res, 400, { error: 'path required' });
      setPath(j.path, j.value, 'api');
      send(res, 200, { ok: true, seq, path: j.path, value: j.value });
    });
    return;
  }
  send(res, 404, { error: 'not found' });
});
server.listen(PORT, () => console.log('[office3d-controller] listening on ' + PORT + (TOKEN ? ' (token required)' : '')));
