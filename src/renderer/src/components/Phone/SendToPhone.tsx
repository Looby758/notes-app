import { useEffect, useMemo, useState } from 'react'
import qrcode from 'qrcode-generator'
import { CheckCircle2, Smartphone } from 'lucide-react'
import type { PhoneShare } from '@shared/types'
import { sendToPhone, usePhone } from '../../store/phone'

/** A QR code the phone's camera opens: it gets the file (or link) straight from this computer over the Wi-Fi. */
export default function SendToPhone() {
  const target = usePhone((s) => s.target)
  const [share, setShare] = useState<PhoneShare | null>(null)
  const [error, setError] = useState('')
  const [delivered, setDelivered] = useState(false)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!target) return
    let made: PhoneShare | null = null
    let cancelled = false
    setShare(null)
    setError('')
    setDelivered(false)
    const start = target.kind === 'file' ? window.api.phoneShareFile(target.path) : window.api.phoneShareLink(target.url)
    start.then(
      (s) => {
        made = s
        if (cancelled) void window.api.phoneStop(s.token)
        else setShare(s)
      },
      (err: Error) => !cancelled && setError(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
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

  const qr = useMemo(() => {
    if (!share) return ''
    const code = qrcode(0, 'M')
    code.addData(share.url)
    code.make()
    return code.createDataURL(6, 2)
  }, [share])

  if (!target) return null
  const close = (): void => sendToPhone(null)
  const name = target.kind === 'file' ? target.path.split('/').pop() : (target.title ?? target.url)
  const left = share ? Math.max(0, Math.round((share.expiresAt - now) / 1000)) : 0
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal phone-dialog" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()} tabIndex={-1} ref={(el) => el?.focus()}>
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
            <div className="phone-qr">{qr ? <img src={qr} alt="QR code" /> : <span>Making the code…</span>}</div>
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
      </div>
    </div>
  )
}
