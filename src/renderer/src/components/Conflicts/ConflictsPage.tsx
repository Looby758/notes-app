import { useEffect, useMemo, useState } from 'react'
import { Columns2, Combine, Copy, FileCheck2, GitCompare } from 'lucide-react'
import { combine, findConflicts, lineDiff, type ConflictPair } from '../../lib/conflicts'
import { getOpenText, openNote, splitPane } from '../../lib/editorController'
import { editNote } from '../../lib/daily'
import { noteTitle } from '../../lib/paths'
import { normalizeText, useNoteIndex } from '../../store/noteIndex'
import { useVault } from '../../store/vault'
import { notify } from '../../store/notify'
import { isLockedText } from '../../lib/lock/crypto'

/** The sync copies ("Plan (1).md") in the notes folder. */
export function useConflicts(): ConflictPair[] {
  const lookup = useNoteIndex((s) => s.lookup)
  return useMemo(() => findConflicts(lookup.paths), [lookup])
}

const textOf = async (path: string): Promise<string> => getOpenText(path) ?? normalizeText(await window.api.readNote(path))

/** Settings-free page listing each note and its sync copy, with ways to put them back together. */
export default function ConflictsPage() {
  const pairs = useConflicts()
  return (
    <div className="conflicts-page" data-conflicts-page>
      <div className="conflicts-inner">
        <h2>
          <GitCompare size={18} /> Sync copies
        </h2>
        <p className="conflicts-intro">
          When a note is changed on two computers before they sync, Google Drive keeps both versions and saves one as a copy, like “Plan (1)”. Here you
          can see what’s different and keep one, combine them, or keep both.
        </p>
        {pairs.length === 0 ? (
          <p className="conflicts-none">
            <FileCheck2 size={16} /> No sync copies. Everything’s in one piece.
          </p>
        ) : (
          pairs.map((p) => <Pair key={p.copy} pair={p} />)
        )}
      </div>
    </div>
  )
}

function Pair({ pair }: { pair: ConflictPair }) {
  const [texts, setTexts] = useState<{ a: string; b: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const version = useNoteIndex((s) => s.version)
  useEffect(() => {
    Promise.all([textOf(pair.original), textOf(pair.copy)]).then(
      ([a, b]) => setTexts({ a, b }),
      () => setTexts(null)
    )
  }, [pair, version])

  const ops = useMemo(() => (texts ? lineDiff(texts.a, texts.b) : []), [texts])
  const changes = ops.filter((o) => o.kind !== 'same').length
  const locked = !!texts && (isLockedText(texts.a) || isLockedText(texts.b))

  const act = async (what: 'original' | 'copy' | 'combine' | 'both'): Promise<void> => {
    if (!texts) return
    setBusy(true)
    try {
      const vault = useVault.getState()
      if (what === 'both') {
        await vault.rename(pair.copy, `${noteTitle(pair.original)} – other copy`)
      } else {
        if (what === 'copy') await editNote(pair.original, () => texts.b)
        if (what === 'combine') await editNote(pair.original, (current) => combine(current, texts.b))
        await vault.trash(pair.copy)
      }
      await vault.refresh([pair.original])
    } catch (err) {
      notify(err)
    } finally {
      setBusy(false)
    }
  }

  // Show changed lines with a little context around each change.
  const shown = ops.map((op, i) => ({ op, i })).filter(({ i }) => ops.slice(Math.max(0, i - 2), i + 3).some((o) => o.kind !== 'same'))

  return (
    <section className="conflict-pair" data-conflict={pair.copy}>
      <header>
        <button className="link-button" onClick={() => openNote(pair.original)}>
          {pair.original.replace(/\.md$/i, '')}
        </button>
        <span className="conflict-vs">and its copy</span>
        <button className="link-button" onClick={() => openNote(pair.copy)}>
          {noteTitle(pair.copy)}
        </button>
        <span className="conflict-count">{texts ? (changes === 0 ? 'identical' : `${changes} ${changes === 1 ? 'line differs' : 'lines differ'}`) : '…'}</span>
      </header>
      {texts && changes > 0 && !locked && (
        <pre className="conflict-diff">
          {shown.map(({ op, i }, k) => (
            <div key={i} className={`diff-${op.kind} ${k > 0 && shown[k - 1].i !== i - 1 ? 'diff-gap' : ''}`}>
              <span className="diff-mark">{op.kind === 'added' ? '+' : op.kind === 'removed' ? '−' : ' '}</span>
              {op.line || ' '}
            </div>
          ))}
        </pre>
      )}
      {locked && <p className="conflicts-intro">One of these is locked: open both side by side to compare them.</p>}
      <div className="conflict-actions">
        <button className="btn" disabled={busy} onClick={() => act('original')} title={`Keep “${noteTitle(pair.original)}” as it is; the copy goes to the bin`} data-keep="original">
          <FileCheck2 size={13} /> Keep the note
        </button>
        <button className="btn" disabled={busy || changes === 0} onClick={() => act('copy')} title="Use the copy’s version (− lines go, + lines stay); the copy goes to the bin" data-keep="copy">
          <Copy size={13} /> Keep the copy’s version
        </button>
        <button className="btn btn-primary" disabled={busy || changes === 0 || locked} onClick={() => act('combine')} title="Every line from both, in order; the copy goes to the bin" data-keep="combine">
          <Combine size={13} /> Combine both
        </button>
        <button className="btn" disabled={busy} onClick={() => act('both')} title="Keep both as separate notes (the copy is renamed)" data-keep="both">
          Keep both
        </button>
        <button
          className="btn"
          onClick={() => {
            openNote(pair.original)
            splitPane('right', { tab: pair.copy })
          }}
          title="Open them side by side"
        >
          <Columns2 size={13} /> Side by side
        </button>
      </div>
    </section>
  )
}
