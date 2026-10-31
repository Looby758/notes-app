import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

export const cleanError = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** The QR code a phone's camera opens. */
export function Qr({ text }: { text: string }) {
  const src = useMemo(() => {
    if (!text) return ''
    const code = qrcode(0, 'M')
    code.addData(text, 'Byte')
    code.make()
    return code.createDataURL(6, 2)
  }, [text])
  return <div className="phone-qr">{src ? <img src={src} alt="QR code" /> : <span>Making the code…</span>}</div>
}
