import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('window', { api: { writeAppData: vi.fn(async () => undefined), readAppData: vi.fn(async () => null) }, dispatchEvent: () => true })
vi.stubGlobal('CustomEvent', class {})
vi.mock('./prefs', async () => {
  const { create } = await import('zustand')
  const usePrefs = create(() => ({ prefs: { videosFolder: 'Videos' } }))
  return { usePrefs, setPrefsQuietly: (patch: object) => usePrefs.setState((s) => ({ prefs: { ...s.prefs, ...patch } })) }
})

const v = await import('./videos')
const pub = await import('./publishing')
const links = await import('./videoLinks')
const { history } = await import('../lib/undo')

const rows = () => links.publishingRows(v.useVideos.getState().projects, pub.usePublishing.getState().videos)

describe('video projects and Publishing share one video', () => {
  beforeEach(async () => {
    await Promise.all([v.loadVideos(), pub.loadPublishing()])
    history.clear()
  })

  it('lists every video project on the Publishing page, plus Publishing-only videos', async () => {
    const old = pub.addVideo('Made in Publishing before')
    const p = v.createProject('Life of Maggie')
    expect(rows().map((r) => [r.name, !!r.project, !!r.draft])).toEqual([
      ['Life of Maggie', true, false],
      ['Made in Publishing before', false, true]
    ])
    const d = await links.draftsForProject(p.id)
    expect(d?.id).toBe(p.id)
    expect(rows()[0].draft?.id).toBe(p.id)
    expect(rows()).toHaveLength(2)
    expect(old.project).toBeUndefined()
  })

  it('makes a video project for a new video on the Publishing page', async () => {
    const id = await links.newVideoFromPublishing('Life of Negan')
    expect(v.projectById(id)?.title).toBe('Life of Negan')
    expect(pub.draftOf(id)?.project).toBe(true)
  })

  it('hides a deleted project’s drafts, and Ctrl+Z brings both back', async () => {
    const p = v.createProject('Rick')
    await links.draftsForProject(p.id)
    pub.addTags(p.id, ['twd'])
    history.clear()
    v.deleteProject(p.id)
    expect(rows()).toHaveLength(0)
    await history.undo()
    expect(rows()[0].draft?.tags).toEqual(['twd'])
  })

  it('marking it uploaded moves the project to Uploaded on that day, as one Ctrl+Z step', async () => {
    const p = v.createProject('Daryl')
    v.setUploadDate(p.id, '2026-12-01')
    await links.draftsForProject(p.id)
    history.clear()
    await links.markUploaded(p.id, { on: '2026-12-03', url: '' })
    expect(v.projectById(p.id)).toMatchObject({ stage: 'uploaded', uploadDate: '2026-12-03' })
    expect(pub.draftOf(p.id)?.uploaded?.on).toBe('2026-12-03')
    expect(await history.undo()).toBe('Marked “Daryl” as uploaded')
    expect(v.projectById(p.id)).toMatchObject({ stage: 'idea', uploadDate: '2026-12-01' })
    expect(pub.draftOf(p.id)?.uploaded).toBeNull()
    expect(history.canUndo).toBe(false)
  })

  it('not uploaded after all takes it off the calendar when it had no planned day', async () => {
    const p = v.createProject('Carol')
    await links.draftsForProject(p.id)
    await links.markUploaded(p.id, { on: '2026-12-03', url: '' })
    await links.markUploaded(p.id, null)
    expect(v.projectById(p.id)?.stage).toBe('edited')
    expect(v.projectById(p.id)?.uploadDate).toBeUndefined()
  })

  it('not uploaded after all puts back the day it was planned for', async () => {
    const p = v.createProject('Ezekiel')
    v.setUploadDate(p.id, '2026-12-10')
    await links.draftsForProject(p.id)
    await links.markUploaded(p.id, { on: '2026-12-03', url: '' })
    expect(v.projectById(p.id)?.uploadDate).toBe('2026-12-03')
    await links.markUploaded(p.id, null)
    expect(v.projectById(p.id)).toMatchObject({ stage: 'edited', uploadDate: '2026-12-10' })
  })

  it('moving it to Uploaded on the board and back again leaves the calendar as it was', () => {
    const p = v.createProject('Michonne')
    v.setStage(p.id, 'uploaded')
    expect(v.projectById(p.id)?.uploadDate).toBeTruthy()
    v.setStage(p.id, 'edited')
    expect(v.projectById(p.id)?.uploadDate).toBeUndefined()
  })

  it('keeps the project flag when publishing.json is read back', async () => {
    const { readPublishing } = await import('../lib/publishing')
    const p = v.createProject('Glenn')
    await links.draftsForProject(p.id)
    const back = readPublishing(JSON.stringify({ videos: pub.usePublishing.getState().videos }))
    expect(back.videos[0].project).toBe(true)
  })
})

describe('deleting a video from the Publishing page', () => {
  beforeEach(async () => {
    await Promise.all([v.loadVideos(), pub.loadPublishing()])
    history.clear()
  })

  it('deletes a Publishing-only video', async () => {
    const old = pub.addVideo('Old test video')
    history.clear()
    await links.deleteFromPublishing(old.id)
    expect(rows()).toHaveLength(0)
    await history.undo()
    expect(rows()[0].name).toBe('Old test video')
  })

  it('deletes a project and its drafts together, as one Ctrl+Z step', async () => {
    const p = v.createProject('Rick')
    await links.draftsForProject(p.id)
    pub.addTags(p.id, ['twd'])
    history.clear()
    await links.deleteFromPublishing(p.id)
    expect(v.projectById(p.id)).toBeUndefined()
    expect(pub.draftOf(p.id)).toBeUndefined()
    expect(await history.undo()).toBe('Deleted the video “Rick”')
    expect(rows()[0].draft?.tags).toEqual(['twd'])
    expect(history.canUndo).toBe(false)
  })
})
