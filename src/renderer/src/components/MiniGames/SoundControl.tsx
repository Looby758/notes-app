import { useSyncExternalStore, type CSSProperties } from 'react'
import { Volume1, Volume2, VolumeX } from 'lucide-react'
import { onSoundSettings, playSound, setSoundSettings, soundSettings } from '../../lib/gameSound'

/** The speaker button (sound on or off) and a volume slider, for every mini game. */
export default function SoundControl() {
  const s = useSyncExternalStore(onSoundSettings, soundSettings)
  const Icon = !s.on || s.volume === 0 ? VolumeX : s.volume < 0.5 ? Volume1 : Volume2
  return (
    <div className={`minigames-sound ${s.on ? 'on' : 'off'}`} data-minigames-sound>
      <button
        className="minigames-sound-btn"
        onClick={() => {
          setSoundSettings({ on: !s.on, volume: !s.on && s.volume === 0 ? 0.6 : s.volume })
          if (!s.on) playSound('select')
        }}
        title={s.on ? 'Turn sound effects off' : 'Turn sound effects on'}
        aria-pressed={s.on}
        data-minigames-sound-toggle
      >
        <Icon size={15} />
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={s.on ? s.volume : 0}
        onChange={(e) => setSoundSettings({ on: Number(e.target.value) > 0, volume: Number(e.target.value) })}
        onPointerUp={() => playSound('chip')}
        aria-label="Sound effects volume"
        style={{ '--v': s.on ? s.volume : 0 } as CSSProperties}
      />
    </div>
  )
}
