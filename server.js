require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db');
const { ask, json } = require('./ai');
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
const LANG = { en: 'English', kn: 'Kannada', hi: 'Hindi' };
const FULL = ['description', 'uses', 'parts', 'prep', 'benefits', 'evidence', 'precautions'];
const CARD = ['description', 'uses', 'benefits'];
const wrap = fn => (req, res) => fn(req, res).catch(e => res.status(e.status || 500).json({ error: e.message }));

app.get('/api/stats', (req, res) => res.json({ plants: db.prepare('SELECT COUNT(*) c FROM herbs WHERE enriched=1').get().c, aiEnabled: !!process.env.ANTHROPIC_API_KEY }));

app.get('/api/herbs', (req, res) => {
  const { q = '', type = '', letter = '', ids = '' } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 24, 60), page = Math.max(parseInt(req.query.page) || 1, 1);
  const w = ['enriched=1'], a = [];
  if (q.trim()) { const l = `%${q.trim()}%`; w.push('(en LIKE ? OR sci LIKE ? OR hi LIKE ? OR kn LIKE ? OR uses LIKE ? OR benefits LIKE ?)'); a.push(l, l, l, l, l, l); }
  if (type === 'popular') w.push('popular=1'); else if (/^[a-z_]+$/.test(type)) { w.push('types LIKE ?'); a.push(`%,${type},%`); }
  if (/^[A-Za-z]$/.test(letter)) { w.push('en LIKE ?'); a.push(letter + '%'); }
  const idList = ids.split(',').map(Number).filter(Boolean).slice(0, 200);
  if (ids) { w.push(`id IN (${idList.map(() => '?').join(',') || 'NULL'})`); a.push(...idList); }
  const where = 'WHERE ' + w.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) c FROM herbs ${where}`).get(...a).c;
  const items = db.prepare(`SELECT id, sci, en, hi, kn, types, popular, toxic, image, description, uses, benefits FROM herbs ${where} ORDER BY popular DESC, en LIMIT ? OFFSET ?`).all(...a, limit, (page - 1) * limit);
  res.json({ total, page, pages: Math.ceil(total / limit), items });
});

app.get('/api/herbs/:id', (req, res) => {
  const h = db.prepare('SELECT * FROM herbs WHERE id=?').get(req.params.id);
  h ? res.json(h) : res.status(404).json({ error: 'Plant not found' });
});

app.post('/api/translate', wrap(async (req, res) => {
  const { lang, ids, scope } = req.body || {};
  if (!['kn', 'hi'].includes(lang) || !Array.isArray(ids)) return res.status(400).json({ error: 'Bad request' });
  const sc = scope === 'full' ? 'full' : 'card', fields = sc === 'full' ? FULL : CARD, out = {}, todo = [];
  for (const id of ids.slice(0, 30)) {
    const c = db.prepare('SELECT data FROM translations WHERE herb_id=? AND lang=? AND scope=?').get(id, lang, sc);
    c ? (out[id] = JSON.parse(c.data)) : todo.push(id);
  }
  if (todo.length) {
    const rows = todo.map(id => db.prepare(`SELECT id, ${fields.join(',')} FROM herbs WHERE id=?`).get(id)).filter(Boolean);
    const arr = json(await ask({ max_tokens: 8000, system: `Translate the string values of each object into simple, natural ${LANG[lang]} for ordinary readers. Keep keys and "id" unchanged. Keep scientific (Latin) names unchanged. Return only a JSON array.`, messages: [{ role: 'user', content: JSON.stringify(rows) }] }));
    for (const o of arr) {
      const id = o.id; delete o.id;
      if (!todo.includes(id)) continue;
      out[id] = o;
      db.prepare('INSERT OR REPLACE INTO translations VALUES (?,?,?,?)').run(id, lang, sc, JSON.stringify(o));
    }
  }
  res.json(out);
}));

app.post('/api/identify', wrap(async (req, res) => {
  const { image, lang = 'en' } = req.body || {};
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image || '');
  if (!m) return res.status(400).json({ error: 'Unsupported image. Please use a JPG, PNG or WEBP file.' });
  if (m[2].length > 6.6e6) return res.status(413).json({ error: 'Image is larger than 5 MB.' });
  const L = LANG[lang] || 'English';
  const txt = await ask({ max_tokens: 700, system: 'You identify plants from photos. Reply only with JSON.', messages: [{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
    { type: 'text', text: `Identify the plant, leaf, flower, fruit or ingredient in this image. Prefer Indian medicinal plants when plausible. Reply only with JSON: {"identified":true/false,"common_name":"","scientific_name":"genus and species in Latin","confidence":"low|medium|high","notes":"1-2 simple sentences in ${L} on what you can see and how sure you are; say it is a visual guess"}. If it is not a plant or you cannot tell, set identified to false.` }] }] });
  const r = json(txt);
  const k = String(r.scientific_name || '').toLowerCase().replace(/[^a-z\s-]/g, ' ').trim().split(/\s+/).slice(0, 2).join(' ');
  const match = k ? db.prepare('SELECT id, en, sci FROM herbs WHERE sci_key=? AND enriched=1').get(k) : null;
  res.json({ ...r, match });
}));

app.post('/api/chat', wrap(async (req, res) => {
  const { message, plantId, history = [], lang = 'en' } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'Message is required.' });
  const h = plantId && db.prepare('SELECT en, sci, uses, precautions FROM herbs WHERE id=?').get(plantId);
  const system = 'You are HerbWise AI, a friendly assistant about Indian medicinal plants and Ayurveda. Separate traditional claims from scientific evidence, mention cautions and drug interactions, never diagnose or prescribe, and remind users to consult a qualified health professional. Keep answers concise. Answer in ' + (LANG[lang] || 'English') + '.' +
    (h ? ` The user is viewing ${h.en} (${h.sci}). Traditional uses: ${h.uses}. Precautions: ${h.precautions}.` : '');
  const messages = [...history.slice(-8).filter(x => x && ['user', 'assistant'].includes(x.role) && typeof x.content === 'string'), { role: 'user', content: message.slice(0, 2000) }];
  res.json({ reply: await ask({ system, messages, max_tokens: 700 }) });
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HerbWise AI running at http://localhost:${PORT}`));
