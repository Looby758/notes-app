import { useState, type FormEvent } from 'react'
import { KeyRound, Lock, MapPin, ShieldAlert, X } from 'lucide-react'
import { loginMatchesPage, originOf, PERMISSION_ASKS, siteOf, type AutofillProfile } from '@shared/browser'
import { saveLogin, unlockVault, usePasswords } from '../../lib/passwords/session'
import { blankLogin, type Login } from '../../lib/passwords/entries'
import { answerPermission, setSite, type PermissionAsk } from '../../store/browser'
import { openSpecialTab, PASSWORDS_TAB } from '../../lib/editorController'
import { notify } from '../../store/notify'

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Your master password, typed into a bar or pop-up to unlock Passwords there and then. */
function Unlock({ onUnlocked, compact }: { onUnlocked: () => void; compact?: boolean }) {
  const [master, setMaster] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await unlockVault(master)
      onUnlocked()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className={`web-unlock ${compact ? 'compact' : ''}`} onSubmit={submit}>
      <Lock size={13} />
      <input type="password" className="text-input" autoFocus placeholder="Master password" value={master} onChange={(e) => setMaster(e.target.value)} disabled={busy} />
      <button className="btn" disabled={busy || !master}>
        Unlock
      </button>
      {error && <span className="web-unlock-error">{error}</span>}
    </form>
  )
}

export interface LoginOffer {
  pageUrl: string
  username: string
  password: string
  /** An existing login for the site and username with a different password: offer to update it. */
  update?: Login
}

/** Works out whether to offer saving a login that was just sent (null: nothing to offer). */
export function loginOffer(pageUrl: string, username: string, password: string): LoginOffer | null {
  if (!password) return null
  const { unlocked, logins } = usePasswords.getState()
  if (!unlocked) return { pageUrl, username, password }
  const here = logins.filter((l) => !l.deleted && loginMatchesPage(l.url, pageUrl))
  const same = here.find((l) => l.username === username || (!username && here.length === 1))
  if (same && same.password === password) return null
  return { pageUrl, username: username || same?.username || '', password, update: same }
}

/** "Save your password for this site?", like Opera GX: saved into Orbit's Passwords. */
export function SaveLoginBar({ offer, onDone }: { offer: LoginOffer; onDone: () => void }) {
  const setUp = usePasswords((s) => s.setUp)
  const unlocked = usePasswords((s) => s.unlocked)
  const [username, setUsername] = useState(offer.username)
  const [show, setShow] = useState(false)
  const site = siteOf(offer.pageUrl)

  const save = async (): Promise<void> => {
    try {
      const now = Date.now()
      const login: Login = offer.update
        ? { ...offer.update, username: username.trim(), password: offer.password, updated: now }
        : { ...blankLogin(now), title: site, username: username.trim(), password: offer.password, url: originOf(offer.pageUrl) }
      await saveLogin(login)
      notify(offer.update ? `Password updated for ${site}` : `Saved to Passwords for ${site}`, 'info')
      onDone()
    } catch (err) {
      notify(err)
    }
  }

  return (
    <div className="web-bar-prompt" data-save-login>
      <KeyRound size={15} />
      <span className="web-bar-prompt-text">
        {offer.update ? `Update your saved password for ${site}?` : `Save your password for ${site}?`}
      </span>
      {!setUp ? (
        <>
          <span className="web-bar-prompt-note">Set up Passwords first (it keeps logins locked with a master password).</span>
          <button className="btn btn-primary" onClick={() => (openSpecialTab(PASSWORDS_TAB), onDone())}>
            Set up Passwords
          </button>
        </>
      ) : !unlocked ? (
        <Unlock onUnlocked={() => undefined} compact />
      ) : (
        <>
          <input className="text-input web-bar-prompt-user" value={username} placeholder="Username" onChange={(e) => setUsername(e.target.value)} />
          <input className="text-input web-bar-prompt-pass" readOnly type={show ? 'text' : 'password'} value={offer.password} onClick={() => setShow(!show)} title="Click to show or hide" />
          <button className="btn btn-primary" onClick={() => void save()} data-save-login-yes>
            {offer.update ? 'Update' : 'Save'}
          </button>
        </>
      )}
      {!offer.update && (
        <button
          className="btn"
          onClick={() => {
            setSite(site, { neverSavePasswords: true })
            onDone()
          }}
        >
          Never for this site
        </button>
      )}
      <button className="icon-btn" title="Not now" onClick={onDone}>
        <X size={14} />
      </button>
    </div>
  )
}

/** "discord.com wants to use your microphone": Allow or Block (remembered; change it in Site settings). */
export function PermissionBar({ ask }: { ask: PermissionAsk }) {
  const what = ask.permissions.map((p) => PERMISSION_ASKS[p])
  const said = what.length > 1 ? `${what.slice(0, -1).join(', ')} and ${what[what.length - 1]}` : what[0]
  return (
    <div className="web-bar-prompt" data-permission-ask={ask.permissions.join(',')}>
      <ShieldAlert size={15} />
      <span className="web-bar-prompt-text">
        <strong>{ask.site}</strong> wants to {said}.
      </span>
      <button className="btn btn-primary" onClick={() => answerPermission(ask, true)}>
        Allow
      </button>
      <button className="btn" onClick={() => answerPermission(ask, false)}>
        Block
      </button>
    </div>
  )
}

export interface FieldFocus {
  kind: 'login' | 'address'
  /** Where the field is on the page, in the page's own pixels. */
  rect: { x: number; y: number; width: number; height: number }
}

/**
 * The pop-up under a form field offering to fill it in (Chrome and Opera GX style): your saved
 * logins for this site, or your name, email and address. Nothing is filled until you pick.
 */
export function FillPopup({
  focus,
  zoom,
  pageUrl,
  profile,
  onFillLogin,
  onFillAddress,
  onHover,
  onClose
}: {
  focus: FieldFocus
  zoom: number
  pageUrl: string
  profile: AutofillProfile
  onFillLogin: (login: Login) => void
  onFillAddress: () => void
  onHover: (over: boolean) => void
  onClose: () => void
}) {
  const setUp = usePasswords((s) => s.setUp)
  const unlocked = usePasswords((s) => s.unlocked)
  const logins = usePasswords((s) => s.logins)
  const style = { left: Math.max(4, focus.rect.x * zoom), top: (focus.rect.y + focus.rect.height) * zoom + 4, minWidth: Math.min(360, Math.max(240, focus.rect.width * zoom)) }
  const box = (children: React.ReactNode): React.ReactElement => (
    <div className="web-fill" style={style} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} onMouseDown={(e) => e.preventDefault()} data-web-fill={focus.kind}>
      {children}
      <button className="web-fill-close icon-btn" title="Close" onClick={onClose}>
        <X size={12} />
      </button>
    </div>
  )

  if (focus.kind === 'address') {
    return box(
      <button className="web-fill-item" onClick={onFillAddress} data-web-fill-address>
        <MapPin size={14} />
        <span>
          <strong>Fill in your details</strong>
          <small>{[profile.name, profile.email, profile.postcode].filter(Boolean).join(' · ')}</small>
        </span>
      </button>
    )
  }
  if (!setUp) return null
  if (!unlocked) {
    return box(
      <div className="web-fill-locked">
        <span>
          <KeyRound size={13} /> Unlock Passwords to fill in a saved login
        </span>
        <Unlock onUnlocked={() => undefined} compact />
      </div>
    )
  }
  const matching = logins.filter((l) => !l.deleted && l.password && loginMatchesPage(l.url, pageUrl))
  if (!matching.length) return null
  return box(
    <>
      <div className="web-fill-head">Saved logins for {siteOf(pageUrl)}</div>
      {matching.map((l) => (
        <button key={l.id} className="web-fill-item" onClick={() => onFillLogin(l)} data-web-fill-login>
          <KeyRound size={14} />
          <span>
            <strong>{l.username || '(no username)'}</strong>
            <small>{'•'.repeat(Math.min(12, l.password.length))}</small>
          </span>
        </button>
      ))}
    </>
  )
}
