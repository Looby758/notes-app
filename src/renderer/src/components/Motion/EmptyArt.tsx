import type { ReactNode } from 'react'

/**
 * Small animated drawings for empty screens ("No notes yet", an empty inbox…). They move gently in
 * a loop with Motion → Full, sit still with Subtle, and the animations live in styles/motion.css.
 */
export type EmptyArtKind =
  | 'notes'
  | 'mail'
  | 'chat'
  | 'sparkle'
  | 'board'
  | 'graph'
  | 'search'
  | 'tag'
  | 'outline'
  | 'link'
  | 'calendar'
  | 'cards'
  | 'key'
  | 'coins'

const ART: Record<EmptyArtKind, ReactNode> = {
  // A page being written on: the last line draws itself while the pencil moves along it.
  notes: (
    <>
      <path className="ea-line" d="M18 8h20l10 10v38H18z" />
      <path className="ea-line" d="M38 8v10h10" />
      <path className="ea-soft" d="M24 26h16M24 33h18" />
      <path className="ea-accent ea-write" d="M24 40h14" />
      <g className="ea-pencil">
        <path className="ea-accent-fill" d="M40 44l12-12 4 4-12 12-5 1z" />
      </g>
    </>
  ),
  // An envelope bobbing, its letter peeking out.
  mail: (
    <g className="ea-bob">
      <rect className="ea-peek ea-accent" x="20" y="16" width="24" height="20" rx="2" />
      <rect className="ea-line ea-bg" x="12" y="24" width="40" height="28" rx="4" />
      <path className="ea-line" d="M12 28l20 13 20-13" />
    </g>
  ),
  // A speech bubble with typing dots.
  chat: (
    <>
      <path className="ea-line" d="M12 16h40a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H28l-10 8v-8h-6a4 4 0 0 1-4-4V20a4 4 0 0 1 4-4z" />
      <circle className="ea-dot ea-accent-fill" cx="22" cy="30" r="3" />
      <circle className="ea-dot ea-accent-fill" cx="32" cy="30" r="3" />
      <circle className="ea-dot ea-accent-fill" cx="42" cy="30" r="3" />
    </>
  ),
  // Three twinkling sparkles.
  sparkle: (
    <>
      <path className="ea-twinkle ea-accent-fill" d="M28 10l4 12 12 4-12 4-4 12-4-12-12-4 12-4z" />
      <path className="ea-twinkle ea-accent-fill" d="M48 34l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />
      <path className="ea-twinkle ea-soft-fill" d="M16 42l1.5 4.5L22 48l-4.5 1.5L16 54l-1.5-4.5L10 48l4.5-1.5z" />
    </>
  ),
  // Two sticky notes, one floating.
  board: (
    <>
      <rect className="ea-line" x="10" y="14" width="24" height="24" rx="3" transform="rotate(-6 22 26)" />
      <g className="ea-float">
        <rect className="ea-accent ea-bg" x="30" y="26" width="24" height="24" rx="3" transform="rotate(5 42 38)" />
        <path className="ea-soft" d="M35 35h12M35 41h8" transform="rotate(5 42 38)" />
      </g>
    </>
  ),
  // Linked notes, with one circling.
  graph: (
    <>
      <path className="ea-soft" d="M20 40L32 22l14 18z" />
      <circle className="ea-pulse ea-accent-fill" cx="32" cy="22" r="5" />
      <circle className="ea-line ea-bg" cx="20" cy="40" r="4" />
      <circle className="ea-line ea-bg" cx="46" cy="40" r="4" />
      <g className="ea-orbit">
        <circle className="ea-accent-fill" cx="32" cy="8" r="2.5" />
      </g>
    </>
  ),
  // A magnifier looking around.
  search: (
    <g className="ea-look">
      <circle className="ea-line" cx="28" cy="28" r="12" />
      <path className="ea-accent" d="M37 37l11 11" />
      <path className="ea-soft" d="M22 24a7 7 0 0 1 6-4" />
    </g>
  ),
  // A tag swinging on its string.
  tag: (
    <>
      <path className="ea-soft" d="M20 8v8" />
      <g className="ea-swing">
        <path className="ea-line" d="M14 16h12l14 14-12 12-14-14z" />
        <circle className="ea-accent-fill" cx="20" cy="22" r="2.5" />
      </g>
    </>
  ),
  // Headings appearing one after another.
  outline: (
    <>
      <path className="ea-accent ea-grow ea-g1" d="M14 18h26" />
      <path className="ea-line ea-grow ea-g2" d="M20 30h24" />
      <path className="ea-line ea-grow ea-g3" d="M20 42h18" />
      <path className="ea-soft ea-grow ea-g4" d="M26 52h20" />
    </>
  ),
  // Two chain links meeting.
  link: (
    <>
      <g className="ea-link-a">
        <rect className="ea-line" x="8" y="24" width="26" height="16" rx="8" />
      </g>
      <g className="ea-link-b">
        <rect className="ea-accent" x="30" y="24" width="26" height="16" rx="8" />
      </g>
    </>
  ),
  // A calendar with today pulsing.
  calendar: (
    <>
      <rect className="ea-line" x="12" y="14" width="40" height="38" rx="5" />
      <path className="ea-line" d="M12 24h40M22 10v8M42 10v8" />
      <path className="ea-soft" d="M20 32h4M30 32h4M40 32h4M20 42h4M40 42h4" />
      <circle className="ea-pulse ea-accent-fill" cx="32" cy="42" r="3" />
    </>
  ),
  // A flashcard turning over.
  cards: (
    <>
      <rect className="ea-soft" x="16" y="18" width="34" height="26" rx="4" transform="rotate(-8 33 31)" />
      <g className="ea-flip">
        <rect className="ea-line ea-bg" x="14" y="20" width="36" height="26" rx="4" />
        <path className="ea-accent" d="M24 33h16" />
      </g>
    </>
  ),
  // A key wiggling.
  key: (
    <g className="ea-wiggle">
      <circle className="ea-line" cx="22" cy="32" r="9" />
      <circle className="ea-accent-fill" cx="22" cy="32" r="3" />
      <path className="ea-line" d="M31 32h22M46 32v7M52 32v5" />
    </g>
  ),
  // A coin dropping onto a little stack.
  coins: (
    <>
      <ellipse className="ea-line" cx="32" cy="50" rx="14" ry="4" />
      <path className="ea-line" d="M18 44v6M46 44v6" />
      <ellipse className="ea-line ea-bg" cx="32" cy="44" rx="14" ry="4" />
      <g className="ea-drop">
        <circle className="ea-accent ea-bg" cx="32" cy="22" r="8" />
        <path className="ea-accent" d="M32 18v8" />
      </g>
    </>
  )
}

export default function EmptyArt({ kind, size = 56 }: { kind: EmptyArtKind; size?: number }) {
  return (
    <svg className={`empty-art empty-art-${kind}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      {ART[kind]}
    </svg>
  )
}
