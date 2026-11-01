import { describe, expect, it } from 'vitest'
import { fileUrl, folderOf, pathFromFileUrl, vaultRelative } from './fileUrl'

describe('fileUrl', () => {
  it('makes file:// addresses for Windows and Mac paths', () => {
    expect(fileUrl('C:\\Users\\Me\\My Videos\\a#1.mp4')).toBe('file:///C:/Users/Me/My%20Videos/a%231.mp4')
    expect(fileUrl('/Users/me/Comics/x.cbr')).toBe('file:///Users/me/Comics/x.cbr')
  })
  it('reads them back', () => {
    expect(pathFromFileUrl(fileUrl('C:\\Users\\Me\\My Videos\\a#1.mp4'))).toBe('C:/Users/Me/My Videos/a#1.mp4')
    expect(pathFromFileUrl(fileUrl('/Users/me/a b.png'))).toBe('/Users/me/a b.png')
    expect(pathFromFileUrl('https://example.com')).toBeNull()
  })
})

describe('vaultRelative', () => {
  it('finds files inside the notes folder', () => {
    expect(vaultRelative('C:\\Notes', 'c:\\notes\\attachments\\a.png')).toBe('attachments/a.png')
    expect(vaultRelative('/Users/me/Notes/', '/Users/me/Notes/a.md')).toBe('a.md')
  })
  it('says no for files outside it', () => {
    expect(vaultRelative('/Users/me/Notes', '/Users/me/Notes2/a.md')).toBeNull()
    expect(vaultRelative('/Users/me/Notes', '/Users/me/notes/a.md')).toBeNull()
  })
})

describe('folderOf', () => {
  it('gives the folder a file is in', () => {
    expect(folderOf('C:/Users/a.png')).toBe('C:/Users')
    expect(folderOf('C:/a.png')).toBe('C:/')
    expect(folderOf('/a/b.png')).toBe('/a')
  })
})
