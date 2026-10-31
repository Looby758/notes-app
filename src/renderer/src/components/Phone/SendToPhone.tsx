import { useEffect, useState } from 'react'
import { CheckCircle2, Eye, EyeOff, Smartphone, Wifi } from 'lucide-react'
import type { PhoneShare } from '@shared/types'
import { wifiQrText } from '@shared/wifi'
import { sendToPhone, usePhone, type PhoneTarget } from '../../store/phone'
import { notify } from '../../store/notify'
import { Qr, cleanError } from './Qr'
import PhoneWebcam from './PhoneWebcam'

/** The phone dialog: send something to the phone, pair the phone, the phone webcam, or the Wi-Fi code for guests. */
export default function SendToPhone() {
  const target = usePhone((s) => s.target)
  if (!target) return null
  const close = (): void => sendToPhone(null)
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div
        className={`modal phone-dialog${target.kind === 'webcam' ? ' cam-dialog' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && close()}
        tabIndex={-1}
        ref={(el) => el?.focus()}
      >
        {target.kind === 'pair' ? (
          <Pair close={close} />
        ) : target.kind === 'webcam' ? (
          <PhoneWebcam close={close} />
        ) : target.kind === 'wifi' ? (
          <GuestWifi close={close} />
        ) : (
          <Send target={target} close={close} />
        )}
      </div>
    </div>
  )
}

/** One file or link: works for 10 minutes, or until the dialog closes. */
function Send({ target, close }: { target: Extract<PhoneTarget, { kind: 'file' | 'link' }>; close: () => void }) {
  const [share, setShare] = useState<PhoneShare | null>(null)
  const [error, setError] = useState('')
  const [delivered, setDelivered] = useState(false)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    let made: PhoneShare | null = null
    let cancelled = false
    const start = target.kind === 'file' ? window.api.phoneShareFile(target.path) : window.api.phoneShareLink(target.url)
    start.then(
      (s) => {
        made = s
        if (cancelled) void window.api.phoneStop(s.token)
        else setShare(s)
      },
      (err) => !cancelled && setError(cleanError(err))
    )
    const off = window.api.onPhoneDelivered((token) => token === made?.token && setDelivered(true))
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      cancelled = true
      off()
      clearInterval(tick)
      if (made) void window.api.phoneStop(made.token)
    }
  }, [target])

  const name = target.kind === 'file' ? target.path.split('/').pop() : (target.title ?? target.url)
  const left = share ? Math.max(0, Math.round((share.expiresAt - now) / 1000)) : 0
  return (
    <>
      <h2>
        <Smartphone size={18} /> Send to phone
      </h2>
      <p className="phone-name">{name}</p>
      {error ? (
        <p className="phone-error">{error}</p>
      ) : delivered ? (
        <p className="phone-done">
          <CheckCircle2 size={40} />
          <span>{target.kind === 'file' ? 'It’s on your phone.' : 'Opened on your phone.'}</span>
        </p>
      ) : left === 0 && share ? (
        <p className="phone-error">This code has run out. Close and send it again.</p>
      ) : (
        <>
          <Qr text={share?.url ?? ''} />
          <p className="phone-hint">
            Point your phone’s camera at the code and tap the link. Your phone needs to be on the same Wi-Fi as this computer.
            {share && ` Works for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}.`}
          </p>
        </>
      )}
      <div className="phone-actions">
        <button type="button" className="btn" onClick={close}>
          {delivered ? 'Done' : 'Close'}
        </button>
      </div>
    </>
  )
}

/** Pairing: one code, remembered, so the phone's page reconnects whenever Notes is open. */
function Pair({ close }: { close: () => void }) {
  const connected = usePhone((s) => s.connected)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const load = (fresh: boolean): void => {
    setError('')
    window.api.phonePair(fresh).then(
      (p) => {
        setUrl(p.url)
        usePhone.setState({ connected: p.connected })
      },
      (err) => setError(cleanError(err))
    )
  }
  useEffect(() => load(false), [])
  const forget = async (): Promise<void> => {
    await window.api.phoneForget()
    usePhone.setState({ connected: 0 })
    notify('Your phone is forgotten. Its page won’t connect any more.', 'info')
    close()
  }
  return (
    <>
      <h2>
        <Smartphone size={18} /> Connect your phone
      </h2>
      {error ? (
        <p className="phone-error">{error}</p>
      ) : (
        <>
          <p className="phone-name">{connected > 0 ? '● Connected' : 'Scan with your phone’s camera'}</p>
          <Qr text={url} />
          <p className="phone-hint">
            Your phone gets a page to send photos and files to Notes, share the clipboard, control music and YouTube, use it as a touchpad and keyboard, talk
            into a note, and scan pages and receipts. On an iPhone, tap Share → Add to Home Screen to keep it: it reconnects by itself whenever Notes is open.
            Same Wi-Fi only.
          </p>
        </>
      )}
      <div className="phone-actions">
        <button type="button" className="btn" onClick={() => void forget()} title="The old code and Home Screen page stop working">
          Forget phone
        </button>
        <button type="button" className="btn" onClick={() => load(true)} title="Makes a new code; the old one stops working">
          New code
        </button>
        <button type="button" className="btn btn-primary" onClick={close}>
          Done
        </button>
      </div>
    </>
  )
}

/** A code guests scan to join your Wi-Fi without typing the password. */
function GuestWifi({ close }: { close: () => void }) {
  const [ssid, setSsid] = useState('')
  const [password, setPassword] = useState('')
  const [shown, setShown] = useState(false)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    window.api
      .phoneWifi()
      .then((w) => {
        setSsid(w.ssid)
        setPassword(w.password)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])
  return (
    <>
      <h2>
        <Wifi size={18} /> Wi-Fi for guests
      </h2>
      {ssid ? <Qr text={wifiQrText({ ssid, password })} /> : <div className="phone-qr">{loading ? 'Finding your Wi-Fi…' : 'Type your Wi-Fi’s name below'}</div>}
      <p className="phone-hint">Guests point their phone’s camera at the code and tap Join. Nothing is saved or sent anywhere.</p>
      <div className="phone-fields">
        <input value={ssid} onChange={(e) => setSsid(e.target.value)} placeholder="Wi-Fi name" spellCheck={false} />
        <div className="phone-password">
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (blank if none)"
            type={shown ? 'text' : 'password'}
            spellCheck={false}
          />
          <button type="button" className="icon-btn" title={shown ? 'Hide' : 'Show'} onClick={() => setShown(!shown)}>
            {shown ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>
      <div className="phone-actions">
        <button type="button" className="btn" onClick={close}>
          Done
        </button>
      </div>
    </>
  )
}
