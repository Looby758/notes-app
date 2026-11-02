import { useState } from 'react'
import { Globe } from 'lucide-react'
import { iconFor } from '@shared/browser'
import { useBrowser } from '../../store/browser'

/** A site's own icon (the YouTube logo for YouTube), or a globe while Orbit doesn't have one. */
export default function SiteIcon({ url, size = 14, className = '' }: { url: string; size?: number; className?: string }) {
  const icon = useBrowser((s) => iconFor(s.favicons, url))
  const [broken, setBroken] = useState<string | null>(null)
  if (!icon || broken === icon) return <Globe size={size} className={className} />
  return <img className={`site-icon ${className}`} src={icon} width={size} height={size} alt="" draggable={false} onError={() => setBroken(icon)} />
}
