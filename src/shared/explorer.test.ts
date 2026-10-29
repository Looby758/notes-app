import { describe, expect, it } from 'vitest'
import { crumbsOf, filterEntries, isHiddenName, parentPath, previewKind, sortEntries, type ExplorerEntry } from './explorer'

const entry = (name: string, extra: Partial<ExplorerEntry> = {}): ExplorerEntry => ({
  name,
  path: `/x/${name}`,
  isDir: false,
  size: 0,
  modified: 0,
  hidden: isHiddenName(name),
  vaultPath: null,
  ...extra
})

describe('file explorer', () => {
  it('splits Windows and Mac paths into breadcrumbs', () => {
    expect(crumbsOf('C:\\Users\\me\\Documents')).toEqual([
      { name: 'C:', path: 'C:\\' },
      { name: 'Users', path: 'C:\\Users' },
      { name: 'me', path: 'C:\\Users\\me' },
      { name: 'Documents', path: 'C:\\Users\\me\\Documents' }
    ])
    expect(crumbsOf('/Users/me').map((c) => c.path)).toEqual(['/', '/Users', '/Users/me'])
    expect(parentPath('C:\\Users')).toBe('C:\\')
    expect(parentPath('C:\\')).toBeNull()
    expect(parentPath('/')).toBeNull()
  })

  it('puts folders first and sorts names the way people count', () => {
    const list = [entry('file 10.txt'), entry('file 2.txt'), entry('Zed', { isDir: true }), entry('apple.png')]
    expect(sortEntries(list, 'name').map((e) => e.name)).toEqual(['Zed', 'apple.png', 'file 2.txt', 'file 10.txt'])
  })

  it('hides system files unless asked, and searches by every word', () => {
    const list = [entry('.git'), entry('desktop.ini'), entry('Holiday photo.jpg'), entry('Photo of cat.png')]
    expect(filterEntries(list, '', false).map((e) => e.name)).toEqual(['Holiday photo.jpg', 'Photo of cat.png'])
    expect(filterEntries(list, 'photo cat', false).map((e) => e.name)).toEqual(['Photo of cat.png'])
    expect(filterEntries(list, '', true)).toHaveLength(4)
  })

  it('knows which files it can preview', () => {
    expect(previewKind('IMG_1.JPG')).toBe('image')
    expect(previewKind('report.pdf')).toBe('pdf')
    expect(previewKind('notes.md')).toBe('text')
    expect(previewKind('setup.exe')).toBe('none')
  })
})
