import { describe, expect, it } from 'vitest'
import { pathsFromArgv } from './openInOrbit'
import { isComicBookFile } from './comics'

describe('Open in Orbit', () => {
  it('reads the files from the command line', () => {
    expect(pathsFromArgv(['C:\\Orbit\\Orbit.exe', '--open-in-orbit', 'C:\\Videos\\film.mkv'])).toEqual(['C:\\Videos\\film.mkv'])
    expect(pathsFromArgv(['Orbit.exe', '--allow-file-access', '--open-in-orbit=D:\\Comics\\Saga 1.cbr'])).toEqual(['D:\\Comics\\Saga 1.cbr'])
    expect(pathsFromArgv(['Orbit.exe', '--open-in-orbit="D:\\a b.zip"'])).toEqual(['D:\\a b.zip'])
    expect(pathsFromArgv(['Orbit.exe', '--hidden'])).toEqual([])
    expect(pathsFromArgv(['Orbit.exe', '--open-in-orbit'])).toEqual([])
  })
  it('only treats .cbz and .cbr as comics when clicked', () => {
    expect(isComicBookFile('Saga Vol 1.CBR')).toBe(true)
    expect(isComicBookFile('a.cbz')).toBe(true)
    expect(isComicBookFile('photos.zip')).toBe(false)
  })
})
