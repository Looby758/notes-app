// Style J pictures for every add-on: bold flat colour, a big glass symbol, poster headline.
// Run from the repo root: node scripts/addon-pictures.mjs src/renderer/public/addons [ids...]
// (needs Playwright and Chromium; writes <id>.webp, plus <id>.png when KEEP_PNG is set)
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const APP = process.cwd()
const require = createRequire(APP + '/package.json')
const { chromium } = require('playwright')
const ICONS = APP + '/node_modules/lucide-react/dist/esm/icons/'

const CAT = {
  notes: ['#3a4bff', '#ffe14d'],
  plan: ['#7048e8', '#8ce99a'],
  money: ['#00a86b', '#d4ff3a'],
  friends: ['#f06595', '#fff3bf'],
  ai: ['#1c7ed6', '#a5f3fc'],
  music: ['#ff4d6d', '#ffd23f'],
  watch: ['#862e9c', '#ffc9e3'],
  gaming: ['#ff9f1c', '#fff3b0'],
  video: ['#d9480f', '#ffe8cc'],
  files: ['#0b7285', '#99e9f2'],
  phone: ['#15aabf', '#fff3bf'],
  computer: ['#2b2f36', '#69db7c']
}

// id: [category, icon, headline (| = new line), subline]
const A = {
  'summon-bar': ['notes', 'command', 'Always one|key away.', 'Jot, ask or run anything over any app'],
  'canvas-board': ['notes', 'sticky-note', 'Think on a|big board.', 'Notes, pictures and arrows, anywhere'],
  'mind-map': ['notes', 'network', 'See the|big picture.', 'Your note, branching out from the middle'],
  sketch: ['notes', 'pen-line', 'Draw it|by hand.', 'Pen, highlighter and handwriting to text'],
  graph: ['notes', 'waypoints', 'Every note,|connected.', 'A map of your notes and their links'],
  'random-note': ['notes', 'dices', 'Rediscover|old ideas.', 'Opens a note at random'],
  flashcards: ['notes', 'layers', 'Remember it|for good.', 'Review the cards that are due today'],
  zen: ['notes', 'leaf', 'Just you and|the page.', 'Full screen, with a focus timer'],
  calendar: ['plan', 'calendar-days', 'Your week,|sorted.', 'Events, reminders and bills in one place'],
  weather: ['plan', 'cloud-sun', 'Know before|you go.', 'Today and the week ahead'],
  countdowns: ['plan', 'hourglass', 'How long|is left?', 'Days until the things you’re waiting for'],
  clocks: ['plan', 'earth', 'Are they|awake?', 'The time where your friends are'],
  money: ['money', 'piggy-bank', 'Know where|it goes.', 'Spending, budgets and bills'],
  passwords: ['money', 'key-round', 'Locked|and ready.', 'Your logins, kept on this computer'],
  email: ['friends', 'mail', 'Your inbox,|beside you.', 'Gmail in a tab next to your notes'],
  messages: ['friends', 'messages-square', 'Your chats,|one tab.', 'WhatsApp and Discord beside your notes'],
  'discord-voice': ['friends', 'headphones', 'Who’s|talking?', 'Your Discord call, over your game'],
  ask: ['ai', 'message-circle-question', 'Ask your|own notes.', 'Answers from what you’ve written'],
  'ai-chat': ['ai', 'bot', 'Chat about|anything.', 'Talk with Claude in a tab'],
  claude: ['ai', 'sparkles', 'Claude,|right here.', 'claude.ai in a tab or floating'],
  grok: ['ai', 'zap', 'Grok,|right here.', 'Grok in a tab or floating'],
  'offline-ai': ['ai', 'cpu', 'AI with no|internet.', 'Runs on your own graphics card'],
  web: ['ai', 'globe', 'The web,|in a tab.', 'Browse beside your notes'],
  music: ['music', 'disc-3', 'All your|music.', 'Your own songs and Spotify, one player'],
  songid: ['music', 'audio-lines', 'What’s|this song?', 'Find the song in any video or game'],
  soundboard: ['music', 'volume-2', 'Sounds on|a button.', 'Play them into your Discord call'],
  'audio-editor': ['music', 'audio-waveform', 'Snip it|to size.', 'Trim songs, voice memos and recordings'],
  mixer: ['music', 'sliders-vertical', 'Every app,|its own volume.', 'Games, Discord and Spotify, just right'],
  'video-player': ['watch', 'circle-play', 'Press|play.', 'Almost any video, with subtitles'],
  comics: ['watch', 'book-open', 'Read panel|by panel.', 'A shelf and a reader for your comics'],
  wiki: ['watch', 'library', 'Wikis,|no ads.', 'Read Fandom wikis offline'],
  games: ['gaming', 'gamepad-2', 'Every game,|one shelf.', 'Steam and the rest, ready to play'],
  skyblock: ['gaming', 'pickaxe', 'Plan your|SkyBlock.', 'Profiles, goals and event timers'],
  'mini-games': ['gaming', 'puzzle', 'A quick|break.', 'Sudoku, Wordle, Chess and more'],
  clips: ['gaming', 'history', 'Save that|moment.', 'The last 30 seconds, on a key'],
  'video-projects': ['video', 'clapperboard', 'Every video,|one place.', 'Script, research and uploads'],
  studio: ['video', 'video', 'Record or|go live.', 'Screen, webcam and voiceover'],
  screenshots: ['video', 'images', 'Find the|right shot.', 'Screenshots tagged by character and episode'],
  timeline: ['video', 'route', 'Put the story|in order.', 'Eras, episodes and flashbacks'],
  streamer: ['video', 'eye-off', 'Stream|without worry.', 'Private things blurred on screen'],
  files: ['files', 'folder-open', 'All your|files.', 'Browse, preview and search your PC'],
  downloads: ['files', 'download', 'Grab it|from a link.', 'Videos and files, queued up'],
  convert: ['files', 'arrow-left-right', 'Any file,|any format.', 'Photos, documents, audio and video'],
  'pdf-editor': ['files', 'file-pen-line', 'Sign it.|Done.', 'Fill, sign, merge and split PDFs'],
  filesender: ['files', 'send', 'Send|huge files.', 'Straight to a friend with a code'],
  phone: ['phone', 'smartphone', 'Your phone,|connected.', 'Files, remote and webcam'],
  'second-screen': ['phone', 'laptop', 'One more|screen.', 'Use your Mac as a second screen'],
  screens: ['phone', 'monitor-cog', 'Brighter?|Dimmer?', 'Control your monitors from Orbit'],
  snip: ['computer', 'scissors', 'Snip|anything.', 'Copy a picture, or the text in it'],
  'task-manager': ['computer', 'activity', 'What’s|slowing it?', 'See and end what’s running'],
  uninstaller: ['computer', 'trash-2', 'Gone.|Completely.', 'Remove apps and their leftovers'],
  macros: ['computer', 'mouse-pointer-click', 'Do it|once.', 'Record keys and clicks, play them back'],
  keyremap: ['computer', 'keyboard', 'Any key,|your way.', 'Make one key act as another'],
  terminal: ['computer', 'square-terminal', 'Commands|in tabs.', 'With run buttons for your apps'],
  appstudio: ['computer', 'app-window', 'Build your|own apps.', 'Ideas, bugs and builds with Claude Code']
}

const NAMES = {}
for (const m of fs.readFileSync(APP + '/src/shared/addons.ts', 'utf8').matchAll(/id: '([^']+)', name: '([^']+)'/g)) NAMES[m[1]] = m[2]

async function iconSvg(name) {
  const mod = await import(ICONS + name + '.js')
  return mod.__iconNode
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ')}/>`)
    .join('')
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

async function page(id) {
  const [cat, icon, head, sub] = A[id]
  const [solid, accent] = CAT[cat]
  const shapes = await iconSvg(icon)
  const lines = head.split('|')
  const longest = Math.max(...lines.map((l) => l.length))
  const size = Math.min(44, Math.floor(330 / (longest * 0.66)))
  const k = 'i'
  // The symbol: glass tubes. The fill is a soft white gradient masked to the strokes; a brighter rim
  // is the outer stroke minus the inner one. Masks union overlapping strokes, so no seams.
  const sym = `
<svg viewBox="0 0 560 324" width="560" height="324" style="position:absolute;inset:0" aria-hidden="true">
  <defs>
    <linearGradient id="${k}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.42"/><stop offset="1" stop-color="#fff" stop-opacity="0.12"/></linearGradient>
    <mask id="${k}in" maskUnits="userSpaceOnUse" x="0" y="0" width="560" height="324"><g transform="translate(318 30) rotate(-10 132 132) scale(11)" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shapes}</g></mask>
    <mask id="${k}rim" maskUnits="userSpaceOnUse" x="0" y="0" width="560" height="324">
      <g transform="translate(318 30) rotate(-10 132 132) scale(11)" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <g stroke="#fff" stroke-width="2.3">${shapes}</g><g stroke="#000" stroke-width="1.95">${shapes}</g>
      </g>
    </mask>
    <filter id="${k}sh" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="10"/></filter>
  </defs>
  <g opacity="0.14" filter="url(#${k}sh)" transform="translate(0 10)"><rect width="560" height="324" fill="#000" mask="url(#${k}in)"/></g>
  <rect width="560" height="324" fill="url(#${k}g)" mask="url(#${k}in)"/>
  <rect width="560" height="324" fill="#fff" fill-opacity="0.7" mask="url(#${k}rim)"/>
</svg>`
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;800;900&display=swap" rel="stylesheet">
<style>body{margin:0;background:transparent}</style></head><body>
<figure id="pic" style="margin:0;position:relative;width:560px;height:324px;overflow:hidden;background:${solid};font-family:Inter,system-ui,sans-serif">
  <div aria-hidden="true" style="position:absolute;width:280px;height:280px;border-radius:50%;right:10px;top:20px;background:${accent};opacity:0.45;filter:blur(55px)"></div>
  ${sym}
  <figcaption style="position:absolute;left:32px;top:32px;bottom:32px;display:flex;flex-direction:column;justify-content:space-between;color:#fff">
    <div style="font-size:12px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:${accent}">${esc(NAMES[id] ?? id)}</div>
    <div style="max-width:330px">
      <div style="font-size:${size}px;font-weight:900;letter-spacing:-0.04em;line-height:0.95;text-transform:uppercase">${lines.map(esc).join('<br>')}</div>
      <div style="font-size:13px;opacity:0.85;margin-top:12px">${esc(sub)}</div>
    </div>
  </figcaption>
</figure></body></html>`
}

const out = process.argv[2]
const ids = process.argv.length > 3 ? process.argv.slice(3) : Object.keys(A)
fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const pg = await browser.newPage({ viewport: { width: 560, height: 324 }, deviceScaleFactor: 2 })
for (const id of ids) {
  await pg.setContent(await page(id), { waitUntil: 'networkidle' })
  await pg.evaluate(() => document.fonts.ready)
  const png = await pg.locator('#pic').screenshot({ omitBackground: true })
  // PNG -> WebP through a canvas in the page.
  const webp = await pg.evaluate(async (b64) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    c.getContext('2d').drawImage(img, 0, 0)
    return c.toDataURL('image/webp', 0.9).split(',')[1]
  }, png.toString('base64'))
  fs.writeFileSync(path.join(out, id + '.webp'), Buffer.from(webp, 'base64'))
  if (process.env.KEEP_PNG) fs.writeFileSync(path.join(out, id + '.png'), png)
}
await browser.close()
console.log('done', ids.length)
