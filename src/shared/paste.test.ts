import { describe, expect, it } from 'vitest'
import { decodeEntities, linkText, tableFromTsv, titleFromHtml } from './paste'

describe('tables from Excel', () => {
  it('turns tab-separated rows into a markdown table', () => {
    expect(tableFromTsv('Name\tAge\r\nSam\t30\r\nJo | Lee\t\r\n')).toBe('| Name | Age |\n| --- | --- |\n| Sam | 30 |\n| Jo \\| Lee |   |')
  })
  it('leaves ordinary text alone', () => {
    expect(tableFromTsv('just one line\twith a tab')).toBeNull()
    expect(tableFromTsv('two\nlines')).toBeNull()
    expect(tableFromTsv('a\tb\nc')).toBeNull()
  })
})

describe('page titles', () => {
  it('prefers og:title, then <title>', () => {
    expect(titleFromHtml('<head><meta property="og:title" content="Nice &amp; tidy"><title>Site | x</title>')).toBe('Nice & tidy')
    expect(titleFromHtml('<title>\n  The Walking Dead &#8211; Wikipedia </title>')).toBe('The Walking Dead – Wikipedia')
    expect(titleFromHtml('<p>no title</p>')).toBeNull()
  })
  it('decodes entities and escapes brackets for link text', () => {
    expect(decodeEntities('&lt;b&gt; &#x27;hi&#39; &nbsp;')).toBe("<b> 'hi'  ")
    expect(linkText('[Draft] notes')).toBe('\\[Draft\\] notes')
  })
})
