import { describe, expect, it } from 'vitest'
import { computeCoverage } from '../authoring/coverage.ts'
import { observationFromCriterion, observationFromResponse } from '../insight/observe.ts'
import { r0Estimate } from '../insight/r0.ts'
import { rootGaps } from '../insight/rootGaps.ts'
import { gradeResponse } from '../quiz/grade.ts'
import { normalizeNumber } from '../quiz/normalize.ts'

const t = (day: number) => `2026-10-0${day}T00:00:00Z`

describe('hàm thuần docs/06', () => {
  it('N01 decimal comma', () => {
    expect(normalizeNumber('0,5')).toEqual({ ok: true, value: 0.5 })
  })
  it('N02 fraction', () => {
    const parsed = normalizeNumber('5/6')
    expect(parsed.ok && parsed.value.toFixed(6)).toBe('0.833333')
  })
  it('N03 unicode minus', () => {
    expect(normalizeNumber('−0,75')).toEqual({ ok: true, value: -0.75 })
  })
  it('N04 empty is not zero', () => {
    expect(normalizeNumber('  ')).toEqual({ ok: false, reason: 'empty' })
  })
  it('N05 "1.000" ambiguous (thousands vs decimal)', () => {
    expect(normalizeNumber('1.000')).toEqual({ ok: false, reason: 'ambiguous_separator' })
  })
  it('N08 "0.125" is fine', () => {
    expect(normalizeNumber('0.125')).toEqual({ ok: true, value: 0.125 })
  })
  it('N09 "2.5" is fine', () => {
    expect(normalizeNumber('2.5')).toEqual({ ok: true, value: 2.5 })
  })
  it('N06 letters', () => {
    expect(normalizeNumber('ba')).toEqual({ ok: false, reason: 'unparseable' })
  })
  it('N07 div by zero', () => {
    expect(normalizeNumber('1/0')).toEqual({ ok: false, reason: 'division_by_zero' })
  })

  it('G01 single correct', () => {
    expect(gradeResponse('single_choice', { option: 'b' }, { option: 'b' })).toEqual({ correct: true, score: 1 })
  })
  it('G02 multi all_or_nothing partial pick', () => {
    expect(gradeResponse('multi_choice', { options: ['a', 'c'], scoring: 'all_or_nothing' }, { options: ['a'] })).toEqual({
      correct: false,
      score: 0,
    })
  })
  it('G03 multi partial with wrong pick', () => {
    expect(gradeResponse('multi_choice', { options: ['a', 'c'], scoring: 'partial' }, { options: ['a', 'b'] })).toEqual({
      correct: false,
      score: 0,
    })
  })
  it('G04 multi partial one of two', () => {
    expect(gradeResponse('multi_choice', { options: ['a', 'c'], scoring: 'partial' }, { options: ['c'] })).toEqual({
      correct: false,
      score: 0.5,
    })
  })
  it('G05 numeric fraction vs decimal accept', () => {
    expect(gradeResponse('numeric', { value: '5/6', tolerance: '0.001' }, { raw: '0,8333' })).toEqual({ correct: true, score: 1 })
  })
  it('G06 numeric unparseable throws', () => {
    expect(() => gradeResponse('numeric', { value: '2' }, { raw: 'hai' })).toThrow('VALIDATION_FAILED')
  })
  it('G07 short_text case-insensitive', () => {
    expect(gradeResponse('short_text', { accept: ['WHERE'], caseSensitive: false }, { raw: '  where ' })).toEqual({
      correct: true,
      score: 1,
    })
  })
  it('G08 short_text manual', () => {
    expect(gradeResponse('short_text', { manual: true }, { raw: 'x' })).toEqual({ correct: null, score: 0 })
  })

  it('O01 practice first try no hint', () => {
    expect(observationFromResponse({ purpose: 'practice', tryNo: 1, hintsUsed: 0, correct: true, score: 1 })).toEqual({
      weight: 0.6,
      score: 1,
    })
  })
  it('O02 practice with hint (C04)', () => {
    expect(observationFromResponse({ purpose: 'practice', tryNo: 2, hintsUsed: 2, correct: true, score: 1 })).toEqual({
      weight: 0.3,
      score: 1,
    })
  })
  it('O03 practice third try', () => {
    expect(observationFromResponse({ purpose: 'practice', tryNo: 3, hintsUsed: 0, correct: false, score: 0 })).toEqual({
      weight: 0.2,
      score: 0,
    })
  })
  it('O04 practice fourth try ignored', () => {
    expect(observationFromResponse({ purpose: 'practice', tryNo: 4, hintsUsed: 0, correct: true, score: 1 })).toBeNull()
  })
  it('O05 diagnostic provisional item halves weight', () => {
    expect(
      observationFromResponse({ purpose: 'diagnostic', tryNo: 1, hintsUsed: 0, correct: false, score: 0, provisionalItem: true }),
    ).toEqual({ weight: 0.35, score: 0 })
  })
  it('O06 criterion developing', () => {
    expect(observationFromCriterion('developing', 'kc-if')).toEqual({ weight: 1, score: 0.5 })
  })
  it('O07 criterion not_shown (C05)', () => {
    expect(observationFromCriterion('not_shown', 'kc-if')).toBeNull()
  })
  it('O08 criterion without KC (V08)', () => {
    expect(observationFromCriterion('meets', null)).toBeNull()
  })

  it('R01 one observation insufficient', () => {
    expect(r0Estimate([{ sourceType: 'practice', weight: 0.6, score: 1, hintsUsed: 0, observedAt: t(1) }])).toEqual({
      status: 'insufficient',
      value: null,
      n: 1,
    })
  })
  it('R02 low weighted value', () => {
    expect(
      r0Estimate([
        { sourceType: 'practice', weight: 0.6, score: 0, hintsUsed: 0, observedAt: t(1) },
        { sourceType: 'practice', weight: 0.6, score: 1, hintsUsed: 0, observedAt: t(2) },
        { sourceType: 'diagnostic', weight: 0.7, score: 0, hintsUsed: 0, observedAt: t(3) },
      ]),
    ).toEqual({ status: 'needs_support', value: 0.3158, n: 3 })
  })
  it('R03 strong', () => {
    expect(
      r0Estimate([
        { sourceType: 'practice', weight: 0.6, score: 1, hintsUsed: 0, observedAt: t(1) },
        { sourceType: 'diagnostic', weight: 0.7, score: 1, hintsUsed: 0, observedAt: t(2) },
        { sourceType: 'review', weight: 1, score: 1, hintsUsed: 0, observedAt: t(3) },
      ]),
    ).toEqual({ status: 'strong', value: 1, n: 3 })
  })
  it('R04 only hinted practice cannot be strong', () => {
    expect(
      r0Estimate([
        { sourceType: 'practice', weight: 0.3, score: 1, hintsUsed: 1, observedAt: t(1) },
        { sourceType: 'practice', weight: 0.3, score: 1, hintsUsed: 2, observedAt: t(2) },
        { sourceType: 'practice', weight: 0.3, score: 1, hintsUsed: 1, observedAt: t(3) },
      ]),
    ).toEqual({ status: 'developing', value: 1, n: 3 })
  })
  it('R05 last review not_yet overrides high value', () => {
    expect(
      r0Estimate([
        { sourceType: 'practice', weight: 0.6, score: 1, hintsUsed: 0, observedAt: t(1) },
        { sourceType: 'practice', weight: 0.6, score: 1, hintsUsed: 0, observedAt: t(2) },
        { sourceType: 'practice', weight: 0.6, score: 1, hintsUsed: 0, observedAt: t(3) },
        { sourceType: 'review', weight: 1, score: 0, hintsUsed: 0, observedAt: t(4) },
      ]),
    ).toEqual({ status: 'needs_support', value: 0.6429, n: 4 })
  })
  it('R06 developing with review developing', () => {
    expect(
      r0Estimate([
        { sourceType: 'review', weight: 1, score: 0.5, hintsUsed: 0, observedAt: t(1) },
        { sourceType: 'practice', weight: 0.6, score: 1, hintsUsed: 0, observedAt: t(2) },
      ]),
    ).toEqual({ status: 'developing', value: 0.6875, n: 2 })
  })

  it('T01 root gap walks back', () => {
    expect(
      rootGaps(
        new Map([
          ['if', ['io', 'toantu']],
          ['for', ['if']],
          ['list', ['for']],
        ]),
        new Map([
          ['toantu', 'needs_support'],
          ['io', 'strong'],
          ['if', 'needs_support'],
          ['for', 'needs_support'],
          ['list', 'developing'],
        ]),
      ),
    ).toEqual([{ root: 'toantu', affected: ['for', 'if', 'toantu'], capped: false }])
  })
  it('T02 depth cap 3 (B06)', () => {
    expect(
      rootGaps(
        new Map([
          ['e', ['d']],
          ['d', ['c']],
          ['c', ['b']],
          ['b', ['a']],
        ]),
        new Map([
          ['a', 'needs_support'],
          ['b', 'needs_support'],
          ['c', 'needs_support'],
          ['d', 'needs_support'],
          ['e', 'needs_support'],
        ]),
      ),
    ).toEqual([
      { root: 'a', affected: ['a', 'b', 'c', 'd'], capped: false },
      { root: 'b', affected: ['e'], capped: true },
    ])
  })
  it('T03 order independent', () => {
    const prereq = new Map([
      ['if', ['io', 'toantu']],
      ['for', ['if']],
    ])
    const first = new Map<string, string>([
      ['toantu', 'needs_support'],
      ['if', 'needs_support'],
      ['for', 'needs_support'],
      ['io', 'strong'],
    ])
    const second = new Map([...first].reverse())
    expect(JSON.stringify(rootGaps(prereq, first))).toBe(JSON.stringify(rootGaps(prereq, second)))
  })

  it('V01 uncovered requirement blocks', () => {
    expect(
      computeCoverage(
        {
          requirementIds: ['r1', 'r2'],
          items: [{ type: 'quiz', purpose: 'practice', questions: [{ kcObservable: ['k1'], qtype: 'single_choice', source: 'teacher', hints: ['h'] }] }],
        },
        new Map([
          ['r1', { bloom: 3, kcs: ['k1'] }],
          ['r2', { bloom: 2, kcs: ['k2'] }],
        ]),
        new Set(['k1', 'k2']),
      ).warnings,
    ).toEqual([{ code: 'V01', level: 'block', target: 'r2' }])
  })
  it('V02 bloom 6 choice-only cautions', () => {
    expect(
      computeCoverage(
        {
          requirementIds: ['r1'],
          items: [{ type: 'quiz', purpose: 'practice', questions: [{ kcObservable: ['k1'], qtype: 'single_choice', source: 'teacher', hints: ['h'] }] }],
        },
        new Map([['r1', { bloom: 6, kcs: ['k1'] }]]),
        new Set(['k1']),
      ).warnings,
    ).toEqual([{ code: 'V02', level: 'caution', target: 'r1' }])
  })
  it('V05+V07 blocks', () => {
    expect(
      computeCoverage(
        {
          requirementIds: ['r1'],
          items: [
            { type: 'quiz', purpose: 'diagnostic', questions: [{ kcObservable: ['k9'], qtype: 'numeric', source: 'ai_proposal' }] },
            { type: 'assignment', rubric: { criteria: [{ kcVersionId: 'k1' }, { kcVersionId: null }] } },
          ],
        },
        new Map([['r1', { bloom: 3, kcs: ['k1'] }]]),
        new Set(['k1']),
      ).warnings.map((warning) => warning.code),
    ).toEqual(['V05', 'V07', 'V08'])
  })
  it('V05 diagnostic direct prereq allowed', () => {
    expect(
      computeCoverage(
        {
          requirementIds: ['r1'],
          items: [{ type: 'quiz', purpose: 'diagnostic', questions: [{ kcObservable: ['k1', 'kp'], qtype: 'single_choice', source: 'teacher', hints: [] }] }],
        },
        new Map([['r1', { bloom: 3, kcs: ['k1'] }]]),
        new Set(['k1', 'kp']),
        new Set(['kp']),
      ).warnings.map((warning) => warning.code),
    ).toEqual([])
  })
  it('V05 practice direct prereq blocks', () => {
    expect(
      computeCoverage(
        {
          requirementIds: ['r1'],
          items: [{ type: 'quiz', purpose: 'practice', questions: [{ kcObservable: ['k1', 'kp'], qtype: 'single_choice', source: 'teacher', hints: ['h'] }] }],
        },
        new Map([['r1', { bloom: 3, kcs: ['k1'] }]]),
        new Set(['k1', 'kp']),
        new Set(['kp']),
      ).warnings.map((warning) => warning.code),
    ).toEqual(['V05'])
  })
})
