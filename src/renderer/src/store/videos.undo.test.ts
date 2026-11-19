import { beforeEach, describe, expect, it, vi } from 'vitest'

const writes: string[] = []
vi.stubGlobal('window', { api: { writeAppData: vi.fn(async (_n: string, c: string) => void writes.push(c)), readAppData: vi.fn(async () => null) } })
// Settings, without the app's appearance and settings file behind them.
vi.mock('./prefs', async () => {
  const { create } = await import('zustand')
  const usePrefs = create(() => ({ prefs: { videosFolder: 'Videos' } }))
  return { usePrefs, setPrefsQuietly: (patch: object) => usePrefs.setState((s) => ({ prefs: { ...s.prefs, ...patch } })) }
})

const { useVideos, loadVideos, createProject, renameProject, addItems, deleteProject, remapVideos, folderForProject, followMovedVideosFolder, setStage, setUploadDate, addIdea, promoteIdea, deleteIdea } = await import('./videos')
const { usePrefs } = await import('./prefs')
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

  it('follows the videos folder when it is renamed, in Orbit or outside it', () => {
    const a = createProject('Maggie')
    folderForProject(a)
    remapVideos('Videos', 'YouTube')
    expect(usePrefs.getState().prefs.videosFolder).toBe('YouTube')
    const folder = (path: string, children: never[] = []) => ({ name: path.split('/').pop()!, path, type: 'folder' as const, children })
    followMovedVideosFolder([folder('TWD', [folder('TWD/Maggie')] as never[])])
    expect(usePrefs.getState().prefs.videosFolder).toBe('TWD')
    expect(useVideos.getState().projects[0].folder).toBe('TWD/Maggie')
  })

  it('moves a video along the pipeline, dating it when it goes up', async () => {
    const a = createProject('Maggie')
    setUploadDate(a.id, '2026-12-05')
    setStage(a.id, 'uploaded')
    expect(useVideos.getState().projects[0].uploadDate).toBe('2026-12-05')
    const b = createProject('Negan')
    setStage(b.id, 'uploaded')
    expect(useVideos.getState().projects[0].uploadDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(await history.undo()).toBe('Moved “Negan” to Uploaded')
    expect(useVideos.getState().projects[0].stage).toBe('idea')
    expect(useVideos.getState().projects[0].uploadDate).toBeUndefined()
    setUploadDate(b.id, 'next week')
    expect(useVideos.getState().projects[0].uploadDate).toBeUndefined()
  })

  it('turns an idea into a project in one undoable step', async () => {
    const idea = addIdea('Was Negan right?\nEvery choice he made.')!
    addIdea('Carol vs the Whisperers')
    expect(useVideos.getState().ideas.map((i) => i.text)).toEqual(['Carol vs the Whisperers', 'Was Negan right?\nEvery choice he made.'])
    const made = promoteIdea(idea.id)!
    expect(made).toMatchObject({ title: 'Was Negan right?', summary: 'Every choice he made.', stage: 'idea' })
    expect(useVideos.getState().ideas).toHaveLength(1)
    await history.undo()
    expect(useVideos.getState().ideas).toHaveLength(2)
    expect(useVideos.getState().projects.some((p) => p.id === made.id)).toBe(false)
    deleteIdea(idea.id)
    expect(useVideos.getState().ideas.map((i) => i.text)).toEqual(['Carol vs the Whisperers'])
    expect(addIdea('   ')).toBeNull()
  })

  it("won't undo onto reloaded projects", async () => {
    createProject('Negan')
    await loadVideos()
    await expect(history.undo()).rejects.toThrow(/reloaded/)
  })
})
