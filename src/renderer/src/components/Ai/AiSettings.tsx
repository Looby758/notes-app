import './ai.css'
import { useEffect, useState } from 'react'
import { ChevronDown, ExternalLink, KeyRound, LogOut } from 'lucide-react'
import { refreshAiStatus, useAi } from '../../store/ai'
import { useUI } from '../../store/ui'
import { errorMessage } from '../../lib/paths'
import { SYSTEM_NAME } from '@shared/platform'

/** Switches an open Settings page to this section. */
export const openAiSettings = (): void => useUI.setState({ settingsSection: 'ai' })

/** Settings → AI helper: your Anthropic API key, stored encrypted on this computer. */
export default function AiSettings() {
  const status = useAi((s) => s.status)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    refreshAiStatus()
  }, [])

  const run = async (job: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await job()
      setKey('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      await refreshAiStatus()
      setBusy(false)
    }
  }

  if (!status) return null
  return (
    <section className="settings-group cal-sources ai-settings" data-section="ai">
      <h3>Claude</h3>
      <p className="cal-sources-intro">
        Claude, made by Anthropic, is the online AI: cleverer than the offline one, and it reads handwriting in sketches. It uses
        your own account, so Anthropic bills you directly (usually a cent or two each time).
      </p>
      <p className="cal-sources-intro">
        Nothing is sent unless you press one of its buttons. Then only what that needs goes to Anthropic: the note you’re
        summarising, or for a question, the notes that best match it. Locked notes are never sent.
      </p>

      {status.hasKey ? (
        <div className="cal-connected">
          <span className="cal-connected-dot" />
          <span>Your API key is saved and working.</span>
          <button className="btn" disabled={busy} onClick={() => run(() => window.api.aiClearKey())} data-ai-remove-key>
            <LogOut size={13} /> Remove key
          </button>
        </div>
      ) : (
        <>
          <button className="cal-help-toggle" onClick={() => setHelpOpen(!helpOpen)}>
            <ChevronDown size={13} className={helpOpen ? 'open' : ''} /> How to get an API key (one-time, about 2 minutes)
          </button>
          {helpOpen && (
            <ol className="cal-help">
              <li>
                Go to{' '}
                <button className="link-btn" onClick={() => window.open('https://console.anthropic.com/settings/keys')}>
                  console.anthropic.com <ExternalLink size={11} />
                </button>{' '}
                and sign up or sign in.
              </li>
              <li>
                Under <strong>Billing</strong>, add a little credit (5 dollars lasts a long time).
              </li>
              <li>
                Under <strong>API keys</strong>, choose <strong>Create key</strong>, give it any name, and copy it. It starts
                with <code>sk-ant-</code>.
              </li>
              <li>Paste it below and press Save.</li>
            </ol>
          )}
          <div className="cal-client">
            <label>
              API key
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && key.trim() && run(() => window.api.aiSetKey(key))}
                placeholder="sk-ant-…"
                spellCheck={false}
                data-ai-key
              />
            </label>
            <div className="cal-client-actions">
              <button className="btn btn-primary" disabled={busy || !key.trim() || !status.canEncrypt} onClick={() => run(() => window.api.aiSetKey(key))} data-ai-save-key>
                <KeyRound size={14} /> {busy ? 'Checking…' : 'Save'}
              </button>
            </div>
          </div>
          <p className="cal-note">The key is checked with Anthropic, then stored encrypted on this computer using the protection built into {SYSTEM_NAME}.</p>
        </>
      )}
      {!status.canEncrypt && <p className="setting-warning">This computer can’t encrypt the key, so it can’t be saved.</p>}
      {error && <p className="setting-warning">{error}</p>}
    </section>
  )
}
