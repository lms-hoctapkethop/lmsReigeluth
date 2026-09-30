// Bản cài đặt tham chiếu các hàm thuần của Học cùng nhau 3.0 (docs/06).
// Chạy: node tests/reference/pure.reference.mjs  → in PASS/FAIL cho từng vector.
// Cursor: port sang packages/domain/src/<module>/*.ts, giữ nguyên VECTORS trong Vitest.

// ---------------------------------------------------------------- 1. Chuẩn hóa số (INV-12)
// Trả { ok: true, value: number } hoặc { ok: false, reason }
export function normalizeNumber(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: 'not_string' };
  let s = raw.trim().replace(/−/g, '-').replace(/\s+/g, '');
  if (s === '') return { ok: false, reason: 'empty' };
  // phân số a/b (a, b có thể thập phân kiểu VN)
  const frac = s.match(/^(-?)(\d+(?:[.,]\d+)?)\/(\d+(?:[.,]\d+)?)$/);
  if (frac) {
    const a = Number(frac[2].replace(',', '.')), b = Number(frac[3].replace(',', '.'));
    if (b === 0) return { ok: false, reason: 'division_by_zero' };
    return { ok: true, value: (frac[1] ? -1 : 1) * a / b };
  }
  // dấu phẩy thập phân VN "0,5"; không chấp nhận phân tách hàng nghìn để tránh nhập nhằng "1.000"
  // "1.000", "12.500": ở Việt Nam dấu chấm thường phân tách hàng nghìn → nhập nhằng, yêu cầu nhập lại
  if (/^-?[1-9]\d{0,2}\.\d{3}$/.test(s)) return { ok: false, reason: 'ambiguous_separator' };
  if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { ok: false, reason: 'unparseable' };
  return { ok: true, value: Number(s) };
}

// ---------------------------------------------------------------- 2. Chấm một câu trả lời
// Trả { correct: boolean|null, score: 0..1 }. Ném lỗi VALIDATION khi response sai dạng.
export function gradeResponse(qtype, key, response) {
  switch (qtype) {
    case 'single_choice':
      if (typeof response?.option !== 'string') throw new Error('VALIDATION_FAILED');
      return { correct: response.option === key.option, score: response.option === key.option ? 1 : 0 };
    case 'multi_choice': {
      if (!Array.isArray(response?.options)) throw new Error('VALIDATION_FAILED');
      const picked = new Set(response.options), want = new Set(key.options);
      const tp = [...picked].filter((o) => want.has(o)).length, fp = picked.size - tp;
      const exact = tp === want.size && fp === 0;
      if (key.scoring === 'partial') {
        const score = Math.max(0, (tp - fp) / want.size);
        return { correct: exact, score: round3(score) };
      }
      return { correct: exact, score: exact ? 1 : 0 };
    }
    case 'numeric': {
      const r = normalizeNumber(response?.raw);
      if (!r.ok) throw new Error('VALIDATION_FAILED');
      const targets = [key.value, ...(key.accept ?? [])].map((v) => normalizeNumber(v)).filter((x) => x.ok).map((x) => x.value);
      const tol = key.tolerance ? normalizeNumber(key.tolerance).value : 0;
      const ok = targets.some((t) => Math.abs(t - r.value) <= tol + 1e-9);
      return { correct: ok, score: ok ? 1 : 0 };
    }
    case 'short_text': {
      if (typeof response?.raw !== 'string') throw new Error('VALIDATION_FAILED');
      if (key.manual) return { correct: null, score: 0 };
      const norm = (x) => (key.caseSensitive ? x : x.toLowerCase()).trim().replace(/\s+/g, ' ');
      const ok = key.accept.map(norm).includes(norm(response.raw));
      return { correct: ok, score: ok ? 1 : 0 };
    }
    default:
      throw new Error('UNKNOWN_QTYPE');
  }
}

// ---------------------------------------------------------------- 3. Quan sát từ câu trả lời và review (docs/06 mục 3)
export const WEIGHTS = { review: 1.0, diagnostic: 0.7, exit_ticket: 0.7, practice: 0.6, practice_hint: 0.3, practice_retry: 0.2 };

// response: { purpose, tryNo, hintsUsed, correct, score, provisionalItem }
// Trả null nếu không tạo quan sát.
export function observationFromResponse(r) {
  if (r.correct === null) return null;                          // short_text chấm tay
  if (r.purpose === 'self_assessment' || r.purpose === 'summative') return null;
  let weight;
  if (r.purpose === 'practice') {
    if (r.tryNo > 3) return null;
    weight = r.tryNo >= 3 ? WEIGHTS.practice_retry : r.hintsUsed > 0 ? WEIGHTS.practice_hint : WEIGHTS.practice;
  } else {
    weight = WEIGHTS[r.purpose];
  }
  if (r.provisionalItem) weight = weight / 2;                  // HCN22-13
  return { weight: round3(weight), score: round3(r.score) };
}

// level: meets | developing | not_yet | not_shown ; kcVersionId null → không quan sát (V08)
export function observationFromCriterion(level, kcVersionId) {
  if (!kcVersionId || level === 'not_shown') return null;       // HCN22-12
  const score = { meets: 1, developing: 0.5, not_yet: 0 }[level];
  if (score === undefined) throw new Error('VALIDATION_FAILED');
  return { weight: WEIGHTS.review, score };
}

// ---------------------------------------------------------------- 4. Ước lượng R0 (tệp 08 mục 4.4)
export const R0_VERSION = 'R0@1.0.0';
// obs: [{ sourceType: 'review'|'diagnostic'|'practice'|'exit_ticket', weight, score, hintsUsed, observedAt }]
export function r0Estimate(obs) {
  const n = obs.length;
  if (n < 2) return { status: 'insufficient', value: null, n };
  const w = obs.reduce((s, o) => s + o.weight, 0);
  const value = round4(obs.reduce((s, o) => s + o.weight * o.score, 0) / w);
  const sorted = [...obs].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const lastReview = [...sorted].reverse().find((o) => o.sourceType === 'review');
  const hasNonHint = obs.some((o) => !(o.sourceType === 'practice' && o.hintsUsed > 0));
  if (value < 0.5 || (lastReview && lastReview.score < 0.5)) return { status: 'needs_support', value, n };
  if (value >= 0.8 && n >= 3 && hasNonHint) return { status: 'strong', value, n };
  return { status: 'developing', value, n };
}

// ---------------------------------------------------------------- 5. Hổng gốc (tệp 08 mục 4.5)
// prereq: Map<kc, kc[]> chỉ cạnh approved; status: Map<kc, status>
// Kết quả xác định, không phụ thuộc thứ tự: [{ root, affected: kc[] (sắp xếp), capped }], sắp theo root.
// capped = true khi dừng vì chạm maxDepth mà gốc vẫn còn tiên quyết yếu (B06 → gợi ý GV trao đổi).
export function rootGaps(prereq, status, maxDepth = 3) {
  const groups = new Map();
  for (const [kc, st] of status) {
    if (st !== 'needs_support') continue;
    let cur = kc, depth = 0, capped = false;
    while (true) {
      const weak = (prereq.get(cur) ?? []).filter((p) => status.get(p) === 'needs_support').sort();
      if (weak.length === 0) break;
      if (depth === maxDepth) { capped = true; break; }
      cur = weak[0]; depth++;
    }
    const g = groups.get(cur) ?? { root: cur, affected: [], capped: false };
    g.affected.push(kc); g.capped = g.capped || capped;
    groups.set(cur, g);
  }
  return [...groups.values()].map((g) => ({ ...g, affected: g.affected.sort() })).sort((a, b) => a.root.localeCompare(b.root));
}

// ---------------------------------------------------------------- 6. Độ phủ (tệp 09 mục 4)
// draft: { requirementIds, items: [{ type, questions?: [{kcObservable, qtype, source, approvedBy, hints, purpose}], rubric?: {criteria:[{kcVersionId}]} }] }
// reqKcs: Map<requirementId, { bloom, kcs: string[] }> (chỉ link approved); approvedKcs: Set
export function computeCoverage(draft, reqKcs, approvedKcs) {
  const warnings = [];
  const rows = draft.requirementIds.map((rid) => {
    const r = reqKcs.get(rid) ?? { bloom: null, kcs: [] };
    let choice = 0, product = 0;
    for (const it of draft.items) {
      for (const q of it.questions ?? []) if (q.kcObservable.some((k) => r.kcs.includes(k))) choice++;
      for (const c of it.rubric?.criteria ?? []) if (c.kcVersionId && r.kcs.includes(c.kcVersionId)) product++;
    }
    if (choice + product === 0) warnings.push({ code: 'V01', level: 'block', target: rid });
    else if ((r.bloom ?? 0) >= 5 && product === 0) warnings.push({ code: 'V02', level: 'caution', target: rid });
    return { requirementId: rid, bloom: r.bloom, choiceObservations: choice, productObservations: product };
  });
  const scopeKcs = new Set(draft.requirementIds.flatMap((rid) => reqKcs.get(rid)?.kcs ?? []));
  draft.items.forEach((it, i) => {
    (it.questions ?? []).forEach((q, j) => {
      const t = `item${i}.q${j}`;
      if (it.purpose === 'practice' && (q.hints ?? []).length === 0) warnings.push({ code: 'V03', level: 'caution', target: t });
      if ((q.qtype === 'single_choice' || q.qtype === 'multi_choice') && q.unmappedDistractors > 0) warnings.push({ code: 'V04', level: 'info', target: t });
      if (q.kcObservable.some((k) => !approvedKcs.has(k) || !scopeKcs.has(k))) warnings.push({ code: 'V05', level: 'block', target: t });
      if (q.source === 'ai_proposal' && !q.approvedBy) warnings.push({ code: 'V07', level: 'block', target: t });
    });
    (it.rubric?.criteria ?? []).forEach((c, j) => { if (!c.kcVersionId) warnings.push({ code: 'V08', level: 'caution', target: `item${i}.c${j}` }); });
  });
  return { rows, warnings, blocking: warnings.some((w) => w.level === 'block') };
}

function round3(x) { return Math.round(x * 1000) / 1000; }
function round4(x) { return Math.round(x * 10000) / 10000; }

// ================================================================ VECTORS
const t = (iso) => `2026-10-0${iso}T00:00:00Z`;
export const VECTORS = [
  // normalizeNumber
  ['N01 decimal comma', () => normalizeNumber('0,5'), { ok: true, value: 0.5 }],
  ['N02 fraction', () => normalizeNumber('5/6').value.toFixed(6), '0.833333'],
  ['N03 unicode minus', () => normalizeNumber('−0,75'), { ok: true, value: -0.75 }],
  ['N04 empty is not zero', () => normalizeNumber('  '), { ok: false, reason: 'empty' }],
  ['N05 "1.000" ambiguous (thousands vs decimal)', () => normalizeNumber('1.000'), { ok: false, reason: 'ambiguous_separator' }],
  ['N08 "0.125" is fine', () => normalizeNumber('0.125'), { ok: true, value: 0.125 }],
  ['N09 "2.5" is fine', () => normalizeNumber('2.5'), { ok: true, value: 2.5 }],
  ['N06 letters', () => normalizeNumber('ba'), { ok: false, reason: 'unparseable' }],
  ['N07 div by zero', () => normalizeNumber('1/0'), { ok: false, reason: 'division_by_zero' }],
  // gradeResponse
  ['G01 single correct', () => gradeResponse('single_choice', { option: 'b' }, { option: 'b' }), { correct: true, score: 1 }],
  ['G02 multi all_or_nothing partial pick', () => gradeResponse('multi_choice', { options: ['a', 'c'], scoring: 'all_or_nothing' }, { options: ['a'] }), { correct: false, score: 0 }],
  ['G03 multi partial with wrong pick', () => gradeResponse('multi_choice', { options: ['a', 'c'], scoring: 'partial' }, { options: ['a', 'b'] }), { correct: false, score: 0 }],
  ['G04 multi partial one of two', () => gradeResponse('multi_choice', { options: ['a', 'c'], scoring: 'partial' }, { options: ['c'] }), { correct: false, score: 0.5 }],
  ['G05 numeric fraction vs decimal accept', () => gradeResponse('numeric', { value: '5/6', tolerance: '0.001' }, { raw: '0,8333' }), { correct: true, score: 1 }],
  ['G06 numeric unparseable throws', () => { try { gradeResponse('numeric', { value: '2' }, { raw: 'hai' }); return 'no-throw'; } catch (e) { return e.message; } }, 'VALIDATION_FAILED'],
  ['G07 short_text case-insensitive', () => gradeResponse('short_text', { accept: ['WHERE'], caseSensitive: false }, { raw: '  where ' }), { correct: true, score: 1 }],
  ['G08 short_text manual', () => gradeResponse('short_text', { manual: true }, { raw: 'x' }), { correct: null, score: 0 }],
  // observations
  ['O01 practice first try no hint', () => observationFromResponse({ purpose: 'practice', tryNo: 1, hintsUsed: 0, correct: true, score: 1 }), { weight: 0.6, score: 1 }],
  ['O02 practice with hint (C04)', () => observationFromResponse({ purpose: 'practice', tryNo: 2, hintsUsed: 2, correct: true, score: 1 }), { weight: 0.3, score: 1 }],
  ['O03 practice third try', () => observationFromResponse({ purpose: 'practice', tryNo: 3, hintsUsed: 0, correct: false, score: 0 }), { weight: 0.2, score: 0 }],
  ['O04 practice fourth try ignored', () => observationFromResponse({ purpose: 'practice', tryNo: 4, hintsUsed: 0, correct: true, score: 1 }), null],
  ['O05 diagnostic provisional item halves weight', () => observationFromResponse({ purpose: 'diagnostic', tryNo: 1, hintsUsed: 0, correct: false, score: 0, provisionalItem: true }), { weight: 0.35, score: 0 }],
  ['O06 criterion developing', () => observationFromCriterion('developing', 'kc-if'), { weight: 1, score: 0.5 }],
  ['O07 criterion not_shown (C05)', () => observationFromCriterion('not_shown', 'kc-if'), null],
  ['O08 criterion without KC (V08)', () => observationFromCriterion('meets', null), null],
  // R0
  ['R01 one observation insufficient', () => r0Estimate([{ sourceType: 'practice', weight: 0.6, score: 1, hintsUsed: 0, observedAt: t(1) }]), { status: 'insufficient', value: null, n: 1 }],
  ['R02 low weighted value', () => r0Estimate([
      { sourceType: 'practice', weight: 0.6, score: 0, hintsUsed: 0, observedAt: t(1) },
      { sourceType: 'practice', weight: 0.6, score: 1, hintsUsed: 0, observedAt: t(2) },
      { sourceType: 'diagnostic', weight: 0.7, score: 0, hintsUsed: 0, observedAt: t(3) }]), { status: 'needs_support', value: 0.3158, n: 3 }],
  ['R03 strong', () => r0Estimate([
      { sourceType: 'practice', weight: 0.6, score: 1, hintsUsed: 0, observedAt: t(1) },
      { sourceType: 'diagnostic', weight: 0.7, score: 1, hintsUsed: 0, observedAt: t(2) },
      { sourceType: 'review', weight: 1, score: 1, hintsUsed: 0, observedAt: t(3) }]), { status: 'strong', value: 1, n: 3 }],
  ['R04 only hinted practice cannot be strong', () => r0Estimate([
      { sourceType: 'practice', weight: 0.3, score: 1, hintsUsed: 1, observedAt: t(1) },
      { sourceType: 'practice', weight: 0.3, score: 1, hintsUsed: 2, observedAt: t(2) },
      { sourceType: 'practice', weight: 0.3, score: 1, hintsUsed: 1, observedAt: t(3) }]), { status: 'developing', value: 1, n: 3 }],
  ['R05 last review not_yet overrides high value', () => r0Estimate([
      { sourceType: 'practice', weight: 0.6, score: 1, hintsUsed: 0, observedAt: t(1) },
      { sourceType: 'practice', weight: 0.6, score: 1, hintsUsed: 0, observedAt: t(2) },
      { sourceType: 'practice', weight: 0.6, score: 1, hintsUsed: 0, observedAt: t(3) },
      { sourceType: 'review', weight: 1, score: 0, hintsUsed: 0, observedAt: t(4) }]), { status: 'needs_support', value: 0.6429, n: 4 }],
  ['R06 developing with review developing', () => r0Estimate([
      { sourceType: 'review', weight: 1, score: 0.5, hintsUsed: 0, observedAt: t(1) },
      { sourceType: 'practice', weight: 0.6, score: 1, hintsUsed: 0, observedAt: t(2) }]), { status: 'developing', value: 0.6875, n: 2 }],
  // root gaps: toantu → if → for → list ; io → if
  ['T01 root gap walks back', () => rootGaps(
      new Map([['if', ['io', 'toantu']], ['for', ['if']], ['list', ['for']]]),
      new Map([['toantu', 'needs_support'], ['io', 'strong'], ['if', 'needs_support'], ['for', 'needs_support'], ['list', 'developing']])),
    [{ root: 'toantu', affected: ['for', 'if', 'toantu'], capped: false }]],
  ['T02 depth cap 3 (B06)', () => rootGaps(
      new Map([['e', ['d']], ['d', ['c']], ['c', ['b']], ['b', ['a']]]),
      new Map([['a', 'needs_support'], ['b', 'needs_support'], ['c', 'needs_support'], ['d', 'needs_support'], ['e', 'needs_support']])),
    [{ root: 'a', affected: ['a', 'b', 'c', 'd'], capped: false }, { root: 'b', affected: ['e'], capped: true }]],
  ['T03 order independent', () => {
      const p = new Map([['if', ['io', 'toantu']], ['for', ['if']]]);
      const s1 = new Map([['toantu', 'needs_support'], ['if', 'needs_support'], ['for', 'needs_support'], ['io', 'strong']]);
      const s2 = new Map([...s1].reverse());
      return JSON.stringify(rootGaps(p, s1)) === JSON.stringify(rootGaps(p, s2));
    }, true],
  // coverage
  ['V01 uncovered requirement blocks', () => computeCoverage(
      { requirementIds: ['r1', 'r2'], items: [{ type: 'quiz', purpose: 'practice', questions: [{ kcObservable: ['k1'], qtype: 'single_choice', source: 'teacher', hints: ['h'] }] }] },
      new Map([['r1', { bloom: 3, kcs: ['k1'] }], ['r2', { bloom: 2, kcs: ['k2'] }]]), new Set(['k1', 'k2'])).warnings,
    [{ code: 'V01', level: 'block', target: 'r2' }]],
  ['V02 bloom 6 choice-only cautions', () => computeCoverage(
      { requirementIds: ['r1'], items: [{ type: 'quiz', purpose: 'practice', questions: [{ kcObservable: ['k1'], qtype: 'single_choice', source: 'teacher', hints: ['h'] }] }] },
      new Map([['r1', { bloom: 6, kcs: ['k1'] }]]), new Set(['k1'])).warnings,
    [{ code: 'V02', level: 'caution', target: 'r1' }]],
  ['V05+V07 blocks', () => computeCoverage(
      { requirementIds: ['r1'], items: [{ type: 'quiz', purpose: 'diagnostic', questions: [{ kcObservable: ['k9'], qtype: 'numeric', source: 'ai_proposal' }] }, { type: 'assignment', rubric: { criteria: [{ kcVersionId: 'k1' }, { kcVersionId: null }] } }] },
      new Map([['r1', { bloom: 3, kcs: ['k1'] }]]), new Set(['k1'])).warnings.map((w) => w.code),
    ['V05', 'V07', 'V08']],
];

// ---------------------------------------------------------------- runner
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let fail = 0;
for (const [name, fn, expected] of VECTORS) {
  const got = fn();
  if (eq(got, expected)) console.log('PASS', name);
  else { fail++; console.log('FAIL', name, '\n  expected', JSON.stringify(expected), '\n  got     ', JSON.stringify(got)); }
}
console.log(fail ? `${fail} FAILED` : `ALL ${VECTORS.length} PASS`);
process.exitCode = fail ? 1 : 0;
