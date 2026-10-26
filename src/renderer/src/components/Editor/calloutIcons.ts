import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AlertTriangle, CheckCircle2, Flame, HelpCircle, Info, Lightbulb, Quote, Star, type LucideIcon } from 'lucide-react'

/** Each callout type's icon, as SVG markup (callouts are drawn by the editor, outside React). */
const ICONS: Record<string, LucideIcon> = {
  note: Info,
  tip: Lightbulb,
  warning: AlertTriangle,
  important: Star,
  question: HelpCircle,
  success: CheckCircle2,
  danger: Flame,
  quote: Quote
}

const cache = new Map<string, string>()

export function calloutIcon(type: string): string {
  let svg = cache.get(type)
  if (!svg) {
    svg = renderToStaticMarkup(createElement(ICONS[type] ?? Info, { size: 15, strokeWidth: 2.2 }))
    cache.set(type, svg)
  }
  return svg
}
