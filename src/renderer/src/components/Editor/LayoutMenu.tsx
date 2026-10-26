import { useCallback, useRef, useState } from 'react'
import { Columns2, Columns3, Grid2x2, LayoutGrid, Rows2, Scaling, Square } from 'lucide-react'
import { applyPreset, equalizePanes, splitPane } from '../../lib/editorController'
import type { Preset } from '../../lib/layout'
import ContextMenu, { type MenuItem } from '../ContextMenu'

const PRESETS: { preset: Preset; label: string; icon: typeof Square }[] = [
  { preset: 'single', label: 'Single pane', icon: Square },
  { preset: 'columns2', label: 'Two columns', icon: Columns2 },
  { preset: 'columns3', label: 'Three columns', icon: Columns3 },
  { preset: 'rows2', label: 'Two rows', icon: Rows2 },
  { preset: 'grid4', label: 'Grid of four', icon: Grid2x2 }
]

/** Title-bar button for arranging the editor area. */
export default function LayoutMenu() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setPos(null), [])

  const items: MenuItem[] = [
    ...PRESETS.map(({ preset, label, icon: Icon }): MenuItem => ({ label, icon: <Icon size={15} />, onClick: () => applyPreset(preset) })),
    'separator',
    { label: 'Split right', icon: <Columns2 size={15} />, onClick: () => splitPane('right') },
    { label: 'Split down', icon: <Rows2 size={15} />, onClick: () => splitPane('down') },
    { label: 'Even out pane sizes', icon: <Scaling size={15} />, onClick: equalizePanes }
  ]

  return (
    <>
      <button
        ref={button}
        className="icon-btn"
        title="Layout"
        onClick={() => {
          const r = button.current!.getBoundingClientRect()
          setPos(pos ? null : { x: r.left, y: r.bottom + 4 })
        }}
      >
        <LayoutGrid size={15} />
      </button>
      {pos && <ContextMenu x={pos.x} y={pos.y} items={items} onClose={close} />}
    </>
  )
}
