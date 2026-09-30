import { parse } from 'csv-parse/sync'
import { readFileSync } from 'node:fs'
import { DomainError } from '../errors.ts'
import type { Db } from './support.ts'

export type SeedCurriculumResult = { added: number; updated: number; skipped: number }

const subjectNames: Record<string, string> = { '1401': 'Tin học', '0201': 'Toán' }

type Row = { code791: string; extraction?: string; flags?: string; text: string; source_doc: string }

export async function seedCurriculum(db: Db, filePath: string): Promise<SeedCurriculumResult> {
  const normalized = filePath.replaceAll('\\', '/')
  if (process.env.NODE_ENV === 'production' && normalized.includes('db/seeds/test/')) {
    throw new DomainError('VALIDATION_FAILED', { reason: 'TEST_SEED' })
  }
  const raw = readFileSync(filePath, 'utf8')
  const rows = filePath.endsWith('.json') ? readJson(raw) : readCsv(raw)
  const parsed = rows.map(parseRow)
  const grades = new Map<string, Set<number>>()
  for (const row of parsed) {
    const set = grades.get(row.subject) ?? new Set<number>()
    set.add(row.grade)
    grades.set(row.subject, set)
  }
  const known = await db.selectFrom('subjects').select(['code', 'grades']).execute()
  const knownGrades = new Map(known.map((row) => [row.code, row.grades]))
  for (const [code, gradeSet] of grades) {
    const merged = [...new Set([...(knownGrades.get(code) ?? []), ...gradeSet])].sort((a, b) => a - b)
    await db
      .insertInto('subjects')
      .values({ code, name: subjectNames[code] ?? `Môn ${code}`, grades: merged })
      .onConflict((conflict) => conflict.column('code').doUpdateSet({ name: subjectNames[code] ?? `Môn ${code}`, grades: merged }))
      .execute()
  }
  const existing = await db
    .selectFrom('curriculum_requirements')
    .select(['code791_stem', 'text', 'review_status', 'bloom_level', 'extraction', 'extraction_flags'])
    .execute()
  const byStem = new Map(existing.map((row) => [row.code791_stem, row]))
  let added = 0
  let updated = 0
  let skipped = 0
  for (const row of parsed) {
    const current = byStem.get(row.stem)
    if (current?.review_status === 'approved') {
      skipped += 1
      continue
    }
    if (!current) {
      await db
        .insertInto('curriculum_requirements')
        .values({
          code791_stem: row.stem,
          bloom_level: row.bloom,
          subject_code: row.subject,
          grade: row.grade,
          unit1: row.unit1,
          unit2: row.unit2,
          text: row.text,
          topic_label: null,
          orientation: null,
          source_doc: row.sourceDoc,
          source_locator: null,
          extraction: row.extraction,
          extraction_flags: row.flags,
          review_status: 'unverified',
          reviewed_by: null,
          reviewed_at: null,
        })
        .execute()
      added += 1
      continue
    }
    const sameFlags = JSON.stringify(current.extraction_flags) === JSON.stringify(row.flags)
    if (current.text === row.text && current.bloom_level === row.bloom && current.extraction === row.extraction && sameFlags) {
      skipped += 1
      continue
    }
    await db
      .updateTable('curriculum_requirements')
      .set({ text: row.text, bloom_level: row.bloom, source_doc: row.sourceDoc, extraction: row.extraction, extraction_flags: row.flags })
      .where('code791_stem', '=', row.stem)
      .where('review_status', '<>', 'approved')
      .execute()
    updated += 1
  }
  return { added, updated, skipped }
}

function readCsv(raw: string): Row[] {
  return parse(raw, { columns: true, skip_empty_lines: true, bom: true }) as Row[]
}

function readJson(raw: string): Row[] {
  const parsed = JSON.parse(raw) as Row[] | { requirements: Row[] }
  return Array.isArray(parsed) ? parsed : parsed.requirements
}

function parseRow(row: Row): {
  stem: string
  bloom: number | null
  subject: string
  grade: number
  unit1: string
  unit2: string
  text: string
  sourceDoc: string
  extraction: 'clean' | 'check'
  flags: string[]
} {
  const match = /^([0-9]{4})([0-9]{2})\.([0-9]{2})([0-9]{2})([a-z])([1-6])?$/.exec((row.code791 ?? '').trim())
  if (!match) throw new DomainError('VALIDATION_FAILED', { reason: 'BAD_CODE791' })
  const subject = match[1] ?? ''
  const gradeText = match[2] ?? ''
  const unit1 = match[3] ?? ''
  const unit2 = match[4] ?? ''
  const letter = match[5] ?? ''
  const bloom = match[6] ? Number(match[6]) : null
  const extraction = row.extraction === 'check' ? 'check' : 'clean'
  const flags = (row.flags ?? '')
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return {
    stem: `${subject}${gradeText}.${unit1}${unit2}${letter}`,
    bloom,
    subject,
    grade: Number(gradeText),
    unit1,
    unit2,
    text: row.text ?? '',
    sourceDoc: row.source_doc ?? '',
    extraction,
    flags,
  }
}

