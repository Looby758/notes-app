import { beforeEach, describe, expect, it, vi } from 'vitest'

const writes: string[] = []
vi.stubGlobal('window', { api: { writeAppData: vi.fn(async (_n: string, c: string) => void writes.push(c)), readAppData: vi.fn(async () => null) } })

const { useVideos, loadVideos, createProject, renameProject, addItems, deleteProject, remapVideos, folderForProject } = await import('./videos')
const { history } = await import('../lib/undo')

describe('video projects and Ctrl+Z', () => {
  beforeEach(async () => {
    await loadVideos()
    history.clear()
  })

  it('undoes and redoes deleting a project', async () => {
    const p = createProject('Maggie')
    addItems(p.id, 'image', ['attachments/a.png', 'attachments/a.png'])
    expect(useVideos.getState().projects[0].items).toHaveLength(1)
    deleteProject(p.id)
    expect(useVideos.getState().projects).toHaveLength(0)
    expect(await history.undo()).toBe('Deleted the video “Maggie”')
    expect(useVideos.getState().projects[0].items[0].path).toBe('attachments/a.png')
    await history.redo()
    expect(useVideos.getState().projects).toHaveLength(0)
  })

  it('undoes typing a title in one go', async () => {
    const p = createProject('Mag')
    renameProject(p.id, 'Magg')
    renameProject(p.id, 'Maggie')
    await history.undo()
    expect(useVideos.getState().projects[0].title).toBe('Mag')
  })

  it('follows renamed notes and gives each project its own folder', () => {
    const a = createProject('Maggie')
    const b = createProject('Maggie')
    expect(folderForProject(a)).toBe('Videos/Maggie')
    expect(folderForProject(useVideos.getState().projects.find((p) => p.id === b.id)!)).toBe('Videos/Maggie (2)')
    addItems(a.id, 'research', ['Videos/Maggie/Research.md'])
    remapVideos('Videos/Maggie', 'Videos/Maggie Rhee')
    const moved = useVideos.getState().projects.find((p) => p.id === a.id)!
    expect(moved.folder).toBe('Videos/Maggie Rhee')
    expect(moved.items[0].path).toBe('Videos/Maggie Rhee/Research.md')
  })

  it("won't undo onto reloaded projects", async () => {
    createProject('Negan')
    await loadVideos()
    await expect(history.undo()).rejects.toThrow(/reloaded/)
  })
})
