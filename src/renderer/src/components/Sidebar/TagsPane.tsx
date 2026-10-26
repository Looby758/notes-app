import { useMemo } from 'react'
import { Hash } from 'lucide-react'
import { allTags, useNoteIndex } from '../../store/noteIndex'
import { showSearch } from '../../store/ui'

export default function TagsPane() {
  const version = useNoteIndex((s) => s.version)
  // `version` changes whenever any note's tags change.
  const tags = useMemo(() => allTags(), [version])

  if (tags.length === 0) {
    return (
      <div className="panel-empty">
        No tags yet. Add one anywhere in a note, like <code>#idea</code> or <code>#project/alpha</code>, or in frontmatter
        as <code>tags: [idea]</code>.
      </div>
    )
  }

  return (
    <div className="tags-list">
      {tags.map(({ name, count }) => (
        <button key={name} className="tag-row" onClick={() => showSearch(`#${name}`)} title={`Show notes tagged #${name}`}>
          <Hash size={13} />
          <span className="tag-name">{name}</span>
          <span className="tag-count">{count}</span>
        </button>
      ))}
    </div>
  )
}
