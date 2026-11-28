import { useLayoutEffect, useRef, useState, type ComponentType } from 'react'

/**
 * A row of tabs with a pill that slides to the one you pick. `attr` names the data attribute each
 * tab carries (e.g. "data-ws-view"), so tests and the rest of the studio can find them.
 */
export default function Segmented<T extends string>({
  items,
  value,
  onChange,
  attr,
  className = ''
}: {
  items: { id: T; label: string; icon: ComponentType<{ size?: number }> }[]
  value: T
  onChange: (id: T) => void
  attr: string
  className?: string
}) {
  const row = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null)

  useLayoutEffect(() => {
    const el = row.current
    if (!el) return
    const place = (): void => {
      const on = el.querySelector<HTMLElement>('[aria-selected="true"]')
      if (on) setPill({ left: on.offsetLeft, width: on.offsetWidth })
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    return () => ro.disconnect()
  }, [value])

  return (
    <div className={`ws-seg ${className}`} role="tablist" ref={row}>
      {pill && <span className="ws-seg-pill" style={{ transform: `translateX(${pill.left}px)`, width: pill.width }} aria-hidden />}
      {items.map((it) => (
        <button key={it.id} role="tab" aria-selected={value === it.id} className={`ws-seg-tab ${value === it.id ? 'on' : ''}`} onClick={() => onChange(it.id)} {...{ [attr]: it.id }}>
          <it.icon size={14} /> <span>{it.label}</span>
        </button>
      ))}
    </div>
  )
}
