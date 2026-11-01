import { useEffect, useState } from 'react'
import { Download, MonitorUp, MousePointerClick, ShieldAlert, Square } from 'lucide-react'
import type { ScreenStatus } from '@shared/screenLink'
import { errorMessage } from '../../lib/paths'

/** Settings → Two computers → Screens: the Mac as the PC's second screen, and using the Mac from the PC. */
export default function ScreenSettings({ peerName, peerOs }: { peerName: string; peerOs: 'mac' | 'win' }) {
  const [status, setStatus] = useState<ScreenStatus | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.api.screenStatus().then(setStatus)
    return window.api.onScreenStatus(setStatus)
  }, [])

  if (!status) return null
  const run = (job: () => Promise<unknown>): void => {
    setError('')
    job().catch((err) => setError(errorMessage(err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
  }
  const s = status.session
  const thisIsPc = peerOs === 'mac'
  const shownError = error || status.error

  return (
    <div className="share-screens">
      <h4>Screens</h4>

      {s ? (
        <div className="share-state">
          <span className={`cal-connected-dot ${s.state === 'live' ? '' : 'off'}`} />
          <span style={{ flex: 1 }}>
            {s.mode === 'extend'
              ? s.role === 'send'
                ? `${peerName} is ${s.state === 'live' ? '' : 'getting ready to be '}a second screen for this computer.`
                : `This computer is ${s.state === 'live' ? '' : 'getting ready to be '}a second screen for ${peerName}.`
              : s.role === 'view'
                ? `${s.state === 'live' ? 'Showing' : 'Connecting to'} ${peerName}’s screen in a window.`
                : `${peerName} is ${s.state === 'live' ? 'seeing and using' : 'connecting to'} this computer’s screen.`}
          </span>
          <button className="btn" onClick={() => run(() => window.api.screenStop())}>
            <Square size={12} /> Stop
          </button>
        </div>
      ) : (
        <div className="share-actions">
          {thisIsPc && (
            <button className="btn btn-primary" disabled={!status.available} onClick={() => run(() => window.api.screenStart('extend'))}>
              <MonitorUp size={13} /> Use {peerName} as a second screen
            </button>
          )}
          {thisIsPc && (
            <button className="btn" disabled={!status.available} onClick={() => run(() => window.api.screenStart('control'))}>
              <MousePointerClick size={13} /> See and control {peerName}
            </button>
          )}
          {!thisIsPc && (
            <p className="share-muted">
              Start these on the PC: use this Mac as its second screen, or see and use this Mac from the PC in a window.
            </p>
          )}
        </div>
      )}

      {shownError && <p className="setting-warning">{shownError}</p>}

      {!thisIsPc && !status.screenAllowed && (
        <div className="share-warning">
          <ShieldAlert size={16} />
          <span>
            For the PC to see and use this Mac, macOS needs to let Orbit record the screen: System Settings → Privacy &amp; Security →
            Screen Recording.
          </span>
        </div>
      )}

      {thisIsPc && (
        <>
          {status.displays.length > 1 ? (
            <div className="setting-row">
              <div className="setting-text">
                <label>Screen to show on {peerName}</label>
                <p>An extra screen (like the virtual one) adds space; the main one makes {peerName} show a copy of it.</p>
              </div>
              <div className="setting-control">
                <select value={status.extendDisplay} onChange={(e) => run(() => window.api.screenSetDisplay(e.target.value))}>
                  <option value="">Work it out (an extra screen if there is one)</option>
                  {status.displays.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label} · {d.width}×{d.height}
                      {d.primary ? ' · main' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="share-help">
              <p className="share-muted">
                This PC has one screen, so {peerName} would show a copy of it. To get extra space instead, add a free virtual screen to
                Windows (the open-source Virtual Display Driver). Windows asks before installing it. Then place it next to your
                monitor in Windows Settings → System → Display, on the side {peerName} sits.
              </p>
              <button className="btn" disabled={!!status.installing} onClick={() => run(() => window.api.screenInstallVirtual())}>
                <Download size={13} /> {status.installing || 'Add a virtual screen'}
              </button>
            </div>
          )}
          <ul className="share-muted share-screen-tips">
            <li>While {peerName} is a second screen, the mouse moves onto it like any other monitor (mouse sharing waits until you stop).</li>
            <li>In the window showing {peerName}, Ctrl works as ⌘ if “Swap ⌘ and Ctrl” is on on the Mac.</li>
            <li>Ctrl+Alt+Esc (⌃⌥Esc on the Mac) or the bar at the top of the picture stops it.</li>
          </ul>
        </>
      )}
    </div>
  )
}
