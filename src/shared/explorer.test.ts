import { describe, expect, it } from 'vitest'
import { crumbsOf, filterEntries, isHiddenName, isInside, nameProblem, parentPath, previewKind, sortEntries, uniqueName, whereIn, type ExplorerEntry } from './explorer'

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

describe('file explorer file actions', () => {
  it('finds a free name the way Windows does', () => {
    expect(uniqueName('Plan.txt', ['other.txt'])).toBe('Plan.txt')
    expect(uniqueName('Plan.txt', ['plan.TXT'])).toBe('Plan (2).txt')
    expect(uniqueName('Plan.txt', ['Plan.txt', 'Plan (2).txt'])).toBe('Plan (3).txt')
    expect(uniqueName('Plan (2).txt', ['Plan (2).txt'])).toBe('Plan (3).txt')
    expect(uniqueName('New folder', ['New folder'], true)).toBe('New folder (2)')
    expect(uniqueName('v1.2', ['v1.2'], true)).toBe('v1.2 (2)')
    expect(uniqueName('.env', ['.env'])).toBe('.env (2)')
  })

  it('turns down names Windows or a Mac won’t take', () => {
    expect(nameProblem('Plan.txt')).toBeNull()
    expect(nameProblem('  ')).not.toBeNull()
    expect(nameProblem('a/b')).not.toBeNull()
    expect(nameProblem('what?')).not.toBeNull()
    expect(nameProblem('CON')).not.toBeNull()
    expect(nameProblem('con.txt')).not.toBeNull()
    expect(nameProblem('trailing.')).not.toBeNull()
  })

  it('knows when a folder would go inside itself', () => {
    expect(isInside('C:\\Users\\me\\Docs\\Work', 'C:\\Users\\me\\Docs')).toBe(true)
    expect(isInside('C:\\Users\\me\\Docs', 'c:\\users\\me\\docs\\')).toBe(true)
    expect(isInside('C:\\Users\\me\\Docs2', 'C:\\Users\\me\\Docs')).toBe(false)
    expect(isInside('/Users/me/a/b', '/Users/me/a')).toBe(true)
  })

  it('says where a search result is', () => {
    expect(whereIn('C:\\Users\\me\\Docs\\Work\\plan.txt', 'C:\\Users\\me')).toBe('Docs › Work')
    expect(whereIn('/Users/me/plan.txt', '/Users/me')).toBe('')
  })
})
