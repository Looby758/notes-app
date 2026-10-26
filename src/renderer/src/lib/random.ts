import { useNoteIndex } from '../store/noteIndex'
import { usePrefs } from '../store/prefs'
import { useEditor } from '../store/editor'
import { notify } from '../store/notify'
import { dailyDateOf } from './dailyPaths'
import { openNote } from './editorController'
import { isWithin } from './paths'

/** Opens a random note (never a template; daily notes only if the setting says so). */
export function openRandomNote(): void {
  const { templatesFolder, randomIncludeDaily } = usePrefs.getState().prefs
  const current = useEditor.getState().active
  const pool = useNoteIndex
    .getState()
    .lookup.paths.filter((p) => p !== current && !(templatesFolder && isWithin(p, templatesFolder)) && (randomIncludeDaily || dailyDateOf(p) === null))
  if (pool.length === 0) {
    notify('No other notes to pick from yet.', 'info')
    return
  }
  openNote(pool[Math.floor(Math.random() * pool.length)])
}
