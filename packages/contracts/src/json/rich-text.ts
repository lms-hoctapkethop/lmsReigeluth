import katex from 'katex'
import { z } from 'zod'

const htmlLike = /<\/?[a-zA-Z!]/
const control = /[\u0000-\u001F\u007F]/
/** KaTeX 0.18 `trust: false` vẫn render \href/\url và chỉ cảnh báo \htmlClass. Chặn ngay trên nguồn TeX. */
const unsafeTex = /\\(?:href|url|htmlClass)\b/i

export const richLimits = {
  blocks: 100,
  text: 8000,
  code: 20000,
  math: 2000,
  href: 2000,
  table: 10,
} as const

const mark = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('bold') }),
  z.strictObject({ type: z.literal('italic') }),
  z.strictObject({ type: z.literal('code') }),
  z.strictObject({ type: z.literal('link'), href: z.string().max(richLimits.href) }),
])

const textNode = z.strictObject({
  text: z.string().max(richLimits.text),
  marks: z.array(mark).max(4).optional(),
})

const children = z.array(textNode).max(40)

export const richBlock = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('paragraph'), children }),
  z.strictObject({ type: z.literal('heading'), level: z.union([z.literal(2), z.literal(3), z.literal(4)]), children }),
  z.strictObject({
    type: z.literal('list'),
    style: z.enum(['ordered', 'bullet']),
    items: z.array(children).max(40),
  }),
  z.strictObject({
    type: z.literal('code'),
    language: z.enum(['python', 'sql', 'html', 'css', 'text']),
    text: z.string().max(richLimits.code),
  }),
  z.strictObject({ type: z.literal('math'), tex: z.string().min(1).max(richLimits.math) }),
  z.strictObject({ type: z.literal('image'), fileId: z.string().uuid(), alt: z.string().min(1).max(200) }),
  z.strictObject({
    type: z.literal('table'),
    rows: z.array(z.array(z.string().max(500)).max(richLimits.table)).max(richLimits.table),
  }),
  z.strictObject({ type: z.literal('callout'), children }),
])

export const richDoc = z.strictObject({
  format: z.literal('hcn-rich/1'),
  blocks: z.array(richBlock).max(richLimits.blocks),
})

export type RichDoc = z.infer<typeof richDoc>

export type RichParse = { ok: true; doc: RichDoc } | { ok: false; code: 'FEATURE_NOT_ENABLED' | 'VALIDATION_FAILED' }

function hasImage(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(hasImage)
  const record = value as Record<string, unknown>
  if (record.type === 'image') return true
  return Object.values(record).some(hasImage)
}

function httpsLink(href: string): boolean {
  if (control.test(href) || href !== href.trim()) return false
  const lower = href.trim().toLowerCase()
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) return false
  return href.startsWith('https://')
}

function textsOf(doc: RichDoc): string[] {
  const texts: string[] = []
  for (const block of doc.blocks) {
    if (block.type === 'code') texts.push(block.text)
    if (block.type === 'table') for (const row of block.rows) texts.push(...row)
    if (block.type === 'paragraph' || block.type === 'heading' || block.type === 'callout') {
      for (const child of block.children) texts.push(child.text)
    }
    if (block.type === 'list') for (const item of block.items) for (const child of item) texts.push(child.text)
  }
  return texts
}

function linksOf(doc: RichDoc): string[] {
  const hrefs: string[] = []
  for (const block of doc.blocks) {
    const groups = block.type === 'list'
      ? block.items
      : block.type === 'paragraph' || block.type === 'heading' || block.type === 'callout'
        ? [block.children]
        : []
    for (const group of groups) {
      for (const node of group) {
        for (const mark of node.marks ?? []) if (mark.type === 'link') hrefs.push(mark.href)
      }
    }
  }
  return hrefs
}

export function parseRichText(value: unknown): RichParse {
  if (hasImage(value)) return { ok: false, code: 'FEATURE_NOT_ENABLED' }
  const parsed = richDoc.safeParse(value)
  if (!parsed.success) return { ok: false, code: 'VALIDATION_FAILED' }
  if (textsOf(parsed.data).some((text) => htmlLike.test(text))) return { ok: false, code: 'VALIDATION_FAILED' }
  if (linksOf(parsed.data).some((href) => !httpsLink(href))) return { ok: false, code: 'VALIDATION_FAILED' }
  for (const block of parsed.data.blocks) {
    if (block.type !== 'math') continue
    if (unsafeTex.test(block.tex)) return { ok: false, code: 'VALIDATION_FAILED' }
    try {
      const html = katex.renderToString(block.tex, { throwOnError: true, trust: false })
      if (/<a\b|href\s*=|javascript:/i.test(html)) return { ok: false, code: 'VALIDATION_FAILED' }
    } catch {
      return { ok: false, code: 'VALIDATION_FAILED' }
    }
  }
  return { ok: true, doc: parsed.data }
}

export function paragraph(text: string, href?: string): RichDoc {
  return {
    format: 'hcn-rich/1',
    blocks: [{ type: 'paragraph', children: [{ text, ...(href ? { marks: [{ type: 'link' as const, href }] } : {}) }] }],
  }
}
