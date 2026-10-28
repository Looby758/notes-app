import { useState } from 'react'
import { ExternalLink, KeyRound, LogOut } from 'lucide-react'
import type { AnimatedCovers, CoversStatus } from '@shared/games'
import { SYSTEM_NAME } from '@shared/platform'
import { errorMessage } from '../../lib/paths'

const MODE_NOTE: Record<AnimatedCovers, string> = {
  always: 'They move all the time while they’re on screen.',
  hover: 'They move while the pointer is on them.',
  off: 'They’re turned off (or Motion isn’t on Full), so still pictures are shown.'
}

/** The Games page's "Animated covers" box: your free SteamGridDB key, stored encrypted on this computer. */
export default function CoversSetup({ status, mode, found, onChange }: { status: CoversStatus; mode: AnimatedCovers; found: number; onChange: (s: CoversStatus) => void }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (job: () => Promise<CoversStatus>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      onChange(await job())
      setKey('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const save = (): Promise<void> => run(() => window.api.gamesSetCoversKey(key))

  return (
    <div className="games-covers" data-games-covers-setup>
      <p>
        Covers that move, made by people on SteamGridDB. Games without one keep their still picture. Change how they play in Settings → Appearance →
        Animated game covers. {MODE_NOTE[mode]}
      </p>
      {status.hasKey ? (
        <div className="cal-connected">
          <span className="cal-connected-dot" />
          <span>
            Your SteamGridDB key is saved. {found ? `${found} game${found === 1 ? ' has' : 's have'} a moving cover.` : 'No moving covers found yet.'}
          </span>
          <button className="btn" disabled={busy} onClick={() => run(() => window.api.gamesClearCoversKey())} data-games-covers-remove>
            <LogOut size={13} /> Remove key
          </button>
        </div>
      ) : (
        <>
          <ol className="cal-help">
            <li>
              Sign in at{' '}
              <button className="link-btn" onClick={() => window.open('https://www.steamgriddb.com/profile/preferences/api')}>
                steamgriddb.com <ExternalLink size={11} />
              </button>{' '}
              with your Steam account. It’s free.
            </li>
            <li>
              Under <strong>Preferences → API</strong>, generate a key and copy it.
            </li>
            <li>Paste it below and press Save.</li>
          </ol>
          <div className="cal-client">
            <label>
              API key
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && key.trim() && void save()}
                spellCheck={false}
                data-games-covers-key
              />
            </label>
            <div className="cal-client-actions">
              <button className="btn btn-primary" disabled={busy || !key.trim() || !status.canEncrypt} onClick={() => void save()} data-games-covers-save>
                <KeyRound size={14} /> {busy ? 'Checking…' : 'Save'}
              </button>
            </div>
          </div>
          <p className="cal-note">
            The key is checked with SteamGridDB, then stored encrypted on this computer using the protection built into {SYSTEM_NAME}. Only your games’ names
            and Steam numbers are sent, to find their covers.
          </p>
        </>
      )}
      {!status.canEncrypt && <p className="setting-warning">This computer can’t encrypt the key, so it can’t be saved.</p>}
      {error && <p className="setting-warning">{error}</p>}
    </div>
  )
}
