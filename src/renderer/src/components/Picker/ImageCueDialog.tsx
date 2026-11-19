import { useMemo, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { insertInlineIntoActiveNote } from '../../lib/editorController'
import { fuzzyFilter } from '../../lib/fuzzy'
import { isWithin, toVaultUrl } from '../../lib/paths'
import { imageMarkerValue, markerText } from '../../lib/script'
import { vaultImages } from '../Editor/scriptTools'
import { useVault } from '../../store/vault'
import { usePrefs } from '../../store/prefs'
import { notify } from '../../store/notify'
import Picker, { Highlighted, type PickerItem } from './Picker'

/**
 * "/Image cue" in a script: pick a picture from your attachments (searching by name) or add one
 * from the computer, and an [IMAGE: name.png] marker goes in at the cursor.
 */
export default function ImageCueDialog({ close }: { close: () => void }) {
  const [query, setQuery] = useState('')
  const tree = useVault((s) => s.tree)
  const folder = usePrefs((s) => s.prefs.attachmentFolder)
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
    const found = fuzzyFilter(images, query, (p) => p.slice(p.lastIndexOf('/') + 1))
      .slice(0, 200)
      .map(
        ({ item: path, positions }): PickerItem => ({
          id: path,
          icon: <img className="image-cue-thumb" src={toVaultUrl(path)} alt="" loading="lazy" draggable={false} />,
          label: <Highlighted text={path.slice(path.lastIndexOf('/') + 1)} positions={positions} />,
          detail: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : undefined,
          run: () => insert([path])
        })
      )
    return [
      ...found,
      {
        id: ':computer',
        icon: <FolderOpen size={15} />,
        label: 'Add a picture from the computer…',
        detail: `copied into ${folder || 'your notes'}`,
        run: () => void fromComputer()
      }
    ]
  }, [images, query, folder])

  return (
    <div className="image-cue-dialog" data-image-cue>
      <Picker
        query={query}
        onQuery={setQuery}
        items={items}
        placeholder="Find a picture for this image cue…"
        empty="No pictures match."
        onEscape={close}
      />
    </div>
  )
}
