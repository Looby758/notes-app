import { useEffect, useState } from 'react'
import { ExternalLink, Headphones, HeadphoneOff, History, Loader2, LogOut, Mic, MicOff, PictureInPicture2, RefreshCw, Trash2, Volume2 } from 'lucide-react'
import { DISCORD_REDIRECT, memberState, validClientId, type VoiceMember } from '@shared/discord'
import { cleanError, toggleDiscord, useDiscord, watchDiscord } from '../../store/discord'
import { notify } from '../../store/notify'
import { addHomeCard } from '../../lib/home'
import { openSpecialTab, DISCORD_TAB } from '../../lib/editorController'
import { HomeBox } from '../Home/HomePage'
import { CallHistory } from './VoicePopout'

addHomeCard({ id: 'discord-voice', order: 24, title: 'Discord voice', Card: DiscordHomeCard })

/**
 * The Discord voice tab: who's in your voice channel (and who's talking), with your own mute and
 * deafen. It uses Discord's official local RPC with your own Discord application, so there's no
 * client mod (see shared/discord.ts). The same mute / deafen are on the phone deck and in Ctrl+K.
 */
export default function DiscordVoicePage() {
  useEffect(watchDiscord, [])
  const stage = useDiscord((s) => s.stage)
  const error = useDiscord((s) => s.error)
  return (
    <div className="dc-page">
      <div className="dc-inner">
        <div className="dc-head">
          <h2>
            <Headphones size={20} /> Discord voice
          </h2>
          {stage === 'ready' && (
            <div className="dc-head-actions">
              <PopOutButton />
              <Controls />
            </div>
          )}
        </div>
        {error && stage !== 'ready' && <p className="dc-error">{error}</p>}
        {stage === 'setup' && <Setup />}
        {stage === 'signed-out' && <SignIn />}
        {(stage === 'connecting' || stage === 'authorizing') && <Waiting authorizing={stage === 'authorizing'} />}
        {stage === 'no-discord' && <NoDiscord />}
        {stage === 'ready' && <Channel />}
        {stage !== 'setup' && (
          <section className="dc-card">
            <h3 className="dc-history-head">
              <History size={15} /> Recent calls
            </h3>
            <CallHistory />
          </section>
        )}
        {stage !== 'setup' && <Footer />}
      </div>
    </div>
  )
}

/** Opens the Discord voice pop-out (its own window, for a second screen). */
function PopOutButton() {
  return (
    <button className="btn" onClick={() => void window.api.openDiscordPopout()} title="Open the call in its own window, to keep on a second screen">
      <PictureInPicture2 size={16} /> Pop out
    </button>
  )
}

function Setup() {
  const canEncrypt = useDiscord((s) => s.canEncrypt)
  const [id, setId] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.discordSaveApp(id, secret)
      setSecret('')
      void window.api.discordSignIn()
    } catch (err) {
      notify(cleanError(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="dc-card">
      <p className="dc-intro">
        See who’s in your voice channel and mute or deafen yourself from Orbit or your phone. Orbit talks to the Discord app through Discord’s own official
        connection for apps, so there’s no mod and nothing that breaks Discord’s rules. It needs a free Discord application of your own, made once:
      </p>
      <ol className="dc-steps">
        <li>
          Open the{' '}
          <button className="link-button" onClick={() => void window.api.discordOpenPortal()}>
            Discord Developer Portal <ExternalLink size={12} />
          </button>{' '}
          and press <b>New Application</b>. Call it Orbit.
        </li>
        <li>
          Under <b>General Information</b>, copy the <b>Application ID</b>.
        </li>
        <li>
          Under <b>OAuth2</b>, press <b>Reset Secret</b> and copy the client secret. In <b>Redirects</b> on the same page, add <code>{DISCORD_REDIRECT}</code> and save.
        </li>
        <li>Paste both here. Discord then asks you to allow Orbit, once.</li>
      </ol>
      <div className="dc-form">
        <input className="text-input" placeholder="Application ID" value={id} onChange={(e) => setId(e.target.value)} spellCheck={false} />
        <input className="text-input" placeholder="Client secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} spellCheck={false} />
        <button className="btn btn-primary" disabled={busy || !validClientId(id) || secret.trim().length < 16 || !canEncrypt} onClick={() => void save()}>
          Save and sign in
        </button>
      </div>
      {!canEncrypt && <p className="dc-error">This computer can’t store the secret securely, so Discord voice can’t be set up here.</p>}
      <p className="dc-note">The secret and sign-in are stored encrypted on this computer and only sent to Discord.</p>
    </section>
  )
}

function SignIn() {
  return (
    <section className="dc-card">
      <p className="dc-intro">Open Discord on this computer, then sign in. Discord shows a window asking you to allow Orbit to see your voice channel and change your mute.</p>
      <button className="btn btn-primary" onClick={() => void window.api.discordSignIn()}>
        Sign in with Discord
      </button>
    </section>
  )
}

function Waiting({ authorizing }: { authorizing: boolean }) {
  return (
    <section className="dc-card dc-waiting">
      <Loader2 size={18} className="spin" />
      {authorizing ? 'Press Authorize in the Discord window to let Orbit in.' : 'Looking for Discord on this computer…'}
    </section>
  )
}

function NoDiscord() {
  return (
    <section className="dc-card">
      <p className="dc-intro">Discord isn’t open on this computer. Start it and Orbit picks it up within a few seconds.</p>
      <button className="btn" onClick={() => void window.api.discordRetry()}>
        <RefreshCw size={14} /> Try now
      </button>
    </section>
  )
}

function Controls({ small = false }: { small?: boolean }) {
  const mute = useDiscord((s) => s.mute)
  const deaf = useDiscord((s) => s.deaf)
  const size = small ? 14 : 16
  return (
    <div className={`dc-controls${small ? ' small' : ''}`}>
      <button className={`btn dc-toggle${mute || deaf ? ' on' : ''}`} onClick={() => void toggleDiscord('mute')} title="Mute / unmute in Discord">
        {mute || deaf ? <MicOff size={size} /> : <Mic size={size} />}
        {mute || deaf ? 'Muted' : 'Mute'}
      </button>
      <button className={`btn dc-toggle${deaf ? ' on' : ''}`} onClick={() => void toggleDiscord('deaf')} title="Deafen / undeafen in Discord">
        {deaf ? <HeadphoneOff size={size} /> : <Headphones size={size} />}
        {deaf ? 'Deafened' : 'Deafen'}
      </button>
    </div>
  )
}

function Channel() {
  const channel = useDiscord((s) => s.channel)
  const me = useDiscord((s) => s.me)
  if (!channel)
    return (
      <section className="dc-card">
        <p className="dc-intro">
          You’re not in a voice channel. Join one in Discord and it shows here{me ? `, ${me.name}` : ''}. Mute and deafen work either way.
        </p>
      </section>
    )
  const talking = channel.members.filter((m) => m.speaking).length
  return (
    <section className="dc-card">
      <div className="dc-channel">
        <Volume2 size={16} />
        <b>{channel.name}</b>
        {channel.server && <span className="dc-server">{channel.server}</span>}
        <span className="dc-count">
          {channel.members.length} in voice{talking > 0 ? ` · ${talking} talking` : ''}
        </span>
      </div>
      <ul className="dc-members">
        {channel.members.map((m) => (
          <Member key={m.id} m={m} me={m.id === me?.id} />
        ))}
      </ul>
    </section>
  )
}

function Avatar({ m }: { m: VoiceMember }) {
  return (
    <span className={`dc-avatar${m.speaking ? ' speaking' : ''}`}>
      {m.avatar ? <img src={m.avatar} alt="" /> : <span>{m.name.slice(0, 1).toUpperCase()}</span>}
    </span>
  )
}

function Member({ m, me }: { m: VoiceMember; me: boolean }) {
  const state = memberState(m)
  return (
    <li className="dc-member">
      <Avatar m={m} />
      <span className="dc-name">
        {m.name}
        {me && <span className="dc-you"> (you)</span>}
        {m.bot && <span className="dc-bot">BOT</span>}
      </span>
      {state && (
        <span className="dc-state" title={state}>
          {m.selfDeaf || m.serverDeaf ? <HeadphoneOff size={14} /> : <MicOff size={14} />}
          {state}
        </span>
      )}
    </li>
  )
}

function Footer() {
  const stage = useDiscord((s) => s.stage)
  const me = useDiscord((s) => s.me)
  const forget = async (): Promise<void> => {
    if (!confirm('Remove the Discord application and sign-in from Orbit?')) return
    try {
      await window.api.discordForget()
    } catch (err) {
      notify(cleanError(err))
    }
  }
  return (
    <div className="dc-footer">
      {stage === 'ready' && me && <span>Signed in as {me.name}</span>}
      {stage !== 'signed-out' && (
        <button className="link-button" onClick={() => void window.api.discordSignOut()}>
          <LogOut size={13} /> Sign out
        </button>
      )}
      <button className="link-button" onClick={() => void forget()}>
        <Trash2 size={13} /> Remove the Discord application
      </button>
    </div>
  )
}

/** On Home while you're in a voice channel: who's there, and mute / deafen. */
function DiscordHomeCard() {
  useEffect(watchDiscord, [])
  const stage = useDiscord((s) => s.stage)
  const channel = useDiscord((s) => s.channel)
  if (stage !== 'ready' || !channel) return null
  return (
    <HomeBox
      icon={<Headphones size={15} />}
      title={channel.name}
      action={
        <button className="link-button home-box-action" onClick={() => openSpecialTab(DISCORD_TAB)}>
          Discord voice
        </button>
      }
    >
      <div className="dc-home">
        <div className="dc-home-faces">
          {channel.members.slice(0, 12).map((m) => (
            <span key={m.id} title={`${m.name}${memberState(m) ? ` · ${memberState(m)}` : ''}`}>
              <Avatar m={m} />
            </span>
          ))}
          {channel.members.length > 12 && <span className="dc-more">+{channel.members.length - 12}</span>}
        </div>
        <Controls small />
      </div>
    </HomeBox>
  )
}
