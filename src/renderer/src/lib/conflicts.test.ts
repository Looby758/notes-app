import { describe, expect, it } from 'vitest'
import { combine, findConflicts, lineDiff } from './conflicts'

describe('findConflicts', () => {
  it('pairs sync copies with their notes', () => {
    const paths = [
      'Plan.md',
      'Plan (1).md',
      'Work/Ideas.md',
      'Work/Ideas (conflicted copy 2026-10-26).md',
      'Diary [Conflict].md',
      'Diary.md',
      'Chapter (1).md', // no "Chapter.md": not a copy
      'Notes (2).md',
      'notes.md',
      'Other/Plan (1).md' // the original is in another folder
    ]
    expect(findConflicts(paths)).toEqual([
      { original: 'Diary.md', copy: 'Diary [Conflict].md' },
      { original: 'notes.md', copy: 'Notes (2).md' },
      { original: 'Plan.md', copy: 'Plan (1).md' },
      { original: 'Work/Ideas.md', copy: 'Work/Ideas (conflicted copy 2026-10-26).md' }
    ])
  })
})

describe('lineDiff and combine', () => {
  const a = '# Shopping\n\n- milk\n- eggs\n- bread\n'
  const b = '# Shopping\n\n- milk\n- butter\n- bread\n- jam\n'
  it('finds the changed lines', () => {
    const changed = lineDiff(a, b).filter((o) => o.kind !== 'same')
    expect(changed).toEqual([
      { kind: 'added', line: '- butter' },
      { kind: 'removed', line: '- eggs' },
      { kind: 'added', line: '- jam' }
    ])
  })
  it('combines both versions without losing anything', () => {
    expect(combine(a, b)).toBe('# Shopping\n\n- milk\n- butter\n- eggs\n- bread\n- jam\n')
  })
})
