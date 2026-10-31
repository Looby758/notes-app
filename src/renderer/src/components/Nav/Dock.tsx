import './nav.css'
import { useState, type DragEvent } from 'react'
import { LayoutGrid } from 'lucide-react'
import { usePrefs } from '../../store/prefs'
import { featuresFor, moveFeature, openLauncher, toggleFeatureIn, type Feature, type FeaturePlace } from '../../lib/features'
import { showKeys } from '@shared/platform'

const DRAG_TYPE = 'application/x-orbit-feature'

/** A feature's button, used by the top bar and the dock: its icon, a badge, and a lit-up look while it's on. */
export function FeatureButton({ feature: f, place, index, className = 'icon-btn' }: { feature: Feature; place: FeaturePlace; index: number; className?: string }) {
  const Icon = f.icon
  const Badge = f.badge
  const active = f.useActive?.() ?? false
  const [over, setOver] = useState(false)
  const onDrop = (e: DragEvent): void => {
    const id = e.dataTransfer.getData(DRAG_TYPE)
    setOver(false)
    if (!id) return
    e.preventDefault()
    moveFeature(place, id, index)
  }
  return (
    <button
      className={`${className} feature-btn ${active ? 'active' : ''} ${over ? 'drop-before' : ''}`}
      onClick={f.run}
      title={f.name}
      data-label={f.name}
      data-feature={f.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, f.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onContextMenu={(e) => {
        e.preventDefault()
        toggleFeatureIn(place, f.id)
      }}
    >
      <Icon size={className === 'icon-btn' ? 15 : 18} />
      {Badge && <Badge />}
    </button>
  )
}

/** The features you picked for the top bar (Settings → Finding features, or the pins in the launcher). */
export function TopbarFeatures() {
  const ids = usePrefs((s) => s.prefs.topbarFeatures)
  return (
    <>
      {featuresFor(ids).map((f, i) => (
        <FeatureButton key={f.id} feature={f} place="topbarFeatures" index={i} />
      ))}
    </>
  )
}

/** The dock: a slim strip down the left edge with the features you use most. Drag to reorder, right-click to remove. */
export default function Dock() {
  const show = usePrefs((s) => s.prefs.showDock)
  const ids = usePrefs((s) => s.prefs.dockFeatures)
  if (!show) return null
  return (
    <nav className="dock" data-dock>
      {featuresFor(ids).map((f, i) => (
        <FeatureButton key={f.id} feature={f} place="dockFeatures" index={i} className="dock-btn" />
      ))}
      <div className="dock-spacer" />
      <button className="dock-btn" onClick={openLauncher} title={`All features (${showKeys('Ctrl+Shift+Space')})`} data-label="All features">
        <LayoutGrid size={18} />
      </button>
    </nav>
  )
}
