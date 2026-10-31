import './soundboard.css'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, FolderOpen, Headphones, Keyboard, Mic, MicOff, Music, Pencil, Plus, Square, Trash2, Volume2, X } from 'lucide-react'
import {
  acceleratorFromEvent,
  hotkeyLabel,
  hotkeyOwner,
  isVirtualCableInput,
  isVirtualCableOutput,
  SOUND_COLOURS,
  SOUND_TYPES,
  VOICE_EFFECTS,
  type BoardHotkeys,
  type SoundClip
} from '@shared/soundboard'
import { IS_MAC } from '@shared/platform'
import { setSoundboard, useSoundboard, type RepeatPress } from '../../store/soundboard'
import { useMusic } from '../../store/music'
import { callLevel, micLevel, playClip, setBoardStatus, stopAll, stopClip } from '../../lib/soundboard'

/**
 * The soundboard tab: buttons for your sound clips (each with a hotkey that works in games), the
 * voice changer, "Hear yourself", and your music into the call. How the sound reaches Discord is
 * explained in the setup box: a virtual cable, which Discord uses as its microphone.
 */

export default function SoundboardPage() {
  const cableFound = useCableFound()
  const sendId = useSoundboard((s) => s.sendId)
  return (
    <div className="sb-page">
      <TopBar />
      <div className="sb-body">
        <main className="sb-main">
          {(!sendId || !cableFound) && <SetupGuide cableFound={cableFound} />}
          <Board />
        </main>
        <aside className="sb-side">
          <VoiceChanger />
          <MusicToCall />
          <Outputs />
          <BoardHotkeysBox />
        </aside>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Devices

function useDevices(kind: MediaDeviceKind): MediaDeviceInfo[] {
  const [list, setList] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    const load = (): void =>
      void navigator.mediaDevices.enumerateDevices().then((d) => setList(d.filter((x) => x.kind === kind && x.deviceId !== 'default' && x.deviceId !== 'communications')))
    load()
    navigator.mediaDevices.addEventListener('devicechange', load)
    return () => navigator.mediaDevices.removeEventListener('devicechange', load)
  }, [kind])
  return list
}

/** Whether a virtual cable is installed (null while still looking). Picks it for you the first time. */
function useCableFound(): boolean | null {
  const outputs = useDevices('audiooutput')
  const sendId = useSoundboard((s) => s.sendId)
  const [looked, setLooked] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setLooked(true), 600)
    return () => clearTimeout(t)
  }, [])
  const cable = outputs.find((d) => isVirtualCableOutput(d.label))
  useEffect(() => {
    if (!sendId && cable) setSoundboard({ sendId: cable.deviceId })
  }, [sendId, cable])
  if (!looked && outputs.length === 0) return null
  return !!cable || (!!sendId && outputs.some((d) => d.deviceId === sendId))
}

// ---------------------------------------------------------------------------------------------
// Top bar

function TopBar() {
  const playing = useSoundboard((s) => s.playing.length > 0)
  const problem = useSoundboard((s) => s.problem)
  const [skipped, setSkipped] = useState<string[]>([])
  return (
    <>
      <header className="sb-top">
        <h2>Soundboard</h2>
        <CallMeter />
        <div className="sb-gap" />
        <button className="btn" disabled={!playing} onClick={stopAll} title="Stop every sound that's playing">
          <Square size={13} /> Stop all
        </button>
        <button className="btn" title="Open the folder Orbit keeps your sounds in" onClick={() => void window.api.soundboardShowFolder()}>
          <FolderOpen size={14} />
        </button>
        <button
          className="btn btn-primary"
          onClick={async () => {
            const res = await window.api.soundboardPick()
            setBoardStatus(res.status)
            setSkipped(res.skipped)
          }}
        >
          <Plus size={14} /> Add sounds
        </button>
      </header>
      {problem && (
        <p className="sb-problem">
          {problem}
          <button className="icon-btn" title="Hide" onClick={() => useSoundboard.setState({ problem: null })}>
            <X size={13} />
          </button>
        </p>
      )}
      {skipped.length > 0 && (
        <p className="sb-problem">
          Not added: {skipped.join(', ')}
          <button className="icon-btn" title="Hide" onClick={() => setSkipped([])}>
            <X size={13} />
          </button>
        </p>
      )}
    </>
  )
}

function useLevel(read: () => number): React.RefObject<HTMLDivElement | null> {
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    let shown = 0
    const tick = (): void => {
      shown = Math.max(read(), shown * 0.9)
      if (bar.current) bar.current.style.transform = `scaleX(${shown})`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [read])
  return bar
}

function CallMeter() {
  const running = useSoundboard((s) => s.running)
  const sending = useSoundboard((s) => !!s.sendId)
  const bar = useLevel(callLevel)
  if (!running) return null
  return (
    <div className="sb-callmeter" title={sending ? 'How loud what the call hears from Orbit is' : 'Nothing is sent to a call yet: pick the cable under “Where sound goes”'}>
      <span>{sending ? 'Call hears' : 'Not sent to a call'}</span>
      <div className="sb-meter">
        <div ref={bar} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Setup

function SetupGuide({ cableFound }: { cableFound: boolean | null }) {
  const [open, setOpen] = useState(true)
  if (cableFound === null) return null
  const mac = IS_MAC
  return (
    <section className="sb-setup">
      <button className="sb-setup-head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <strong>{cableFound ? 'Pick where the call’s sound goes' : 'One-time setup: get sounds into Discord and games'}</strong>
      </button>
      {open && (
        <div className="sb-setup-body">
          <p>
            Orbit can’t be a microphone by itself, so it plays your voice, the sounds and your music into a free <em>virtual cable</em>. Discord (or the game) then
            listens to the cable instead of your mic. Without it, the sounds still play, but only you hear them.
          </p>
          <ol>
            <li className={cableFound ? 'done' : ''}>
              {cableFound ? <Check size={13} /> : null}
              {mac ? (
                <>
                  Install <button className="link-btn" onClick={() => void window.api.soundboardOpenLink('blackhole')}>BlackHole 2ch</button> (or{' '}
                  <button className="link-btn" onClick={() => void window.api.soundboardOpenLink('cable')}>VB-CABLE for Mac</button>), then restart Orbit.
                </>
              ) : (
                <>
                  Install <button className="link-btn" onClick={() => void window.api.soundboardOpenLink('cable')}>VB-CABLE</button> (free): unzip it, right-click{' '}
                  <code>VBCABLE_Setup_x64.exe</code> → Run as administrator → Install Driver, then restart the PC.
                </>
              )}
            </li>
            <li>
              Here in Orbit, under <strong>Where sound goes</strong>, set <em>Send to the call</em> to <strong>{mac ? 'BlackHole 2ch' : 'CABLE Input'}</strong> (Orbit picks it for you
              when it finds it).
            </li>
            <li>
              Turn on <strong>Use my mic through Orbit</strong> on the right and pick your real microphone.
            </li>
            <li>
              In Discord: Settings → Voice & Video → <strong>Input Device</strong> = <strong>{mac ? 'BlackHole 2ch' : 'CABLE Output'}</strong>. Also set Noise Suppression to <em>None</em>{' '}
              (Krisp cuts out sounds and music), and turn off <em>Automatic Gain Control</em>. In a game, pick the same device as the voice chat mic.
            </li>
          </ol>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------------------------
// The board

function Board() {
  const clips = useSoundboard((s) => s.board.clips)
  const loaded = useSoundboard((s) => s.loaded)
  const [editing, setEditing] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [moving, setMoving] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<string[]>([])

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragOver(false)
    if (moving) return
    const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean)
    if (!paths.length) return
    const res = await window.api.soundboardAddFiles(paths)
    setBoardStatus(res.status)
    setSkipped(res.skipped)
  }

  return (
    <section
      className={`sb-board${dragOver ? ' drag' : ''}`}
      onDragOver={(e) => {
        if (moving || ![...e.dataTransfer.types].includes('Files')) return
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
      }}
      onDrop={(e) => void onDrop(e)}
    >
      {skipped.length > 0 && <p className="sb-problem">Not added: {skipped.join(', ')}</p>}
      {loaded && clips.length === 0 ? (
        <div className="sb-empty">
          <Volume2 size={28} />
          <p>No sounds yet. Press “Add sounds” or drop sound files here ({SOUND_TYPES.slice(0, 6).join(', ')}…).</p>
          <p className="sb-hint">Give each one a hotkey and press it in a game or Discord: everyone in the call hears it.</p>
        </div>
      ) : (
        <div className="sb-grid">
          {clips.map((clip, i) => (
            <ClipButton
              key={clip.id}
              clip={clip}
              onEdit={() => setEditing(editing === clip.id ? null : clip.id)}
              editing={editing === clip.id}
              onDragStart={() => setMoving(clip.id)}
              onDragEnd={() => setMoving(null)}
              onDropHere={() => {
                if (moving && moving !== clip.id) void window.api.soundboardMove(moving, i).then(setBoardStatus)
                setMoving(null)
              }}
            />
          ))}
        </div>
      )}
      {editing && clips.some((c) => c.id === editing) && <ClipEditor clip={clips.find((c) => c.id === editing)!} onClose={() => setEditing(null)} />}
    </section>
  )
}

function ClipButton({
  clip,
  editing,
  onEdit,
  onDragStart,
  onDragEnd,
  onDropHere
}: {
  clip: SoundClip
  editing: boolean
  onEdit: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onDropHere: () => void
}) {
  const playing = useSoundboard((s) => s.playing.includes(clip.id))
  const error = useSoundboard((s) => s.hotkeyErrors[clip.id])
  return (
    <div
      className={`sb-clip${playing ? ' playing' : ''}${editing ? ' editing' : ''}`}
      style={{ ['--clip' as string]: clip.colour }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.stopPropagation()
        onDropHere()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onEdit()
      }}
    >
      <button className="sb-clip-play" onClick={() => void playClip(clip.id)} title={playing ? 'Playing (click to play again)' : 'Play'}>
        <span className="sb-clip-emoji">{clip.emoji || '🔊'}</span>
        <span className="sb-clip-name">{clip.name}</span>
        {clip.hotkey ? <kbd className={error ? 'bad' : ''}>{hotkeyLabel(clip.hotkey)}</kbd> : <span className="sb-clip-nokey">No hotkey</span>}
      </button>
      <div className="sb-clip-tools">
        {playing && (
          <button className="icon-btn" title="Stop" onClick={() => stopClip(clip.id)}>
            <Square size={12} />
          </button>
        )}
        <button className="icon-btn" title="Edit (name, hotkey, volume)" onClick={onEdit}>
          <Pencil size={12} />
        </button>
      </div>
    </div>
  )
}

const EMOJIS = ['🔊', '📯', '😂', '💀', '🔥', '👏', '🥁', '🚨', '💥', '🎺', '🐐', '🤡', '😱', '🎉', '👻', '🧟', '🔫', '💨', '🐸', '❌', '✅', '🎵', '🙄', '😴']

function ClipEditor({ clip, onClose }: { clip: SoundClip; onClose: () => void }) {
  const [name, setName] = useState(clip.name)
  const error = useSoundboard((s) => s.hotkeyErrors[clip.id])
  useEffect(() => setName(clip.name), [clip.id, clip.name])
  const update = (patch: Parameters<typeof window.api.soundboardUpdate>[1]): void => void window.api.soundboardUpdate(clip.id, patch).then(setBoardStatus)
  const saveName = (): void => {
    const n = name.trim()
    if (n && n !== clip.name) update({ name: n })
  }
  return (
    <div className="sb-editor" style={{ ['--clip' as string]: clip.colour }}>
      <header>
        <h3>Edit sound</h3>
        <button className="icon-btn" title="Done" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <label>
        Name
        <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === 'Enter' && saveName()} />
      </label>
      <div className="sb-field">
        <span>Hotkey</span>
        <HotkeyInput value={clip.hotkey} owner={clip.id} onChange={(accel) => update({ hotkey: accel })} />
        {error && <p className="sb-bad">{error}</p>}
      </div>
      <label>
        Volume {Math.round(clip.volume * 100)}%
        <input type="range" min={0} max={2} step={0.05} value={clip.volume} onChange={(e) => update({ volume: Number(e.target.value) })} />
      </label>
      <div className="sb-field">
        <span>Colour</span>
        <div className="sb-swatches">
          {SOUND_COLOURS.map((c) => (
            <button key={c} className={c === clip.colour ? 'on' : ''} style={{ background: c }} title={c} onClick={() => update({ colour: c })} />
          ))}
        </div>
      </div>
      <div className="sb-field">
        <span>Picture</span>
        <div className="sb-emojis">
          {EMOJIS.map((e) => (
            <button key={e} className={e === (clip.emoji || '🔊') ? 'on' : ''} onClick={() => update({ emoji: e === '🔊' ? '' : e })}>
              {e}
            </button>
          ))}
        </div>
      </div>
      <footer>
        <button className="btn" onClick={() => void playClip(clip.id)}>
          <Volume2 size={13} /> Try it
        </button>
        <button
          className="btn danger"
          onClick={async () => {
            const ok = await window.api.confirm({ message: `Remove “${clip.name}” from the soundboard?`, detail: 'Orbit’s copy of the sound is deleted. The file you added it from isn’t touched.', ok: 'Remove' })
            if (!ok) return
            onClose()
            setBoardStatus(await window.api.soundboardRemove(clip.id))
          }}
        >
          <Trash2 size={13} /> Remove
        </button>
      </footer>
    </div>
  )
}

/** Click, then press the keys. Esc cancels, Backspace clears. */
function HotkeyInput({ value, owner, onChange }: { value: string; owner: string; onChange: (accel: string) => void }) {
  const [recording, setRecording] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const board = useSoundboard((s) => s.board)
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        setRecording(false)
        setHint(null)
        return
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        onChange('')
        setRecording(false)
        setHint(null)
        return
      }
      const accel = acceleratorFromEvent(e)
      if (!accel) {
        if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) setHint('Letters and numbers need Ctrl, Alt or Shift+Ctrl with them. F keys and the number pad work on their own.')
        return
      }
      const taken = hotkeyOwner(board, accel, owner)
      setHint(taken ? `Moved from ${taken}.` : null)
      onChange(accel)
      setRecording(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, board, owner, onChange])
  return (
    <div className="sb-hotkey">
      <button className={`btn${recording ? ' recording' : ''}`} onClick={() => setRecording(!recording)}>
        <Keyboard size={13} /> {recording ? 'Press the keys… (Esc cancels)' : value ? hotkeyLabel(value) : 'Set a hotkey'}
      </button>
      {value && !recording && (
        <button className="icon-btn" title="No hotkey" onClick={() => onChange('')}>
          <X size={13} />
        </button>
      )}
      {hint && <p className="sb-hint">{hint}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Side panels

function Box({ title, icon, children, right }: { title: string; icon: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="sb-box">
      <header>
        <h3>
          {icon} {title}
        </h3>
        {right}
      </header>
      {children}
    </section>
  )
}

function Toggle({ checked, onChange, children, disabled }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className="sb-toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  )
}

function Slider({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <label className="sb-slider">
      <span>
        {label} <em>{Math.round(value * 100)}%</em>
      </span>
      <input type="range" min={0} max={2} step={0.05} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}

function MicMeter() {
  const bar = useLevel(micLevel)
  return (
    <div className="sb-meter" title="Your mic">
      <div ref={bar} />
    </div>
  )
}

function VoiceChanger() {
  const s = useSoundboard()
  const mics = useDevices('audioinput').filter((d) => !isVirtualCableInput(d.label))
  return (
    <Box
      title="Voice changer"
      icon={<Mic size={13} />}
      right={
        s.micOn && (
          <button className={`icon-btn${s.micMuted ? ' sb-muted' : ''}`} title={s.micMuted ? 'Unmute my mic' : 'Mute my mic (sounds still play)'} onClick={() => setSoundboard({ micMuted: !s.micMuted })}>
            {s.micMuted ? <MicOff size={14} /> : <Mic size={14} />}
          </button>
        )
      }
    >
      <Toggle checked={s.micOn} onChange={(on) => setSoundboard({ micOn: on })}>
        Use my mic through Orbit
      </Toggle>
      {s.micOn && (
        <>
          <select value={s.micId} onChange={(e) => setSoundboard({ micId: e.target.value })}>
            <option value="">Default microphone</option>
            {mics.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Microphone'}
              </option>
            ))}
          </select>
          <MicMeter />
        </>
      )}
      {!s.micOn && <p className="sb-hint">Turn this on when Discord listens to the cable, or your friends will only hear the sounds, not you.</p>}
      <div className="sb-voices">
        {VOICE_EFFECTS.map((v) => (
          <button
            key={v.id}
            className={s.voice === v.id ? 'on' : ''}
            title={v.blurb}
            onClick={() => setSoundboard({ voice: v.id, voiceOn: true })}
          >
            <span>{v.emoji}</span>
            {v.name}
          </button>
        ))}
      </div>
      {s.voice !== 'none' && (
        <Toggle checked={s.voiceOn} onChange={(on) => setSoundboard({ voiceOn: on })}>
          Voice changer on
        </Toggle>
      )}
      <Toggle checked={s.hearYourself} onChange={(on) => setSoundboard({ hearYourself: on })} disabled={!s.micOn}>
        <Headphones size={12} /> Hear yourself
      </Toggle>
      {s.hearYourself && s.micOn && <p className="sb-hint">Use headphones, or your speakers will feed back into the mic.</p>}
      <Slider label="Mic volume" value={s.micVolume} onChange={(v) => setSoundboard({ micVolume: v })} disabled={!s.micOn} />
      <Toggle checked={s.noiseSuppression} onChange={(on) => setSoundboard({ noiseSuppression: on })} disabled={!s.micOn}>
        Cut background noise
      </Toggle>
    </Box>
  )
}

function MusicToCall() {
  const musicOn = useSoundboard((s) => s.musicOn)
  const musicVolume = useSoundboard((s) => s.musicVolume)
  const spotify = useMusic((s) => !s.local && !!s.state)
  return (
    <Box title="Music into the call" icon={<Music size={13} />}>
      <Toggle checked={musicOn} onChange={(on) => setSoundboard({ musicOn: on })}>
        Play my Orbit music into the call
      </Toggle>
      <Slider label="Call’s music volume" value={musicVolume} onChange={(v) => setSoundboard({ musicVolume: v })} disabled={!musicOn} />
      <p className="sb-hint">
        Separate from the player’s volume, so you can listen loud while the call hears it quietly.
        {musicOn && spotify ? ' Spotify plays in its own app, so Orbit can’t send it: play your own songs in Orbit’s player (My music) instead.' : ' Works with your own songs in the Music player.'}
      </p>
    </Box>
  )
}

function Outputs() {
  const s = useSoundboard()
  const outputs = useDevices('audiooutput')
  const real = outputs.filter((d) => !isVirtualCableOutput(d.label))
  const cables = outputs.filter((d) => isVirtualCableOutput(d.label))
  return (
    <Box title="Where sound goes" icon={<Volume2 size={13} />}>
      <label className="sb-label">
        Send to the call
        <select value={s.sendId} onChange={(e) => setSoundboard({ sendId: e.target.value })}>
          <option value="">Nowhere (only I hear the sounds)</option>
          {cables.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
          {real.length > 0 && (
            <optgroup label="Other outputs">
              {real.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || 'Speakers'}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <label className="sb-label">
        I hear it on
        <select value={s.monitorId} onChange={(e) => setSoundboard({ monitorId: e.target.value })}>
          <option value="">Default speakers or headphones</option>
          {real.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || 'Speakers'}
            </option>
          ))}
        </select>
      </label>
      <Toggle checked={s.hearSounds} onChange={(on) => setSoundboard({ hearSounds: on })}>
        I hear the sounds too
      </Toggle>
      <Slider label="Sounds volume (the call)" value={s.soundsVolume} onChange={(v) => setSoundboard({ soundsVolume: v })} />
      <Slider label="What I hear" value={s.monitorVolume} onChange={(v) => setSoundboard({ monitorVolume: v })} />
      <label className="sb-label">
        Pressing a sound that’s playing
        <select value={s.repeat} onChange={(e) => setSoundboard({ repeat: e.target.value as RepeatPress })}>
          <option value="restart">Starts it again</option>
          <option value="stop">Stops it</option>
          <option value="overlap">Plays it again on top</option>
        </select>
      </label>
    </Box>
  )
}

const BOARD_KEYS: { key: keyof BoardHotkeys; label: string }[] = [
  { key: 'stopAll', label: 'Stop all sounds' },
  { key: 'voiceToggle', label: 'Voice changer on/off' },
  { key: 'muteToggle', label: 'Mute my mic' }
]

function BoardHotkeysBox() {
  const hotkeys = useSoundboard((s) => s.board.hotkeys)
  const errors = useSoundboard((s) => s.hotkeyErrors)
  return (
    <Box title="Hotkeys" icon={<Keyboard size={13} />}>
      <p className="sb-hint">These work everywhere, even in a full-screen game.</p>
      {BOARD_KEYS.map(({ key, label }) => (
        <div className="sb-field" key={key}>
          <span>{label}</span>
          <HotkeyInput value={hotkeys[key]} owner={key} onChange={(accel) => void window.api.soundboardSetBoardHotkey(key, accel).then(setBoardStatus)} />
          {errors[key] && <p className="sb-bad">{errors[key]}</p>}
        </div>
      ))}
    </Box>
  )
}
