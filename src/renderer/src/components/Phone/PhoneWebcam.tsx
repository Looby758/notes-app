import { useEffect, useRef, useState } from 'react'
import { Webcam } from 'lucide-react'
import type { CamStatus } from '@shared/types'
import { usePhone } from '../../store/phone'
import { notify } from '../../store/notify'
import { Qr, cleanError } from './Qr'

const OBS_DOWNLOAD = 'https://obsproject.com/download'

/** The phone's frames, live, while this window is open. */
function Preview() {
  const [src, setSrc] = useState('')
  const last = useRef('')
  useEffect(() => {
    void window.api.camPreview(true)
    const off = window.api.onCamFrame((jpeg) => {
      const url = URL.createObjectURL(new Blob([jpeg as BlobPart], { type: 'image/jpeg' }))
      if (last.current) URL.revokeObjectURL(last.current)
      last.current = url
      setSrc(url)
    })
    return () => {
      off()
      void window.api.camPreview(false)
      if (last.current) URL.revokeObjectURL(last.current)
    }
  }, [])
  return <div className="cam-preview">{src ? <img src={src} alt="What your phone sees" /> : <span>Waiting for a picture…</span>}</div>
}

/** What's happening with the PC side: the camera apps pick. */
function CameraLine({ cam, retry }: { cam: CamStatus; retry: () => void }) {
  switch (cam.camera) {
    case 'running':
      return (
        <p className="cam-line ok">
          ● Ready. In Discord, Zoom or Teams, pick <b>OBS Virtual Camera</b> as your camera.
        </p>
      )
    case 'starting':
      return <p className="cam-line">Starting the camera…</p>
    case 'no-driver':
      return (
        <div className="cam-box">
          <p>
            One thing first: Orbit uses the free webcam driver that comes with <b>OBS Studio</b>. Install OBS once (you never need to open it), then click Check
            again.
          </p>
          <div className="phone-actions">
            <button type="button" className="btn btn-primary" onClick={() => window.open(OBS_DOWNLOAD)}>
              Get OBS Studio
            </button>
            <button type="button" className="btn" onClick={retry}>
              Check again
            </button>
          </div>
        </div>
      )
    case 'in-use':
    case 'error':
      return (
        <div className="cam-box">
          <p>{cam.message || 'The camera couldn’t start.'}</p>
          <div className="phone-actions">
            <button type="button" className="btn" onClick={retry}>
              Try again
            </button>
          </div>
        </div>
      )
    default:
      return null
  }
}

/** Phone webcam: turn it on, scan the code, and the phone is the PC's webcam. */
export default function PhoneWebcam({ close }: { close: () => void }) {
  const cam = usePhone((s) => s.cam)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    window.api.camStatus().then(
      (c) => usePhone.setState({ cam: c }),
      () => {}
    )
  }, [])

  const run = (action: () => Promise<CamStatus>): void => {
    setBusy(true)
    setError('')
    action()
      .then((c) => usePhone.setState({ cam: c }))
      .catch((err) => setError(cleanError(err)))
      .finally(() => setBusy(false))
  }

  const title = (
    <h2>
      <Webcam size={18} /> Phone webcam
    </h2>
  )

  if (cam?.camera === 'mac') {
    return (
      <>
        {title}
        <p className="phone-hint cam-intro">
          Your Mac doesn’t need this. It has its own camera, and an iPhone already works as a Mac webcam with Continuity Camera: bring the iPhone close, then
          pick it as the camera in the app (or in FaceTime, Video → iPhone camera).
        </p>
        <div className="phone-actions">
          <button type="button" className="btn btn-primary" onClick={close}>
            Done
          </button>
        </div>
      </>
    )
  }

  if (!cam?.on) {
    return (
      <>
        {title}
        <p className="phone-hint cam-intro">
          Use your phone’s camera as this PC’s webcam, for Discord, Zoom, Teams, the browser and anything else with a camera. It goes over your Wi-Fi with
          nothing to install on the phone.
        </p>
        {error && <p className="phone-error">{error}</p>}
        <div className="phone-actions">
          <button type="button" className="btn" onClick={close}>
            Close
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(window.api.camOn)}>
            Turn on
          </button>
        </div>
      </>
    )
  }

  const newLink = (): void =>
    run(async () => {
      const c = await window.api.camNewLink()
      notify('Made a new webcam link. The old code and Home Screen page won’t work any more.', 'info')
      return c
    })

  return (
    <>
      {title}
      <CameraLine cam={cam} retry={() => run(window.api.camRetry)} />
      {cam.phone ? (
        <>
          <Preview />
          <p className="phone-name">● Your phone is live · {cam.fps} fps</p>
        </>
      ) : (
        <>
          <Qr text={cam.url} />
          <p className="phone-hint">
            Scan with your phone’s camera (same Wi-Fi). The first time, Safari says the connection isn’t private: that’s only because it’s your own computer,
            not a website. Tap <b>Show Details</b>, then <b>visit this website</b>. Then tap Start. To keep it, tap Share → Add to Home Screen.
          </p>
        </>
      )}
      <div className="cam-settings">
        <label>
          Quality
          <select value={cam.quality} onChange={(e) => run(() => window.api.camSet({ quality: e.target.value as 'sd' | 'hd' }))}>
            <option value="sd">720p (smoother)</option>
            <option value="hd">1080p (sharper)</option>
          </select>
        </label>
        <label>
          Picture
          <select value={cam.fill ? 'fill' : 'fit'} onChange={(e) => run(() => window.api.camSet({ fill: e.target.value === 'fill' }))}>
            <option value="fit">Show it all</option>
            <option value="fill">Fill the frame</option>
          </select>
        </label>
      </div>
      {error && <p className="phone-error">{error}</p>}
      <div className="phone-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => run(window.api.camOff)} title="The camera goes away from other apps">
          Turn off
        </button>
        <button type="button" className="btn" disabled={busy} onClick={newLink} title="Makes a new code; the old one stops working">
          New code
        </button>
        <button type="button" className="btn btn-primary" onClick={close}>
          Done
        </button>
      </div>
      <p className="phone-hint cam-foot">It stays on when you close this, and comes back on next time Orbit opens, until you turn it off.</p>
    </>
  )
}
