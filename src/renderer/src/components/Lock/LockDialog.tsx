import { useState, type FormEvent, type ReactNode } from 'react'
import { Check, Copy, KeyRound, Lock } from 'lucide-react'
import { useLockDialog, openLockDialog, type LockDialog as Dialog } from '../../lib/lock/actions'
import {
  changePassword,
  checkPassword,
  hasRecoveryKey,
  setOwnPassword,
  setUpPassword,
  unlockNotes,
  unlockWithRecoveryKey
} from '../../lib/lock/session'
import { setNoteLock } from '../../lib/editorController'
import { noteTitle } from '../../lib/paths'
import { notify } from '../../store/notify'

export const MIN_PASSWORD = 4

/** Checks a new password and its repeat; returns what's wrong, if anything. */
export function newPasswordProblem(password: string, again: string): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`
  if (password !== again) return 'The two passwords don’t match.'
  return null
}

/** The dialogs for locked notes: set up the password, unlock, a note's own password, change it. */
export default function LockDialog() {
  const dialog = useLockDialog((s) => s.dialog)
  if (!dialog) return null
  const close = (): void => openLockDialog(null)
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal lock-dialog" data-lock-dialog={dialog.kind} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <Body dialog={dialog} close={close} />
      </div>
    </div>
  )
}

function Body({ dialog, close }: { dialog: Dialog; close: () => void }) {
  switch (dialog.kind) {
    case 'setup':
      return <SetUp then={dialog.then} close={close} />
    case 'unlock':
      return <Unlock then={dialog.then} close={close} />
    case 'own':
      return <OwnPassword path={dialog.path} close={close} />
    case 'change':
      return <ChangePassword close={close} />
    case 'newPassword':
      return <NewPassword close={close} />
  }
}

/** A titled form with an error line and a busy state (deriving keys takes a moment). */
function Form({
  title,
  intro,
  submit,
  onSubmit,
  children,
  close
}: {
  title: string
  intro?: ReactNode
  submit: string
  onSubmit: () => Promise<void>
  children: ReactNode
  close: () => void
}) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onSubmit()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="lock-form" onSubmit={run}>
      <h3>
        <Lock size={16} /> {title}
      </h3>
      {intro && <p className="lock-intro">{intro}</p>}
      {children}
      {error && (
        <p className="lock-error" role="alert">
          {error}
        </p>
      )}
      <div className="lock-foot">
        <button type="button" className="btn" onClick={close}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy} data-lock-submit>
          {busy ? 'One moment…' : submit}
        </button>
      </div>
    </form>
  )
}

function Field({ label, value, onChange, autoFocus, name }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; name: string }) {
  return (
    <label className="lock-field">
      <span>{label}</span>
      <input type="password" value={value} autoFocus={autoFocus} data-lock-field={name} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

/** Password, typed twice. */
function NewPasswordFields({ password, again, set, setAgain, first = 'Password' }: { password: string; again: string; set: (v: string) => void; setAgain: (v: string) => void; first?: string }) {
  return (
    <>
      <Field label={first} name="password" value={password} onChange={set} autoFocus />
      <Field label="Type it again" name="again" value={again} onChange={setAgain} />
    </>
  )
}

function SetUp({ then, close }: { then?: () => Promise<void>; close: () => void }) {
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [withRecovery, setWithRecovery] = useState(true)
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null)

  const finish = async (): Promise<void> => {
    close()
    await then?.().catch(notify)
  }

  if (recoveryKey) return <ShowRecoveryKey recoveryKey={recoveryKey} done={finish} />
  return (
    <Form
      title="Set a password for locked notes"
      intro="Locked notes are encrypted with this password. One password covers all of them (a note can also have its own)."
      submit="Set password"
      close={close}
      onSubmit={async () => {
        const problem = newPasswordProblem(password, again)
        if (problem) throw new Error(problem)
        const key = await setUpPassword(password, withRecovery)
        if (key) setRecoveryKey(key)
        else await finish()
      }}
    >
      <NewPasswordFields password={password} again={again} set={setPassword} setAgain={setAgain} />
      <label className="lock-check">
        <input type="checkbox" checked={withRecovery} onChange={(e) => setWithRecovery(e.target.checked)} data-lock-recovery />
        Make a recovery key, in case I forget the password (recommended)
      </label>
    </Form>
  )
}

export function ShowRecoveryKey({ recoveryKey, done, what = 'your notes' }: { recoveryKey: string; done: () => Promise<void>; what?: string }) {
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  return (
    <div className="lock-form">
      <h3>
        <KeyRound size={16} /> Your recovery key
      </h3>
      <p className="lock-intro">
        If you forget your password, this key unlocks {what}. Keep it somewhere safe, away from your notes (a password manager, or on paper). It won’t be
        shown again.
      </p>
      <div className="lock-key" data-recovery-key>
        {recoveryKey}
      </div>
      <button
        type="button"
        className="btn"
        onClick={() => {
          navigator.clipboard.writeText(recoveryKey).then(() => setCopied(true), notify)
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
      </button>
      <label className="lock-check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} data-lock-saved />
        I’ve saved my recovery key
      </label>
      <div className="lock-foot">
        <button type="button" className="btn btn-primary" disabled={!saved} onClick={done} data-lock-submit>
          Done
        </button>
      </div>
    </div>
  )
}

function Unlock({ then, close }: { then?: () => Promise<void>; close: () => void }) {
  const [password, setPassword] = useState('')
  return (
    <Form
      title="Enter your notes password"
      submit="Unlock"
      close={close}
      onSubmit={async () => {
        await unlockNotes(password)
        close()
        await then?.().catch(notify)
      }}
    >
      <Field label="Password" name="password" value={password} onChange={setPassword} autoFocus />
    </Form>
  )
}

function OwnPassword({ path, close }: { path: string; close: () => void }) {
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  return (
    <Form
      title={`A password for “${noteTitle(path)}”`}
      intro="Only this note uses it. The recovery key doesn’t cover it: if you forget this password, the note can’t be opened."
      submit="Lock note"
      close={close}
      onSubmit={async () => {
        const problem = newPasswordProblem(password, again)
        if (problem) throw new Error(problem)
        await setOwnPassword(path, password)
        await setNoteLock(path, { mode: 'own' })
        close()
        notify(`“${noteTitle(path)}” is locked with its own password.`, 'info')
      }}
    >
      <NewPasswordFields password={password} again={again} set={setPassword} setAgain={setAgain} />
    </Form>
  )
}

function ChangePassword({ close }: { close: () => void }) {
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  return (
    <Form
      title="Change your notes password"
      intro={hasRecoveryKey() ? 'Your recovery key keeps working.' : undefined}
      submit="Change password"
      close={close}
      onSubmit={async () => {
        if (!(await checkPassword(current))) throw new Error('Your current password isn’t right.')
        const problem = newPasswordProblem(password, again)
        if (problem) throw new Error(problem)
        await unlockNotes(current)
        await changePassword(password)
        close()
        notify('Your notes password has been changed.', 'info')
      }}
    >
      <Field label="Current password" name="current" value={current} onChange={setCurrent} autoFocus />
      <NewPasswordFields password={password} again={again} set={setPassword} setAgain={setAgain} first="New password" />
    </Form>
  )
}

/** After unlocking with the recovery key: pick a new password. */
function NewPassword({ close }: { close: () => void }) {
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  return (
    <Form
      title="Choose a new password"
      intro="Your notes are unlocked with the recovery key. Choose a new password for them (the recovery key keeps working)."
      submit="Set password"
      close={close}
      onSubmit={async () => {
        const problem = newPasswordProblem(password, again)
        if (problem) throw new Error(problem)
        await changePassword(password)
        close()
        notify('Your new notes password is set.', 'info')
      }}
    >
      <NewPasswordFields password={password} again={again} set={setPassword} setAgain={setAgain} first="New password" />
    </Form>
  )
}

/** Used by the lock screen's "forgot password". */
export async function recover(recoveryKey: string): Promise<void> {
  await unlockWithRecoveryKey(recoveryKey)
  openLockDialog({ kind: 'newPassword' })
}
