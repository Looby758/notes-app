import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { AlertTriangle, Check, Copy, Dices, ExternalLink, Eye, EyeOff, KeyRound, Lock, Pencil, Plus, Search, ShieldCheck, Trash2 } from 'lucide-react'
import Private from '../Streamer/Private'
import {
  autoLockMinutes,
  changeMasterPassword,
  checkMasterPassword,
  deleteLogin,
  lockVault,
  masterPasswordProblem,
  saveLogin,
  setUpVault,
  unlockVault,
  unlockVaultWithRecovery,
  usePasswords,
  vaultHasRecoveryKey
} from '../../lib/passwords/session'
import { blankLogin, reusedPasswords, searchLogins, siteLink, siteName, type Login } from '../../lib/passwords/entries'
import {
  DEFAULT_OPTIONS,
  estimateStrength,
  generatedBits,
  generatePassword,
  MAX_LENGTH,
  MIN_LENGTH,
  strengthLabel,
  type GenerateOptions,
  type Strength
} from '../../lib/passwords/generate'
import { ShowRecoveryKey } from '../Lock/LockDialog'
import { notify } from '../../store/notify'
import EmptyArt from '../Motion/EmptyArt'

/** Seconds a copied password stays on the clipboard. */
const CLEAR_AFTER = 30

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** The password vault: set it up, unlock it, then your saved logins. */
export default function PasswordsPage({ autoFocus }: { autoFocus: boolean }) {
  const setUp = usePasswords((s) => s.setUp)
  const unlocked = usePasswords((s) => s.unlocked)
  // After unlocking with the recovery key you pick a new master password before anything else.
  const [mustRenew, setMustRenew] = useState(false)
  // Shown once, right after setting up (kept here: setting up already unlocks the vault).
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null)
  useEffect(() => {
    if (!unlocked) setMustRenew(false)
  }, [unlocked])

  return (
    <div className="passwords-page" data-passwords-page>
      <div className="passwords-inner">
        {recoveryKey ? (
          <div className="passwords-card">
            <ShowRecoveryKey recoveryKey={recoveryKey} what="your passwords" done={async () => setRecoveryKey(null)} />
          </div>
        ) : !setUp ? (
          <SetUp autoFocus={autoFocus} madeRecoveryKey={setRecoveryKey} />
        ) : !unlocked ? (
          <Unlock autoFocus={autoFocus} recovered={() => setMustRenew(true)} />
        ) : mustRenew ? (
          <NewMaster title="Choose a new master password" intro="You unlocked with your recovery key. Pick a new master password; your recovery key keeps working." done={() => setMustRenew(false)} />
        ) : (
          <Private cover label="Your saved logins are hidden for streamer mode">
            <Vault />
          </Private>
        )}
      </div>
    </div>
  )
}

// ---------- setting up and unlocking ----------

function Heading() {
  return (
    <h2>
      <KeyRound size={18} /> Passwords
    </h2>
  )
}

/** A form with an error line and a busy state (making the key from a password takes a moment). */
function useSubmit(action: () => Promise<void>): { busy: boolean; error: string; submit: (e: FormEvent) => Promise<void> } {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, submit }
}

function ErrorLine({ error }: { error: string }) {
  if (!error) return null
  return (
    <p className="lock-error" role="alert">
      {error}
    </p>
  )
}

function PasswordInput({ label, value, onChange, autoFocus, name }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; name: string }) {
  return (
    <label className="lock-field">
      <span>{label}</span>
      <input type="password" value={value} autoFocus={autoFocus} spellCheck={false} autoComplete="off" data-passwords-field={name} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function StrengthHint({ password }: { password: string }) {
  if (!password) return null
  const { label } = estimateStrength(password)
  return <StrengthBadge label={label} />
}

function StrengthBadge({ label }: { label: Strength }) {
  return (
    <span className={`passwords-strength ${label.replace(' ', '-')}`} data-strength={label}>
      {label === 'weak' && <AlertTriangle size={12} />}
      {label[0].toUpperCase() + label.slice(1)}
    </span>
  )
}

function SetUp({ autoFocus, madeRecoveryKey }: { autoFocus: boolean; madeRecoveryKey: (key: string) => void }) {
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [withRecovery, setWithRecovery] = useState(true)
  const [understood, setUnderstood] = useState(false)
  const { busy, error, submit } = useSubmit(async () => {
    const problem = masterPasswordProblem(password, again)
    if (problem) throw new Error(problem)
    const key = await setUpVault(password, withRecovery)
    if (key) madeRecoveryKey(key)
  })

  return (
    <>
      <Heading />
      <p className="passwords-intro">
        Keep your logins here, locked with a <b>master password</b>. Everything is encrypted (AES-256, the same as locked notes) before it's saved in your
        notes folder, so the file is unreadable without it. Your master password is separate from your locked-notes password and is never saved anywhere.
      </p>
      <div className="passwords-card passwords-risks">
        <h3>
          <ShieldCheck size={15} /> Good to know
        </h3>
        <ul>
          <li>
            <b>If you forget your master password</b> and don't have a recovery key, your passwords can't be got back by anyone.
          </li>
          <li>
            <b>While unlocked,</b> anyone using your computer can see them. They lock again after {autoLockMinutes()} min without using Notes, with Ctrl+Alt+L,
            and when Notes closes.
          </li>
          <li>
            <b>A virus</b> that watches your typing or screen can get around any password app.
          </li>
          <li>
            <b>Copied passwords</b> can be read by other apps until the clipboard clears itself ({CLEAR_AFTER} seconds). On Windows, clipboard history (Win+V)
            may keep a copy; turn it off in Windows settings if you use it.
          </li>
          <li>
            <b>Not independently checked.</b> Dedicated apps like Bitwarden or 1Password have been tested by outside security experts. For your most
            important accounts (bank, main email) they're the safer place.
          </li>
        </ul>
      </div>
      <form className="passwords-card lock-form" onSubmit={submit} data-passwords-setup>
        <h3>
          <Lock size={15} /> Choose a master password
        </h3>
        <p className="lock-intro">Make it long and new: a few unrelated words together (like “tulip ladder orbit seven”) is strong and easy to remember.</p>
        <PasswordInput label="Master password" name="password" value={password} onChange={setPassword} autoFocus={autoFocus} />
        <StrengthHint password={password} />
        <PasswordInput label="Type it again" name="again" value={again} onChange={setAgain} />
        <label className="lock-check">
          <input type="checkbox" checked={withRecovery} onChange={(e) => setWithRecovery(e.target.checked)} data-passwords-recovery />
          Make a recovery key, in case I forget the master password (recommended)
        </label>
        <label className="lock-check">
          <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} data-passwords-understood />
          I understand that if I lose my master password{withRecovery ? ' and recovery key' : ''}, my passwords are gone for good
        </label>
        <ErrorLine error={error} />
        <div className="lock-foot">
          <button type="submit" className="btn btn-primary" disabled={busy || !understood} data-passwords-submit>
            {busy ? 'One moment…' : 'Create password vault'}
          </button>
        </div>
      </form>
    </>
  )
}

function Unlock({ autoFocus, recovered }: { autoFocus: boolean; recovered: () => void }) {
  const [value, setValue] = useState('')
  const [recovering, setRecovering] = useState(false)
  const { busy, error, submit } = useSubmit(async () => {
    if (!value) return
    if (recovering) {
      await unlockVaultWithRecovery(value)
      recovered()
    } else await unlockVault(value)
  })
  return (
    <div className="lock-screen" data-passwords-locked>
      <KeyRound size={34} strokeWidth={1.4} />
      <h2>Passwords are locked</h2>
      <p>{recovering ? 'Enter your recovery key. You’ll then choose a new master password.' : 'Enter your master password to see your saved logins.'}</p>
      <form onSubmit={submit} className="lock-screen-form">
        <input
          key={recovering ? 'recovery' : 'password'}
          type={recovering ? 'text' : 'password'}
          autoFocus={autoFocus}
          placeholder={recovering ? 'XXXXX-XXXXX-XXXXX-XXXXX-XXXXX' : 'Master password'}
          value={value}
          spellCheck={false}
          autoComplete="off"
          data-passwords-unlock-input
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="btn btn-primary" disabled={busy || !value} data-passwords-unlock>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
      <ErrorLine error={error} />
      {vaultHasRecoveryKey() && (
        <button
          className="link-button"
          onClick={() => {
            setRecovering(!recovering)
            setValue('')
          }}
        >
          {recovering ? 'Use my master password' : 'Forgot your master password?'}
        </button>
      )}
    </div>
  )
}

function NewMaster({ title, intro, done, needCurrent }: { title: string; intro: string; done: () => void; needCurrent?: boolean }) {
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const { busy, error, submit } = useSubmit(async () => {
    if (needCurrent && !(await checkMasterPassword(current))) throw new Error('Your current master password isn’t right.')
    const problem = masterPasswordProblem(password, again)
    if (problem) throw new Error(problem)
    await changeMasterPassword(password)
    notify('Your master password has been changed.', 'info')
    done()
  })
  return (
    <form className="passwords-card lock-form" onSubmit={submit} data-passwords-change>
      <h3>
        <Lock size={15} /> {title}
      </h3>
      <p className="lock-intro">{intro}</p>
      {needCurrent && <PasswordInput label="Current master password" name="current" value={current} onChange={setCurrent} autoFocus />}
      <PasswordInput label="New master password" name="password" value={password} onChange={setPassword} autoFocus={!needCurrent} />
      <StrengthHint password={password} />
      <PasswordInput label="Type it again" name="again" value={again} onChange={setAgain} />
      <ErrorLine error={error} />
      <div className="lock-foot">
        {needCurrent && (
          <button type="button" className="btn" onClick={done}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy} data-passwords-submit>
          {busy ? 'One moment…' : 'Change master password'}
        </button>
      </div>
    </form>
  )
}

// ---------- the unlocked vault ----------

/** What the right side shows. */
type View = { kind: 'none' } | { kind: 'show'; id: string } | { kind: 'edit'; login: Login; isNew: boolean } | { kind: 'generator' } | { kind: 'master' }

function Vault() {
  const logins = usePasswords((s) => s.logins)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<View>({ kind: 'none' })
  const shown = useMemo(() => searchLogins(logins, query), [logins, query])
  const reused = useMemo(() => reusedPasswords(logins), [logins])
  const count = logins.filter((l) => !l.deleted).length
  const current = view.kind === 'show' ? logins.find((l) => l.id === view.id && !l.deleted) : undefined
  const selectedId = view.kind === 'show' ? view.id : view.kind === 'edit' ? view.login.id : null

  return (
    <>
      <div className="passwords-top">
        <Heading />
        <div className="passwords-actions">
          <button className="btn" onClick={() => setView({ kind: 'generator' })} data-passwords-generator-open>
            <Dices size={14} /> Make a password
          </button>
          <button className="btn" onClick={() => setView({ kind: 'master' })} data-passwords-master>
            Change master password
          </button>
          <button className="btn" onClick={lockVault} title="Lock (Ctrl+Alt+L)" data-passwords-lock>
            <Lock size={14} /> Lock
          </button>
        </div>
      </div>
      <div className="passwords-body">
        <div className="passwords-list">
          <div className="passwords-search">
            <Search size={14} />
            <input value={query} placeholder={`Search ${count} login${count === 1 ? '' : 's'}`} spellCheck={false} onChange={(e) => setQuery(e.target.value)} data-passwords-search />
          </div>
          <button className="btn btn-primary passwords-new" onClick={() => setView({ kind: 'edit', login: blankLogin(), isNew: true })} data-passwords-new>
            <Plus size={14} /> New login
          </button>
          <ul data-passwords-list>
            {shown.map((l) => (
              <li key={l.id}>
                <button className={`passwords-row ${selectedId === l.id ? 'active' : ''}`} onClick={() => setView({ kind: 'show', id: l.id })} data-passwords-row={l.id}>
                  <span className="passwords-row-title">{l.title || siteName(l.url) || 'Untitled'}</span>
                  <span className="passwords-row-sub">{l.username || siteName(l.url)}</span>
                  {reused.has(l.id) && <AlertTriangle size={13} className="passwords-row-warn" aria-label="Password used more than once" />}
                </button>
              </li>
            ))}
          </ul>
          {count === 0 && (
            <div className="empty-with-art">
              <EmptyArt kind="key" />
              <p className="passwords-none">No logins yet. Press “New login” to add one.</p>
            </div>
          )}
          {count > 0 && shown.length === 0 && <p className="passwords-none">Nothing matches “{query}”.</p>}
        </div>
        <div className="passwords-detail">
          {view.kind === 'edit' ? (
            <Edit key={view.login.id} login={view.login} isNew={view.isNew} done={(id) => setView(id ? { kind: 'show', id } : { kind: 'none' })} />
          ) : view.kind === 'generator' ? (
            <Generator />
          ) : view.kind === 'master' ? (
            <NewMaster
              title="Change master password"
              intro={vaultHasRecoveryKey() ? 'Your recovery key keeps working.' : 'Pick something long and new.'}
              needCurrent
              done={() => setView({ kind: 'none' })}
            />
          ) : current ? (
            <Show key={current.id} login={current} reused={reused.has(current.id)} edit={() => setView({ kind: 'edit', login: current, isNew: false })} />
          ) : (
            <p className="passwords-none">Pick a login on the left, or add a new one.</p>
          )}
        </div>
      </div>
    </>
  )
}

/** A copy button that shows a tick for a moment. Passwords go through the self-clearing clipboard. */
function CopyButton({ text, secret, label }: { text: string; secret?: boolean; label: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  const copy = (): void => {
    const done = secret ? window.api.copySecret(text, CLEAR_AFTER) : navigator.clipboard.writeText(text)
    done.then(() => {
      setCopied(true)
      if (secret) notify(`Password copied. The clipboard clears in ${CLEAR_AFTER} seconds.`, 'info')
    }, notify)
  }
  return (
    <button type="button" className="icon-btn" onClick={copy} disabled={!text} title={label} aria-label={label} data-passwords-copy={secret ? 'password' : 'text'}>
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="passwords-field">
      <span className="passwords-label">{label}</span>
      <div className="passwords-value">{children}</div>
    </div>
  )
}

function Show({ login, reused, edit }: { login: Login; reused: boolean; edit: () => void }) {
  const [reveal, setReveal] = useState(false)
  const link = siteLink(login.url)
  const remove = async (): Promise<void> => {
    const ok = await window.api.confirm({
      message: `Delete the login “${login.title || siteName(login.url) || 'Untitled'}”?`,
      detail: 'Its password will be gone from Notes for good.',
      ok: 'Delete',
      cancel: 'Keep it'
    })
    if (ok) await deleteLogin(login.id).catch(notify)
  }
  return (
    <div className="passwords-card" data-passwords-show={login.id}>
      <div className="passwords-show-head">
        <h3>{login.title || siteName(login.url) || 'Untitled'}</h3>
        <button className="btn" onClick={edit} data-passwords-edit>
          <Pencil size={13} /> Edit
        </button>
        <button className="icon-btn" onClick={() => void remove()} title="Delete" aria-label="Delete" data-passwords-delete>
          <Trash2 size={14} />
        </button>
      </div>
      {login.username && (
        <Row label="Username">
          <span className="passwords-text">{login.username}</span>
          <CopyButton text={login.username} label="Copy username" />
        </Row>
      )}
      <Row label="Password">
        <span className="passwords-text passwords-secret" data-passwords-secret>
          {login.password ? (reveal ? login.password : '•'.repeat(12)) : <i>none</i>}
        </span>
        {login.password && (
          <>
            <button type="button" className="icon-btn" onClick={() => setReveal(!reveal)} title={reveal ? 'Hide' : 'Show'} aria-label={reveal ? 'Hide password' : 'Show password'} data-passwords-reveal>
              {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <CopyButton text={login.password} secret label="Copy password" />
          </>
        )}
      </Row>
      {reused && (
        <p className="passwords-warning" data-passwords-reused>
          <AlertTriangle size={13} /> This password is used for more than one login. If one site leaks it, the others are at risk too. Consider giving each its own.
        </p>
      )}
      {login.url && (
        <Row label="Website">
          {link ? (
            <a href={link} target="_blank" rel="noreferrer" className="passwords-text">
              {siteName(login.url)} <ExternalLink size={12} />
            </a>
          ) : (
            <span className="passwords-text">{login.url}</span>
          )}
        </Row>
      )}
      {login.notes && (
        <Row label="Notes">
          <span className="passwords-text passwords-notes">{login.notes}</span>
        </Row>
      )}
      <p className="passwords-meta">Last changed {new Date(login.updated).toLocaleString()}</p>
    </div>
  )
}

function Edit({ login, isNew, done }: { login: Login; isNew: boolean; done: (id?: string) => void }) {
  const [draft, setDraft] = useState(login)
  const [reveal, setReveal] = useState(isNew)
  const [generating, setGenerating] = useState(false)
  const set = (patch: Partial<Login>): void => setDraft((d) => ({ ...d, ...patch }))
  const { busy, error, submit } = useSubmit(async () => {
    if (!draft.title.trim() && !draft.url.trim()) throw new Error('Give it a name or a website, so you can find it again.')
    await saveLogin({ ...draft, title: draft.title.trim(), username: draft.username.trim(), url: draft.url.trim() })
    done(draft.id)
  })
  const text = (key: 'title' | 'username' | 'url', label: string, placeholder: string, autoFocus = false) => (
    <label className="lock-field">
      <span>{label}</span>
      <input value={draft[key]} placeholder={placeholder} autoFocus={autoFocus} spellCheck={false} autoComplete="off" onChange={(e) => set({ [key]: e.target.value })} data-passwords-input={key} />
    </label>
  )
  return (
    <form className="passwords-card lock-form" onSubmit={submit} data-passwords-form>
      <h3>{isNew ? 'New login' : 'Edit login'}</h3>
      {text('title', 'Name', 'e.g. Netflix', true)}
      {text('username', 'Username or email', '')}
      <label className="lock-field">
        <span>Password</span>
        <div className="passwords-password-row">
          <input
            type={reveal ? 'text' : 'password'}
            value={draft.password}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => set({ password: e.target.value })}
            data-passwords-input="password"
          />
          <button type="button" className="icon-btn" onClick={() => setReveal(!reveal)} title={reveal ? 'Hide' : 'Show'} aria-label={reveal ? 'Hide password' : 'Show password'}>
            {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button type="button" className="btn" onClick={() => setGenerating(!generating)} data-passwords-generate>
            <Dices size={14} /> Make one
          </button>
        </div>
      </label>
      <StrengthHint password={draft.password} />
      {generating && (
        <Generator
          use={(p) => {
            set({ password: p })
            setReveal(true)
            setGenerating(false)
          }}
        />
      )}
      {text('url', 'Website', 'e.g. netflix.com')}
      <label className="lock-field">
        <span>Notes</span>
        <textarea value={draft.notes} rows={3} spellCheck={false} onChange={(e) => set({ notes: e.target.value })} data-passwords-input="notes" />
      </label>
      <ErrorLine error={error} />
      <div className="lock-foot">
        <button type="button" className="btn" onClick={() => done(isNew ? undefined : login.id)}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy} data-passwords-save>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

/** Makes random passwords. With `use`, it fills in the login being edited. */
function Generator({ use }: { use?: (password: string) => void }) {
  const [options, setOptions] = useState<GenerateOptions>(DEFAULT_OPTIONS)
  const [password, setPassword] = useState(() => generatePassword(DEFAULT_OPTIONS))
  const change = (patch: Partial<GenerateOptions>): void => {
    const next = { ...options, ...patch }
    setOptions(next)
    setPassword(generatePassword(next))
  }
  const toggle = (key: 'lower' | 'upper' | 'digits' | 'symbols', label: string) => (
    <label className="lock-check">
      <input
        type="checkbox"
        checked={options[key]}
        // Keep at least one kind of character.
        disabled={options[key] && ['lower', 'upper', 'digits', 'symbols'].filter((k) => options[k as typeof key]).length === 1}
        onChange={(e) => change({ [key]: e.target.checked })}
        data-passwords-option={key}
      />
      {label}
    </label>
  )
  return (
    <div className={`passwords-generator ${use ? 'inline' : 'passwords-card'}`} data-passwords-generator>
      {!use && (
        <h3>
          <Dices size={15} /> Make a password
        </h3>
      )}
      <div className="passwords-generated">
        <code data-passwords-generated>{password}</code>
        <button type="button" className="icon-btn" onClick={() => setPassword(generatePassword(options))} title="Make another" aria-label="Make another" data-passwords-regenerate>
          <Dices size={14} />
        </button>
        {!use && <CopyButton text={password} secret label="Copy password" />}
      </div>
      <StrengthBadge label={strengthLabel(generatedBits(options))} />
      <label className="passwords-length">
        <span>Length: {options.length}</span>
        <input type="range" min={MIN_LENGTH} max={MAX_LENGTH} value={options.length} onChange={(e) => change({ length: Number(e.target.value) })} data-passwords-length />
      </label>
      <div className="passwords-options">
        {toggle('lower', 'a–z')}
        {toggle('upper', 'A–Z')}
        {toggle('digits', '0–9')}
        {toggle('symbols', '!@#$')}
        <label className="lock-check">
          <input type="checkbox" checked={options.noLookalikes} onChange={(e) => change({ noLookalikes: e.target.checked })} />
          Avoid look-alikes (0 O 1 l I)
        </label>
      </div>
      {use && (
        <button type="button" className="btn btn-primary" onClick={() => use(password)} data-passwords-use>
          Use this password
        </button>
      )}
    </div>
  )
}
