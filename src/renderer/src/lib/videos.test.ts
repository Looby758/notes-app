import { describe, expect, it } from 'vitest'
import { fitsSection, folderName, projectFolderFor, readVideos, remapProjects, videosJson, type VideoProject } from './videos'

const kind = (p: string): string => (/\.(png|jpg)$/i.test(p) ? 'image' : /\.(mp3|wav|webm)$/i.test(p) ? 'audio' : /\.mp4$/i.test(p) ? 'video' : 'other')

const project = (over: Partial<VideoProject> = {}): VideoProject => ({
  id: 'v1',
  title: 'Maggie',
  stage: 'idea',
  summary: '',
  script: null,
  folder: null,
  items: [],
  created: 1,
  updated: 1,
  ...over
})

describe('readVideos', () => {
  it('reads nothing as empty', () => {
    expect(readVideos(null)).toEqual({ projects: [], ideas: [] })
    expect(readVideos('not json')).toEqual({ projects: [], ideas: [] })
  })

  it('round-trips and keeps fields from a newer Orbit', () => {
    const p = { ...project({ script: 'Videos/Maggie/Script.md', items: [{ id: 'i', kind: 'image', path: 'attachments/a.png', added: 2 }] }), publishing: { titles: ['x'] } }
    const back = readVideos(videosJson({ projects: [p], ideas: [{ id: 'd', text: 'Negan', created: 3 }] }))
    expect(back.projects[0]).toEqual(p)
    expect(back.ideas).toEqual([{ id: 'd', text: 'Negan', created: 3 }])
  })

  it('drops broken items, unsafe paths and repeated ids', () => {
    const raw = JSON.stringify({
      projects: [
        { id: 'a', title: 'A', stage: 'nonsense', script: '../outside.md', items: [{ id: '1', kind: 'image', path: '/etc/passwd' }, { id: '2', kind: 'weird', path: 'x.png' }, { id: '3', kind: 'thumbnail', text: 'big red arrow' }] },
        { id: 'a', title: 'again' },
        { title: 'no id' }
      ]
    })
    const { projects } = readVideos(raw)
    expect(projects).toHaveLength(1)
    expect(projects[0].stage).toBe('idea')
    expect(projects[0].script).toBeNull()
    expect(projects[0].items.map((i) => i.id)).toEqual(['3'])
  })
})

describe('remapProjects', () => {
  it('follows a renamed folder', () => {
    const p = project({ script: 'Videos/Maggie/Script.md', folder: 'Videos/Maggie', items: [{ id: 'i', kind: 'research', path: 'Videos/Maggie/Research.md', added: 0 }, { id: 'j', kind: 'image', path: 'attachments/a.png', added: 0 }] })
    const [next] = remapProjects([p], 'Videos/Maggie', 'Videos/Maggie Rhee')!
    expect(next.script).toBe('Videos/Maggie Rhee/Script.md')
    expect(next.folder).toBe('Videos/Maggie Rhee')
    expect(next.items.map((i) => i.path)).toEqual(['Videos/Maggie Rhee/Research.md', 'attachments/a.png'])
  })

  it('says when nothing changed', () => {
    expect(remapProjects([project({ script: 'Other.md' })], 'Videos', 'Old videos')).toBeNull()
  })
})

describe('folders', () => {
  it('makes titles safe and unique', () => {
    expect(folderName('What: really/happened?')).toBe('What really happened')
    expect(folderName('  ')).toBe('Untitled video')
    expect(projectFolderFor('Maggie', ['Videos/maggie', 'Videos/Maggie (2)'])).toBe('Videos/Maggie (3)')
  })
})

describe('fitsSection', () => {
  it('puts each kind of file in its place', () => {
    expect(fitsSection('script', 'a.md', kind)).toBe(true)
    expect(fitsSection('research', 'a.png', kind)).toBe(false)
    expect(fitsSection('image', 'a.png', kind)).toBe(true)
    expect(fitsSection('thumbnail', 'a.png', kind)).toBe(true)
    expect(fitsSection('recording', 'a.wav', kind)).toBe(true)
    expect(fitsSection('recording', 'a.mp4', kind)).toBe(true)
    expect(fitsSection('recording', 'a.png', kind)).toBe(false)
  })
})
