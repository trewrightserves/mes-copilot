'use strict';
/*
 * MES Copilot server.
 * Rules honored here:
 *  - ALL production numbers are computed in this file (or not at all).
 *    The LLM only phrases computed facts (Flow C / handoff) or structures /
 *    inspects input (Flows B / A). It never calculates.
 *  - The dataset is synthetic and loaded from ../data at boot.
 *  - META_API_KEY is read from the environment only (see llm.js); with no
 *    key the app runs fully in clearly-marked stub mode.
 */
const fs = require('fs');
const path = require('path');
// Minimal .env loader (no dependency): KEY=VALUE lines from ../.env when the
// file exists. Real environment variables always win. Runs before llm.js is
// required so model/base-URL overrides in .env are honored.
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && m[1] && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
} catch { /* no .env is fine — stub mode or real env vars */ }
const express = require('express');
const llm = require('./llm');
const P = require('./prompts');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, '..', 'data');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const USER_EVENTS_FILE = path.join(DATA_DIR, 'user_downtime_events.json');

// ---------------------------------------------------------------------------
// Load dataset
// ---------------------------------------------------------------------------
function loadJson(name) {
  const p = path.join(DATA_DIR, name);
  if (!fs.existsSync(p)) {
    console.error(`Missing ${name} — run: npm run generate-data`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
const meta = loadJson('meta.json');
const hierarchy = loadJson('hierarchy.json');
const products = loadJson('products.json');
const operators = loadJson('operators.json');
const shifts = loadJson('shifts.json');
const orders = loadJson('orders.json');
const inspections = loadJson('inspections.json');
const holds = loadJson('holds.json');
let userEvents = [];
if (fs.existsSync(USER_EVENTS_FILE)) {
  try { userEvents = JSON.parse(fs.readFileSync(USER_EVENTS_FILE, 'utf8')); } catch (_) { userEvents = []; }
}
const downtimeEvents = [...loadJson('downtime_events.json'), ...userEvents];

const TODAY = meta.demo_today;
const LINE_COST = Object.fromEntries(hierarchy.work_centers.map(w => [w.id, w.downtime_cost_per_min]));
const orderById = Object.fromEntries(orders.map(o => [o.order_id, o]));
const shiftById = Object.fromEntries(shifts.map(s => [s.shift_instance_id, s]));
const money = (n) => `$${Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

// ---------------------------------------------------------------------------
// Vision QC sample manifest (bundled, clearly synthetic images)
// ---------------------------------------------------------------------------
const SAMPLES = [
  { id: 'brk-2041-good', file: 'brk-2041-good.png', label: 'BRK-2041 — known good', sku: 'BRK-2041' },
  { id: 'brk-2041-scratch', file: 'brk-2041-scratch.png', label: 'BRK-2041 — surface scratch (seeded defect)', sku: 'BRK-2041' },
  { id: 'brk-2041-dent', file: 'brk-2041-dent.png', label: 'BRK-2041 — dent (seeded defect)', sku: 'BRK-2041' },
  { id: 'brk-2041-hole-missing', file: 'brk-2041-hole-missing.png', label: 'BRK-2041 — hole missing (seeded defect)', sku: 'BRK-2041' },
  { id: 'brk-2041-crack', file: 'brk-2041-crack.png', label: 'BRK-2041 — crack (seeded defect)', sku: 'BRK-2041' },
  { id: 'brk-2041-burr', file: 'brk-2041-burr.png', label: 'BRK-2041 — burr (seeded defect)', sku: 'BRK-2041' }
];
const sampleById = Object.fromEntries(SAMPLES.map(s => [s.id, s]));
const qcCache = new Map(); // verdicts for bundled samples are cached (credit saver)

// ---------------------------------------------------------------------------
// Date-window helpers (demo "today" = final dataset day)
// ---------------------------------------------------------------------------
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function windowRange(kind) {
  if (kind === 'today') return { start: TODAY, end: TODAY, label: 'today' };
  if (kind === 'week') return { start: addDays(TODAY, -6), end: TODAY, label: 'this week (last 7 days)' };
  return { start: meta.date_range.start, end: TODAY, label: 'this month (the last 30 days)' };
}
const inWindow = (dateStr, w) => dateStr >= w.start && dateStr <= w.end;

// ---------------------------------------------------------------------------
// Flow C — deterministic intent handling + fact computation
// ---------------------------------------------------------------------------
const CAUSE_KEYWORDS = [
  ['EQ-JAM', ['jam']], ['PL-CHG', ['changeover', 'change over', 'change-over']],
  ['EQ-BRK', ['breakdown', 'broke down', 'broken down']], ['EQ-OVHT', ['overheat', 'hot']],
  ['EQ-WEAR', ['wear', 'worn', 'tooling']],
  ['MAT-OUT', ['stock-out', 'stockout', 'stock out', 'ran out', 'out of stock']],
  ['MAT-DEF', ['defective material', 'bad material']],
  ['MAT-LATE', ['late delivery', 'delivery late']],
  ['QL-HOLD', ['quality hold']], ['QL-REWK', ['rework']],
  ['OP-ABS', ['operator unavailable', 'absent', 'called out']],
  ['UT-PWR', ['power dip', 'power']], ['IT-SYS', ['tablet', 'system down']]
];
const CLASS_KEYWORDS = [
  ['unplanned_equipment', ['equipment']],
  ['unplanned_material', ['material']],
  ['unplanned_quality', ['quality']],
  ['planned', ['planned']]
];

function summarizeDowntime(events) {
  const totalMin = events.reduce((s, e) => s + e.duration_min, 0);
  const totalCost = events.reduce((s, e) => s + e.cost_usd, 0);
  const byCause = {};
  for (const e of events) {
    const k = e.cause_code;
    byCause[k] = byCause[k] || { cause_code: k, label: P.CAUSE_LABELS[k] || k, events: 0, minutes: 0, cost: 0 };
    byCause[k].events += 1; byCause[k].minutes += e.duration_min; byCause[k].cost += e.cost_usd;
  }
  const ranked = Object.values(byCause).sort((a, b) => b.minutes - a.minutes);
  return { totalMin, totalCost, count: events.length, ranked };
}

function computeFacts(question) {
  const q = String(question || '').toLowerCase();
  const line = /\bline[\s-]?2\b/.test(q) ? 'LINE-2' : /\bline[\s-]?1\b/.test(q) ? 'LINE-1' : null;
  const win = windowRange(q.includes('today') ? 'today' : q.includes('week') ? 'week' : 'month');

  // Order status by explicit order id
  const poMatch = question.match(/PO-\d{4}-\d+/i);
  if (poMatch) {
    const o = orderById[poMatch[0].toUpperCase()];
    if (!o) return { covered: false, reason: `Order ${poMatch[0].toUpperCase()} is not in the dataset.` };
    return {
      covered: true, kind: 'order',
      facts: [
        `Order ${o.order_id}: SKU ${o.sku} on ${o.work_center_id}.`,
        `Status: ${o.status}. Priority: ${o.priority}.`,
        `Planned quantity ${o.planned_qty}; produced ${o.produced_qty}; scrap ${o.scrap_qty}.`,
        `Scheduled ${o.scheduled_start} to ${o.scheduled_end}.` + (o.actual_end ? ` Actual end ${o.actual_end}.` : ' No actual end recorded yet.')
      ].join('\n')
    };
  }
  // Orders on hold / late
  if (q.includes('order') && (q.includes('hold') || q.includes('held'))) {
    const list = orders.filter(o => o.status === 'on_hold' && (!line || o.work_center_id === line));
    const lines = list.slice(0, 12).map(o => `- ${o.order_id}: SKU ${o.sku} on ${o.work_center_id}, planned ${o.planned_qty}, produced so far ${o.produced_qty}, priority ${o.priority}.`);
    return {
      covered: true, kind: 'orders_on_hold',
      facts: [`${list.length} production orders currently have status on_hold${line ? ` on ${line}` : ''}.`, ...lines].join('\n')
    };
  }
  if (q.includes('order') && q.includes('late')) {
    const list = orders.filter(o => o.status === 'late' && (!line || o.work_center_id === line));
    const lines = list.slice(0, 12).map(o => `- ${o.order_id}: SKU ${o.sku} on ${o.work_center_id}, planned ${o.planned_qty}, produced ${o.produced_qty}, scrap ${o.scrap_qty}, scheduled end ${o.scheduled_end}, actual end ${o.actual_end}.`);
    return {
      covered: true, kind: 'orders_late',
      facts: [`${list.length} production orders finished late${line ? ` on ${line}` : ''} in the dataset.`, ...lines].join('\n')
    };
  }
  // Quality holds
  if (q.includes('hold') || (q.includes('quality') && q.includes('how many'))) {
    const list = holds.filter(h => inWindow(h.placed_at.slice(0, 10), win) && (!line || (orderById[h.order_id] && orderById[h.order_id].work_center_id === line)));
    const open = list.filter(h => !h.released_at).length;
    const qty = list.reduce((s, h) => s + h.qty_held, 0);
    const lines = list.slice(0, 8).map(h => `- ${h.hold_id} on order ${h.order_id}: ${h.qty_held} pcs held, reason "${h.reason}", disposition ${h.disposition || 'still open'}.`);
    return {
      covered: true, kind: 'holds',
      facts: [`${list.length} quality holds were placed ${win.label}${line ? ` on ${line}` : ''}, holding ${qty} pieces total; ${open} of them are still open.`, ...lines].join('\n')
    };
  }
  // Downtime (default production question family)
  const causeHit = CAUSE_KEYWORDS.find(([, words]) => words.some(w => q.includes(w)));
  const classHit = !causeHit && CLASS_KEYWORDS.find(([, words]) => words.some(w => q.includes(w)));
  const downtimeish = q.includes('downtime') || q.includes('stop') || q.includes('cost') || q.includes('cause') || causeHit || classHit || q.includes('down');
  if (downtimeish) {
    let evs = downtimeEvents.filter(e => inWindow(e.start.slice(0, 10), win) && (!line || e.work_center_id === line));
    if (causeHit) evs = evs.filter(e => e.cause_code === causeHit[0]);
    if (classHit) evs = evs.filter(e => e.class === classHit[0]);
    const s = summarizeDowntime(evs);
    const scope = `${line || 'both lines'} ${win.label}${causeHit ? `, cause ${causeHit[0]} (${P.CAUSE_LABELS[causeHit[0]]})` : ''}${classHit ? `, class ${classHit[0]}` : ''}`;
    const factLines = [
      `Scope: ${scope}.`,
      `Total downtime: ${s.totalMin} minutes across ${s.count} recorded stoppages.`,
      `Total downtime cost: ${money(s.totalCost)} (computed at ${line ? money(LINE_COST[line]) : '$38.50 on LINE-1 and $24.75 on LINE-2'} per minute).`
    ];
    if (!causeHit && s.ranked.length) {
      factLines.push('Breakdown by cause (minutes, cost, events):');
      for (const r of s.ranked.slice(0, 6)) {
        factLines.push(`- ${r.cause_code} ${r.label}: ${r.minutes} minutes, ${money(r.cost)}, ${r.events} events.`);
      }
      factLines.push(`Biggest single cause: ${s.ranked[0].cause_code} (${s.ranked[0].label}) at ${s.ranked[0].minutes} minutes and ${money(s.ranked[0].cost)}.`);
    }
    return { covered: true, kind: 'downtime', facts: factLines.join('\n') };
  }
  return { covered: false, reason: 'No matching production intent.' };
}

const UNCOVERED_ANSWER = 'The production data on hand does not cover that question. I can answer from the recorded dataset about: downtime by line, cause, and time window (today, this week, this month) with its cost; which orders are late or on hold; the status of a specific order by its PO number; and quality holds placed in a time window. Try one of the suggested questions below.';

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(express.static(PUBLIC_DIR));

app.get('/api/health', (req, res) => {
  const cfg = llm.config();
  res.json({
    ok: true,
    app: 'mes-copilot',
    plant: meta.plant,
    demo_today: TODAY,
    mode: cfg.stub ? 'stub' : 'live',
    llm: { base_url: cfg.baseUrl, text_model: cfg.textModel, vision_model: cfg.visionModel },
    counts: meta.counts
  });
});

app.get('/api/snapshot', (req, res) => {
  const todaysOrders = orders.filter(o => o.scheduled_start.slice(0, 10) === TODAY);
  const todaysEvents = downtimeEvents.filter(e => e.start.slice(0, 10) === TODAY);
  const dt = summarizeDowntime(todaysEvents);
  const perLine = {};
  for (const line of ['LINE-1', 'LINE-2']) {
    const evs = todaysEvents.filter(e => e.work_center_id === line);
    const s = summarizeDowntime(evs);
    perLine[line] = { events: s.count, minutes: s.totalMin, cost: Math.round(s.totalCost * 100) / 100 };
  }
  const holdsToday = holds.filter(h => h.placed_at.slice(0, 10) === TODAY);
  const openHolds = holds.filter(h => !h.released_at);
  const inspToday = inspections.filter(i => i.inspected_at.slice(0, 10) === TODAY);
  res.json({
    date: TODAY,
    plant: meta.plant,
    orders: {
      scheduled_today: todaysOrders.length,
      by_status: todaysOrders.reduce((acc, o) => { acc[o.status] = (acc[o.status] || 0) + 1; return acc; }, {}),
      planned_qty: todaysOrders.reduce((s, o) => s + o.planned_qty, 0),
      produced_qty: todaysOrders.reduce((s, o) => s + o.produced_qty, 0),
      list: todaysOrders.map(o => ({ order_id: o.order_id, sku: o.sku, line: o.work_center_id, status: o.status, planned_qty: o.planned_qty, produced_qty: o.produced_qty }))
    },
    downtime: { events: dt.count, minutes: dt.totalMin, cost_usd: Math.round(dt.totalCost * 100) / 100, by_line: perLine, top_causes: dt.ranked.slice(0, 3) },
    holds: { placed_today: holdsToday.length, open_now: openHolds.length, open: openHolds.map(h => ({ hold_id: h.hold_id, order_id: h.order_id, qty_held: h.qty_held, reason: h.reason })) },
    inspections: { today: inspToday.length, failed_qty: inspToday.reduce((s, i) => s + i.failed_qty, 0) },
    mode: llm.isStub() ? 'stub' : 'live'
  });
});

// --- Flow B: Downtime Detective -------------------------------------------
app.post('/api/downtime', async (req, res) => {
  const description = (req.body && req.body.description || '').trim();
  if (!description) return res.status(400).json({ error: 'Describe the stoppage first — a sentence is enough.' });
  try {
    const draft = await llm.chatJSON([
      { role: 'system', content: P.DOWNTIME_SYSTEM },
      { role: 'user', content: P.downtimeUser(description, { currentLine: req.body.line || null, shift: req.body.shift || null }) }
    ]);
    const line = draft.line && LINE_COST[draft.line] ? draft.line : (req.body.line && LINE_COST[req.body.line] ? req.body.line : null);
    const duration = Math.max(1, Math.round(Number(draft.estimated_duration_min) || 30));
    const record = {
      event_id: `DT-USER-${String(userEvents.length + 1).padStart(4, '0')}`,
      work_center_id: line,
      work_unit_id: draft.equipment || null,
      shift_instance_id: null,
      order_id: null,
      start: `${TODAY}T${new Date().toTimeString().slice(0, 8)}`,
      duration_min: duration,
      class: draft.class || 'unplanned_equipment',
      cause_code: draft.cause_code || 'EQ-BRK',
      cost_usd: line ? Math.round(duration * LINE_COST[line] * 100) / 100 : null,
      operator_note: description,
      root_cause: draft.root_cause_draft || null,
      corrective_action: draft.corrective_action_draft || null,
      reported_by: 'operator (Flow B)',
      source: 'flow_b_downtime_detective',
      confidence: typeof draft.confidence === 'number' ? draft.confidence : null,
      summary: draft.summary || null,
      stub: !!draft._stub
    };
    userEvents.push(record);
    downtimeEvents.push(record);
    fs.writeFileSync(USER_EVENTS_FILE, JSON.stringify(userEvents, null, 2) + '\n');
    res.json({ record, mode: llm.isStub() ? 'stub' : 'live' });
  } catch (err) {
    res.status(502).json({ error: `Downtime Detective could not file that just now: ${err.message}` });
  }
});

app.get('/api/downtime/recent', (req, res) => {
  res.json({ events: userEvents.slice(-10).reverse(), total_filed: userEvents.length });
});

// --- Flow C: Ask Production ------------------------------------------------
app.post('/api/ask', async (req, res) => {
  const question = (req.body && req.body.question || '').trim();
  if (!question) return res.status(400).json({ error: 'Ask a production question first.' });
  const result = computeFacts(question);
  if (!result.covered) {
    return res.json({ question, covered: false, answer: UNCOVERED_ANSWER, facts: null, suggestions: P.JUDGE_QUESTIONS, mode: llm.isStub() ? 'stub' : 'live' });
  }
  try {
    const answer = await llm.chatText([
      { role: 'system', content: P.ASK_SYSTEM },
      { role: 'user', content: P.askUser(question, result.facts) }
    ]);
    res.json({ question, covered: true, kind: result.kind, answer, facts: result.facts, mode: llm.isStub() ? 'stub' : 'live' });
  } catch (err) {
    // Graceful fallback: the computed facts still answer the question.
    res.json({ question, covered: true, kind: result.kind, answer: result.facts, facts: result.facts, mode: llm.isStub() ? 'stub' : 'live', note: 'Phrasing model unavailable; showing computed facts directly.' });
  }
});

app.get('/api/questions', (req, res) => res.json({ questions: P.JUDGE_QUESTIONS }));

// --- Flow C: shift handoff --------------------------------------------------
app.post('/api/handoff', async (req, res) => {
  // Current shift = the shift instance with the most recent downtime activity today.
  const todays = downtimeEvents.filter(e => e.start.slice(0, 10) === TODAY && e.shift_instance_id);
  let si = todays.length ? shiftById[todays[todays.length - 1].shift_instance_id] : shiftById[`${TODAY}-S2-LINE-1`];
  if (req.body && req.body.shift_instance_id && shiftById[req.body.shift_instance_id]) si = shiftById[req.body.shift_instance_id];
  if (!si) si = shifts[shifts.length - 1];
  const line = si.work_center_id;
  const shiftEvents = downtimeEvents.filter(e => e.shift_instance_id === si.shift_instance_id);
  const s = summarizeDowntime(shiftEvents);
  const dayOrders = orders.filter(o => o.work_center_id === line && o.scheduled_start.slice(0, 10) === TODAY);
  const lineOrderIds = new Set(dayOrders.map(o => o.order_id));
  const lineHolds = holds.filter(h => lineOrderIds.has(h.order_id));
  const openLineHolds = lineHolds.filter(h => !h.released_at);
  const backlog = shiftEvents.filter(e => !e.root_cause).length;
  const facts = [
    `Shift: ${si.shift} on ${line} (${si.date}), lead ${si.lead_operator_id}.`,
    `Orders on ${line} today: ${dayOrders.length} scheduled; ${dayOrders.filter(o => o.status === 'complete').length} complete, ${dayOrders.filter(o => o.status === 'running').length} running, ${dayOrders.filter(o => o.status === 'on_hold').length} on hold, ${dayOrders.filter(o => o.status === 'late').length} late.`,
    `Produced so far on those orders: ${dayOrders.reduce((a, o) => a + o.produced_qty, 0)} pieces against ${dayOrders.reduce((a, o) => a + o.planned_qty, 0)} planned; scrap ${dayOrders.reduce((a, o) => a + o.scrap_qty, 0)}.`,
    `Downtime this shift: ${s.totalMin} minutes across ${s.count} stoppages, costing ${money(s.totalCost)}.` + (s.ranked.length ? ` Biggest: ${s.ranked[0].cause_code} (${s.ranked[0].label}) at ${s.ranked[0].minutes} minutes and ${money(s.ranked[0].cost)}.` : ''),
    `Quality holds touching ${line} today: ${lineHolds.length} placed; ${openLineHolds.length} still open` + (openLineHolds.length ? ` (${openLineHolds.map(h => `${h.hold_id}, ${h.qty_held} pcs`).join('; ')})` : '') + '.',
    `${backlog} stoppage(s) this shift still have no root cause recorded — the incoming lead should chase those first.`
  ].join('\n');
  try {
    const summary = await llm.chatText([
      { role: 'system', content: P.HANDOFF_SYSTEM },
      { role: 'user', content: P.handoffUser(facts) }
    ]);
    res.json({ shift_instance_id: si.shift_instance_id, summary, facts, mode: llm.isStub() ? 'stub' : 'live' });
  } catch (err) {
    res.json({ shift_instance_id: si.shift_instance_id, summary: facts, facts, mode: llm.isStub() ? 'stub' : 'live', note: 'Phrasing model unavailable; showing computed facts directly.' });
  }
});

// --- Flow A: Vision QC -------------------------------------------------------
app.get('/api/samples', (req, res) => {
  res.json({ samples: SAMPLES.map(s => ({ id: s.id, label: s.label, sku: s.sku, url: `/samples/${s.file}` })), demo_grade: true });
});

app.post('/api/qc', async (req, res) => {
  const { sampleId, sku } = req.body || {};
  let imageDataUrl = null;
  let cacheKey = null;
  if (sampleId) {
    const sample = sampleById[sampleId];
    if (!sample) return res.status(400).json({ error: `Unknown sample "${sampleId}".` });
    const file = path.join(PUBLIC_DIR, 'samples', sample.file);
    if (!fs.existsSync(file)) return res.status(500).json({ error: 'Sample image missing on the server.' });
    if (qcCache.has(sampleId) && !llm.isStub()) return res.json({ ...qcCache.get(sampleId), cached: true });
    imageDataUrl = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
    cacheKey = sampleId;
  } else if (req.body && req.body.imageBase64) {
    const raw = String(req.body.imageBase64);
    if (raw.length > 9_000_000) return res.status(413).json({ error: 'Photo is too large for the demo — try a smaller image.' });
    imageDataUrl = raw.startsWith('data:') ? raw : `data:image/jpeg;base64,${raw}`;
  } else {
    return res.status(400).json({ error: 'Provide a sampleId or an imageBase64 photo.' });
  }
  try {
    const verdict = await llm.chatJSON([
      { role: 'system', content: P.VISION_SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: P.visionUser(sku || 'BRK-2041') + (sampleId ? `\n(sample: ${sampleId})` : '') },
          { type: 'image_url', image_url: { url: imageDataUrl } }
        ]
      }
    ], { vision: true, sampleId: sampleId || null });
    const out = {
      verdict: verdict.verdict === 'pass' ? 'pass' : 'flag',
      defects: Array.isArray(verdict.defects) ? verdict.defects : [],
      confidence: typeof verdict.confidence === 'number' ? verdict.confidence : null,
      note: verdict.note || '',
      disposition: ['use', 'rework', 'hold'].includes(verdict.disposition) ? verdict.disposition : 'hold',
      demo_grade: true,
      stub: !!verdict._stub,
      sample: sampleId || null,
      mode: llm.isStub() ? 'stub' : 'live'
    };
    if (cacheKey) qcCache.set(cacheKey, out);
    res.json(out);
  } catch (err) {
    res.status(502).json({ error: `Vision QC could not check that photo just now: ${err.message}` });
  }
});

app.listen(PORT, () => {
  const cfg = llm.config();
  console.log(`MES Copilot listening on http://localhost:${PORT}`);
  console.log(`Plant: ${meta.plant} | demo today: ${TODAY} | orders ${orders.length}, downtime ${downtimeEvents.length}, inspections ${inspections.length}, holds ${holds.length}`);
  console.log(cfg.stub
    ? 'LLM mode: STUB (no META_API_KEY set — deterministic mock responses, clearly marked)'
    : `LLM mode: LIVE via ${cfg.baseUrl} (text ${cfg.textModel}, vision ${cfg.visionModel})`);
});
