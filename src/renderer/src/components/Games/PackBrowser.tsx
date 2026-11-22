import { useEffect, useMemo, useState } from 'react'
import { ArrowUp, ChevronRight, FileArchive, Folder, FolderOpen, Gamepad2, HardDrive, House, Loader2, X } from 'lucide-react'
import { crumbsOf, describeBytes, parentPath, type ExplorerEntry, type ExplorerPlace } from '@shared/explorer'
import { errorMessage } from '../../lib/paths'
import { McText } from './SkyblockProfile'

const LAST_DIR = 'orbit.skyblock.packBrowserDir'

const readLast = (): string | null => {
  try {
    return localStorage.getItem(LAST_DIR)
  } catch {
    return null
  }
}
const saveLast = (dir: string): void => {
  try {
    localStorage.setItem(LAST_DIR, dir)
  } catch {
    // Starts in the Minecraft folder next time instead.
  }
}

const isZip = (e: ExplorerEntry): boolean => !e.isDir && /\.zip$/i.test(e.name)

/**
 * Orbit's own file browser for picking a Minecraft resource pack: a .zip, or a pack folder. Opens in
 * Minecraft's resourcepacks folder when there is one, and shows only folders and .zip files.
 */
export default function PackBrowser({ onPick, onSystem, close }: { onPick: (path: string) => void; onSystem: () => void; close: () => void }) {
  const [mcFolders, setMcFolders] = useState<string[]>([])
  const [places, setPlaces] = useState<ExplorerPlace[]>([])
  const [dir, setDir] = useState<string | null>(null)
  const [entries, setEntries] = useState<ExplorerEntry[] | null>(null)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<string | null>(null)

  useEffect(() => {
    void Promise.all([window.api.skyblockAddonPackFolders().catch(() => []), window.api.explorerPlaces().catch(() => [])]).then(([mc, pl]) => {
      setMcFolders(mc)
      setPlaces(pl.filter((p) => p.kind !== 'google' && p.kind !== 'notes'))
      setDir(readLast() ?? mc[0] ?? pl.find((p) => p.kind === 'downloads')?.path ?? pl[0]?.path ?? null)
    })
  }, [])

  useEffect(() => {
    if (!dir) return
    let live = true
    setEntries(null)
    setError('')
    setPicked(null)
    window.api
      .explorerList(dir)
      .then((list) => {
        if (!live) return
        setEntries(list)
        saveLast(dir)
      })
      .catch((err) => {
        if (!live) return
        setEntries([])
        setError(errorMessage(err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      })
    return () => {
      live = false
    }
  }, [dir])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const shown = useMemo(
    () =>
      (entries ?? [])
        .filter((e) => !e.hidden && (e.isDir || isZip(e)))
        .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })),
    [entries]
  )
  // A folder with pack.mcmeta (or assets/) in it is a pack you can use as it is.
  const isPack = !!entries?.some((e) => (!e.isDir && e.name.toLowerCase() === 'pack.mcmeta') || (e.isDir && e.name.toLowerCase() === 'assets'))
  const up = dir ? parentPath(dir) : null
  const pickedEntry = picked ? shown.find((e) => e.path === picked) : undefined

  const placeIcon = (p: ExplorerPlace) => (p.kind === 'drive' ? <HardDrive size={14} /> : p.kind === 'home' ? <House size={14} /> : <Folder size={14} />)

  return (
    <div className="modal-backdrop sba-browser-backdrop" onMouseDown={close}>
      <div className="modal sba-browser" onMouseDown={(e) => e.stopPropagation()} data-sba-browser>
        <header className="sba-browser-head">
          <strong>Choose a Minecraft pack</strong>
          <button className="icon-btn" title="Close" onClick={close}>
            <X size={15} />
          </button>
        </header>
        <div className="sba-browser-main">
          <nav className="sba-browser-places">
            {mcFolders.map((f) => (
              <button key={f} className={dir === f ? 'active' : ''} onClick={() => setDir(f)} data-sba-browser-place="minecraft">
                <Gamepad2 size={14} /> Minecraft packs
              </button>
            ))}
            {places.map((p) => (
              <button key={p.id} className={dir === p.path ? 'active' : ''} onClick={() => setDir(p.path)}>
                {placeIcon(p)} {p.label}
              </button>
            ))}
          </nav>
          <div className="sba-browser-files">
            <div className="sba-browser-bar">
              <button className="icon-btn" disabled={!up} title="Up a folder" onClick={() => up && setDir(up)}>
                <ArrowUp size={14} />
              </button>
              <div className="sba-browser-crumbs">
                {dir &&
                  crumbsOf(dir).map((c, i, all) => (
                    <span key={c.path}>
                      <button onClick={() => setDir(c.path)}>{c.name}</button>
                      {i < all.length - 1 && <ChevronRight size={12} className="faint" />}
                    </span>
                  ))}
              </div>
            </div>
            {isPack && (
              <div className="sba-browser-pack">
                <span>This folder is a resource pack.</span>
                <button className="btn btn-primary" onClick={() => dir && onPick(dir)} data-sba-browser-use-folder>
                  <FolderOpen size={13} /> Use this folder
                </button>
              </div>
            )}
            <ul className="sba-browser-list">
              {entries === null && (
                <li className="faint">
                  <Loader2 size={13} className="spin" /> Loading…
                </li>
              )}
              {error && <li className="setting-warning">{error}</li>}
              {entries !== null && !error && !shown.length && <li className="faint">No folders or .zip files here.</li>}
              {shown.map((e) => (
                <li key={e.path}>
                  <button
                    className={picked === e.path ? 'picked' : ''}
                    onClick={() => (e.isDir ? setDir(e.path) : setPicked(e.path))}
                    onDoubleClick={() => !e.isDir && onPick(e.path)}
                    data-sba-browser-entry={e.name}
                  >
                    {e.isDir ? <Folder size={15} /> : <FileArchive size={15} />}
                    <span className="sba-browser-name">{e.name.includes('§') ? <McText text={e.name} /> : e.name}</span>
                    {!e.isDir && <span className="faint">{describeBytes(e.size)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <footer className="sba-browser-foot">
          <button className="link-btn" onClick={onSystem}>
            Use the system file picker instead
          </button>
          <span className="sba-browser-chosen faint">{pickedEntry ? pickedEntry.name.replace(/§./g, '') : 'Pick a .zip, or open a pack folder.'}</span>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!picked} onClick={() => picked && onPick(picked)} data-sba-browser-use>
            Use this pack
          </button>
        </footer>
      </div>
    </div>
  )
}
