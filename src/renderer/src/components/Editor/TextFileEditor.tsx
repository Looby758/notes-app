import { useEffect, useRef, useState } from 'react'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentUnit, LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { AlertTriangle, Braces } from 'lucide-react'
import { decodeText, encodeText, jsonProblem, wrapsLines, type TextFormat } from '@shared/textFiles'
import { editorTheme, highlightStyle } from './theme'
import { usePrefs } from '../../store/prefs'
import { setPendingTextSave } from '../../lib/textFiles'
import { notify } from '../../store/notify'

type SaveState = 'saved' | 'unsaved' | 'saving' | 'failed'

const isJson = (path: string): boolean => /\.(json|geojson)$/i.test(path)

/** Text files are edited edge to edge in a monospace font, unlike notes (above the notes theme). */
const textFileTheme = Prec.highest(
  EditorView.theme({
    '.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: '0.92em' },
    '.cm-content': { maxWidth: 'none', margin: '0', padding: '12px 16px 40vh 4px' }
  })
)

/** A .txt, .json or other plain text file from the notes folder, edited in its own tab and saved as you type. */
export default function TextFileEditor({ path }: { path: string }) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [changedOnDisk, setChangedOnDisk] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [language, setLanguage] = useState<string>('Plain text')
  // What the file held when last read or saved, and how to write it back (line endings, BOM).
  const disk = useRef<{ text: string; format: TextFormat }>({ text: '', format: { bom: false, crlf: false } })
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const holdSaves = useRef(false)
  const saveRef = useRef<(force?: boolean) => Promise<void>>(async () => undefined)

  useEffect(() => {
    let cancelled = false
    const langCompartment = new Compartment()
    const prefs = usePrefs.getState().prefs

    const current = (): string => viewRef.current?.state.doc.toString() ?? disk.current.text

    /** `force`: save even if nothing changed here (to overwrite a version changed on disk). */
    const save = async (force = false): Promise<void> => {
      clearTimeout(saveTimer.current)
      setPendingTextSave(path, null)
      const text = current()
      if (holdSaves.current || (!force && text === disk.current.text)) return
      setSaveState('saving')
      try {
        await window.api.writeNote(path, encodeText(text, disk.current.format))
        disk.current = { ...disk.current, text }
        if (!cancelled) setSaveState(current() === text ? 'saved' : 'unsaved')
      } catch (err) {
        if (!cancelled) setSaveState('failed')
        throw err
      }
    }
    saveRef.current = save

    const checkJson = (text: string): void => setProblem(isJson(path) ? jsonProblem(text) : null)

    window.api
      .readTextFile(path)
      .then((raw) => {
        if (cancelled || !host.current) return
        const { text, format } = decodeText(raw)
        disk.current = { text, format }
        checkJson(text)
        const view = new EditorView({
          parent: host.current,
          state: EditorState.create({
            doc: text,
            extensions: [
              history(),
              drawSelection(),
              lineNumbers(),
              highlightActiveLine(),
              highlightActiveLineGutter(),
              bracketMatching(),
              closeBrackets(),
              highlightSelectionMatches(),
              syntaxHighlighting(highlightStyle),
              EditorState.tabSize.of(prefs.tabSize),
              indentUnit.of(prefs.indentWithTabs ? '\t' : ' '.repeat(prefs.tabSize)),
              wrapsLines(path) ? EditorView.lineWrapping : [],
              EditorView.contentAttributes.of({ spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
              langCompartment.of([]),
              editorTheme,
              textFileTheme,
              keymap.of([
                { key: 'Mod-s', preventDefault: true, run: () => (void save().catch(notify), true) },
                ...closeBracketsKeymap,
                ...defaultKeymap,
                ...historyKeymap,
                ...searchKeymap,
                indentWithTab
              ]),
              EditorView.updateListener.of((u) => {
                if (!u.docChanged) return
                const text = u.state.doc.toString()
                checkJson(text)
                if (text === disk.current.text) {
                  clearTimeout(saveTimer.current)
                  setPendingTextSave(path, null)
                  setSaveState('saved')
                  return
                }
                setSaveState('unsaved')
                setPendingTextSave(path, save)
                clearTimeout(saveTimer.current)
                if (!holdSaves.current) saveTimer.current = setTimeout(() => void save().catch(notify), usePrefs.getState().prefs.autosaveDelay)
              })
            ]
          })
        })
        viewRef.current = view
        view.focus()
        // Colours for JSON, YAML, code… (loaded the first time each language is needed).
        const lang = LanguageDescription.matchFilename(languages, path.slice(path.lastIndexOf('/') + 1))
        if (lang) {
          setLanguage(lang.name)
          lang
            .load()
            .then((support) => !cancelled && view.dispatch({ effects: langCompartment.reconfigure(support) }))
            .catch(() => undefined)
        }
      })
      .catch((err: Error) => !cancelled && setLoadError(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))

    // Changed by another app (or synced from another computer): show the new text if nothing here is unsaved.
    const offChanged = window.api.onVaultChanged((paths) => {
      if (!paths.includes(path) || !viewRef.current) return
      window.api
        .readTextFile(path)
        .then((raw) => {
          const view = viewRef.current
          if (cancelled || !view) return
          const next = decodeText(raw)
          const mine = view.state.doc.toString()
          // Our own save coming back, or the same text as here: nothing to do.
          if (next.text === disk.current.text || next.text === mine) {
            disk.current = next
            return
          }
          if (mine === disk.current.text) {
            disk.current = next
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next.text } })
          } else {
            holdSaves.current = true
            clearTimeout(saveTimer.current)
            setChangedOnDisk(true)
          }
        })
        .catch(() => undefined) // deleted or moved: the tab closes or follows it
    })

    return () => {
      cancelled = true
      offChanged()
      // Closing the tab saves what's left.
      if (!holdSaves.current) void save().catch(notify)
      setPendingTextSave(path, null)
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [path])

  const resolve = async (keep: 'disk' | 'mine'): Promise<void> => {
    const view = viewRef.current
    if (!view) return
    holdSaves.current = false
    setChangedOnDisk(false)
    if (keep === 'disk') {
      const next = decodeText(await window.api.readTextFile(path))
      disk.current = next
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next.text } })
      setSaveState('saved')
    } else {
      // Whatever is on disk now gets overwritten by what's here.
      await saveRef.current(true).catch(notify)
    }
  }

  const formatJson = (): void => {
    const view = viewRef.current
    if (!view) return
    try {
      const pretty = JSON.stringify(JSON.parse(view.state.doc.toString()), null, usePrefs.getState().prefs.indentWithTabs ? '\t' : usePrefs.getState().prefs.tabSize) + '\n'
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: pretty } })
    } catch {
      // The status bar already says what's wrong.
    }
  }

  if (loadError) return <p className="file-viewer-failed">{loadError}</p>

  return (
    <div className="text-file-editor" data-text-file={path}>
      {changedOnDisk && (
        <div className="conflict-banner">
          <AlertTriangle size={15} />
          <span>This file was changed on disk while you were editing it.</span>
          <button className="btn" onClick={() => void resolve('disk')}>
            Load disk version
          </button>
          <button className="btn" onClick={() => void resolve('mine')}>
            Keep mine
          </button>
        </div>
      )}
      <div ref={host} className="text-file-host" />
      <div className="text-file-status">
        <span>{language}</span>
        {isJson(path) && (
          <>
            <span className={problem ? 'text-file-problem' : 'text-file-ok'}>{problem ? `JSON error: ${problem}` : 'Valid JSON'}</span>
            <button className="btn" onClick={formatJson} disabled={!!problem} title="Lay the JSON out neatly, one item per line">
              <Braces size={12} /> Format
            </button>
          </>
        )}
        <span className="text-file-save" data-save-state={saveState}>
          {saveState === 'saving' ? 'Saving…' : saveState === 'unsaved' ? 'Unsaved' : saveState === 'failed' ? 'Couldn’t save' : 'Saved'}
        </span>
      </div>
    </div>
  )
}
