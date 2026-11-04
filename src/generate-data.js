'use strict';
/*
 * Seeded synthetic-data generator for the MES Copilot demo.
 * Clean-room: every record here is invented by this script. Shapes follow only
 * public ISA-88 / ISA-95 concepts (see ../../SYNTHETIC-DATA-SPEC.md).
 * Seed is fixed (42) so the dataset is byte-identical on every run.
 */
const fs = require('fs');
const path = require('path');

const SEED = 42;
const DATA_DIR = path.join(__dirname, '..', 'data');

// ---------- deterministic RNG (mulberry32) ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const rand = (min, max) => min + rng() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
function weightedPick(pairs) { // [[value, weight], ...]
  const total = pairs.reduce((s, p) => s + p[1], 0);
  let r = rng() * total;
  for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; }
  return pairs[pairs.length - 1][0];
}
function gauss() { // approx normal via sum of uniforms
  return (rng() + rng() + rng() + rng() - 2) / 2; // -1..1
}

// ---------- calendar helpers (plant-local dates as plain strings) ----------
const START_DATE = '2026-10-05'; // Monday
const DAYS = 30;
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function weekday(dateStr) { return new Date(dateStr + 'T12:00:00Z').getUTCDay(); } // 0 Sun .. 6 Sat
const DATES = Array.from({ length: DAYS }, (_, i) => addDays(START_DATE, i));
const LAST_DATE = DATES[DAYS - 1];
const pad2 = (n) => String(n).padStart(2, '0');
function ts(dateStr, hour, minute) {
  return `${dateStr}T${pad2(hour)}:${pad2(minute)}:00`;
}

// ---------- static master data ----------
const hierarchy = {
  enterprise: { id: 'ENT-01', name: 'Riverbend Fabrication LLC' },
  site: { id: 'SITE-01', name: 'Plant 1 — Riverbend', enterprise_id: 'ENT-01' },
  areas: [
    { id: 'AREA-FAB', name: 'Fabrication', site_id: 'SITE-01' },
    { id: 'AREA-ASM', name: 'Assembly & Pack', site_id: 'SITE-01' }
  ],
  work_centers: [
    { id: 'LINE-1', name: 'Press & Form Line 1', area_id: 'AREA-FAB', downtime_cost_per_min: 38.50, standard_rate_per_hour: 220 },
    { id: 'LINE-2', name: 'Assembly Line 2', area_id: 'AREA-ASM', downtime_cost_per_min: 24.75, standard_rate_per_hour: 340 }
  ],
  work_units: [
    { id: 'PRESS-101', name: 'Stamping Press 101', work_center_id: 'LINE-1', type: 'press' },
    { id: 'FORM-102', name: 'Form Station 102', work_center_id: 'LINE-1', type: 'form' },
    { id: 'QC-103', name: 'Inspection Bench 103', work_center_id: 'LINE-1', type: 'inspection' },
    { id: 'ASM-201', name: 'Assembly Station 201', work_center_id: 'LINE-2', type: 'assembly' },
    { id: 'TORQ-202', name: 'Torque Station 202', work_center_id: 'LINE-2', type: 'torque' },
    { id: 'PACK-203', name: 'Pack-Out 203', work_center_id: 'LINE-2', type: 'pack' }
  ]
};
const LINE_COST = { 'LINE-1': 38.50, 'LINE-2': 24.75 };
const LINE_UNITS = {
  'LINE-1': ['PRESS-101', 'FORM-102', 'QC-103'],
  'LINE-2': ['ASM-201', 'TORQ-202', 'PACK-203']
};

const products = [
  { sku: 'BRK-2041', name: 'Mounting Bracket, 4-hole', work_center_id: 'LINE-1', standard_cycle_sec: 16.4, material: 'CRS coil, 11 ga', lot_size: 500 },
  { sku: 'HSG-1180', name: 'Sensor Housing, stamped', work_center_id: 'LINE-1', standard_cycle_sec: 21.0, material: 'CRS coil, 14 ga', lot_size: 400 },
  { sku: 'PLT-0935', name: 'Cover Plate, 6x4', work_center_id: 'LINE-1', standard_cycle_sec: 12.8, material: 'Aluminum sheet, 0.125 in', lot_size: 600 },
  { sku: 'ASM-3300', name: 'Bracket Assembly, finished', work_center_id: 'LINE-2', standard_cycle_sec: 45.0, material: 'BRK-2041 + hardware kit', lot_size: 250 },
  { sku: 'ASM-3315', name: 'Housing Assembly, finished', work_center_id: 'LINE-2', standard_cycle_sec: 52.5, material: 'HSG-1180 + sensor kit', lot_size: 200 }
];
const LINE_SKUS = { 'LINE-1': ['BRK-2041', 'HSG-1180', 'PLT-0935'], 'LINE-2': ['ASM-3300', 'ASM-3315'] };

const operators = [
  { operator_id: 'OP-01', name: 'Marcus Reed', role: 'lead', home_work_center_id: 'LINE-1', shift_pattern: 'S1', certifications: ['press-op', 'forklift'] },
  { operator_id: 'OP-02', name: 'Priya Nair', role: 'operator', home_work_center_id: 'LINE-1', shift_pattern: 'S1', certifications: ['press-op'] },
  { operator_id: 'OP-03', name: 'Dana Whitfield', role: 'lead', home_work_center_id: 'LINE-1', shift_pattern: 'S2', certifications: ['press-op', 'setup'] },
  { operator_id: 'OP-04', name: 'Tommy Kowalski', role: 'operator', home_work_center_id: 'LINE-1', shift_pattern: 'S2', certifications: ['press-op'] },
  { operator_id: 'OP-05', name: 'Renee Baptiste', role: 'lead', home_work_center_id: 'LINE-1', shift_pattern: 'S3', certifications: ['press-op', 'setup'] },
  { operator_id: 'OP-06', name: 'Sam Delgado', role: 'operator', home_work_center_id: 'LINE-1', shift_pattern: 'S3', certifications: ['forklift'] },
  { operator_id: 'OP-07', name: 'Grace Lindqvist', role: 'lead', home_work_center_id: 'LINE-2', shift_pattern: 'S1', certifications: ['assembly', 'torque-audit'] },
  { operator_id: 'OP-08', name: 'Andre Boateng', role: 'operator', home_work_center_id: 'LINE-2', shift_pattern: 'S1', certifications: ['assembly'] },
  { operator_id: 'OP-09', name: 'Lucia Ferreira', role: 'lead', home_work_center_id: 'LINE-2', shift_pattern: 'S2', certifications: ['assembly', 'setup'] },
  { operator_id: 'OP-10', name: 'Ben Okafor', role: 'operator', home_work_center_id: 'LINE-2', shift_pattern: 'S2', certifications: ['assembly'] },
  { operator_id: 'OP-11', name: 'Hannah Weiss', role: 'lead', home_work_center_id: 'LINE-2', shift_pattern: 'S3', certifications: ['assembly', 'torque-audit'] },
  { operator_id: 'OP-12', name: 'Jorge Medina', role: 'operator', home_work_center_id: 'LINE-2', shift_pattern: 'S3', certifications: ['assembly', 'forklift'] },
  { operator_id: 'OP-13', name: 'Carol Tanaka', role: 'quality tech', home_work_center_id: 'LINE-1', shift_pattern: 'S1', certifications: ['cmm', 'visual-inspection'] },
  { operator_id: 'OP-14', name: 'Earl Pruitt', role: 'maintenance tech', home_work_center_id: 'LINE-1', shift_pattern: 'S2', certifications: ['electrical', 'hydraulics'] }
];
const LEADS = {
  'LINE-1': { S1: 'OP-01', S2: 'OP-03', S3: 'OP-05' },
  'LINE-2': { S1: 'OP-07', S2: 'OP-09', S3: 'OP-11' }
};
const LINE_OPS = {
  'LINE-1': { S1: ['OP-01', 'OP-02'], S2: ['OP-03', 'OP-04'], S3: ['OP-05', 'OP-06'] },
  'LINE-2': { S1: ['OP-07', 'OP-08'], S2: ['OP-09', 'OP-10'], S3: ['OP-11', 'OP-12'] }
};
const SHIFT_START_HOUR = { S1: 6, S2: 14, S3: 22 };

// ---------- shifts (~180 instances) ----------
const shifts = [];
for (const date of DATES) {
  for (const line of ['LINE-1', 'LINE-2']) {
    for (const shift of ['S1', 'S2', 'S3']) {
      shifts.push({
        shift_instance_id: `${date}-${shift}-${line}`,
        date, shift, work_center_id: line,
        lead_operator_id: LEADS[line][shift],
        planned_minutes: 480, break_minutes: 30
      });
    }
  }
}
const shiftById = Object.fromEntries(shifts.map(s => [s.shift_instance_id, s]));
function shiftStartTs(si) {
  const h = SHIFT_START_HOUR[si.shift];
  return ts(si.date, h, 0);
}

// ---------- orders (~300) ----------
const orders = [];
let orderSeq = 10400;
for (let d = 0; d < DAYS; d++) {
  const date = DATES[d];
  const perDay = randInt(9, 11); // ~300 over 30 days
  for (let i = 0; i < perDay; i++) {
    const line = rng() < 0.52 ? 'LINE-1' : 'LINE-2';
    const sku = pick(LINE_SKUS[line]);
    const prod = products.find(p => p.sku === sku);
    const planned = Math.round(rand(0.6, 1.6) * prod.lot_size) * 4;
    const startHour = pick([6, 6, 10, 14, 14, 18, 22]);
    const runHours = Math.max(2, Math.round((planned * prod.standard_cycle_sec) / 3600) + randInt(0, 2));
    const schedStart = ts(date, startHour, pick([0, 0, 15, 30]));
    const endDate = addDays(date, startHour + runHours >= 24 ? 1 : 0);
    const schedEnd = ts(endDate, (startHour + runHours) % 24, pick([0, 15, 30, 45]));
    const isLastDay = d === DAYS - 1;
    let status, produced, scrap, actualStart, actualEnd;
    if (isLastDay) {
      status = weightedPick([['running', 0.45], ['planned', 0.35], ['on_hold', 0.2]]);
      produced = status === 'running' ? Math.floor(planned * rand(0.15, 0.6)) : 0;
      scrap = Math.floor(produced * rand(0.005, 0.03));
      actualStart = status === 'planned' ? null : schedStart;
      actualEnd = null;
    } else {
      const r = rng();
      status = r < 0.85 ? 'complete' : r < 0.93 ? 'late' : 'on_hold';
      produced = status === 'on_hold' ? Math.floor(planned * rand(0.3, 0.8)) : planned - randInt(0, Math.floor(planned * 0.05));
      scrap = Math.floor(planned * rand(0.008, 0.028));
      const lateMin = status === 'late' ? randInt(25, 190) : randInt(-10, 35);
      actualStart = schedStart;
      const end = new Date(schedEnd.replace(' ', 'T') + '');
      const endMs = new Date(`${schedEnd}`).getTime() + lateMin * 60000;
      const e = new Date(endMs);
      actualEnd = `${e.getFullYear()}-${pad2(e.getMonth() + 1)}-${pad2(e.getDate())}T${pad2(e.getHours())}:${pad2(e.getMinutes())}:00`;
      void end;
    }
    orderSeq += randInt(1, 3);
    orders.push({
      order_id: `PO-2026-${orderSeq}`, sku, work_center_id: line,
      planned_qty: planned, produced_qty: produced, scrap_qty: scrap,
      status, priority: rng() < 0.18 ? 'expedite' : 'standard',
      scheduled_start: schedStart, scheduled_end: schedEnd,
      actual_start: actualStart, actual_end: actualEnd
    });
  }
}
const ordersByLineDate = {};
for (const o of orders) {
  const key = `${o.work_center_id}|${o.scheduled_start.slice(0, 10)}`;
  (ordersByLineDate[key] = ordersByLineDate[key] || []).push(o);
}

// ---------- downtime taxonomy ----------
const CAUSES = {
  'EQ-BRK': { cls: 'unplanned_equipment', label: 'Breakdown' },
  'EQ-JAM': { cls: 'unplanned_equipment', label: 'Jam' },
  'EQ-WEAR': { cls: 'unplanned_equipment', label: 'Tooling wear' },
  'EQ-OVHT': { cls: 'unplanned_equipment', label: 'Overheat' },
  'MAT-OUT': { cls: 'unplanned_material', label: 'Stock-out' },
  'MAT-DEF': { cls: 'unplanned_material', label: 'Defective material' },
  'MAT-LATE': { cls: 'unplanned_material', label: 'Late delivery' },
  'QL-HOLD': { cls: 'unplanned_quality', label: 'Quality hold' },
  'QL-REWK': { cls: 'unplanned_quality', label: 'Rework loop' },
  'OP-ABS': { cls: 'unplanned_people_other', label: 'Operator unavailable' },
  'UT-PWR': { cls: 'unplanned_people_other', label: 'Power dip' },
  'IT-SYS': { cls: 'unplanned_people_other', label: 'System / tablet down' },
  'PL-CHG': { cls: 'planned', label: 'Changeover' },
  'PL-PM': { cls: 'planned', label: 'Planned maintenance' },
  'PL-BRK': { cls: 'planned', label: 'No-order gap' }
};
// Distribution skew per spec: equipment ~38%, changeover ~20%, material ~15%, quality ~12%, other ~15%
const CAUSE_WEIGHTS = [
  ['EQ-BRK', 9], ['EQ-JAM', 13], ['EQ-WEAR', 9], ['EQ-OVHT', 7],
  ['MAT-OUT', 6], ['MAT-DEF', 5], ['MAT-LATE', 4],
  ['QL-HOLD', 7], ['QL-REWK', 5],
  ['OP-ABS', 5], ['UT-PWR', 4], ['IT-SYS', 6],
  ['PL-CHG', 20], ['PL-PM', 7], ['PL-BRK', 3]
];
const NOTES = {
  'EQ-BRK': ['press just quit mid-stroke, hydraulics sound bad, called maint', 'drive faulted out and wont reset, motor humming but no motion', 'loud bang from the press then nothing, e-stopped it'],
  'EQ-JAM': ['press kept jamming on the left feed, cleared it 3 times then called maint', 'parts nesting in the die, jam every few minutes', 'feed jam again, same spot as last shift'],
  'EQ-WEAR': ['edges rolling over, punch is worn out, quality dropping', 'die cutting dirty, burr getting worse, swapped to check tooling', 'tooling worn, parts coming out ragged'],
  'EQ-OVHT': ['motor running hot, smelled hot so we shut it down to cool', 'press overheating, temp alarm kept coming in', 'hydraulic oil temp high, stopped before it cooked something'],
  'MAT-OUT': ['ran out of coil, rack is empty, waiting on material handler', 'no hardware kits at the station, line starved', 'out of stock on the small brackets, nothing to run'],
  'MAT-DEF': ['coil from the new lot is splitting on the bend, bad material', 'incoming parts out of spec, holes already off before we touch them', 'material looks wrong, surface rust on half the bundle'],
  'MAT-LATE': ['truck with the coil is late, sitting idle', 'delivery missed the window, no material until it shows', 'supplier load delayed again, line waiting'],
  'QL-HOLD': ['quality put a hold on the last hour of parts, burr over spec', 'hold placed, waiting on QA to disposition the lot', 'first piece failed, lot on hold till quality clears it'],
  'QL-REWK': ['running the rework lot back through, deburr and recheck', 'rework loop on the flagged parts, sorting as we go', 'had to re-run the bad batch through deburr'],
  'OP-ABS': ['operator called out, no cover for the station', 'short handed, one station unmanned for a stretch', 'op went home sick, lead covered when he could'],
  'UT-PWR': ['power blinked and the line faulted, had to restart everything', 'voltage dip reset the press controls', 'lights flickered, machines dropped out for a bit'],
  'IT-SYS': ['tablet froze on the data entry screen, IT had to reboot it', 'system down, couldnt log production, waited on IT', 'scanner and tablet both dead, network issue'],
  'PL-CHG': ['changeover to the other bracket, die swap and first piece', 'changing over, took longer than normal getting first piece approved', 'setup change for the next order, die and fixture swap'],
  'PL-PM': ['planned PM on the press, lube and inspection', 'scheduled maintenance window, filters and checks', 'PM tasks per the board, grease and torque checks'],
  'PL-BRK': ['gap between orders, nothing scheduled to run', 'waiting on the next order release from planning', 'no order on the board for a bit']
};
const ROOT_CAUSES = {
  'EQ-BRK': 'Main drive coupling sheared after fatigue cracking at the keyway.',
  'EQ-JAM': 'Worn feed-roll knurling slipping on coil stock, causing misfeed jams.',
  'EQ-WEAR': 'Punch edge radius worn past the sharpening limit for this die set.',
  'EQ-OVHT': 'Clogged hydraulic cooler fins restricting oil flow and cooling.',
  'MAT-OUT': 'Kanban trigger missed on the prior shift; rack emptied before reorder fired.',
  'MAT-DEF': 'Supplier coil lot with edge cracking from an out-of-spec anneal.',
  'MAT-LATE': 'Supplier truck delayed by a missed dock appointment window.',
  'QL-HOLD': 'Burr height above spec after tooling wear on the trim station.',
  'QL-REWK': 'Upstream burr defect required a deburr-and-recheck loop on the lot.',
  'OP-ABS': 'Unplanned absence with no trained backup on that station.',
  'UT-PWR': 'Momentary utility voltage sag faulted the press drive.',
  'IT-SYS': 'Tablet OS update stalled the data-entry app until IT reimaged it.',
  'PL-CHG': 'Planned die and fixture changeover for the next scheduled order.',
  'PL-PM': 'Scheduled preventive maintenance per the PM board.',
  'PL-BRK': 'Scheduling gap between released orders.'
};
const ACTIONS = {
  'EQ-BRK': 'Replaced coupling; added coupling inspection to monthly PM.',
  'EQ-JAM': 'Replaced feed roll set; added knurling check to weekly PM.',
  'EQ-WEAR': 'Sharpened punch set; logged die-life counter and reset the alert.',
  'EQ-OVHT': 'Cleaned cooler fins; added a monthly blow-down to the PM list.',
  'MAT-OUT': 'Moved the kanban trigger one bin earlier; lead verifies at shift start.',
  'MAT-DEF': 'Quarantined the lot; supplier notified with photos and lot number.',
  'MAT-LATE': 'Dock window rebooked; safety stock raised by one bundle.',
  'QL-HOLD': 'Lot dispositioned by quality; trim station tooling flagged for change.',
  'QL-REWK': 'Lot reworked and re-inspected; upstream cause logged as a wear event.',
  'OP-ABS': 'Cross-training list posted; two backups named per station.',
  'UT-PWR': 'Drive ride-through setting enabled; facilities notified of the sag.',
  'IT-SYS': 'Tablet reimaged; spare tablet staged at the line.',
  'PL-CHG': 'Changeover checklist updated with the first-piece approval step timed.',
  'PL-PM': 'PM completed and signed off on the board.',
  'PL-BRK': 'Planning notified; pull-forward list requested for gaps over 30 min.'
};
function lognormalishMinutes() {
  const m = Math.exp(2.9 + gauss() * 0.75); // median ~18 min
  return Math.max(5, Math.min(180, Math.round(m)));
}

// ---------- downtime events (~480) ----------
const events = [];
let evSeq = 8800;
function makeEvent({ date, line, shift, cause, duration, story }) {
  const si = shiftById[`${date}-${shift}-${line}`];
  const startHour = SHIFT_START_HOUR[shift];
  const offsetMin = randInt(10, 400);
  const absMin = startHour * 60 + offsetMin;
  const evDate = absMin >= 1440 ? addDays(date, 1) : date;
  const start = ts(evDate, Math.floor((absMin % 1440) / 60), absMin % 60);
  const dayOrders = ordersByLineDate[`${line}|${date}`] || [];
  const order = dayOrders.length ? pick(dayOrders) : null;
  const filled = story ? true : rng() < 0.60; // ~60% carry root cause; rest are the unstructured backlog
  evSeq += randInt(1, 4);
  return {
    event_id: `DT-2026-${evSeq}`,
    work_center_id: line,
    work_unit_id: pick(LINE_UNITS[line]),
    shift_instance_id: si.shift_instance_id,
    order_id: order ? order.order_id : null,
    start,
    duration_min: duration,
    class: CAUSES[cause].cls,
    cause_code: cause,
    cost_usd: Math.round(duration * LINE_COST[line] * 100) / 100,
    operator_note: pick(NOTES[cause]),
    root_cause: filled ? ROOT_CAUSES[cause] : null,
    corrective_action: filled ? ACTIONS[cause] : null,
    reported_by: pick(LINE_OPS[line][shift])
  };
}
for (let d = 0; d < DAYS; d++) {
  const date = DATES[d];
  const dayIndex = d;
  const isThursday = weekday(date) === 4;
  for (const line of ['LINE-1', 'LINE-2']) {
    const perLineDay = randInt(7, 9); // ~480 total
    for (let i = 0; i < perLineDay; i++) {
      const shift = pick(['S1', 'S2', 'S3']);
      let cause = weightedPick(CAUSE_WEIGHTS);
      // Story pattern 1: Line 1 jams cluster on S2 (esp. after coil changes)
      if (line === 'LINE-1' && shift === 'S2' && rng() < 0.22) cause = 'EQ-JAM';
      // Story pattern 2: week-3 supplier lot drives a material-defect spike
      if (dayIndex >= 14 && dayIndex <= 20 && line === 'LINE-1' && rng() < 0.16) cause = 'MAT-DEF';
      let duration = lognormalishMinutes();
      // Story pattern 3: Thursday changeovers run long
      if (cause === 'PL-CHG' && isThursday) duration = Math.round(duration * rand(1.45, 1.8));
      if (cause === 'PL-CHG') duration = Math.max(duration, randInt(25, 60));
      events.push(makeEvent({ date, line, shift, cause, duration, story: false }));
    }
  }
  // Story pattern 4: one big breakdown per week
  if ((d + 1) % 7 === 0) {
    const line = rng() < 0.5 ? 'LINE-1' : 'LINE-2';
    events.push(makeEvent({
      date, line, shift: pick(['S1', 'S2']), cause: 'EQ-BRK',
      duration: randInt(120, 235), story: true
    }));
  }
}
events.sort((a, b) => a.start.localeCompare(b.start));

// ---------- inspections (~900) & holds (~40) ----------
const DEFECTS = ['surface_scratch', 'dent', 'hole_missing', 'hole_offcenter', 'bend_angle_off', 'burr', 'crack', 'finish_discolor'];
const inspections = [];
const holds = [];
let qiSeq = 55300, qhSeq = 90;
for (const o of orders) {
  const perOrder = weightedPick([[2, 0.2], [3, 0.6], [4, 0.2]]); // ~3 per order
  const checkpoints = ['first_piece', 'patrol', 'patrol', 'final'].slice(0, perOrder);
  checkpoints.forEach((cp, idx) => {
    const orderDate = o.scheduled_start.slice(0, 10);
    const dayIdx = DATES.indexOf(orderDate);
    let failP = 0.04;
    if (dayIdx >= 14 && dayIdx <= 20 && o.sku === 'BRK-2041') failP = 0.16; // week-3 defect spike
    const failed = rng() < failP;
    const sample = randInt(5, 20);
    const failedQty = failed ? randInt(1, Math.min(4, sample)) : 0;
    const inspHour = Math.min(23, parseInt(o.scheduled_start.slice(11, 13), 10) + idx * 2 + randInt(0, 1));
    qiSeq += randInt(1, 3);
    const insp = {
      inspection_id: `QI-2026-${qiSeq}`,
      order_id: o.order_id,
      checkpoint: cp,
      inspected_at: ts(orderDate, inspHour, randInt(0, 59)),
      inspector_id: rng() < 0.6 ? 'OP-13' : LEADS[o.work_center_id][pick(['S1', 'S2', 'S3'])],
      sample_qty: sample,
      passed_qty: sample - failedQty,
      failed_qty: failedQty,
      defects: failed ? [pick(DEFECTS)] : [],
      photo_ref: null
    };
    inspections.push(insp);
    // Holds grow out of most failed inspections
    if (failed && holds.length < 46 && rng() < 0.85) {
      qhSeq += randInt(1, 3);
      const placed = insp.inspected_at;
      const isRecent = orderDate >= addDays(LAST_DATE, -1);
      const open = isRecent && rng() < 0.6;
      holds.push({
        hold_id: `QH-2026-${String(qhSeq).padStart(4, '0')}`,
        order_id: o.order_id,
        qty_held: randInt(40, 320),
        reason: `${insp.defects[0].replace(/_/g, ' ')} above spec on ${o.sku}, lot around ${placed.slice(11, 16)}`,
        placed_at: placed,
        disposition: open ? null : pick(['release', 'rework', 'rework', 'scrap']),
        released_at: open ? null : ts(orderDate, Math.min(23, inspHour + randInt(1, 3)), randInt(0, 59)),
        released_by: open ? null : 'OP-13'
      });
    }
  });
}
// Top holds up to the spec volume (~40): patrol findings that escalate to a
// lot hold even when the sampled pieces passed.
while (holds.length < 40) {
  const o = orders[randInt(0, orders.length - 1)];
  const orderDate = o.scheduled_start.slice(0, 10);
  const defect = pick(DEFECTS);
  const hour = randInt(7, 21);
  qhSeq += randInt(1, 3);
  const isRecent = orderDate >= addDays(LAST_DATE, -1);
  const open = isRecent && rng() < 0.6;
  holds.push({
    hold_id: `QH-2026-${String(qhSeq).padStart(4, '0')}`,
    order_id: o.order_id,
    qty_held: randInt(40, 320),
    reason: `${defect.replace(/_/g, ' ')} above spec on ${o.sku}, lot around ${pad2(hour)}:00`,
    placed_at: ts(orderDate, hour, randInt(0, 59)),
    disposition: open ? null : pick(['release', 'rework', 'rework', 'scrap']),
    released_at: open ? null : ts(orderDate, Math.min(23, hour + randInt(1, 3)), randInt(0, 59)),
    released_by: open ? null : 'OP-13'
  });
}
inspections.sort((a, b) => a.inspected_at.localeCompare(b.inspected_at));
holds.sort((a, b) => a.placed_at.localeCompare(b.placed_at));

// ---------- write out ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
function write(name, obj) {
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(obj, null, 2) + '\n');
}
write('hierarchy.json', hierarchy);
write('products.json', products);
write('operators.json', operators);
write('shifts.json', shifts);
write('orders.json', orders);
write('downtime_events.json', events);
write('inspections.json', inspections);
write('holds.json', holds);
const meta = {
  generated_at: '2026-11-03T00:00:00-05:00',
  seed: SEED,
  plant: 'Riverbend Fabrication — Plant 1 (fictional)',
  date_range: { start: DATES[0], end: LAST_DATE, days: DAYS },
  demo_today: LAST_DATE,
  counts: {
    areas: hierarchy.areas.length,
    work_centers: hierarchy.work_centers.length,
    work_units: hierarchy.work_units.length,
    products: products.length,
    operators: operators.length,
    shifts: shifts.length,
    orders: orders.length,
    downtime_events: events.length,
    inspections: inspections.length,
    holds: holds.length
  },
  clean_room: 'All records synthetic, generated by src/generate-data.js with seed 42. No real company data.'
};
write('meta.json', meta);
console.log(JSON.stringify(meta.counts, null, 2));
console.log(`Date range ${meta.date_range.start} .. ${meta.date_range.end}; demo today = ${LAST_DATE}`);
