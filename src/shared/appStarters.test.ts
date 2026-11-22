import { describe, expect, it } from 'vitest'
import { firstRunCommand, appNameProblem, appSlug, firstCard, starterFiles, STARTERS } from './appStarters'

describe('app starters', () => {
  it('makes a folder name from the app’s name', () => {
    expect(appSlug('My Cool App!')).toBe('my-cool-app')
    expect(appSlug('  Café  Racer ')).toBe('cafe-racer')
    expect(appSlug('!!!')).toBe('')
    expect(appNameProblem('')).toBe('Give it a name.')
    expect(appNameProblem('!!!')).toBe('Use some letters or numbers in the name.')
    expect(appNameProblem('Eclipse')).toBeNull()
  })
  it('gives every starter a README, a CLAUDE.md and a package.json that names it', () => {
    for (const s of STARTERS) {
      const files = starterFiles(s.id, 'Star Hopper', 'A game about hopping between stars.')
      expect(files['README.md']).toContain('# Star Hopper')
      expect(files['CLAUDE.md']).toContain('A game about hopping between stars.')
      expect(JSON.parse(files['package.json']).name).toBe('star-hopper')
      if (s.run) expect(JSON.parse(files['package.json']).scripts.dev).toBeTruthy()
    }
  })
  it('gives the desktop app a release workflow', () => {
    const files = starterFiles('desktop', 'Eclipse', '')
    expect(files['.github/workflows/release.yml']).toMatch(/tags:\s*\n\s*- 'v\*'/)
    expect(JSON.parse(files['package.json']).scripts['build:win']).toContain('electron-builder')
  })
  it('keeps odd characters in the name out of the code', () => {
    const files = starterFiles('website', 'A <b>"bold"</b> {app}', 'Says hi')
    expect(files['src/App.tsx']).not.toContain('<b>')
    expect(files['src/App.tsx']).not.toMatch(/\{app\}/)
  })
  it('starts the board with a card to build the first version', () => {
    expect(firstCard('Eclipse', 'A music app.', 'desktop')).toEqual({
      title: 'Build the first version of Eclipse',
      details: "A music app.\n\nIt started from App Studio's desktop app starter, so the basics are there to build on."
    })
  })
})

describe('first run', () => {
  it('pushes, then installs', () => {
    expect(firstRunCommand(false, true, true)).toBe('git push -u origin main && npm install')
    expect(firstRunCommand(true, true, true)).toBe('git push -u origin main; if ($LASTEXITCODE -eq 0) { npm install }')
    expect(firstRunCommand(false, false, true)).toBe('npm install')
    expect(firstRunCommand(false, false, false)).toBeNull()
  })
})
