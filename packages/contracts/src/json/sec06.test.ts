import { describe, expect, it } from 'vitest'
import { paragraph, parseRichText } from './rich-text.ts'

const code = (doc: unknown) => parseRichText(doc).ok ? 'ok' : (parseRichText(doc) as { code: string }).code
const link = (href: string) => paragraph('xem', href)

describe('SEC-06', () => {
  it('từ chối rich text độc', () => {
    expect(code(link('javascript:alert(1)'))).toBe('VALIDATION_FAILED')
    expect(code(link('data:text/html,hi'))).toBe('VALIDATION_FAILED')
    expect(code(link('vbscript:msgbox(1)'))).toBe('VALIDATION_FAILED')
    expect(code(link('JavaScript:alert(1)'))).toBe('VALIDATION_FAILED')
    expect(code(link(' javascript:alert(1)'))).toBe('VALIDATION_FAILED')
    expect(code(link('\u0001javascript:alert(1)'))).toBe('VALIDATION_FAILED')
    expect(code({ format: 'hcn-rich/1', blocks: [{ type: 'widget', text: 'no' }] })).toBe('VALIDATION_FAILED')
    expect(code(paragraph('<b>đậm</b>'))).toBe('VALIDATION_FAILED')
    expect(code({ format: 'hcn-rich/1', blocks: [{ type: 'code', language: 'html', text: '<script>alert(1)</script>' }] })).toBe('VALIDATION_FAILED')
    expect(code({ format: 'hcn-rich/1', blocks: [{ type: 'math', tex: '\\href{https://evil.test}{x}' }] })).toBe('VALIDATION_FAILED')
    expect(code({ format: 'hcn-rich/1', blocks: [{ type: 'math', tex: '\\url{https://evil.test}' }] })).toBe('VALIDATION_FAILED')
    expect(code({ format: 'hcn-rich/1', blocks: [{ type: 'math', tex: '\\htmlClass{x}{y}' }] })).toBe('VALIDATION_FAILED')
    expect(code({ format: 'hcn-rich/1', blocks: [{ type: 'image', fileId: '00000000-0000-4000-8000-000000000099', alt: 'ảnh' }] })).toBe('ok')
    expect(code({ format: 'hcn-rich/1', blocks: [{ type: 'image', fileId: '00000000-0000-4000-8000-000000000099', alt: '' }] })).toBe('VALIDATION_FAILED')
    expect(code(paragraph('Phân số \\(a/b\\) an toàn'))).toBe('ok')
  })
})
