import './voicePopout.css'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Clock,
  Gamepad2,
  Headphones,
  HeadphoneOff,
  History,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  Minus,
  MonitorPlay,
  Music2,
  PhoneOff,
  Radio,
  RefreshCw,
  Scissors,
  Square,
  Trash2,
  Video,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import { callClock, callLength, memberState, peopleList, type CallRecord, type ChatMessage, type VoiceMember } from '@shared/discord'
import { ROBLOX_ID, stripGames, type Game } from '@shared/games'
import type { SoundClip } from '@shared/soundboard'
import { cleanError, useDiscord, watchDiscord } from '../../store/discord'
import { CALL_CLIP_SECONDS, closeMic, micLevel, openMic, saveCallClip, startClipBuffer, stopClipBuffer, useCallAudio } from '../../lib/callAudio'

/**
 * The Discord voice pop-out (its own window, opened with #discord-popout; main/discordPopout.ts
 * remembers where it was left). Meant to sit on a second screen while you're in a call: who's in
 * it and who's talking, each person's volume (and muting them just for you), your own mute,
 * deafen, push-to-talk and leave, your mic level, the call timer, the channel's chat, Orbit's game
 * shortcuts, the soundboard, a 30-second call clip, and the call history.
 *
 * Everything goes through the same Discord connection as the Discord voice tab (main/discord.ts).
 */

type Tab = 'chat' | 'sounds' | 'history'
const TAB_KEY = 'discordPopout.tab'
const CLIP_KEY = 'discordPopout.clipBuffer'

function readKey<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null
    return v && allowed.includes(v) ? v : fallback
  } catch {
    return fallback
  }
}
function writeKey(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Not important.
  }
}

/** A short message at the bottom of the window ("Saved the last 30 seconds"). */
function useFlash(): [string | null, (text: string) => void] {
  const [text, setText] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const flash = (t: string): void => {
    clearTimeout(timer.current)
    setText(t)
    timer.current = setTimeout(() => setText(null), 4000)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  return [text, flash]
}

export default function VoicePopout() {
  useEffect(watchDiscord, [])
  const stage = useDiscord((s) => s.stage)
  const channel = useDiscord((s) => s.channel)
  const [flashText, flash] = useFlash()
  const run = async (what: () => Promise<unknown>): Promise<void> => {
    try {
      await what()
    } catch (err) {
      flash(cleanError(err))
    }
  }

  // The mic meter is open while the window is; the clip buffer only while you're in a call.
  const [clipOn, setClipOn] = useState(() => readKey(CLIP_KEY, ['on', 'off'] as const, 'on') === 'on')
  const inCall = stage === 'ready' && !!channel
  useEffect(() => {
    if (!inCall) return
    void openMic()
    return closeMic
  }, [inCall])
  useEffect(() => {
    if (!inCall || !clipOn) return
    void startClipBuffer()
    return () => stopClipBuffer()
  }, [inCall, clipOn])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) void window.api.minimizeDiscordPopout()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="vp">
      <TitleBar />
      <div className="vp-body">
        {stage !== 'ready' ? (
          <NotReady />
        ) : !channel ? (
          <NotInCall />
        ) : (
          <>
            <MyControls
              run={run}
              flash={flash}
              clipOn={clipOn}
              setClipOn={(on) => {
                setClipOn(on)
                writeKey(CLIP_KEY, on ? 'on' : 'off')
              }}
            />
            <CallList run={run} />
            <GameStrip flash={flash} />
            <Tabs run={run} />
          </>
        )}
      </div>
      {flashText && <div className="vp-flash">{flashText}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// The title bar: the channel, the call timer, and the window buttons

function TitleBar() {
  const channel = useDiscord((s) => s.channel)
  return (
    <div className="vp-bar">
      <Headphones size={14} className="vp-bar-icon" />
      <span className="vp-bar-name" title={channel ? `${channel.name}${channel.server ? ` · ${channel.server}` : ''}` : 'Discord voice'}>
        {channel ? channel.name : 'Discord voice'}
        {channel?.server && <span className="vp-bar-server"> · {channel.server}</span>}
      </span>
      {channel && <CallTimer since={channel.joinedAt} />}
      <button className="icon-btn" title="Minimise (Esc)" onClick={() => void window.api.minimizeDiscordPopout()}>
        <Minus size={14} />
      </button>
      <button className="icon-btn" title="Close the pop-out (you stay in the call)" onClick={() => void window.api.closeDiscordPopout()}>
        <X size={14} />
      </button>
    </div>
  )
}

function CallTimer({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <span className="vp-timer" title="How long you’ve been in this call">
      <Clock size={12} /> {callClock(now - since)}
    </span>
  )
}

// ---------------------------------------------------------------------------------------------
// Before you're in a call

function NotReady() {
  const stage = useDiscord((s) => s.stage)
  const error = useDiscord((s) => s.error)
  const text =
    stage === 'setup'
      ? 'Set up Discord voice in Orbit first (the Discord voice tab), then this window shows your calls.'
      : stage === 'signed-out'
        ? 'Sign in to Discord in Orbit to see your call here.'
        : stage === 'authorizing'
          ? 'Press Authorize in the Discord window to let Orbit in.'
          : stage === 'connecting'
            ? 'Looking for Discord on this computer…'
            : 'Discord isn’t open on this computer. Start it and this picks it up within a few seconds.'
  return (
    <div className="vp-empty">
      {(stage === 'connecting' || stage === 'authorizing') && <Loader2 size={18} className="spin" />}
      <p>{text}</p>
      {error && <p className="vp-error">{error}</p>}
      {stage === 'signed-out' && (
        <button className="btn btn-primary" onClick={() => void window.api.discordSignIn()}>
          Sign in with Discord
        </button>
      )}
      {stage === 'no-discord' && (
        <button className="btn" onClick={() => void window.api.discordRetry()}>
          <RefreshCw size={14} /> Try now
        </button>
      )}
    </div>
  )
}

function NotInCall() {
  return (
    <>
      <div className="vp-empty">
        <Headphones size={20} />
        <p>You’re not in a voice call. Join one in Discord and it shows here.</p>
      </div>
      <section className="vp-section vp-grow">
        <h4 className="vp-head">
          <History size={13} /> Recent calls
        </h4>
        <CallHistory />
      </section>
    </>
  )
}

// ---------------------------------------------------------------------------------------------
// Your own controls

function MyControls({ run, flash, clipOn, setClipOn }: { run: (f: () => Promise<unknown>) => Promise<void>; flash: (t: string) => void; clipOn: boolean; setClipOn: (on: boolean) => void }) {
  const mute = useDiscord((s) => s.mute)
  const deaf = useDiscord((s) => s.deaf)
  const meSpeaking = useDiscord((s) => !!s.channel?.members.find((m) => m.id === s.me?.id)?.speaking)
  const [holding, setHolding] = useState(false)
  const muted = mute || deaf

  const press = (down: boolean): void => {
    if (down === holding) return
    setHolding(down)
    void run(() => window.api.discordPushToTalk(down))
  }
  const leave = (): void => void run(() => window.api.discordLeave())

  return (
    <section className="vp-section vp-me">
      <div className="vp-me-buttons">
        <button className={`vp-big${muted ? ' on' : ''}`} onClick={() => void run(() => window.api.discordSet('mute'))} title="Mute / unmute in Discord">
          {muted ? <MicOff size={18} /> : <Mic size={18} />}
          <span>{muted ? 'Muted' : 'Mute'}</span>
        </button>
        <button className={`vp-big${deaf ? ' on' : ''}`} onClick={() => void run(() => window.api.discordSet('deaf'))} title="Deafen / undeafen in Discord">
          {deaf ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
          <span>{deaf ? 'Deafened' : 'Deafen'}</span>
        </button>
        <button
          className={`vp-big${holding ? ' talking' : ''}`}
          disabled={!holding && (!mute || deaf)}
          title={deaf ? 'Undeafen first' : mute ? 'Hold to talk: unmutes you while it’s held' : 'Mute first, then hold this to talk'}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            press(true)
          }}
          onPointerUp={() => press(false)}
          onPointerCancel={() => press(false)}
          onLostPointerCapture={() => press(false)}
          onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && !e.repeat && press(true)}
          onKeyUp={(e) => (e.key === ' ' || e.key === 'Enter') && press(false)}
        >
          <Radio size={18} />
          <span>{holding ? 'Talking' : 'Push to talk'}</span>
        </button>
        <button className="vp-big vp-leave" onClick={leave} title="Leave the voice call">
          <PhoneOff size={18} />
          <span>Leave</span>
        </button>
      </div>
      <MicMeter muted={muted} discordHears={meSpeaking} />
      <ClipButton flash={flash} clipOn={clipOn} setClipOn={setClipOn} />
    </section>
  )
}

/** Your mic level, and whether Discord hears you talking (your ring lighting up in the call). */
function MicMeter({ muted, discordHears }: { muted: boolean; discordHears: boolean }) {
  const bar = useRef<HTMLDivElement>(null)
  const micOn = useCallAudio((s) => s.micOn)
  const problem = useCallAudio((s) => s.micProblem)
  useEffect(() => {
    let frame = 0
    let shown = 0
    const tick = (): void => {
      const level = micLevel()
      // Up fast, down slowly, so the bar is easy to read.
      shown = level > shown ? level : shown * 0.9
      if (bar.current) bar.current.style.transform = `scaleX(${shown.toFixed(3)})`
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])
  return (
    <div className="vp-meter-row">
      <Mic size={13} />
      <div className={`vp-meter${muted ? ' muted' : ''}`} title={problem ?? 'Your mic level'}>
        <div ref={bar} className="vp-meter-fill" />
      </div>
      <span className={`vp-hears${discordHears ? ' on' : ''}`} title="Lights up when Discord hears you talking">
        {muted ? 'Muted' : discordHears ? 'Coming through' : micOn ? 'Quiet' : 'No mic'}
      </span>
    </div>
  )
}

function ClipButton({ flash, clipOn, setClipOn }: { flash: (t: string) => void; clipOn: boolean; setClipOn: (on: boolean) => void }) {
  const buffering = useCallAudio((s) => s.buffering)
  const buffered = useCallAudio((s) => s.buffered)
  const saving = useCallAudio((s) => s.saving)
  const problem = useCallAudio((s) => s.clipProblem)
  const save = async (): Promise<void> => {
    try {
      const name = await saveCallClip()
      flash(`Saved the last ${CALL_CLIP_SECONDS} seconds: ${name}`)
    } catch (err) {
      flash(`Couldn’t save the clip: ${cleanError(err)}`)
    }
  }
  return (
    <div className="vp-clip-row">
      <button className="btn vp-clip" disabled={!buffering || saving} onClick={() => void save()} title={`Save the last ${CALL_CLIP_SECONDS} seconds of the call’s sound to your recordings folder (it shows in Clips)`}>
        {saving ? <Loader2 size={14} className="spin" /> : <Scissors size={14} />}
        Clip last {CALL_CLIP_SECONDS}s
      </button>
      <span className="vp-clip-state" title={problem ?? undefined}>
        {!clipOn ? 'Clip recording is off' : buffering ? `${buffered}s ready` : problem ? problem : 'Starting…'}
      </span>
      <label className="vp-clip-toggle" title="Keep the last 30 seconds of the call ready to save (in memory only; nothing is saved until you press Clip)">
        <input type="checkbox" checked={clipOn} onChange={(e) => setClipOn(e.target.checked)} /> Keep ready
      </label>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Who's in the call

function CallList({ run }: { run: (f: () => Promise<unknown>) => Promise<void> }) {
  const members = useDiscord((s) => s.channel?.members ?? [])
  const me = useDiscord((s) => s.me)
  const talking = members.filter((m) => m.speaking).length
  // You first, then everyone else in name order.
  const sorted = [...members].sort((a, b) => Number(b.id === me?.id) - Number(a.id === me?.id))
  return (
    <section className="vp-section">
      <h4 className="vp-head">
        <Volume2 size={13} /> {members.length} in the call{talking > 0 ? ` · ${talking} talking` : ''}
      </h4>
      <ul className="vp-members">
        {sorted.map((m) => (
          <MemberRow key={m.id} m={m} me={m.id === me?.id} run={run} />
        ))}
      </ul>
    </section>
  )
}

function Avatar({ m }: { m: Pick<VoiceMember, 'avatar' | 'name' | 'speaking'> }) {
  return (
    <span className={`dc-avatar vp-avatar${m.speaking ? ' speaking' : ''}`}>
      {m.avatar ? <img src={m.avatar} alt="" /> : <span>{m.name.slice(0, 1).toUpperCase()}</span>}
    </span>
  )
}

function MemberRow({ m, me, run }: { m: VoiceMember; me: boolean; run: (f: () => Promise<unknown>) => Promise<void> }) {
  const state = memberState(m)
  // The slider moves at once; Discord is told a few times a second while it's dragged.
  const [volume, setVolume] = useState(m.volume)
  const dragging = useRef(false)
  const sendTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    if (!dragging.current) setVolume(m.volume)
  }, [m.volume])
  useEffect(() => () => clearTimeout(sendTimer.current), [])
  const sendVolume = (v: number, now = false): void => {
    clearTimeout(sendTimer.current)
    const go = (): void => void run(() => window.api.discordUserVoice(m.id, { volume: v }))
    if (now) go()
    else sendTimer.current = setTimeout(go, 120)
  }
  const watch = (): void => void run(() => window.api.watchDiscordStream())

  return (
    <li className={`vp-member${m.localMute ? ' local-muted' : ''}`}>
      <div className="vp-member-top">
        <Avatar m={m} />
        <span className="vp-name" title={m.name}>
          {m.name}
          {me && <span className="dc-you"> (you)</span>}
          {m.bot && <span className="dc-bot">BOT</span>}
        </span>
        {(m.streaming || m.video) && (
          <span className="vp-live" title={m.streaming ? 'Sharing their screen' : 'Camera on'}>
            {m.streaming ? 'LIVE' : <Video size={11} />}
          </span>
        )}
        {state && (
          <span className={`vp-state${m.serverMute || m.serverDeaf ? ' server' : ''}`} title={state}>
            {m.selfDeaf || m.serverDeaf ? <HeadphoneOff size={13} /> : <MicOff size={13} />}
          </span>
        )}
        {!me && (m.streaming || m.video) && (
          <button className="icon-btn vp-watch" title="Watch it in an Orbit window: start watching it in Discord (or pop it out of Discord), and Orbit shows that window" onClick={watch}>
            <MonitorPlay size={14} />
          </button>
        )}
        {!me && (
          <button
            className={`icon-btn vp-mute-one${m.localMute ? ' on' : ''}`}
            title={m.localMute ? `Unmute ${m.name} (only for you)` : `Mute ${m.name} just for you (they can still talk to everyone else)`}
            onClick={() => void run(() => window.api.discordUserVoice(m.id, { mute: !m.localMute }))}
          >
            {m.localMute ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
        )}
      </div>
      {!me && (
        <div className="vp-volume">
          <input
            type="range"
            min={0}
            max={200}
            step={1}
            value={volume}
            disabled={m.localMute}
            aria-label={`${m.name}’s volume`}
            onPointerDown={() => (dragging.current = true)}
            onPointerUp={() => {
              dragging.current = false
              sendVolume(volume, true)
            }}
            onChange={(e) => {
              const v = Number(e.target.value)
              setVolume(v)
              sendVolume(v)
            }}
          />
          <button
            className="vp-volume-value"
            title="Back to 100%"
            onClick={() => {
              setVolume(100)
              sendVolume(100, true)
            }}
          >
            {volume}%
          </button>
        </div>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------------------------
// Games

function GameStrip({ flash }: { flash: (t: string) => void }) {
  const [games, setGames] = useState<Game[] | null>(null)
  const [starting, setStarting] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    const load = (): void =>
      void window.api
        .gamesList(false)
        .then((l) => live && setGames(stripGames(l.games)))
        .catch(() => live && setGames([]))
    load()
    const off = window.api.onGamesChanged(load)
    return () => {
      live = false
      off()
    }
  }, [])
  const play = async (g: Game): Promise<void> => {
    setStarting(g.id)
    try {
      const error = await window.api.gamesPlay(g.id)
      flash(error ?? `Starting ${g.name}…`)
    } finally {
      setTimeout(() => setStarting(null), 1500)
    }
  }
  const hasRoblox = !!games?.some((g) => g.id === ROBLOX_ID)
  return (
    <section className="vp-section">
      <h4 className="vp-head">
        <Gamepad2 size={13} /> Games
      </h4>
      <div className="vp-games">
        {games && !hasRoblox && (
          <button className="vp-game vp-game-get" title="Roblox isn’t installed on this computer: get it from roblox.com" onClick={() => void window.api.openRobloxDownload()}>
            <span className="vp-game-art vp-game-letter">R</span>
            <span className="vp-game-name">Get Roblox</span>
          </button>
        )}
        {games?.map((g) => (
          <button key={g.id} className={`vp-game${g.running ? ' running' : ''}`} title={g.running ? `${g.name} (playing)` : `Play ${g.name}`} onClick={() => void play(g)} disabled={starting === g.id}>
            {g.art ? (
              <img className="vp-game-art" src={g.art} alt="" />
            ) : g.icon ? (
              <img className="vp-game-art vp-game-icon" src={g.icon} alt="" />
            ) : (
              <span className="vp-game-art vp-game-letter">{g.name.slice(0, 1).toUpperCase()}</span>
            )}
            <span className="vp-game-name">{g.name}</span>
          </button>
        ))}
        {!games && (
          <span className="vp-faint">
            <Loader2 size={13} className="spin" /> Finding games…
          </span>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------------------------
// Chat, soundboard and history

function Tabs({ run }: { run: (f: () => Promise<unknown>) => Promise<void> }) {
  const [tab, setTabState] = useState<Tab>(() => readKey(TAB_KEY, ['chat', 'sounds', 'history'] as const, 'chat'))
  const setTab = (t: Tab): void => {
    setTabState(t)
    writeKey(TAB_KEY, t)
  }
  const unread = useUnread(tab === 'chat')
  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: 'chat', label: unread ? `Chat (${unread})` : 'Chat', icon: <MessageSquare size={13} /> },
    { id: 'sounds', label: 'Soundboard', icon: <Music2 size={13} /> },
    { id: 'history', label: 'History', icon: <History size={13} /> }
  ]
  return (
    <section className="vp-section vp-grow vp-tabs-section">
      <div className="vp-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      {tab === 'chat' && <Chat run={run} />}
      {tab === 'sounds' && <Soundboard run={run} />}
      {tab === 'history' && <CallHistory />}
    </section>
  )
}

/** New messages that came in while another tab was showing. */
function useUnread(showing: boolean): number {
  const chat = useDiscord((s) => s.chat)
  const seen = useRef<string | null>(null)
  const last = chat[chat.length - 1]?.id ?? null
  if (showing) seen.current = last
  if (showing || !last) return 0
  const from = chat.findIndex((m) => m.id === seen.current)
  return from < 0 ? (seen.current === null ? 0 : chat.length) : chat.length - from - 1
}

const timeOf = (at: number): string => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

function Chat({ run }: { run: (f: () => Promise<unknown>) => Promise<void> }) {
  const chat = useDiscord((s) => s.chat)
  const chatState = useDiscord((s) => s.chatState)
  const list = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => {
    const el = list.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [chat])
  if (chatState === 'sign-in')
    return (
      <div className="vp-tab-empty">
        <p>To show the call’s chat, Discord needs to let Orbit read messages. Sign in again and press Authorize in Discord.</p>
        <button className="btn btn-primary" onClick={() => void run(() => window.api.discordReauthorize())}>
          Sign in again
        </button>
      </div>
    )
  return (
    <div className="vp-chat">
      <div
        ref={list}
        className="vp-chat-list"
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {chatState === 'none' && <p className="vp-faint vp-pad">This call’s chat can’t be read by Orbit.</p>}
        {chatState === 'ok' && !chat.length && <p className="vp-faint vp-pad">No messages yet.</p>}
        {chat.map((m, i) => (
          <ChatLine key={m.id} m={m} grouped={i > 0 && chat[i - 1].authorId === m.authorId && m.at - chat[i - 1].at < 5 * 60_000} />
        ))}
      </div>
      <button className="btn vp-reply" onClick={() => void run(() => window.api.discordOpenChannel())} title="Discord only lets apps read the chat, so replies are typed in Discord">
        <MessageSquare size={13} /> Reply in Discord
      </button>
    </div>
  )
}

function ChatLine({ m, grouped }: { m: ChatMessage; grouped: boolean }) {
  return (
    <div className={`vp-msg${grouped ? ' grouped' : ''}`}>
      {!grouped && <Avatar m={{ avatar: m.avatar, name: m.author, speaking: false }} />}
      <div className="vp-msg-body">
        {!grouped && (
          <div className="vp-msg-head">
            <b>{m.author}</b> <span className="vp-faint">{timeOf(m.at)}</span>
          </div>
        )}
        {m.content && <div className="vp-msg-text">{m.content}</div>}
        {m.attachments > 0 && (
          <div className="vp-faint">
            + {m.attachments} attachment{m.attachments === 1 ? '' : 's'} (open Discord to see)
          </div>
        )}
      </div>
    </div>
  )
}

function Soundboard({ run }: { run: (f: () => Promise<unknown>) => Promise<void> }) {
  const [clips, setClips] = useState<SoundClip[] | null>(null)
  useEffect(() => {
    let live = true
    void window.api
      .soundboardGet()
      .then((s) => live && setClips(s.board.clips))
      .catch(() => live && setClips([]))
    const off = window.api.onSoundboardChanged((s) => setClips(s.board.clips))
    return () => {
      live = false
      off()
    }
  }, [])
  if (!clips) return <p className="vp-faint vp-pad">Loading the soundboard…</p>
  if (!clips.length) return <p className="vp-faint vp-pad">No sounds yet. Add some on Orbit’s Soundboard tab.</p>
  return (
    <div className="vp-sounds">
      <div className="vp-sounds-grid">
        {clips.map((c) => (
          <button key={c.id} className="vp-sound" style={{ ['--clip' as string]: c.colour }} title={c.name} onClick={() => void run(() => window.api.soundboardTrigger({ kind: 'clip', id: c.id }))}>
            {c.emoji && <span className="vp-sound-emoji">{c.emoji}</span>}
            <span className="vp-sound-name">{c.name}</span>
          </button>
        ))}
      </div>
      <button className="btn vp-stop" onClick={() => void run(() => window.api.soundboardTrigger({ kind: 'stopAll' }))}>
        <Square size={12} /> Stop all sounds
      </button>
    </div>
  )
}

function CallHistory() {
  const [calls, setCalls] = useState<CallRecord[] | null>(null)
  useEffect(() => {
    let live = true
    void window.api.discordCalls().then((c) => live && setCalls(c))
    const off = window.api.onDiscordCalls(setCalls)
    return () => {
      live = false
      off()
    }
  }, [])
  if (!calls) return null
  if (!calls.length) return <p className="vp-faint vp-pad">Calls you’ve been in show here once they end. They’re kept only on this computer.</p>
  const clear = (): void => {
    if (confirm('Clear the whole call history?')) void window.api.discordClearCalls().then(setCalls)
  }
  return (
    <div className="vp-history">
      <ul>
        {calls.map((c) => (
          <li key={c.id} className="vp-call">
            <div className="vp-call-top">
              <b title={c.server ?? undefined}>{c.channel}</b>
              <span className="vp-faint">{callLength(c.end - c.start)}</span>
              <button className="icon-btn vp-call-remove" title="Remove from the history" onClick={() => void window.api.discordRemoveCall(c.id).then(setCalls)}>
                <X size={12} />
              </button>
            </div>
            <div className="vp-faint">
              {new Date(c.start).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
              {c.server ? ` · ${c.server}` : ''}
            </div>
            <div className="vp-call-people">With {peopleList(c.people)}</div>
          </li>
        ))}
      </ul>
      <button className="link-button vp-clear" onClick={clear}>
        <Trash2 size={12} /> Clear history
      </button>
    </div>
  )
}

export { CallHistory }
