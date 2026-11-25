import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, FolderOpen, KeyRound, LogOut, Play, Square, Target, Trash2 } from 'lucide-react'
import { describeMinutes, MODE_NAMES, shortNumber, type SkyblockStatus, type SkyblockSummary } from '@shared/skyblock'
import { SYSTEM_NAME } from '@shared/platform'
import { errorMessage } from '../../lib/paths'
import { showSkyblockSummary } from './SkyblockCard'
import { openSpecialTab, SKYBLOCK_GOALS_TAB } from '../../lib/editorController'
import { keyWarning } from '@shared/skyblockGoals'
import SkyblockAddonCard from './SkyblockAddonCard'
import { useSkyblockAddon } from './SkyblockPic'

const clean = (err: unknown): string => errorMessage(err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/**
 * The Games page's "SkyBlock" box: your Hypixel key and Minecraft name, which profile to follow,
 * whether to read Minecraft's chat log for rare drops, and the sessions so far.
 */
export default function SkyblockSetupGate() {
  const addon = useSkyblockAddon()
  if (!addon) return null
  // Session summaries are part of the SkyBlock add-on, an optional download.
  if (addon.state !== 'ready')
    return (
      <div className="games-covers sb-setup" data-skyblock-setup>
        <SkyblockAddonCard />
      </div>
    )
  return <SkyblockSetup />
}

function SkyblockSetup() {
  const [status, setStatus] = useState<SkyblockStatus | null>(null)
  const [sessions, setSessions] = useState<SkyblockSummary[]>([])
  const [key, setKey] = useState('')
  const [player, setPlayer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const reload = useCallback(async () => {
    const st = await window.api.skyblockStatus()
    setStatus(st)
    setPlayer((p) => p || st.player)
    setSessions(await window.api.skyblockSessions())
  }, [])

  useEffect(() => {
    void reload()
    const off1 = window.api.onSkyblockChanged(() => void reload())
    const off2 = window.api.onSkyblockSummary(() => void reload())
    return () => {
      off1()
      off2()
    }
  }, [reload])

  const run = async (job: () => Promise<SkyblockStatus>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await job())
      setKey('')
      setEditing(false)
    } catch (err) {
      setError(clean(err))
    } finally {
      setBusy(false)
    }
  }

  if (!status) return null
  const ready = status.hasKey && !!status.uuid && !editing

  return (
    <div className="games-covers sb-setup" data-skyblock-setup>
      <p>
        When Minecraft closes, Orbit shows a card for that SkyBlock session: coins an hour, XP, rare drops and what you collected. It takes your numbers from Hypixel when Minecraft
        opens and again a couple of minutes after it closes (Hypixel needs that long to save them), so Orbit has to be running, even just in the tray.
      </p>

      {ready ? (
        <>
          <div className="cal-connected">
            <span className="cal-connected-dot" />
            <span>
              Following <b>{status.player}</b>
              {status.session ? (
                <>
                  {' '}
                  · <span className="sb-live">Session going since {new Date(status.session.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </>
              ) : status.finishing ? (
                ' · Waiting for Hypixel to save your last session…'
              ) : (
                ' · Waiting for Minecraft to open'
              )}
            </span>
            {status.session ? (
              <button
                className="btn"
                disabled={busy}
                onClick={() => run(() => window.api.skyblockEndNow())}
                title="End the session now (Hypixel may need a couple of minutes to catch up)"
                data-skyblock-end
              >
                <Square size={12} /> End now
              </button>
            ) : (
              <button
                className="btn"
                disabled={busy}
                onClick={() => run(() => window.api.skyblockStartNow())}
                title="If Orbit didn’t notice Minecraft, or you want to time just part of a session"
                data-skyblock-start
              >
                <Play size={12} /> Start now
              </button>
            )}
            <button className="btn" onClick={() => setEditing(true)}>
              Change
            </button>
            <button
              className="btn"
              onClick={() => openSpecialTab(SKYBLOCK_GOALS_TAB)}
              title="Plan crafting goals: the whole tree, what you have, what’s locked"
              data-skyblock-goals-open
            >
              <Target size={12} /> Goal planner
            </button>
          </div>

          <div className="sb-options">
            <label>
              Profile
              <select className="select" value={status.profileId} onChange={(e) => run(() => window.api.skyblockSetProfile(e.target.value))} data-skyblock-profile>
                <option value="">The one I’m on in game</option>
                {status.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {MODE_NAMES[p.mode] ? ` (${MODE_NAMES[p.mode]})` : ''}
                    {p.selected ? ' · on now' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="sb-check" title="Developer keys from the dashboard stop working after 3 days; Orbit warns a day before.">
              <input type="checkbox" checked={status.personalKey} onChange={(e) => run(() => window.api.skyblockSetPersonalKey(e.target.checked))} data-skyblock-personal />
              It’s a Personal key (doesn’t run out after 3 days)
            </label>
            <label className="sb-check">
              <input type="checkbox" checked={status.readLog} onChange={(e) => run(() => window.api.skyblockSetLog(e.target.checked))} />
              Read Minecraft’s chat log for rare drops
            </label>
            {status.readLog && (
              <div className="sb-log">
                <span className="faint">{status.logFolder ? status.logFolder : 'Looks in the usual places (.minecraft, Lunar Client, Badlion).'}</span>
                <button className="btn" onClick={() => run(() => window.api.skyblockPickLogFolder())}>
                  <FolderOpen size={12} /> Pick the logs folder
                </button>
                {status.logFolder && (
                  <button className="link-btn" onClick={() => run(() => window.api.skyblockSetLog(true, ''))}>
                    Use the usual places
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <ol className="cal-help">
            <li>
              Go to{' '}
              <button className="link-btn" onClick={() => window.open('https://developer.hypixel.net/dashboard')}>
                developer.hypixel.net <ExternalLink size={11} />
              </button>
              , sign in with your Hypixel forums account and copy your API key. A development key stops working after 3 days; for one that lasts, apply for a Personal key there.
            </li>
            <li>
              In SkyBlock, open <b>SkyBlock Menu → Settings → Personal → API Settings</b> and turn on Skills, Collections and Banking, or those parts stay blank.
            </li>
            <li>Paste the key and your Minecraft name below.</li>
          </ol>
          <div className="cal-client">
            <label>
              Minecraft name
              <input value={player} onChange={(e) => setPlayer(e.target.value)} spellCheck={false} placeholder="e.g. Looby" data-skyblock-player />
            </label>
            <label>
              Hypixel API key{status.hasKey ? ' (blank keeps the saved one)' : ''}
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                spellCheck={false}
                data-skyblock-key
                onKeyDown={(e) => e.key === 'Enter' && void run(() => window.api.skyblockSetup({ key, player }))}
              />
            </label>
            <div className="cal-client-actions">
              <button
                className="btn btn-primary"
                disabled={busy || !player.trim() || (!key.trim() && !status.hasKey) || !status.canEncrypt}
                onClick={() => void run(() => window.api.skyblockSetup({ key, player }))}
                data-skyblock-save-key
              >
                <KeyRound size={14} /> {busy ? 'Checking…' : 'Save'}
              </button>
              {editing && (
                <button className="btn" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              )}
              {status.hasKey && (
                <button className="btn" disabled={busy} onClick={() => run(() => window.api.skyblockForget())}>
                  <LogOut size={13} /> Remove key
                </button>
              )}
            </div>
          </div>
          <p className="cal-note">
            The key is checked with Hypixel, then stored encrypted on this computer using the protection built into {SYSTEM_NAME}. Your Minecraft name goes to Mojang to find your
            player id, and that id goes to Hypixel. Nothing else leaves this computer.
          </p>
        </>
      )}

      {ready && keyWarning(status.keySavedAt, status.personalKey, Date.now()) && <p className="setting-warning">{keyWarning(status.keySavedAt, status.personalKey, Date.now())}</p>}
      {status.problem && <p className="setting-warning">{status.problem}</p>}
      {!status.canEncrypt && <p className="setting-warning">This computer can’t encrypt the key, so it can’t be saved.</p>}
      {error && <p className="setting-warning">{error}</p>}

      {sessions.length > 0 && (
        <div className="sb-past" data-skyblock-sessions>
          <h4>Past sessions</h4>
          <ul>
            {sessions.slice(0, 12).map((s) => (
              <li key={s.id}>
                <button className="sb-past-open" onClick={() => showSkyblockSummary(s)}>
                  <span>{new Date(s.start).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="faint">{describeMinutes(s.minutes)}</span>
                  <span>{s.coins ? `${shortNumber(s.coins.perHour)} coins/h` : ''}</span>
                  <span className="faint">{s.skills[0] ? `+${shortNumber(s.skills[0].gained)} ${s.skills[0].name}` : ''}</span>
                  <span className="faint">{s.drops?.length ? `${s.drops.reduce((n, d) => n + d.count, 0)} rare` : ''}</span>
                </button>
                <button
                  className="icon-btn"
                  title="Delete"
                  onClick={async () => {
                    setSessions(await window.api.skyblockDeleteSession(s.id))
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
