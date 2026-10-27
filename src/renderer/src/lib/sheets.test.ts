import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { columnName, formatNumber, parseDelimited, readSpreadsheet, readWorkbook } from './sheets'

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** A small workbook, put together the way Excel writes one. */
async function workbook(sheets: { name: string; xml: string; state?: string }[], extra: { strings?: string[]; styles?: string; date1904?: boolean } = {}): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  zip.file(
    'xl/workbook.xml',
    `<workbook ${NS}><workbookPr${extra.date1904 ? ' date1904="1"' : ''}/><sheets>${sheets
      .map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}"${s.state ? ` state="${s.state}"` : ''} r:id="rId${i + 1}"/>`)
      .join('')}</sheets></workbook>`
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join('')}<Relationship Id="rS" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rT" Type="${REL}/styles" Target="styles.xml"/></Relationships>`
  )
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, `<worksheet ${NS}>${s.xml}</worksheet>`))
  zip.file('xl/sharedStrings.xml', `<sst ${NS}>${(extra.strings ?? []).map((t) => `<si>${t}</si>`).join('')}</sst>`)
  zip.file('xl/styles.xml', `<styleSheet ${NS}>${extra.styles ?? '<cellXfs><xf numFmtId="0"/></cellXfs>'}</styleSheet>`)
  return zip.generateAsync({ type: 'uint8array' })
}

const texts = (rows: { text: string }[][]): string[][] => rows.map((r) => r.map((c) => c.text))

describe('parseDelimited', () => {
  it('handles quotes, doubled quotes, line breaks in cells and CRLF', () => {
    expect(parseDelimited('﻿name,note\r\n"Smith, J","said ""hi""\nthen left"\r\nx,')).toEqual([
      ['name', 'note'],
      ['Smith, J', 'said "hi"\nthen left'],
      ['x', '']
    ])
  })
  it('splits on tabs for .tsv', () => {
    expect(parseDelimited('a\tb\n1\t2', '\t')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })
})

describe('columnName', () => {
  it('counts like Excel', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA'])
  })
})

describe('formatNumber', () => {
  it('keeps General numbers free of float noise', () => {
    expect(formatNumber(0.1 + 0.2, undefined)).toBe('0.3')
    expect(formatNumber(42, 'General')).toBe('42')
  })
  it('applies decimals, grouping, percent, currency and scientific formats', () => {
    expect(formatNumber(1234.5, '#,##0.00')).toBe(new Intl.NumberFormat(undefined, { minimumFractionDigits: 2 }).format(1234.5))
    expect(formatNumber(0.256, '0.0%')).toBe(new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(25.6) + '%')
    expect(formatNumber(5, '"$"#,##0')).toBe('$5')
    expect(formatNumber(-5, '[$£-809]#,##0;[Red]-[$£-809]#,##0')).toBe('-£5')
    expect(formatNumber(12345, '0.00E+00')).toBe('1.23E+4')
  })
  it('reads date serials as dates', () => {
    const shown = formatNumber(45356, 'yyyy-mm-dd')
    expect(shown).toBe(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 2, 5))))
    expect(formatNumber(0, 'yyyy-mm-dd', true)).toBe(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(Date.UTC(1904, 0, 1))))
  })
})

describe('readWorkbook', () => {
  it('reads shared strings, numbers, formulas, booleans, errors and gaps', async () => {
    const data = await workbook(
      [
        {
          name: 'Budget',
          xml: `<sheetData>
            <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
            <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>1500.5</v></c><c r="D2" t="b"><v>1</v></c></row>
            <row r="4"><c r="A4" t="inlineStr"><is><t>Total &amp; more</t></is></c><c r="B4" s="1"><f>SUM(B2:B3)</f><v>1500.5</v></c><c r="C4" t="e"><v>#DIV/0!</v></c><c r="E4" s="1"/></row>
          </sheetData>`
        }
      ],
      {
        strings: ['<t>Item</t>', '<t>Cost</t>', '<r><t>Rent</t></r><r><t xml:space="preserve"> (May)</t></r><rPh><t>x</t></rPh>'],
        styles: '<numFmts><numFmt numFmtId="164" formatCode="0.00"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs>'
      }
    )
    const [sheet] = await readWorkbook(data)
    expect(sheet.name).toBe('Budget')
    expect(sheet.cols).toBe(4)
    expect(texts(sheet.rows)).toEqual([['Item', 'Cost'], ['Rent (May)', formatNumber(1500.5, '0.00'), '', 'TRUE'], [], ['Total & more', formatNumber(1500.5, '0.00'), '#DIV/0!']])
    expect(sheet.rows[1][1].num).toBe(true)
  })

  it('keeps every sheet in order, marks hidden ones, and reads column widths', async () => {
    const data = await workbook([
      { name: 'One', xml: '<cols><col min="2" max="3" width="20"/></cols><sheetData><row r="1"><c r="C1"><v>3</v></c></row></sheetData>' },
      { name: 'Two', state: 'hidden', xml: '<sheetData/>' }
    ])
    const sheets = await readWorkbook(data)
    expect(sheets.map((s) => [s.name, !!s.hidden])).toEqual([
      ['One', false],
      ['Two', true]
    ])
    expect(sheets[0].widths?.slice(0, 3)).toEqual([undefined, 20, 20])
    expect(texts(sheets[1].rows)).toEqual([])
  })

  it('says so when the file is not a workbook', async () => {
    await expect(readWorkbook(new TextEncoder().encode('not a zip'))).rejects.toThrow(/Excel workbook/)
  })
})

describe('readSpreadsheet', () => {
  it('reads a CSV file as one sheet named after the file', async () => {
    const data = new TextEncoder().encode('Name,Amount\nTea,3.50\n').buffer as ArrayBuffer
    const [sheet] = await readSpreadsheet('Shopping.csv', data)
    expect(sheet.name).toBe('Shopping')
    expect(texts(sheet.rows)).toEqual([
      ['Name', 'Amount'],
      ['Tea', '3.50']
    ])
    expect(sheet.rows[1][1].num).toBe(true)
  })
})
