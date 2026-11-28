import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { newChapter, newStory } from '@shared/writing'
import { buildEpub } from './writingExport'

describe('the e-book', () => {
  it('is a zip with an uncompressed mimetype first, and every chapter', async () => {
    const story = newStory('The Silver Ring')
    story.chapters = [newChapter('One'), newChapter('Two')]
    story.chapters[0].scenes[0].takes[0].text = 'She *ran*.'
    const bytes = await buildEpub(story, new Date('2026-11-28T12:00:00Z'))
    // "mimetype" is the first file's name, right after the 30-byte local header, and stored as is.
    expect(new TextDecoder().decode(bytes.slice(30, 38))).toBe('mimetype')
    expect(new TextDecoder().decode(bytes.slice(38, 58))).toBe('application/epub+zip')
    const zip = await JSZip.loadAsync(bytes)
    expect(Object.keys(zip.files)).toContain('OEBPS/chapter-2.xhtml')
    expect(await zip.file('OEBPS/chapter-1.xhtml')!.async('string')).toContain('<p>She <em>ran</em>.</p>')
  })
})
