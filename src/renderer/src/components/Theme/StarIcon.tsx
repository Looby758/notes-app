import { Star } from 'lucide-react'
import { themeFileUrl } from '@shared/themePack'
import { useActiveTheme } from '../../store/prefs'

/** The star on starred notes, or an imported theme's own picture in its place. */
export default function StarIcon({ size, className }: { size: number; className?: string }) {
  const theme = useActiveTheme()
  const icon = theme.pack?.starIcon
  if (!icon) return <Star size={size} className={className} aria-label="Starred" />
  return <img src={themeFileUrl(theme.id, icon)} width={size + 3} height={size + 3} className={`${className ?? ''} theme-star`} alt="Starred" draggable={false} />
}
