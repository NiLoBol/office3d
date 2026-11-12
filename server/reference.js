/* server/reference.js — เซิร์ฟเวอร์ตัวอย่างของสัญญาณ (Node 18+, Express)
   npm i express · TOKEN=secret node server/reference.js
   GET  /api/state · POST /api/state · POST /api/state/batch · GET /api/state/stream (SSE)
   เก็บใน memory — ใช้จริงเปลี่ยนเป็น Redis/Mongo + auth ที่แข็งกว่านี้
*/
const express = require('express');
const app = express();
const TOKEN = process.env.TOKEN || '';
const PORT = process.env.PORT || 8787;

let seq = 0;
const state = Object.create(null);
const clients = new Set();

app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'authorization,content-type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (TOKEN) {
    const h = req.get('authorization') || '';
    if (h !== 'Bearer ' + TOKEN) return res.status(401).json({ error: 'unauthorized' });
  }
  next();
});

function publish(path, value) {
  seq++;
  state[path] = value;
  const ev = 'event: state\ndata: ' + JSON.stringify({ seq, path, value }) + '\n\n';
  for (const res of clients) res.write(ev);
  return { seq, path, value };
}

app.get('/api/state', (req, res) => res.json({ seq, state }));

app.post('/api/state', (req, res) => {
  const { path, value } = req.body || {};
  if (!path) return res.status(400).json({ error: 'path required' });
  res.json(publish(path, value));
});

app.post('/api/state/batch', (req, res) => {
  const updates = (req.body && req.body.updates) || [];
  const out = updates.map(u => publish(u.path, u.value));
  res.json({ seq, updates: out });
});

app.get('/api/state/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('event: hello\ndata: ' + JSON.stringify({ seq }) + '\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});

/* MCP (สาธิตสั้น ๆ): POST /mcp {method, params} → tool เดียวกับ REST */
app.post('/mcp', (req, res) => {
  const { method, params } = req.body || {};
  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    if (name === 'office_state_get') return res.json({ content: [{ type: 'text', text: JSON.stringify({ seq, state }) }] });
    if (name === 'office_state_set') return res.json({ content: [{ type: 'text', text: JSON.stringify(publish(args.path, args.value)) }] });
    if (name === 'office_state_patch') {
      const out = (args.updates || []).map(u => publish(u.path, u.value));
      return res.json({ content: [{ type: 'text', text: JSON.stringify({ seq, updates: out }) }] });
    }
    return res.status(404).json({ error: 'unknown tool ' + name });
  }
  res.json({
    tools: [
      { name: 'office_state_get', description: 'snapshot ทั้งหมด', inputSchema: { type: 'object', properties: {} } },
      { name: 'office_state_set', description: 'ตั้งค่า 1 path', inputSchema: { type: 'object', properties: { path: { type: 'string' }, value: {} } } },
      { name: 'office_state_patch', description: 'ตั้งหลาย path', inputSchema: { type: 'object', properties: { updates: { type: 'array' } } } }
    ]
  });
});

app.listen(PORT, () => console.log('office3d reference API on :' + PORT));
