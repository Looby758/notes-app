import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { BookOpen, FolderOpen, FolderPlus, LibraryBig, Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-react'
import { isComicFile, percentRead, type ComicShelf, type ComicShelfItem } from '@shared/comics'
import { readComic, useComics } from '../../store/comics'
import { notify } from '../../store/notify'
import ContextMenu, { type MenuItem } from '../ContextMenu'
import ComicReader from './ComicReader'
import './comics.css'

/** The Comics tab: your shelf of comics, or the one you're reading. */
export default function ComicsPage() {
  const reading = useComics((s) => s.reading)
  return reading ? <ComicReader key={reading} id={reading} onClose={() => readComic(null)} /> : <Shelf />
}

type Sort = 'recent' | 'title' | 'added'
const SORT_KEY = 'comics:sort'

const coverUrl = (b: ComicShelfItem): string => `vault://comiccover/${b.id}?v=${b.size}`

function status(b: ComicShelfItem): string {
  if (b.missing) return 'Can’t find the file'
  if (!b.progress) return b.pageCount ? `New · ${b.pageCount.toLocaleString()} pages` : 'New'
  if (b.progress.finished) return 'Finished'
  return b.pageCount ? `Page ${(b.progress.page + 1).toLocaleString()} of ${b.pageCount.toLocaleString()}` : `Page ${b.progress.page + 1}`
}

function Shelf() {
  const [shelf, setShelf] = useState<ComicShelf | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>(() => (localStorage.getItem(SORT_KEY) as Sort) || 'recent')
  const [menu, setMenu] = useState<{ x: number; y: number; book: ComicShelfItem } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const load = (): void => void window.api.comicsShelf().then(setShelf, notify)
    load()
    return window.api.onComicsChanged(load)
  }, [])

  const added = (r: { shelf: ComicShelf; added: string[]; skipped: number }): void => {
    setShelf(r.shelf)
    if (r.skipped) notify(`${r.skipped === 1 ? 'One file wasn’t' : `${r.skipped} files weren’t`} added: comics need to be .cbz or .cbr files (zips or RARs of pictures).`)
  }
  const addFiles = (): void => void window.api.comicsAdd().then(added, notify)
  const addFolder = (): void => void window.api.comicsAddFolder().then(added, notify)

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setDragging(false)
    const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter((p) => p && isComicFile(p))
    if (paths.length) void window.api.comicsAdd(paths).then(added, notify)
    else if (e.dataTransfer.files.length) notify('Drop .cbz or .cbr comic files here.')
  }

  const books = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const list = (shelf?.books ?? []).filter((b) => words.every((w) => `${b.title} ${b.fileName}`.toLowerCase().includes(w)))
    return list.sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, undefined, { numeric: true })
      if (sort === 'added') return b.added - a.added
      return Math.max(b.lastRead, b.added) - Math.max(a.lastRead, a.added)
    })
  }, [shelf, query, sort])

  // The one to carry on with: the last one read that isn't finished.
  const current = useMemo(
    () => (shelf?.books ?? []).filter((b) => b.progress && !b.progress.finished && !b.missing).sort((a, b) => b.lastRead - a.lastRead)[0] ?? null,
    [shelf]
  )

  const items = (b: ComicShelfItem): MenuItem[] => [
    { label: 'Read', icon: <BookOpen size={14} />, onClick: () => readComic(b.id) },
    { label: 'Rename', icon: <Pencil size={14} />, onClick: () => setRenaming(b.id) },
    ...(b.progress ? [{ label: 'Start again (forget where I was)', icon: <RotateCcw size={14} />, onClick: () => void window.api.comicsResetProgress(b.id).then(setShelf, notify) }] : []),
    { label: 'Show the file', icon: <FolderOpen size={14} />, onClick: () => void window.api.comicsReveal(b.id).catch(notify) },
    'separator',
    { label: 'Take off the shelf', icon: <Trash2 size={14} />, danger: true, onClick: () => void window.api.comicsRemove(b.id).then(setShelf, notify) }
  ]

  return (
    <div
      className={`comics-page ${dragging ? 'dragging' : ''}`}
      data-comics-page
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      <div className="comics-inner">
        <header className="comics-head">
          <h2>
            <LibraryBig size={20} /> Comics
          </h2>
          {!!shelf?.pagesToday && <span className="comics-today" data-comics-today>{shelf.pagesToday.toLocaleString()} {shelf.pagesToday === 1 ? 'page' : 'pages'} read today</span>}
          <div className="comics-actions">
            <button className="btn btn-primary" onClick={addFiles} data-comics-add>
              <Plus size={14} /> Add comics
            </button>
            <button className="btn" onClick={addFolder} title="Adds every .cbz and .cbr in a folder (and the folders inside it)">
              <FolderPlus size={14} /> Add a folder
            </button>
          </div>
        </header>

        {shelf && shelf.books.length === 0 && (
          <div className="comics-empty" data-comics-empty>
            <LibraryBig size={42} />
            <h3>Your comic shelf is empty</h3>
            <p>Add .cbz or .cbr comics (big compendiums are fine), or drop them here. They stay where they are on your computer; Orbit only reads them.</p>
            <button className="btn btn-primary" onClick={addFiles}>
              <Plus size={14} /> Add comics
            </button>
          </div>
        )}

        {current && !query && (
          <button className="comics-continue" onClick={() => readComic(current.id)} data-comics-continue>
            {current.hasCover ? <img src={coverUrl(current)} alt="" /> : <span className="comic-cover-blank small"><LibraryBig size={22} /></span>}
            <span className="comics-continue-text">
              <em>Carry on reading</em>
              <strong>{current.title}</strong>
              <span>{status(current)}</span>
              <span className="comic-bar">
                <span style={{ width: `${percentRead(current.progress, current.pageCount)}%` }} />
              </span>
            </span>
          </button>
        )}

        {!!shelf?.books.length && (
          <div className="comics-tools">
            <label className="comics-search">
              <Search size={13} />
              <input placeholder="Find a comic…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as Sort)
                localStorage.setItem(SORT_KEY, e.target.value)
              }}
              title="Sort the shelf"
            >
              <option value="recent">Recently read</option>
              <option value="title">Title</option>
              <option value="added">Recently added</option>
            </select>
          </div>
        )}

        <div className="comics-grid" data-comics-grid>
          {books.map((b) => (
            <div key={b.id} className={`comic-card ${b.missing ? 'missing' : ''}`} data-comic={b.id}>
              <button
                className="comic-cover"
                onClick={() => readComic(b.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ x: e.clientX, y: e.clientY, book: b })
                }}
                title={b.fileName}
              >
                {b.hasCover ? (
                  <img src={coverUrl(b)} alt="" loading="lazy" draggable={false} />
                ) : (
                  <span className="comic-cover-blank">
                    <LibraryBig size={26} />
                    <span>{b.title}</span>
                  </span>
                )}
                <span className="comic-bar">
                  <span style={{ width: `${percentRead(b.progress, b.pageCount)}%` }} />
                </span>
              </button>
              {renaming === b.id ? (
                <input
                  className="comic-rename"
                  autoFocus
                  defaultValue={b.title}
                  onBlur={(e) => {
                    setRenaming(null)
                    void window.api.comicsRename(b.id, e.target.value).then(setShelf, notify)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                />
              ) : (
                <div className="comic-name" title={b.title}>
                  {b.title}
                </div>
              )}
              <div className="comic-meta">{status(b)}</div>
            </div>
          ))}
        </div>
        {shelf && shelf.books.length > 0 && books.length === 0 && <p className="comics-none">No comic matches “{query}”.</p>}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items(menu.book)} onClose={() => setMenu(null)} />}
    </div>
  )
}
