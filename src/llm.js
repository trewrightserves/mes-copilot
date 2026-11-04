'use strict';
/*
 * Meta Model API (Llama API) client + deterministic stub.
 *
 * Live mode: OpenAI-compatible chat completions against the Meta Llama API.
 *   Base URL : https://api.llama.com/v1   (override: LLAMA_API_BASE_URL)
 *   Endpoint : POST /chat/completions, Authorization: Bearer <META_API_KEY>
 *   Models   : text   Llama-4-Maverick-17B-128E-Instruct-FP8 (override: LLM_TEXT_MODEL)
 *              vision Llama-4-Scout-17B-16E-Instruct-FP8    (override: LLM_VISION_MODEL)
 *   Sources: Meta's model list at llama.developer.meta.com/docs/models as
 *   tabulated by LiteLLM (docs.litellm.ai/docs/providers/meta_llama);
 *   base URL corroborated by langchain-meta (PyPI) and the Llama API docs.
 *   Both Llama 4 models accept text + image input per that list.
 *
 * Stub mode: when META_API_KEY is unset, every call returns a clearly-marked,
 * deterministic mock in the EXACT same shape as the live path, so the whole
 * app runs end to end with no key. Stubs never pretend to be model output:
 * every stub payload carries "_stub": true (JSON flows) or a [STUB MODE]
 * prefix (text flows).
 */
const crypto = require('crypto');

const BASE_URL = (process.env.LLAMA_API_BASE_URL || 'https://api.llama.com/v1').replace(/\/$/, '');
const TEXT_MODEL = process.env.LLM_TEXT_MODEL || 'Llama-4-Maverick-17B-128E-Instruct-FP8';
const VISION_MODEL = process.env.LLM_VISION_MODEL || 'Llama-4-Scout-17B-16E-Instruct-FP8';

function isStub() { return !process.env.META_API_KEY; }
function config() {
  return { stub: isStub(), baseUrl: BASE_URL, textModel: TEXT_MODEL, visionModel: VISION_MODEL };
}
function hashInt(str) {
  const h = crypto.createHash('sha256').update(String(str)).digest();
  return h.readUInt32BE(0);
}
function extractText(messages) {
  return messages.map(m => {
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) return m.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
    return '';
  }).join('\n');
}
function userTextOf(messages) {
  const user = [...messages].reverse().find(m => m.role === 'user');
  if (!user) return '';
  if (typeof user.content === 'string') return user.content;
  if (Array.isArray(user.content)) return user.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
  return '';
}
function flowOf(messages) {
  const sys = messages.find(m => m.role === 'system');
  const text = sys && typeof sys.content === 'string' ? sys.content : '';
  const m = text.match(/FLOW_ID:\s*(\S+)/);
  return m ? m[1] : 'unknown';
}

// ---------------------------------------------------------------------------
// Stub responders — deterministic, same shapes as the live path.
// ---------------------------------------------------------------------------
function stubDowntime(userText) {
  const desc = (userText.match(/Operator description: """([\s\S]*?)"""/) || [, ''])[1].toLowerCase();
  const has = (...words) => words.some(w => desc.includes(w));
  let line = null, equipment = null, cause = 'EQ-BRK', cls = 'unplanned_equipment', confidence = 0.45;
  if (has('changeover', 'change over', 'die swap', 'set up for', 'setup for')) { cause = 'PL-CHG'; cls = 'planned'; confidence = 0.8; }
  else if (has('planned maintenance', ' pm ', 'preventive maintenance')) { cause = 'PL-PM'; cls = 'planned'; confidence = 0.8; }
  else if (has('nothing to run', 'no order', 'gap between orders', 'waiting on planning')) { cause = 'PL-BRK'; cls = 'planned'; confidence = 0.7; }
  else if (has('jam')) { cause = 'EQ-JAM'; confidence = 0.88; }
  else if (has('hot', 'overheat', 'smelled hot', 'temp alarm', 'temperature')) { cause = 'EQ-OVHT'; confidence = 0.82; }
  else if (has('worn', 'wear', 'burr getting worse', 'edges rolling', 'dull')) { cause = 'EQ-WEAR'; confidence = 0.78; }
  else if (has('ran out', 'out of stock', 'no coil', 'rack is empty', 'no kits', 'starved')) { cause = 'MAT-OUT'; cls = 'unplanned_material'; confidence = 0.85; }
  else if (has('bad material', 'defective', 'splitting', 'out of spec', 'rust')) { cause = 'MAT-DEF'; cls = 'unplanned_material'; confidence = 0.8; }
  else if (has('truck', 'delivery', 'late load', 'supplier')) { cause = 'MAT-LATE'; cls = 'unplanned_material'; confidence = 0.75; }
  else if (has('hold', 'quality put', 'qa')) { cause = 'QL-HOLD'; cls = 'unplanned_quality'; confidence = 0.8; }
  else if (has('rework')) { cause = 'QL-REWK'; cls = 'unplanned_quality'; confidence = 0.8; }
  else if (has('called out', 'went home sick', 'short handed', 'short-handed', 'no cover')) { cause = 'OP-ABS'; cls = 'unplanned_people_other'; confidence = 0.8; }
  else if (has('power', 'voltage', 'blink', 'flicker')) { cause = 'UT-PWR'; cls = 'unplanned_people_other'; confidence = 0.82; }
  else if (has('tablet', 'scanner', 'system down', 'network', 'froze')) { cause = 'IT-SYS'; cls = 'unplanned_people_other'; confidence = 0.82; }
  if (has('press')) { line = 'LINE-1'; equipment = 'PRESS-101'; }
  else if (has('form station')) { line = 'LINE-1'; equipment = 'FORM-102'; }
  else if (has('inspection bench', 'qc bench')) { line = 'LINE-1'; equipment = 'QC-103'; }
  else if (has('torque')) { line = 'LINE-2'; equipment = 'TORQ-202'; }
  else if (has('pack')) { line = 'LINE-2'; equipment = 'PACK-203'; }
  else if (has('assembly', 'line 2', 'line two')) { line = 'LINE-2'; equipment = 'ASM-201'; }
  else if (has('line 1', 'line one')) { line = 'LINE-1'; }
  const durMatch = desc.match(/(\d+)\s*(min|minutes|hour|hours|hr)/);
  let duration = 30;
  if (durMatch) {
    duration = parseInt(durMatch[1], 10) * (/hour|hr/.test(durMatch[2]) ? 60 : 1);
  } else if (cause === 'PL-CHG') duration = 45;
  else if (cause === 'EQ-JAM') duration = has('3 times', 'three times', 'kept') ? 45 : 15;
  else if (cause === 'EQ-BRK') duration = 60;
  const ROOTS = {
    'EQ-BRK': 'Drive or mechanical failure consistent with the stop described; needs maintenance confirmation.',
    'EQ-JAM': 'Feed or die misfeed consistent with repeated jams at one spot.',
    'EQ-WEAR': 'Tooling wear past its effective edge life, showing up in part quality.',
    'EQ-OVHT': 'Heat buildup in the drive or hydraulics beyond its normal range.',
    'MAT-OUT': 'Material rack emptied before replenishment was triggered.',
    'MAT-DEF': 'Incoming material condition causing defects at the operation.',
    'MAT-LATE': 'Inbound delivery missed its scheduled window.',
    'QL-HOLD': 'Quality hold placed pending disposition of the affected lot.',
    'QL-REWK': 'Flagged lot being reworked and re-inspected.',
    'OP-ABS': 'Station unmanned with no trained backup available.',
    'UT-PWR': 'Momentary power disturbance faulted the equipment.',
    'IT-SYS': 'Shop-floor system or device unavailable.',
    'PL-CHG': 'Planned changeover to the next scheduled order.',
    'PL-PM': 'Scheduled preventive maintenance.',
    'PL-BRK': 'Scheduling gap with no released order to run.'
  };
  const ACTS = {
    'EQ-BRK': 'Maintenance to inspect and repair; log findings back onto this record.',
    'EQ-JAM': 'Clear and inspect the feed path; check feed-roll condition and log it.',
    'EQ-WEAR': 'Swap or sharpen the tooling and reset the die-life check.',
    'EQ-OVHT': 'Let the unit cool, check coolant/oil and cooler fins before restart.',
    'MAT-OUT': 'Expedite replenishment and move the reorder trigger earlier.',
    'MAT-DEF': 'Quarantine the lot and notify quality with the lot number.',
    'MAT-LATE': 'Confirm the new delivery ETA and resequence the next order if needed.',
    'QL-HOLD': 'Quality to disposition the held lot before any further running.',
    'QL-REWK': 'Complete rework and re-inspection; record the pass/fail count.',
    'OP-ABS': 'Lead to reassign cover and update the cross-training list.',
    'UT-PWR': 'Restart per procedure and notify facilities about the disturbance.',
    'IT-SYS': 'IT to restore the device; stage the spare at the line meanwhile.',
    'PL-CHG': 'Time the first-piece approval step and update the changeover checklist.',
    'PL-PM': 'Complete the PM tasks and sign off on the board.',
    'PL-BRK': 'Ask planning for a pull-forward order for the next gap.'
  };
  return {
    _stub: true,
    line, equipment, class: cls, cause_code: cause,
    estimated_duration_min: duration,
    root_cause_draft: ROOTS[cause],
    corrective_action_draft: ACTS[cause],
    confidence,
    summary: `Stub-filed stoppage (${cause})${line ? ` on ${line}` : ''} estimated at ${duration} minutes.`
  };
}

function stubText(flow, userText) {
  if (flow === 'ask_production') {
    const facts = (userText.split(/COMPUTED FACTS[^\n]*\n/)[1] || '').trim();
    const notCovered = facts.includes('NOT COVERED');
    if (notCovered) {
      return '[STUB MODE] The production data on hand does not cover that question. The facts block lists what can be answered instead — quantities, downtime, cost, order status, and holds over today, this week, or this month.';
    }
    const lines = facts.split('\n').map(s => s.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
    return `[STUB MODE] ${lines.join(' ')}`;
  }
  if (flow === 'shift_handoff') {
    const facts = (userText.split(/COMPUTED FACTS[^\n]*\n/)[1] || userText).trim();
    const lines = facts.split('\n').map(s => s.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
    return `[STUB MODE] Shift handoff: ${lines.join(' ')}`;
  }
  return '[STUB MODE] Deterministic stub response (no META_API_KEY set).';
}

function stubVision(messages, opts) {
  const text = extractText(messages);
  const sample = (opts && opts.sampleId) || (text.match(/sample[:=]\s*([\w-]+)/i) || [])[1] || null;
  const seedStr = sample || String(hashInt(text));
  const DEFECT_BY_SAMPLE = {
    'brk-2041-good': null,
    'brk-2041-scratch': { defects: ['surface_scratch'], disposition: 'rework', note: 'Stub inspection: a visible scratch runs across the bracket face. Surface-only in this sample image.' },
    'brk-2041-dent': { defects: ['dent'], disposition: 'hold', note: 'Stub inspection: a dent is visible near the bracket edge. Set aside for quality to judge depth.' },
    'brk-2041-hole-missing': { defects: ['hole_missing'], disposition: 'hold', note: 'Stub inspection: only three of the four punched holes are present. Do not use.' },
    'brk-2041-crack': { defects: ['crack'], disposition: 'hold', note: 'Stub inspection: a crack line runs from the bend. Structural — hold for quality.' },
    'brk-2041-burr': { defects: ['burr'], disposition: 'rework', note: 'Stub inspection: raised burr along the trimmed edge. Deburr and re-check.' }
  };
  if (sample && Object.prototype.hasOwnProperty.call(DEFECT_BY_SAMPLE, sample)) {
    const d = DEFECT_BY_SAMPLE[sample];
    if (!d) {
      return { _stub: true, verdict: 'pass', defects: [], confidence: 0.93, note: 'Stub inspection: bracket shows four clean holes, straight edges, no visible defect in this sample image.', disposition: 'use', demo_grade: true };
    }
    return { _stub: true, verdict: 'flag', defects: d.defects, confidence: 0.88, note: d.note, disposition: d.disposition, demo_grade: true };
  }
  // Unknown / uploaded image in demo mode: never pass an uninspected upload.
  // Custom photos are not visually analyzed in stub/demo mode, so hold the
  // part (confidence 0) and point at the bundled samples for the demo.
  return { _stub: true, verdict: 'flag', defects: [], confidence: 0, note: 'Custom photos are not visually analyzed in demo mode — no inspection was performed, so this upload is held rather than passed. Select one of the bundled samples for the deterministic inspection demo, or connect META_API_KEY for a real vision check.', disposition: 'hold', demo_grade: true };
}

// ---------------------------------------------------------------------------
// Live call
// ---------------------------------------------------------------------------
async function liveChat(messages, { model, jsonMode, temperature = 0.2, maxTokens = 900 }) {
  const body = { model, messages, temperature, max_tokens: maxTokens };
  if (jsonMode) body.response_format = { type: 'json_object' };
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.META_API_KEY}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Llama API ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  const msg = data && data.choices && data.choices[0] ? data.choices[0].message : null;
  let content = '';
  if (msg) {
    if (typeof msg.content === 'string' && msg.content.trim()) content = msg.content;
    else if (typeof msg.reasoning_content === 'string' && msg.reasoning_content.trim()) content = msg.reasoning_content;
    else if (Array.isArray(msg.content)) {
      content = msg.content.map(p => (p && typeof p.text === 'string') ? p.text : '').join('');
    }
  }
  if (!content || typeof content !== 'string') throw new Error('Llama API returned no text content');
  return content;
}
function parseJsonStrict(content) {
  try { return JSON.parse(content); } catch (_) { /* fall through */ }
  const m = content.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) { /* fall through */ } }
  throw new Error('Model did not return valid JSON');
}

// ---------------------------------------------------------------------------
// Public API (same shape in stub and live modes)
// ---------------------------------------------------------------------------
async function chatJSON(messages, opts = {}) {
  const flow = flowOf(messages);
  if (isStub()) {
    if (flow === 'downtime_detective') return stubDowntime(userTextOf(messages));
    if (flow === 'vision_qc') return stubVision(messages, opts);
    return { _stub: true, note: 'Stub JSON response.' };
  }
  const model = opts.vision ? VISION_MODEL : TEXT_MODEL;
  try {
    const content = await liveChat(messages, { model, jsonMode: true, temperature: opts.temperature ?? 0.1, maxTokens: opts.maxTokens || 2400 });
    return parseJsonStrict(content);
  } catch (err) {
    // Graceful degradation for the downtime flow only: if the live model call
    // fails, file the record with the deterministic parser rather than erroring.
    if (flow === 'downtime_detective') return stubDowntime(userTextOf(messages));
    throw err;
  }
}

async function chatText(messages, opts = {}) {
  const flow = flowOf(messages);
  if (isStub()) return stubText(flow, userTextOf(messages));
  return liveChat(messages, { model: TEXT_MODEL, jsonMode: false, temperature: opts.temperature ?? 0.3, maxTokens: opts.maxTokens || 1600 });
}

module.exports = { chatJSON, chatText, isStub, config, TEXT_MODEL, VISION_MODEL, BASE_URL };
