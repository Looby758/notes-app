// The app icon designs you can pick in Settings → Appearance. Each is an SVG drawn from the same
// note-page shape; scripts/make-app-icons.cjs turns them into PNGs.

const page = (fill, corner, lines, outline) => `
  <path d="M150 104 h150 l70 70 v214 a24 24 0 0 1 -24 24 h-196 a24 24 0 0 1 -24 -24 v-260 a24 24 0 0 1 24 -24 z" fill="${fill}" ${outline ? `stroke="${outline}" stroke-width="14" stroke-linejoin="round"` : ''}/>
  <path d="M300 104 v46 a24 24 0 0 0 24 24 h46 z" fill="${corner}"/>
  <rect x="172" y="214" width="120" height="18" rx="9" fill="${lines[0]}"/>
  <rect x="172" y="262" width="168" height="18" rx="9" fill="${lines[1]}"/>
  <rect x="172" y="310" width="144" height="18" rx="9" fill="${lines[1]}"/>
  <rect x="172" y="358" width="92" height="18" rx="9" fill="${lines[1]}"/>`

const svg = (defs, background, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>${defs}
    <linearGradient id="page" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#23242d"/><stop offset="1" stop-color="#16171d"/></linearGradient>
  </defs>
  <rect x="24" y="24" width="464" height="464" rx="108" fill="${background}"/>${body}
</svg>`

const gradient = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`

module.exports = {
  default: { label: 'Purple', svg: svg(gradient('bg', '#9d90fa', '#5a48d8'), 'url(#bg)', page('url(#page)', '#3a3b47', ['#8b7cf6', '#5e6270'])) },
  green: { label: 'Green', svg: svg(gradient('bg', '#86efac', '#4ade80'), 'url(#bg)', page('url(#page)', '#3a3b47', ['#4ade80', '#5e6270'])) },
  forest: { label: 'Forest', svg: svg(gradient('bg', '#4ade80', '#166534'), 'url(#bg)', page('#f8fafc', '#cbd5e1', ['#22a35a', '#94a3b8'])) },
  ocean: { label: 'Ocean', svg: svg(gradient('bg', '#5ea8ff', '#1e3a8a'), 'url(#bg)', page('url(#page)', '#3a3b47', ['#5ea8ff', '#5e6270'])) },
  sunset: { label: 'Sunset', svg: svg(gradient('bg', '#fbbf24', '#f97066'), 'url(#bg)', page('url(#page)', '#3a3b47', ['#fb923c', '#5e6270'])) },
  light: { label: 'Paper', svg: svg('', '#f4f4f7', page('#ffffff', '#dcdce4', ['#8b7cf6', '#c4c6d0'], '#e2e2ea')) },
  midnight: { label: 'Midnight', svg: svg('', '#16171d', page('#16171d', '#2a2b36', ['#8b7cf6', '#3a3b47'], '#8b7cf6')) }
}
