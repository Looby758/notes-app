import { useEffect, useMemo, useState } from 'react'
import { MapPin, Search } from 'lucide-react'
import { placeMarkdown, type Place } from '@shared/places'
import { focusEditor, insertBlockIntoActiveNote } from '../../lib/editorController'
import { notify } from '../../store/notify'
import Picker, { type PickerItem } from './Picker'

/**
 * "Add a place": search for somewhere (a shop, an address, a town) and put it in the note as a
 * link that opens Google Maps, shown with a small map. The search is OpenStreetMap's, which is
 * free, so there's nothing to set up.
 */
export default function PlaceDialog({ close }: { close: () => void }) {
  const [query, setQuery] = useState('')
  const [places, setPlaces] = useState<Place[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')

  // Search once typing pauses (the free search asks apps not to search on every key).
  useEffect(() => {
    const q = query.trim()
    setError('')
    if (q.length < 2) {
      setPlaces([])
      setSearching(false)
      return
    }
    let stale = false
    setSearching(true)
    const timer = setTimeout(() => {
      window.api
        .searchPlaces(q)
        .then((res) => {
          if (stale) return
          setPlaces(res.places)
          setError(res.error ?? '')
        })
        .finally(() => !stale && setSearching(false))
    }, 600)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [query])

  const items = useMemo<PickerItem[]>(() => {
    const insert = (markdown: string): void => {
      close()
      if (insertBlockIntoActiveNote(markdown)) focusEditor()
      else notify('Open a note first; the place goes into it.', 'info')
    }
    const found = places.map(
      (p, i): PickerItem => ({
        id: `${i}:${p.lat},${p.lon}`,
        icon: <MapPin size={15} />,
        label: p.name,
        detail: p.address,
        run: () => insert(placeMarkdown(p))
      })
    )
    const q = query.trim()
    if (!q) return found
    // Always offer a plain Google Maps search too, e.g. for somewhere the free search doesn't know.
    return [
      ...found,
      {
        id: 'google',
        icon: <Search size={15} />,
        label: `Link a Google Maps search for “${q}”`,
        detail: 'no map preview',
        run: () => insert(placeMarkdown({ name: q, query: q }))
      }
    ]
  }, [places, query, close])

  return (
    <Picker
      query={query}
      onQuery={setQuery}
      items={items}
      placeholder="Find a place… (a shop, an address, a town)"
      empty={query.trim().length < 2 ? 'Type a place name or an address.' : searching ? 'Searching…' : error || 'Nothing found.'}
      onEscape={close}
    />
  )
}
