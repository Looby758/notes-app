import { describe, expect, it } from 'vitest'
import { mergePaths, newestFirst, npmMissingText, pathFromShellOutput, usualToolDirs } from './toolPath'

describe('finding npm like the Terminal does', () => {
  it('reads the PATH a login shell printed, around whatever else it said', () => {
    expect(pathFromShellOutput('Last login: Sun\nwelcome!\n__ORBIT_PATH__/opt/homebrew/bin:/usr/bin__ORBIT_PATH__')).toBe('/opt/homebrew/bin:/usr/bin')
    expect(pathFromShellOutput('zsh: no such file')).toBeNull()
    expect(pathFromShellOutput('__ORBIT_PATH____ORBIT_PATH__')).toBeNull()
  })

  it('joins PATHs, keeping the first of each folder', () => {
    expect(mergePaths(':', '/a:/b', undefined, '/b:/c:', null, '/a')).toBe('/a:/b:/c')
    expect(mergePaths(';', 'C:\\x;C:\\y', 'C:\\y')).toBe('C:\\x;C:\\y')
  })

  it('looks where Node.js usually goes on a Mac', () => {
    const dirs = usualToolDirs('darwin', '/Users/me')
    expect(dirs).toContain('/opt/homebrew/bin')
    expect(dirs).toContain('/usr/local/bin')
    expect(dirs).toContain('/Users/me/.volta/bin')
    expect(usualToolDirs('win32', 'C:\\Users\\me', { ProgramFiles: 'C:\\Program Files', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' })).toEqual(['C:\\Program Files\\nodejs', 'C:\\Users\\me\\AppData\\Roaming\\npm'])
  })

  it('tries nvm’s newest Node first', () => {
    expect(newestFirst(['v18.20.1', 'v22.3.0', 'v20.11.1', 'system'])).toEqual(['v22.3.0', 'v20.11.1', 'v18.20.1'])
  })

  it('says what to do when npm really isn’t anywhere', () => {
    expect(npmMissingText('darwin')).toMatch(/brew install node/)
    expect(npmMissingText('darwin', { nvm: true })).toMatch(/nvm alias default node/)
    expect(npmMissingText('win32')).toMatch(/nodejs\.org/)
  })
})
