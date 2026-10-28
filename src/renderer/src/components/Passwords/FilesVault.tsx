import { useEffect, useMemo, useState } from 'react'
import { Download, FileText, Image, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { loadFileVault, openSafeFile, pickIntoFileVault, removeFromFileVault, renameInFileVault, useFileVault, type SafeFile } from '../../lib/passwords/files'
import { notify } from '../../store/notify'
import EmptyArt from '../Motion/EmptyArt'

const sizeText = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`)

/** The file vault, inside the unlocked password vault (so streamer mode already covers it). */
export default function FilesVault() {
  const files = useFileVault((s) => s.files)
  const loaded = useFileVault((s) => s.loaded)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [trashOriginals, setTrashOriginals] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    loadFileVault().catch((err) => notify(err))
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...files].sort((a, b) => b.added - a.added).filter((f) => !q || f.name.toLowerCase().includes(q))
  }, [files, query])
  const current = files.find((f) => f.id === selected)

  const add = async (): Promise<void> => {
    setBusy(true)
    try {
      const n = await pickIntoFileVault(trashOriginals)
      if (n) notify(`Locked away ${n} file${n === 1 ? '' : 's'}${trashOriginals ? ', and sent the originals to the Bin' : ''}.`, 'info')
    } catch (err) {
      notify(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="passwords-body" data-files-vault>
      <div className="passwords-list">
        <div className="passwords-search">
          <Search size={14} />
          <input
            value={query}
            placeholder={`Search ${files.length} file${files.length === 1 ? '' : 's'}`}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button className="btn btn-primary passwords-new" onClick={add} disabled={busy} data-files-vault-add>
          <Plus size={14} /> {busy ? 'Locking away…' : 'Add files'}
        </button>
        <label className="files-vault-originals">
          <input type="checkbox" checked={trashOriginals} onChange={(e) => setTrashOriginals(e.target.checked)} /> Send the originals to the Bin after
        </label>
        <ul>
          {shown.map((f) => (
            <li key={f.id}>
              <button className={`passwords-row ${selected === f.id ? 'active' : ''}`} onClick={() => setSelected(f.id)} data-files-vault-row={f.id}>
                <span className="passwords-row-title">
                  {f.type.startsWith('image/') ? <Image size={13} /> : <FileText size={13} />} {f.name}
                </span>
                <span className="passwords-row-sub">
                  {sizeText(f.size)} · added {new Date(f.added).toLocaleDateString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {loaded && files.length === 0 && (
          <div className="empty-with-art">
            <EmptyArt kind="key" />
            <p className="passwords-none">No files yet. Photos and files you add here are encrypted with your master password.</p>
          </div>
        )}
        {files.length > 0 && shown.length === 0 && <p className="passwords-none">Nothing matches “{query}”.</p>}
      </div>
      <div className="passwords-detail">
        {current ? (
          <Preview key={current.id} file={current} gone={() => setSelected(null)} />
        ) : (
          <p className="passwords-none">Pick a file on the left, or add some.</p>
        )}
      </div>
    </div>
  )
}

/** One unlocked file. Its contents live in a blob URL only while it's shown. */
function Preview({ file, gone }: { file: SafeFile; gone: () => void }) {
  const [data, setData] = useState<Uint8Array | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)

  useEffect(() => {
    let made: string | null = null
    let live = true
    openSafeFile(file)
      .then((bytes) => {
        if (!live) return
        setData(bytes)
        if (file.type === 'text/plain') setText(new TextDecoder().decode(bytes))
        else if (/^(image|video|audio)\//.test(file.type))
          setUrl((made = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: file.type }))))
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : String(err)))
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [file.id, file.type])

  const saveCopy = async (): Promise<void> => {
    if (!data) return
    try {
      if (await window.api.saveSafeCopy(file.name, data)) notify('Saved an unlocked copy. That copy isn’t protected by the vault.', 'info')
    } catch (err) {
      notify(err)
    }
  }
  const remove = async (): Promise<void> => {
    const ok = await window.api.confirm({
      message: `Delete “${file.name}” from the file vault?`,
      detail: 'It will be gone from Notes for good.',
      ok: 'Delete',
      cancel: 'Keep it'
    })
    if (!ok) return
    try {
      await removeFromFileVault(file.id)
      gone()
    } catch (err) {
      notify(err)
    }
  }
  const rename = async (): Promise<void> => {
    const name = renaming
    setRenaming(null)
    if (name && name !== file.name) await renameInFileVault(file.id, name).catch(notify)
  }

  return (
    <div className="passwords-card files-vault-preview" data-files-vault-preview>
      <div className="passwords-top">
        {renaming !== null ? (
          <input
            className="files-vault-rename"
            autoFocus
            value={renaming}
            onChange={(e) => setRenaming(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => e.key === 'Enter' && rename()}
          />
        ) : (
          <h3>{file.name}</h3>
        )}
        <div className="passwords-actions">
          <button className="btn" onClick={() => setRenaming(file.name)} title="Rename">
            <Pencil size={14} />
          </button>
          <button className="btn" onClick={saveCopy} disabled={!data} data-files-vault-save>
            <Download size={14} /> Save a copy
          </button>
          <button className="btn" onClick={remove} title="Delete for good" data-files-vault-delete>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {error ? (
        <p className="passwords-none">{error}</p>
      ) : !data ? (
        <p className="passwords-none">Unlocking…</p>
      ) : text !== null ? (
        <pre className="files-vault-text">{text}</pre>
      ) : url && file.type.startsWith('image/') ? (
        <img src={url} alt={file.name} />
      ) : url && file.type.startsWith('video/') ? (
        <video src={url} controls />
      ) : url && file.type.startsWith('audio/') ? (
        <audio src={url} controls />
      ) : (
        <p className="passwords-none">Notes can’t show this kind of file. Use “Save a copy” to open it in another app.</p>
      )}
    </div>
  )
}
