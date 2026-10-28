import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { EyeOff } from 'lucide-react'
import { useStreamerOn } from '../../store/streamer'
import './streamer.css'

/**
 * Something private: in streamer mode it's blurred until you click it (a click only shows it, so
 * clicking an email or a note name doesn't also open it). Turning streamer mode off and on again
 * hides it once more.
 *
 * `cover` is for a whole area (an email, a page): a "Click to show" layer goes on top, which also
 * works over frames and web pages that would otherwise take the click. `opaque` hides the area
 * completely instead of blurring it (web pages can't be blurred).
 */
export default function Private({
  children,
  when = true,
  cover = false,
  opaque = false,
  label = 'Hidden for streamer mode',
  className = ''
}: {
  children: ReactNode
  /** Extra condition, e.g. a setting that turns this kind of thing off. */
  when?: boolean
  cover?: boolean
  opaque?: boolean
  label?: string
  className?: string
}) {
  const on = useStreamerOn() && when
  const [shown, setShown] = useState(false)
  useEffect(() => setShown(false), [on])
  const hidden = on && !shown

  // The same elements whether hidden or not (only their classes change), so showing something
  // doesn't start it again (a web page reloading, say).
  const show = (e: MouseEvent): void => {
    if (!hidden) return
    e.preventDefault()
    e.stopPropagation()
    setShown(true)
  }

  if (cover) {
    return (
      <div className={`private-area ${hidden ? 'hidden' : ''} ${opaque ? 'opaque' : ''} ${className}`} data-private={hidden || undefined}>
        <div className="private-area-content" aria-hidden={hidden || undefined} inert={hidden}>
          {children}
        </div>
        {hidden && (
          <button className="private-area-cover" onClick={show}>
            <span className="private-area-label">
              <EyeOff size={16} /> {label}
              <span className="btn">Click to show</span>
            </span>
          </button>
        )}
      </div>
    )
  }
  return (
    <span
      className={`private ${hidden ? 'hidden' : ''} ${className}`}
      title={hidden ? 'Hidden for streamer mode. Click to show.' : undefined}
      onClickCapture={show}
      onMouseDownCapture={(e) => hidden && e.stopPropagation()}
      data-private={hidden || undefined}
    >
      {children}
    </span>
  )
}

/** A tooltip that would give away something private: none in streamer mode. */
export function usePrivateTitle(): (title: string | undefined) => string | undefined {
  const on = useStreamerOn()
  return (title) => (on ? undefined : title)
}
