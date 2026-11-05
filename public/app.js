'use strict';
/* MES Copilot front end: rendering + fetch calls only. All business logic
 * (and all arithmetic) lives on the server. */
const $ = (id) => document.getElementById(id);
const money = (n) => '$' + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function jget(url) { const r = await fetch(url); if (!r.ok) throw new Error(await r.text()); return r.json(); }
async function jpost(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

// ---------- health + snapshot ----------
async function loadHealth() {
  try {
    const h = await jget('/api/health');
    const b = $('modeBadge');
    if (h.mode === 'stub') { b.textContent = 'DEMO MODE · Deterministic simulation'; b.className = 'badge'; }
    else { b.textContent = `LIVE · ${h.llm.text_model}`; b.className = 'badge live'; }
  } catch (_) { $('modeBadge').textContent = 'server unreachable'; }
}
async function loadSnapshot() {
  const s = await jget('/api/snapshot');
  $('snapDate').textContent = `· ${s.date}`;
  $('stOrders').textContent = s.orders.scheduled_today;
  $('stProduced').textContent = s.orders.produced_qty.toLocaleString();
  $('stDownMin').textContent = s.downtime.minutes;
  $('stDownCost').textContent = money(s.downtime.cost_usd);
  $('stHolds').textContent = s.holds.open_now;
  const lbl = s.line_labels || { 'LINE-1': 'LINE-1', 'LINE-2': 'LINE-2' };
  $('snapLines').textContent =
    `${lbl['LINE-1']}: ${s.downtime.by_line['LINE-1'].minutes} min down (${money(s.downtime.by_line['LINE-1'].cost)}) · ` +
    `${lbl['LINE-2']}: ${s.downtime.by_line['LINE-2'].minutes} min down (${money(s.downtime.by_line['LINE-2'].cost)}) · ` +
    `${s.holds.placed_today} hold(s) placed today · ${s.inspections.today} inspections today, ${s.inspections.failed_qty} pieces failed` +
    (s.downtime.uncosted_events ? ` · ${s.downtime.uncosted_events} event(s) today lack a cost estimate` : '');
  $('snapTopCauses').innerHTML = s.downtime.top_causes.map(c =>
    `<span class="chip" style="cursor:default">${esc(c.cause_code)} ${esc(c.label)} — ${c.minutes} min · ${money(c.cost)}</span>`).join('');
}

// ---------- Flow A: Vision QC ----------
let selectedSample = null;
async function loadSamples() {
  const { samples } = await jget('/api/samples');
  $('sampleGrid').innerHTML = samples.map(s =>
    `<div class="sample" data-id="${s.id}"><img src="${s.url}" alt="${esc(s.label)}"><span>${esc(s.label)}</span></div>`).join('');
  document.querySelectorAll('.sample').forEach(el => el.addEventListener('click', () => {
    document.querySelectorAll('.sample').forEach(x => x.classList.remove('selected'));
    el.classList.add('selected');
    selectedSample = el.dataset.id;
    $('qcFileName').textContent = '';
    runQc({ sampleId: selectedSample, sku: 'BRK-2041' });
  }));
}
function renderQc(v) {
  const cls = v.verdict === 'pass' ? 'pass' : 'flag';
  $('qcResult').innerHTML = `<div class="result ${cls}">
    <div class="verdict ${cls}">${v.verdict === 'pass' ? '✓ PASS' : '⚠ FLAG'}</div>
    <div style="margin-top:6px"><span class="pill ${esc(v.disposition)}">disposition: ${esc(v.disposition)}</span>
    <span class="pill">confidence: ${v.confidence == null ? '—' : Math.round(v.confidence * 100) + '%'}</span>
    ${v.stub ? '<span class="pill">stub verdict</span>' : ''}${v.cached ? '<span class="pill">cached</span>' : ''}</div>
    ${v.defects && v.defects.length ? `<p><strong>Defects:</strong> ${v.defects.map(esc).join(', ')}</p>` : ''}
    <p>${esc(v.note)}</p>
    <p class="muted">Demo-grade assist only — not a certified inspection.</p></div>`;
}
let qcRequestId = 0;
async function runQc(body) {
  const id = ++qcRequestId;
  $('qcResult').innerHTML = '<div class="result">Checking the part…</div>';
  try {
    const v = await jpost('/api/qc', body);
    if (id === qcRequestId) renderQc(v);
  } catch (e) {
    if (id === qcRequestId) $('qcResult').innerHTML = `<div class="result"><span class="err">${esc(e.message)}</span></div>`;
  }
}
$('qcFile').addEventListener('change', (ev) => {
  const f = ev.target.files[0];
  if (!f) return;
  $('qcFileName').textContent = f.name;
  document.querySelectorAll('.sample').forEach(x => x.classList.remove('selected'));
  selectedSample = null;
  const reader = new FileReader();
  reader.onload = () => runQc({ imageBase64: reader.result, sku: 'BRK-2041' });
  reader.onerror = () => { $('qcResult').innerHTML = '<div class="result"><span class="err">Could not read that photo file — try a different image.</span></div>'; };
  reader.readAsDataURL(f);
});

// ---------- Flow B: Downtime Detective ----------
$('dtExample').addEventListener('click', () => {
  $('dtText').value = 'Press 101 kept jamming on the left feed. We cleared it three times and called maintenance. Line 1 was down for 45 minutes.';
});
$('dtGo').addEventListener('click', async () => {
  const description = $('dtText').value.trim();
  if (!description) { $('dtResult').innerHTML = '<div class="result"><span class="err">Describe the stoppage first — a sentence is enough.</span></div>'; return; }
  $('dtGo').disabled = true;
  $('dtResult').innerHTML = '<div class="result">Structuring the record…</div>';
  try {
    const { record } = await jpost('/api/downtime', { description });
    const filedLabel = record.work_center_id && record.work_unit_id
      ? `Filed record ${esc(record.event_id)}`
      : `Filed record ${esc(record.event_id)} — needs line/equipment confirmation`;
    $('dtResult').innerHTML = `<div class="result">
      <strong>${filedLabel}</strong> ${record.stub ? '<span class="pill">stub mode</span>' : ''}
      ${record.confidence != null ? `<span class="pill">confidence ${Math.round(record.confidence * 100)}%</span>` : ''}
      <dl class="kv">
        <dt>Summary</dt><dd>${esc(record.summary)}</dd>
        <dt>Line / equipment</dt><dd>${esc(record.work_center_id || 'not stated — confirm')} / ${esc(record.work_unit_id || 'not stated — confirm')}</dd>
        <dt>Class / cause</dt><dd>${esc(record.class)} / ${esc(record.cause_code)}</dd>
        <dt>Duration / cost</dt><dd>${record.duration_min} min${record.cost_usd != null ? ' / ' + money(record.cost_usd) : ''}</dd>
        <dt>Operator note</dt><dd>“${esc(record.operator_note)}”</dd>
        <dt>Root cause (draft)</dt><dd>${esc(record.root_cause)}</dd>
        <dt>Corrective action (draft)</dt><dd>${esc(record.corrective_action)}</dd>
      </dl>
      <p class="muted">Saved to the event list — it is already counted in today's snapshot above. Root cause and action are drafts for the lead to confirm.</p></div>`;
    loadSnapshot().catch(() => {}); loadRecent();
  } catch (e) {
    $('dtResult').innerHTML = `<div class="result"><span class="err">${esc(e.message)}</span></div>`;
  } finally { $('dtGo').disabled = false; }
});
async function loadRecent() {
  try {
    const { events, total_filed } = await jget('/api/downtime/recent');
    if (!events.length) { $('dtRecent').innerHTML = ''; return; }
    $('dtRecent').innerHTML = `<p class="muted" style="margin-top:12px"><strong>${total_filed}</strong> stoppage(s) filed through this panel. Most recent: ` +
      events.slice(0, 3).map(e => `${esc(e.event_id)} (${esc(e.cause_code)}, ${e.duration_min} min)`).join(' · ') + '</p>';
  } catch (_) { /* non-fatal */ }
}

// ---------- Flow C: Ask Production + handoff ----------
async function loadChips() {
  const { questions } = await jget('/api/questions');
  $('chips').innerHTML = questions.map(q => `<button class="chip">${esc(q)}</button>`).join('');
  document.querySelectorAll('#chips .chip').forEach(el => el.addEventListener('click', () => { $('askText').value = el.textContent; ask(); }));
}
async function ask() {
  const question = $('askText').value.trim();
  if (!question) {
    $('askResult').innerHTML = '<div class="result"><span class="err">Type a question first, or tap one of the suggestions above.</span></div>';
    return;
  }
  $('askGo').disabled = true;
  $('askResult').innerHTML = '<div class="result">Computing from the production data…</div>';
  try {
    const r = await jpost('/api/ask', { question });
    $('askResult').innerHTML = `<div class="result">
      <p style="margin-top:0">${esc(r.answer)}</p>
      ${r.covered ? `<details><summary class="muted">Computed facts behind this answer</summary><div class="facts">${esc(r.facts)}</div></details>` : ''}
      ${!r.covered && r.suggestions && r.suggestions.length ? `<div class="chips" id="askSuggestions">${r.suggestions.map(q => `<button class="chip">${esc(q)}</button>`).join('')}</div>` : ''}
      ${r.mode === 'stub' ? '<p class="muted">Stub mode: phrasing is a deterministic mock; the facts are real computations over the demo dataset.</p>' : ''}
    </div>`;
    document.querySelectorAll('#askSuggestions .chip').forEach(el => el.addEventListener('click', () => { $('askText').value = el.textContent; ask(); }));
  } catch (e) {
    $('askResult').innerHTML = `<div class="result"><span class="err">${esc(e.message)}</span></div>`;
  } finally { $('askGo').disabled = false; }
}
$('askGo').addEventListener('click', ask);
$('askText').addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });
$('handoffGo').addEventListener('click', async () => {
  $('handoffGo').disabled = true;
  $('handoffResult').innerHTML = '<div class="result">Building the handoff…</div>';
  try {
    const r = await jpost('/api/handoff', {});
    $('handoffResult').innerHTML = `<div class="result">
      <strong>Handoff — ${esc(r.shift_instance_id)}</strong>
      <p>${esc(r.summary)}</p>
      <details><summary class="muted">Computed facts behind this handoff</summary><div class="facts">${esc(r.facts)}</div></details></div>`;
  } catch (e) {
    $('handoffResult').innerHTML = `<div class="result"><span class="err">${esc(e.message)}</span></div>`;
  } finally { $('handoffGo').disabled = false; }
});

// ---------- Help chatbot (documentation knowledge base) ----------
async function loadHelpChips() {
  const { suggestions } = await jget('/api/help/topics');
  $('helpChips').innerHTML = suggestions.map(q => `<button class="chip">${esc(q)}</button>`).join('');
  document.querySelectorAll('#helpChips .chip').forEach(el => el.addEventListener('click', () => { $('helpText').value = el.textContent; askHelp(); }));
}
async function askHelp() {
  const question = $('helpText').value.trim();
  if (!question) {
    $('helpLog').innerHTML = '<div class="result"><span class="err">Type a question first, or tap one of the suggestions above.</span></div>';
    return;
  }
  $('helpGo').disabled = true;
  const prior = $('helpLog').innerHTML;
  $('helpLog').innerHTML = `<div class="result"><p style="margin-top:0"><strong>You:</strong> ${esc(question)}</p><p class="muted">Searching the documentation…</p></div>` + prior;
  try {
    const r = await jpost('/api/help', { question });
    $('helpLog').innerHTML = `<div class="result">
      <p style="margin-top:0"><strong>You:</strong> ${esc(question)}</p>
      <p>${esc(r.answer)}</p>
      ${r.sources && r.sources.length ? `<p class="muted">From the documentation: ${r.sources.map(esc).join(' · ')}</p>` : ''}
      ${r.note ? `<p class="muted">${esc(r.note)}</p>` : ''}
    </div>` + prior;
  } catch (e) {
    $('helpLog').innerHTML = `<div class="result"><span class="err">${esc(e.message)}</span></div>` + prior;
  } finally { $('helpGo').disabled = false; }
}
$('helpGo').addEventListener('click', askHelp);
$('helpText').addEventListener('keydown', (e) => { if (e.key === 'Enter') askHelp(); });

// ---------- Plant Setup (user's own plant profile) ----------
function fillPlantForm(p) {
  const bySlot = Object.fromEntries(p.lines.map(l => [l.slot, l]));
  $('plName').value = p.active ? p.plant_name : '';
  $('plName').placeholder = 'e.g. My Plant — Decatur, AL';
  $('plL1Label').value = bySlot['LINE-1'].label; $('plL1Rate').value = bySlot['LINE-1'].rate; $('plL1Equip').value = bySlot['LINE-1'].equipment.join(', ');
  $('plL2Label').value = bySlot['LINE-2'].label; $('plL2Rate').value = bySlot['LINE-2'].rate; $('plL2Equip').value = bySlot['LINE-2'].equipment.join(', ');
  $('plantName').textContent = p.plant_name;
}
async function loadPlant() {
  try { fillPlantForm(await jget('/api/plant')); } catch (_) { /* non-fatal */ }
}
$('plSave').addEventListener('click', async () => {
  const body = {
    plantName: $('plName').value,
    lines: {
      'LINE-1': { label: $('plL1Label').value, rate: $('plL1Rate').value, equipment: $('plL1Equip').value },
      'LINE-2': { label: $('plL2Label').value, rate: $('plL2Rate').value, equipment: $('plL2Equip').value }
    }
  };
  $('plSave').disabled = true;
  try {
    const p = await jpost('/api/plant', body);
    fillPlantForm(p);
    $('plStatus').innerHTML = `<div class="result"><strong>${esc(p.plant_name)} is live.</strong> New filings will use your line names, equipment, and rates (${p.lines.map(l => `${esc(l.label)} at ${money(l.rate)}/min`).join(' · ')}).${p.persisted === false ? ' Note: the profile is held in memory only on this server right now.' : ''}</div>`;
    loadSnapshot().catch(() => {});
  } catch (e) {
    $('plStatus').innerHTML = `<div class="result"><span class="err">${esc(e.message)}</span></div>`;
  } finally { $('plSave').disabled = false; }
});
$('plReset').addEventListener('click', async () => {
  try {
    const p = await jpost('/api/plant/reset', {});
    fillPlantForm(p);
    $('plStatus').innerHTML = '<div class="result">Back to the Riverbend demo plant — seeded names, equipment, and rates.</div>';
    loadSnapshot().catch(() => {});
  } catch (e) {
    $('plStatus').innerHTML = `<div class="result"><span class="err">${esc(e.message)}</span></div>`;
  }
});

// ---------- boot ----------
loadHealth();
loadPlant();
loadSnapshot().catch(e => { $('snapStats').innerHTML = `<span class="err">${esc(e.message)}</span>`; });
loadSamples().catch(() => { $('sampleGrid').innerHTML = '<p class="err">Could not load the sample photos — is the server running?</p>'; });
loadChips().catch(() => { $('chips').innerHTML = '<span class="err">Could not load the suggested questions — is the server running?</span>'; });
loadHelpChips().catch(() => { $('helpChips').innerHTML = '<span class="err">Could not load the help topics — is the server running?</span>'; });
loadRecent();
