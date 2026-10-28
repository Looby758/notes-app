// The app icon designs you can pick in Settings → Appearance. Each is an SVG drawn from the same
// Orbit mark; scripts/make-app-icons.cjs turns them into PNGs.

const svg = (defs, background, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>${defs}
  </defs>
  <rect x="24" y="24" width="464" height="464" rx="108" fill="${background}"/>${body}
</svg>`

const gradient = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`

// The Orbit mark: a planet with a ring and a small moon.
const orbit = (planet, ring, moon) => `
  <circle cx="256" cy="256" r="72" fill="${planet}"/>
  <circle cx="256" cy="256" r="148" fill="none" stroke="${ring}" stroke-width="20"/>
  <circle cx="361" cy="151" r="30" fill="${moon}"/>`

module.exports = {
  default: { label: 'Orbit', svg: svg('', '#16171d', orbit('#4ade80', '#3a3b47', '#eceef3')) },
  green: { label: 'Green', svg: svg(gradient('bg', '#86efac', '#4ade80'), 'url(#bg)', orbit('#16171d', '#166534', '#16171d')) },
  forest: { label: 'Forest', svg: svg(gradient('bg', '#4ade80', '#166534'), 'url(#bg)', orbit('#f8fafc', '#14532d', '#f8fafc')) },
  ocean: { label: 'Ocean', svg: svg(gradient('bg', '#5ea8ff', '#1e3a8a'), 'url(#bg)', orbit('#f8fafc', '#1e3a8a', '#f8fafc')) },
  sunset: { label: 'Sunset', svg: svg(gradient('bg', '#fbbf24', '#f97066'), 'url(#bg)', orbit('#ffffff', '#9a3412', '#ffffff')) },
  light: { label: 'Paper', svg: svg('', '#f4f4f7', orbit('#22a35a', '#dcdce4', '#1c1b19')) },
  midnight: { label: 'Midnight', svg: svg('', '#16171d', orbit('#8b7cf6', '#2a2b36', '#eceef3')) }
}
