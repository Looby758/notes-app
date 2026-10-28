import { useMemo } from 'react'
import { Hash } from 'lucide-react'
import { allTags, useNoteIndex } from '../../store/noteIndex'
import { showSearch } from '../../store/ui'
import { usePrefs } from '../../store/prefs'
import EmptyArt from '../Motion/EmptyArt'

export default function TagsPane() {
  const version = useNoteIndex((s) => s.version)
  const hideTemplates = usePrefs((s) => s.prefs.hideTemplatesFromTags && s.prefs.templatesFolder)
  // `version` changes whenever any note's tags change.
  const tags = useMemo(() => allTags(), [version, hideTemplates])

  if (tags.length === 0) {
    return (
      <div className="panel-empty">
        <EmptyArt kind="tag" size={44} />
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
