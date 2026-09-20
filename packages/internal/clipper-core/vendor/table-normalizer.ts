interface SourceRow {
  element: HTMLTableRowElement
  headerSection: boolean
}

interface GridCell {
  text: string
  header: boolean
}

const TABLE_PIPE_PLACEHOLDER = '\uE000'

/**
 * 将浏览器允许但 Markdown 表格无法表达的结构正规化为矩形表格。
 * 该步骤在所有站点适配器之后、Turndown 之前统一执行。
 */
export function normalizeHtmlTables(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const tables = Array.from(document.body.querySelectorAll('table')).reverse()
  for (const table of tables) normalizeTable(table, document)
  return document.body.innerHTML
}

export function restoreTablePipes(markdown: string): string {
  return markdown.replaceAll(TABLE_PIPE_PLACEHOLDER, '\\|')
}

function normalizeTable(table: HTMLTableElement, document: Document): void {
  const rows = directRows(table)
  if (rows.length === 0) {
    table.remove()
    return
  }

  const grid: Array<Array<GridCell | undefined>> = []
  rows.forEach((sourceRow, rowIndex) => {
    grid[rowIndex] ??= []
    let columnIndex = 0
    const cells = Array.from(sourceRow.element.children)
      .filter((cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement)

    for (const cell of cells) {
      while (grid[rowIndex]?.[columnIndex]) columnIndex += 1
      const colspan = safeSpan(cell.colSpan)
      const rowspan = safeSpan(cell.rowSpan)
      const text = cellText(cell)
      const header = sourceRow.headerSection || cell.tagName === 'TH'

      for (let rowOffset = 0; rowOffset < rowspan; rowOffset += 1) {
        const targetRow = rowIndex + rowOffset
        grid[targetRow] ??= []
        for (let columnOffset = 0; columnOffset < colspan; columnOffset += 1) {
          const targetColumn = columnIndex + columnOffset
          if (grid[targetRow]?.[targetColumn]) continue
          grid[targetRow]![targetColumn] = {
            // rowspan 重复内容以保留行语义；colspan 的额外列留空。
            text: columnOffset === 0 ? text : '',
            header,
          }
        }
      }
      columnIndex += colspan
    }
  })

  const columnCount = Math.max(0, ...grid.map((row) => row.length))
  if (columnCount === 0) {
    table.remove()
    return
  }

  const normalized = document.createElement('table')
  const thead = document.createElement('thead')
  const headerRow = document.createElement('tr')
  appendRow(headerRow, grid[0] ?? [], columnCount, true, document)
  thead.appendChild(headerRow)
  normalized.appendChild(thead)

  const tbody = document.createElement('tbody')
  for (const row of grid.slice(1)) {
    const tr = document.createElement('tr')
    appendRow(tr, row, columnCount, false, document)
    tbody.appendChild(tr)
  }
  normalized.appendChild(tbody)
  table.replaceWith(normalized)
}

function directRows(table: HTMLTableElement): SourceRow[] {
  const rows: SourceRow[] = []
  for (const child of Array.from(table.children)) {
    if (child.tagName === 'TR') {
      rows.push({ element: child as HTMLTableRowElement, headerSection: false })
      continue
    }
    if (!['THEAD', 'TBODY', 'TFOOT'].includes(child.tagName)) continue
    for (const row of Array.from(child.children)) {
      if (row.tagName !== 'TR') continue
      rows.push({
        element: row as HTMLTableRowElement,
        headerSection: child.tagName === 'THEAD',
      })
    }
  }
  return rows
}

function appendRow(
  target: HTMLTableRowElement,
  cells: Array<GridCell | undefined>,
  columnCount: number,
  forceHeader: boolean,
  document: Document,
): void {
  for (let index = 0; index < columnCount; index += 1) {
    const source = cells[index]
    const cell = document.createElement(forceHeader || source?.header ? 'th' : 'td')
    cell.textContent = source?.text || ''
    target.appendChild(cell)
  }
}

function cellText(cell: HTMLTableCellElement): string {
  const clone = cell.cloneNode(true) as HTMLTableCellElement
  const ownerDocument = clone.ownerDocument
  clone.querySelectorAll('img').forEach((image) => {
    image.replaceWith(ownerDocument.createTextNode(image.getAttribute('alt')?.trim() || ''))
  })
  clone.querySelectorAll('br').forEach((br) => br.replaceWith(ownerDocument.createTextNode(' ')))
  clone.querySelectorAll('table').forEach((nested) => {
    nested.replaceWith(ownerDocument.createTextNode(nested.textContent || ''))
  })
  clone.querySelectorAll('p, div, section, article, ul, ol, li, pre').forEach((block) => {
    block.before(ownerDocument.createTextNode(' '))
    block.after(ownerDocument.createTextNode(' '))
  })
  return (clone.textContent || '')
    .replace(/\s+/g, ' ')
    .replaceAll('|', TABLE_PIPE_PLACEHOLDER)
    .trim()
}

function safeSpan(value: number): number {
  return Math.max(1, Math.min(50, Number.isFinite(value) ? Math.floor(value) : 1))
}
