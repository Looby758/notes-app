import { describe, expect, it } from 'vitest'
import { textToMarkdown, titleOf } from './document'

describe('converting documents', () => {
  it('keeps plain text exactly as written', () => {
    expect(textToMarkdown('# not a heading\n- not a list\n*stars*')).toBe('\\# not a heading  \n\\- not a list  \n\\*stars\\*  ')
  })

  it('titles a file by the heading it opens with', () => {
    expect(titleOf('list.md', '# Shopping\n\n- Eggs')).toBe('Shopping')
    expect(titleOf('list.md', '\n# **Big** plan #\n')).toBe('Big plan')
    expect(titleOf('list.md', 'Intro\n\n# Later heading')).toBe('list')
  })
})
