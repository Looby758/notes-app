import { useState } from 'react'
import Picker from './Picker'
import { useNoteItems } from './noteItems'

/** What a blank tab shows: pick a note (or type a new name) to open it in this tab. */
export default function NewTabPage({ autoFocus = true }: { autoFocus?: boolean }) {
  const [query, setQuery] = useState('')
  const items = useNoteItems(query)

  return (
    <div className="newtab">
      <div className="newtab-inner">
        <h2>Open a note in this tab</h2>
        <p>Pick a note below or in the file tree, or type a name to create one.</p>
        <Picker
          query={query}
          onQuery={setQuery}
          items={items}
          placeholder="Find or create a note…"
          empty="No notes yet. Type a name to create one."
          autoFocus={autoFocus}
        />
      </div>
    </div>
  )
}
