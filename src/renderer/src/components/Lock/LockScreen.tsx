import { useState, type FormEvent } from 'react'
import { Lock } from 'lucide-react'
import { hasRecoveryKey, unlockNotes, unlockOwn, useLock } from '../../lib/lock/session'
import { noteTitle } from '../../lib/paths'
import { usePrefs } from '../../store/prefs'
import { recover } from './LockDialog'

/** Shown in a pane instead of a locked note until you unlock it. */
export default function LockScreen({ path, autoFocus }: { path: string; autoFocus: boolean }) {
  const mode = useLock((s) => s.locked[path])
  const setUp = useLock((s) => s.setUp)
  const minutes = usePrefs((s) => s.prefs.autoLockMinutes)
  const [value, setValue] = useState('')
  const [recovering, setRecovering] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!value) return
    setBusy(true)
    setError('')
    try {
      if (mode === 'own') await unlockOwn(path, await window.api.readNote(path), value)
      else if (recovering) await recover(value)
      else await unlockNotes(value)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const own = mode === 'own'
  const missing = !own && !setUp
  return (
    <div className="lock-screen" data-lock-screen={path}>
      <Lock size={34} strokeWidth={1.4} />
      <h2>{noteTitle(path)}</h2>
      {missing ? (
        <p>
          This note was locked with a notes password, but the password settings (<code>.notesapp/lock.json</code> in your notes folder) are missing. If
          they’re still syncing, reopen Orbit once they’ve arrived.
        </p>
      ) : (
        <>
          <p>
            {own
              ? 'This note has its own password.'
              : recovering
                ? 'Enter your recovery key. You’ll then choose a new password.'
                : `This note is locked. Your notes password unlocks all locked notes${minutes ? ` until you’ve been away for ${minutes} min` : ''}.`}
          </p>
          <form onSubmit={submit} className="lock-screen-form">
            <input
              key={recovering ? 'recovery' : 'password'}
              type={recovering ? 'text' : 'password'}
              autoFocus={autoFocus}
              placeholder={recovering ? 'XXXXX-XXXXX-XXXXX-XXXXX-XXXXX' : 'Password'}
              value={value}
              spellCheck={false}
              data-lock-input
              onChange={(e) => setValue(e.target.value)}
            />
            <button className="btn btn-primary" disabled={busy || !value} data-lock-unlock>
              {busy ? 'Unlocking…' : 'Unlock'}
            </button>
          </form>
          {error && (
            <p className="lock-error" role="alert">
              {error}
            </p>
          )}
          {!own && hasRecoveryKey() && (
            <button
              className="link-button"
              onClick={() => {
                setRecovering(!recovering)
                setValue('')
                setError('')
              }}
            >
              {recovering ? 'Use my password instead' : 'Forgot your password? Use your recovery key'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
