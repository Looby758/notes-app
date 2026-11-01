import { useEffect, useMemo, useRef, useState } from 'react'
import { FileArchive, Folder, FolderInput, FolderOutput, KeyRound, Loader2, Lock } from 'lucide-react'
import { describeContents, type ArchiveEntry } from '@shared/archive'
import { describeBytes, type ExplorerEntry } from '@shared/explorer'
import FileIcon from '../FileIcon'

/**
 * The zip / RAR / 7z opener in the file explorer's preview pane: what's inside an archive, tick
 * the ones you want (or none for everything), and unpack them into a new folder or straight into
 * this one. A password box shows when the archive needs one.
 */

/** Big archives list this many rows; unpacking still gets everything. */
const MAX_ROWS = 400

const isPasswordError = (err: unknown): boolean => /password/i.test(String(err))
const cleanError = (err: unknown): string => String(err instanceof Error ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

interface Row {
  name: string
  depth: number
  label: string
  isDir: boolean
  size: number
  encrypted: boolean
}

/** Every file and folder in path order, folders included even when the archive doesn't list them. */
function rowsOf(entries: ArchiveEntry[]): Row[] {
  const rows = new Map<string, Row>()
  for (const e of entries) {
    const parts = e.name.replace(/\/$/, '').split('/').filter(Boolean)
    parts.forEach((part, i) => {
      const last = i === parts.length - 1
      const name = parts.slice(0, i + 1).join('/') + (last && !e.isDir ? '' : '/')
      if (!rows.has(name)) rows.set(name, { name, depth: i, label: part, isDir: !last || e.isDir, size: last ? e.size : 0, encrypted: last && e.encrypted })
    })
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
}

export default function ArchivePreview({ entry, onExtract }: { entry: ExplorerEntry; onExtract: (opts: { names?: string[]; password?: string; intoFolder: boolean }) => Promise<boolean> }) {
  const [entries, setEntries] = useState<ArchiveEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needsPassword, setNeedsPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [tried, setTried] = useState<string | undefined>(undefined)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const passwordRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    setError(null)
    setEntries(null)
    window.api
      .explorerArchiveList(entry.path, tried)
      .then((list) => {
        if (!live) return
        setEntries(list)
        // A zip lists its names openly but locks what's in them.
        if (!tried && list.some((e) => e.encrypted)) setNeedsPassword(true)
        else if (tried) setNeedsPassword(false)
      })
      .catch((err) => {
        if (!live) return
        if (isPasswordError(err)) {
          setNeedsPassword(true)
          if (tried) setError('That password isn’t right.')
        } else setError(cleanError(err))
        setEntries([])
      })
    return () => {
      live = false
    }
  }, [entry.path, tried])

  useEffect(() => {
    if (needsPassword) passwordRef.current?.focus()
  }, [needsPassword])

  const rows = useMemo(() => rowsOf(entries ?? []), [entries])
  const total = useMemo(() => (entries ?? []).reduce((n, e) => n + (e.isDir ? 0 : e.size), 0), [entries])
  const locked = needsPassword && !password

  const toggle = (name: string): void => {
    const next = new Set(picked)
    if (next.has(name)) next.delete(name)
    else {
      next.add(name)
      // Picking a folder covers what's in it.
      for (const p of next) if (p !== name && name.endsWith('/') && p.startsWith(name)) next.delete(p)
    }
    setPicked(next)
  }
  const coveredByFolder = (name: string): boolean => [...picked].some((p) => p !== name && p.endsWith('/') && name.startsWith(p))

  const extract = (intoFolder: boolean): void => {
    if (busy) return
    setBusy(true)
    setError(null)
    onExtract({ names: picked.size ? [...picked] : undefined, password: password || tried, intoFolder })
      .then((ok) => {
        if (ok) setPicked(new Set())
      })
      .catch((err) => {
        if (isPasswordError(err)) {
          setNeedsPassword(true)
          setError(password ? 'That password isn’t right.' : 'This archive has a password. Type it in first.')
        } else setError(cleanError(err))
      })
      .finally(() => setBusy(false))
  }

  return (
    <div className="explorer-archive">
      <div className="explorer-archive-head">
        <FileArchive size={15} />
        {entries === null ? (
          <span>Looking inside…</span>
        ) : rows.length ? (
          <span>
            {describeContents(entries)} · {describeBytes(total)} unpacked
          </span>
        ) : (
          <span>{needsPassword ? 'Locked with a password' : 'Nothing inside'}</span>
        )}
      </div>

      {needsPassword && (
        <form
          className="explorer-archive-password"
          onSubmit={(e) => {
            e.preventDefault()
            setError(null)
            setTried(password || undefined)
          }}
        >
          <KeyRound size={13} />
          <input ref={passwordRef} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.stopPropagation()} autoComplete="off" />
          {!entries?.length && (
            <button className="btn" type="submit" disabled={!password}>
              Unlock
            </button>
          )}
        </form>
      )}

      {entries === null ? (
        <div className="explorer-archive-list loading">
          <Loader2 size={16} className="spin" />
        </div>
      ) : (
        rows.length > 0 && (
          <div className="explorer-archive-list" role="list">
            {rows.slice(0, MAX_ROWS).map((r) => {
              const covered = coveredByFolder(r.name)
              return (
                <label key={r.name} className="explorer-archive-row" style={{ paddingLeft: 6 + r.depth * 14 }} title={r.name}>
                  <input type="checkbox" checked={covered || picked.has(r.name)} disabled={covered} onChange={() => toggle(r.name)} />
                  {r.isDir ? <Folder size={13} /> : <FileIcon path={r.label} size={13} />}
                  <span className="name">{r.label}</span>
                  {r.encrypted && <Lock size={11} />}
                  {!r.isDir && <span className="size">{describeBytes(r.size)}</span>}
                </label>
              )
            })}
            {rows.length > MAX_ROWS && <div className="explorer-more">Showing the first {MAX_ROWS} of {rows.length}. Unpacking gets them all.</div>}
          </div>
        )
      )}

      {error && <p className="explorer-archive-error">{error}</p>}

      {!!rows.length && (
        <div className="explorer-actions">
          <button className="btn btn-primary" disabled={busy || locked} onClick={() => extract(true)} title="Into a new folder next to the archive">
            {busy ? <Loader2 size={13} className="spin" /> : <FolderOutput size={13} />} {picked.size ? `Extract ${picked.size} picked` : 'Extract all'}
          </button>
          <button className="btn" disabled={busy || locked} onClick={() => extract(false)} title="Straight into this folder (nothing already here is replaced)">
            <FolderInput size={13} /> Extract here
          </button>
        </div>
      )}
    </div>
  )
}

/** Asks for a password before packing files into a new zip or 7z. */
export function CompressDialog({ count, onDone, onClose }: { count: number; onDone: (format: 'zip' | '7z', password: string) => void; onClose: () => void }) {
  const [format, setFormat] = useState<'zip' | '7z'>('zip')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const mismatch = !!again && password !== again
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal explorer-compress"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') onClose()
        }}
        onSubmit={(e) => {
          e.preventDefault()
          if (password && password === again) onDone(format, password)
        }}
      >
        <h3>
          <Lock size={15} /> Compress {count === 1 ? '1 item' : `${count} items`} with a password
        </h3>
        <div className="explorer-compress-formats">
          {(['zip', '7z'] as const).map((f) => (
            <label key={f}>
              <input type="radio" name="format" checked={format === f} onChange={() => setFormat(f)} /> .{f}
              <span>{f === 'zip' ? 'Opens almost anywhere' : 'Smaller, and hides the file names too'}</span>
            </label>
          ))}
        </div>
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="new-password" />
        <input type="password" placeholder="Type it again" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
        <p className="explorer-hint">{mismatch ? 'The two don’t match.' : 'There’s no way to get the files back without it, so keep it somewhere safe (like the password vault).'}</p>
        <div className="explorer-actions">
          <button className="btn btn-primary" type="submit" disabled={!password || password !== again}>
            Compress
          </button>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
