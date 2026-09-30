import { MathTex } from './math.tsx'

type Mark = { type: string; href?: string }
type Node = { text?: string; marks?: Mark[] }

function textOf(nodes: unknown) {
  if (!Array.isArray(nodes)) return null
  return nodes.map((node, index) => {
    const row = node as Node
    const text = row.text ?? ''
    const link = row.marks?.find((mark) => mark.type === 'link')
    if (link?.href?.startsWith('https://')) {
      return <a key={index} href={link.href} rel="noreferrer">{text}</a>
    }
    if (link?.href) return <span key={index}>{text} ({link.href})</span>
    return <span key={index}>{text}</span>
  })
}

function Block({ block }: { block: unknown }) {
  const row = (block ?? {}) as Record<string, unknown>
  if (row.type === 'heading') return <h3>{textOf(row.children)}</h3>
  if (row.type === 'paragraph' || row.type === 'callout') return <p>{textOf(row.children)}</p>
  if (row.type === 'list') {
    const items = Array.isArray(row.items) ? row.items : []
    const Tag = row.style === 'ordered' ? 'ol' : 'ul'
    return <Tag>{items.map((item, index) => <li key={index}>{textOf(item)}</li>)}</Tag>
  }
  if (row.type === 'code') return <pre><code>{String(row.text ?? '')}</code></pre>
  if (row.type === 'math') return <p><MathTex tex={String(row.tex ?? '')} /></p>
  if (row.type === 'image') return <p>{String(row.alt ?? '')}</p>
  if (row.type === 'table') {
    const rows = Array.isArray(row.rows) ? row.rows : []
    return (
      <table>
        <tbody>
          {rows.map((line, index) => (
            <tr key={index}>{(Array.isArray(line) ? line : []).map((cell, cellIndex) => <td key={cellIndex}>{String(cell)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    )
  }
  return <p>{typeof row.text === 'string' ? row.text : ''}</p>
}

export function RichView({ doc }: { doc: unknown }) {
  const blocks = ((doc ?? {}) as { blocks?: unknown[] }).blocks ?? []
  return <div>{blocks.map((block, index) => <Block key={index} block={block} />)}</div>
}
