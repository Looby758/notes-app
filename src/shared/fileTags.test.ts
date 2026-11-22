import { describe, expect, it } from 'vitest'
import { cleanTagStore, copyInStore, emptyTagStore, moveInStore, rebase, setTag, sharedTags, tagCounts, tagName } from './fileTags'

describe('file tags', () => {
  it('turns colours on and off, keeping them in order', () => {
    let s = setTag(emptyTagStore(), ['C:\\a.txt', 'C:\\b.txt'], 'blue', true)
    s = setTag(s, ['C:\\a.txt'], 'red', true)
    expect(s.items['C:\\a.txt']).toEqual(['red', 'blue'])
    s = setTag(s, ['C:\\a.txt', 'C:\\b.txt'], 'blue', false)
    expect(s.items).toEqual({ 'C:\\a.txt': ['red'] })
    expect(tagCounts(s).red).toBe(1)
    expect(sharedTags(setTag(s, ['C:\\b.txt'], 'red', true), ['C:\\a.txt', 'C:\\b.txt'])).toEqual(['red'])
  })

  it('names colours', () => {
    expect(tagName({ labels: {} }, 'green')).toBe('Green')
    expect(tagName({ labels: { green: 'School' } }, 'green')).toBe('School')
  })

  it('follows a rename or move, including everything inside a folder', () => {
    let s = setTag(emptyTagStore(), ['C:\\Work\\Plan.docx', 'C:\\Work', 'C:\\Workshop.txt'], 'purple', true)
    s = { ...s, favourites: ['C:\\Work', 'D:\\Games'] }
    const moved = moveInStore(s, 'C:\\work', 'D:\\Archive\\Work 2026')
    expect(Object.keys(moved.items).sort()).toEqual(['C:\\Workshop.txt', 'D:\\Archive\\Work 2026', 'D:\\Archive\\Work 2026\\Plan.docx'])
    expect(moved.favourites).toEqual(['D:\\Archive\\Work 2026', 'D:\\Games'])
    expect(moveInStore(s, 'C:\\Nothing', 'C:\\Else')).toBe(s)
  })

  it('gives copies the same tags', () => {
    const s = setTag(emptyTagStore(), ['/Users/me/Pics/a.png'], 'yellow', true)
    expect(copyInStore(s, '/Users/me/Pics', '/Users/me/Pics (2)').items['/Users/me/Pics (2)/a.png']).toEqual(['yellow'])
  })

  it('rebases paths', () => {
    expect(rebase('/a/b/c', '/a/b', '/x')).toBe('/x/c')
    expect(rebase('/a/bc', '/a/b', '/x')).toBeNull()
  })

  it('repairs a damaged file', () => {
    expect(cleanTagStore({ items: { a: ['red', 'pink'], b: 'blue' }, favourites: ['x', 'x', 3], labels: { red: '  Urgent ', pink: 'no' } })).toEqual({
      labels: { red: 'Urgent' },
      items: { a: ['red'] },
      favourites: ['x']
    })
    expect(cleanTagStore(null)).toEqual(emptyTagStore())
  })
})
