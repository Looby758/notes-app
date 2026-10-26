import { useMemo, useState } from 'react'
import { Folder, Hash, ListPlus } from 'lucide-react'
import type { FileNode } from '@shared/types'
import { useUI } from '../../store/ui'
import { useVault } from '../../store/vault'
import { useSelection } from '../../store/selection'
import { allTags, getNoteText } from '../../store/noteIndex'
import { notify } from '../../store/notify'
import { addTagMany, moveMany, notesIn, removeTagMany, setPropertyMany } from '../../lib/bulk'
import { readFrontmatter } from '../../lib/properties'
import { fuzzyFilter } from '../../lib/fuzzy'

function folders(nodes: FileNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type !== 'folder') continue
    out.push(n.path)
    folders(n.children ?? [], out)
  }
  return out
}

/** The small dialogs behind the bulk bar: move to a folder, add/remove a tag, set a property. */
export default function BulkDialog({ close }: { close: () => void }) {
  const action = useUI((s) => s.bulkAction)
  const paths = useSelection((s) => s.paths)
  const count = notesIn(paths).length
  if (action === 'move') return <MoveTo paths={paths} close={close} />
  if (action === 'tag') return <TagDialog paths={paths} count={count} close={close} />
  return <PropertyDialog paths={paths} count={count} close={close} />
}

function MoveTo({ paths, close }: { paths: string[]; close: () => void }) {
  const tree = useVault((s) => s.tree)
  const [query, setQuery] = useState('')
  const list = useMemo(() => ['', ...folders(tree)], [tree])
  const shown = query.trim() ? fuzzyFilter(list.slice(1), query, (f) => f).map((r) => r.item) : list
  const go = async (folder: string): Promise<void> => {
    close()
    await moveMany(paths, folder)
  }
  return (
    <div className="bulk-dialog" data-bulk-dialog="move">
      <div className="picker-input">
        <Folder size={15} />
        <input
          autoFocus
          value={query}
          placeholder={`Move ${paths.length} ${paths.length === 1 ? 'item' : 'items'} to…`}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            if (e.key === 'Enter' && shown[0] !== undefined) go(shown[0])
          }}
        />
      </div>
      <div className="bulk-folders">
        {shown.slice(0, 50).map((f) => (
          <button key={f || '/'} onClick={() => go(f)} data-folder={f}>
            <Folder size={14} /> {f || 'Top level (no folder)'}
          </button>
        ))}
      </div>
    </div>
  )
}

function TagDialog({ paths, count, close }: { paths: string[]; count: number; close: () => void }) {
  const [tag, setTag] = useState('')
  // Tags the selected notes have in their properties, to offer for removing.
  const present = useMemo(() => {
    const s = new Set<string>()
    for (const p of notesIn(paths)) {
      const prop = readFrontmatter(getNoteText(p) ?? '')?.properties.find((x) => x.key === 'tags')
      if (Array.isArray(prop?.value)) prop.value.forEach((t) => s.add(t))
    }
    return [...s].sort()
  }, [paths])
  const run = async (remove: boolean, t = tag): Promise<void> => {
    if (!t.trim()) return
    close()
    const n = remove ? await removeTagMany(paths, t) : await addTagMany(paths, t)
    notify(`${remove ? 'Removed' : 'Added'} #${t.replace(/^#/, '')} ${remove ? 'from' : 'to'} ${n} ${n === 1 ? 'note' : 'notes'}.`, 'info')
  }
  return (
    <div className="bulk-dialog" data-bulk-dialog="tag">
      <div className="picker-input">
        <Hash size={15} />
        <input
          autoFocus
          list="bulk-tags"
          value={tag}
          placeholder={`Tag to add to ${count} ${count === 1 ? 'note' : 'notes'}`}
          onChange={(e) => setTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            if (e.key === 'Enter') run(false)
          }}
        />
        <datalist id="bulk-tags">
          {allTags().map((t) => (
            <option key={t.name} value={t.name} />
          ))}
        </datalist>
        <button className="btn btn-primary" onClick={() => run(false)} disabled={!tag.trim()}>
          Add tag
        </button>
      </div>
      {present.length > 0 && (
        <div className="bulk-present">
          <span>Remove from all:</span>
          {present.map((t) => (
            <button key={t} className="props-chip" onClick={() => run(true, t)} title={`Remove #${t} from the selected notes`}>
              #{t} ×
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PropertyDialog({ paths, count, close }: { paths: string[]; count: number; close: () => void }) {
  const [key, setKey] = useState('status')
  const [value, setValue] = useState('')
  const run = async (remove: boolean): Promise<void> => {
    close()
    const n = await setPropertyMany(paths, key, remove ? undefined : value)
    notify(`${remove ? 'Removed' : 'Set'} “${key}” ${remove ? 'from' : 'on'} ${n} ${n === 1 ? 'note' : 'notes'}.`, 'info')
  }
  return (
    <div className="bulk-dialog" data-bulk-dialog="property">
      <div className="bulk-form">
        <ListPlus size={15} />
        <input list="bulk-keys" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Property" aria-label="Property" />
        <datalist id="bulk-keys">
          {['status', 'priority', 'date', 'due', 'tags', 'people', 'source'].map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Value"
          aria-label="Value"
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            if (e.key === 'Enter') run(false)
          }}
        />
      </div>
      <div className="bulk-form-foot">
        <span>
          On {count} {count === 1 ? 'note' : 'notes'}
        </span>
        <button className="btn" onClick={() => run(true)} disabled={!key.trim()}>
          Remove it
        </button>
        <button className="btn btn-primary" onClick={() => run(false)} disabled={!key.trim()}>
          Set
        </button>
      </div>
    </div>
  )
}
