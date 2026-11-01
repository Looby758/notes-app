import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Vault } from './vault'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'vault-test-'))
})
afterEach(() => rm(root, { recursive: true, force: true }))

describe('app data (money, passwords…)', () => {
  it('reads a missing file as null, but an unreadable one as an error', async () => {
    const vault = new Vault(root)
    expect(await vault.readAppData('money.json')).toBeNull()
    // A folder where the file should be can't be read as text.
    await mkdir(join(root, '.notesapp', 'money.json'), { recursive: true })
    await expect(vault.readAppData('money.json')).rejects.toThrow()
  })

  it("keeps a copy of the day's first version before changing it", async () => {
    const vault = new Vault(root)
    await vault.writeAppData('money.json', '{"entries":[1]}')
    // Nothing to back up the first time.
    expect(await readdir(join(root, '.notesapp'))).toEqual(['money.json'])
    await vault.writeAppData('money.json', '{"entries":[]}')
    await vault.writeAppData('money.json', '{"entries":[2]}')
    const backups = await readdir(join(root, '.notesapp', 'backups'))
    expect(backups).toEqual([`money-${new Date().toISOString().slice(0, 10)}.json`])
    expect(await readFile(join(root, '.notesapp', 'backups', backups[0]), 'utf8')).toBe('{"entries":[1]}')
    expect(await vault.readAppData('money.json')).toBe('{"entries":[2]}')
  })

  it('keeps only the newest week of copies', async () => {
    const vault = new Vault(root)
    const dir = join(root, '.notesapp', 'backups')
    await mkdir(dir, { recursive: true })
    for (let d = 1; d <= 9; d++) await writeFile(join(dir, `money-2020-01-0${d}.json`), '{}')
    await writeFile(join(dir, 'flashcards-2020-01-01.json'), '{}')
    await vault.writeAppData('money.json', '{"a":1}')
    await vault.writeAppData('money.json', '{"a":2}')
    const left = (await readdir(dir)).sort()
    expect(left.filter((f) => f.startsWith('money-'))).toHaveLength(7)
    expect(left).toContain('flashcards-2020-01-01.json')
    expect(left).not.toContain('money-2020-01-01.json')
  })
})

describe('text files (.txt, .json…)', () => {
  it('reads and saves them like notes', async () => {
    const vault = new Vault(root)
    await writeFile(join(root, 'todo.txt'), 'milk\r\neggs')
    expect(await vault.readTextFile('todo.txt')).toBe('milk\r\neggs')
    await vault.write('settings.json', '{"a": 1}\n')
    expect(await readFile(join(root, 'settings.json'), 'utf8')).toBe('{"a": 1}\n')
  })

  it('refuses binary files and anything that isn’t a text file', async () => {
    const vault = new Vault(root)
    await writeFile(join(root, 'odd.txt'), Buffer.from([0x50, 0x4b, 0, 0, 1]))
    await expect(vault.readTextFile('odd.txt')).rejects.toThrow(/doesn’t look like text/)
    await writeFile(join(root, 'photo.png'), 'x')
    await expect(vault.readTextFile('photo.png')).rejects.toThrow()
    await expect(vault.write('photo.png', 'x')).rejects.toThrow()
  })
})
