import { useEffect, useMemo, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { insertInlineIntoActiveNote } from '../../lib/editorController'
import { fuzzyFilter } from '../../lib/fuzzy'
import { isWithin, toVaultUrl } from '../../lib/paths'
import { imageMarkerValue, markerText } from '../../lib/script'
import { vaultImages } from '../Editor/scriptTools'
import { useVault } from '../../store/vault'
import { usePrefs } from '../../store/prefs'
import { notify } from '../../store/notify'
import { ensureScreenshots, useScreenshots } from '../../store/screenshots'
import { pictureMatches, tagSummary } from '../../lib/screenshots'
import { openSpecialTab, SCREENSHOTS_TAB } from '../../lib/editorController'
import { Images } from 'lucide-react'
import Picker, { Highlighted, type PickerItem } from './Picker'

/**
 * "/Image cue" in a script: pick a picture from your attachments or add one from the computer, and
 * an [IMAGE: name.png] marker goes in at the cursor. The search looks at file names and at the
 * characters and episodes tagged in the screenshot organiser ("maggie s4e9").
 */
export default function ImageCueDialog({ close }: { close: () => void }) {
  const [query, setQuery] = useState('')
  const tree = useVault((s) => s.tree)
  const folder = usePrefs((s) => s.prefs.attachmentFolder)
  const tags = useScreenshots((s) => s.pictures)
  useEffect(() => {
    void ensureScreenshots()
  }, [])
  // Pictures in the attachments folder first.
  const images = useMemo(() => {
    const all = vaultImages()
    const inFolder = (p: string): boolean => (folder ? isWithin(p, folder) : !p.includes('/'))
    return [...all.filter(inFolder), ...all.filter((p) => !inFolder(p))]
  }, [tree, folder])

  const insert = (paths: string[]): void => {
    close()
    const all = vaultImages()
    const text = paths.map((p) => markerText('IMAGE', imageMarkerValue(p, all))).join(' ')
    if (!insertInlineIntoActiveNote(text)) notify('Open a script first; the image cue goes into it.', 'info')
  }

  const fromComputer = async (): Promise<void> => {
    try {
      const saved = await window.api.pickAttachment(folder, true)
      if (!saved.length) return
      await useVault.getState().refresh()
      insert(saved)
    } catch (err) {
      notify(err)
    }
  }

  const items = useMemo<PickerItem[]>(() => {
    // Name, character and episode matches first, then looser matches on the name (typos).
    const matched = images.filter((p) => pictureMatches(p, tags[p], query))
    const loose = query.trim() ? fuzzyFilter(images.filter((p) => !matched.includes(p)), query, (p) => p.slice(p.lastIndexOf('/') + 1)) : []
    const found = [...matched.map((item) => ({ item, positions: [] as number[] })), ...loose]
      .slice(0, 200)
      .map(
        ({ item: path, positions }): PickerItem => ({
          id: path,
          icon: <img className="image-cue-thumb" src={toVaultUrl(path)} alt="" loading="lazy" draggable={false} />,
          label: <Highlighted text={path.slice(path.lastIndexOf('/') + 1)} positions={positions} />,
          detail: tagSummary(tags[path]) || (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : undefined),
          run: () => insert([path])
        })
      )
    return [
      ...found,
      {
        id: ':organise',
        icon: <Images size={15} />,
        label: 'Tag your screenshots…',
        detail: 'by character and episode, to find them here',
        run: () => {
          close()
          openSpecialTab(SCREENSHOTS_TAB)
        }
      },
      {
        id: ':computer',
        icon: <FolderOpen size={15} />,
        label: 'Add a picture from the computer…',
        detail: `copied into ${folder || 'your notes'}`,
        run: () => void fromComputer()
      }
    ]
  }, [images, query, folder, tags])

  return (
    <div className="image-cue-dialog" data-image-cue>
      <Picker
        query={query}
        onQuery={setQuery}
        items={items}
        placeholder="Find a picture by name, character or episode (“maggie s4e9”)…"
        empty="No pictures match."
        onEscape={close}
      />
    </div>
  )
}
