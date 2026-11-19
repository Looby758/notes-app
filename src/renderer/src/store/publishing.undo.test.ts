import { beforeEach, describe, expect, it, vi } from 'vitest'

const writeAppData = vi.fn(async (_name: string, _content: string) => undefined)
vi.stubGlobal('window', { api: { writeAppData, readAppData: vi.fn(async () => null) }, dispatchEvent: () => true })
vi.stubGlobal('CustomEvent', class {})

const p = await import('./publishing')
const { history } = await import('../lib/undo')

const draft = (id: string) => p.usePublishing.getState().videos.find((v) => v.id === id)!

describe('publishing drafts and Ctrl+Z', () => {
  beforeEach(async () => {
    await p.loadPublishing()
    history.clear()
  })

  it('saves to .notesapp/publishing.json', async () => {
    p.addVideo('Maggie')
    await vi.waitFor(() => expect(writeAppData).toHaveBeenCalled())
    const [name, content] = writeAppData.mock.calls.at(-1)!
    expect(name).toBe('publishing.json')
    expect(JSON.parse(content).videos[0].name).toBe('Maggie')
  })

  it('stars the first title option automatically, and moves the star when it is removed', () => {
    const v = p.addVideo('Maggie')
    const a = p.addTitle(v.id, 'A')
    const b = p.addTitle(v.id, 'B')
    expect(draft(v.id).chosenTitle).toBe(a)
    p.deleteTitle(v.id, a)
    expect(draft(v.id).chosenTitle).toBe(b)
  })

  it('undoes typing a description in one go', async () => {
    const v = p.addVideo('Maggie')
    p.setDescription(v.id, 'T')
    p.setDescription(v.id, 'Th')
    p.setDescription(v.id, 'The')
    expect(await history.undo()).toBe('Changed the description for “Maggie”')
    expect(draft(v.id).description).toBe('')
    await history.redo()
    expect(draft(v.id).description).toBe('The')
  })

  it('undoes deleting a video', async () => {
    const v = p.addVideo('Maggie')
    p.addTags(v.id, ['twd', 'TWD', 'maggie'])
    expect(draft(v.id).tags).toEqual(['twd', 'maggie'])
    p.deleteVideo(v.id)
    expect(p.usePublishing.getState().videos).toHaveLength(0)
    await history.undo()
    expect(draft(v.id).tags).toEqual(['twd', 'maggie'])
  })

  it('makes a record for a video project the first time, without an undo step', () => {
    const d = p.videoDraftFor('project-123', 'Life of Rick')
    expect(d.id).toBe('project-123')
    expect(p.videoDraftFor('project-123', 'Other name').name).toBe('Life of Rick')
    expect(history.canUndo).toBe(false)
  })

  it("won't undo onto reloaded drafts", async () => {
    p.addVideo('Maggie')
    await p.loadPublishing()
    await expect(history.undo()).rejects.toThrow(/reloaded/)
  })

  it('picks the first picture on the board, and undoes removing a card', async () => {
    const v = p.addVideo('Maggie')
    p.addThumbnails(v.id, [{ kind: 'idea', text: 'Big red WHY' }])
    expect(draft(v.id).chosenThumbnail).toBeNull()
    const [pic] = p.addThumbnails(v.id, [{ kind: 'picture', text: '', file: 'attachments/a.png' }])
    expect(draft(v.id).chosenThumbnail).toBe(pic)
    p.deleteThumbnail(v.id, pic)
    expect(draft(v.id).chosenThumbnail).toBeNull()
    await history.undo()
    expect(draft(v.id).chosenThumbnail).toBe(pic)
    p.moveThumbnail(v.id, pic, draft(v.id).thumbnails[0].id)
    expect(draft(v.id).thumbnails[0].id).toBe(pic)
  })
})
