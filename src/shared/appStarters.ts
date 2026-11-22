/**
 * App Studio's "Start a new app": the starters a new app can begin from. Each is a handful of
 * files that run straight away (npm install, then npm run dev), plus a CLAUDE.md that tells
 * Claude Code what the app is, so the first thing sent to Claude has something to build on.
 */

export type StarterId = 'desktop' | 'website' | 'game' | 'blank'

export interface Starter {
  id: StarterId
  label: string
  hint: string
  /** The command that starts it while you work on it. */
  run: string | null
}

export const STARTERS: Starter[] = [
  { id: 'desktop', label: 'Desktop app', hint: 'A window on your computer (Electron), ready to release for Windows and Mac', run: 'npm run dev' },
  { id: 'website', label: 'Website', hint: 'A web page made with React and Vite', run: 'npm run dev' },
  { id: 'game', label: 'Game', hint: 'A canvas with a game loop and the arrow keys hooked up', run: 'npm run dev' },
  { id: 'blank', label: 'Empty', hint: 'Just a README and a CLAUDE.md, for Claude to start from scratch', run: null }
]

/** "My Cool App!" → "my-cool-app": the folder, package and repository name. */
export function appSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** Why a name can't be used, or null when it's fine. */
export function appNameProblem(name: string): string | null {
  if (!name.trim()) return 'Give it a name.'
  if (!appSlug(name)) return 'Use some letters or numbers in the name.'
  if (name.trim().length > 60) return 'That name is too long.'
  return null
}

const json = (v: unknown): string => JSON.stringify(v, null, 2) + '\n'

const GITIGNORE = `node_modules/
dist/
out/
release/
.vite/
.DS_Store
Thumbs.db
*.log
.env
`

function claudeMd(name: string, what: string, starter: Starter, details: string): string {
  return `# ${name}

${what.trim() || `${name} is a new app.`}

## How it's made

${details}

## Working on it

- \`npm install\` once, then \`${starter.run ?? 'npm run dev'}\` to run it while working on it.
- Keep changes small and focused, and open a pull request for each one.
- Write for someone who isn't a programmer in anything the app shows: plain words, no jargon.
`
}

function readme(name: string, what: string, run: string | null): string {
  return `# ${name}

${what.trim() || 'A new app.'}

${run ? `## Running it\n\n\`\`\`\nnpm install\n${run}\n\`\`\`\n` : ''}`
}

/** The files a new app starts with, by path (forward slashes, relative to the app's folder). */
export function starterFiles(starterId: StarterId, name: string, what: string): Record<string, string> {
  const starter = STARTERS.find((s) => s.id === starterId) ?? STARTERS[3]
  const slug = appSlug(name) || 'my-app'
  const title = name.trim() || 'My app'
  const safeTitle = title.replace(/[<>&"]/g, '')
  const base: Record<string, string> = { '.gitignore': GITIGNORE, 'README.md': readme(title, what, starter.run) }

  if (starter.id === 'website' || starter.id === 'game') {
    const game = starter.id === 'game'
    return {
      ...base,
      'CLAUDE.md': claudeMd(
        title,
        what,
        starter,
        game
          ? '- A browser game in TypeScript, built with Vite.\n- `src/main.ts` has the game loop: `update(dt)` moves things, `draw()` paints the canvas.\n- Keys pressed are in the `keys` set.'
          : '- A website in React and TypeScript, built with Vite.\n- `src/App.tsx` is the page; styles are in `src/style.css`.'
      ),
      'package.json': json({
        name: slug,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        ...(game ? {} : { dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' } }),
        devDependencies: game
          ? { typescript: '^5.6.3', vite: '^6.0.0' }
          : { '@types/react': '^18.3.12', '@types/react-dom': '^18.3.1', '@vitejs/plugin-react': '^4.3.4', typescript: '^5.6.3', vite: '^6.0.0' }
      }),
      'tsconfig.json': json({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          ...(game ? {} : { jsx: 'react-jsx' })
        },
        include: ['src']
      }),
      ...(game ? {} : { 'vite.config.ts': `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({ plugins: [react()] })\n` }),
      'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeTitle}</title>
  </head>
  <body>
    ${game ? '<canvas id="game"></canvas>' : '<div id="root"></div>'}
    <script type="module" src="/src/main.${game ? 'ts' : 'tsx'}"></script>
  </body>
</html>
`,
      ...(game
        ? {
            'src/style.css': `html, body { margin: 0; height: 100%; background: #101218; overflow: hidden; }\ncanvas { display: block; width: 100vw; height: 100vh; }\n`,
            'src/main.ts': `import './style.css'

const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const keys = new Set<string>()
addEventListener('keydown', (e) => keys.add(e.key))
addEventListener('keyup', (e) => keys.delete(e.key))

function resize(): void {
  canvas.width = innerWidth * devicePixelRatio
  canvas.height = innerHeight * devicePixelRatio
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
}
addEventListener('resize', resize)
resize()

const player = { x: innerWidth / 2, y: innerHeight / 2, size: 28, speed: 320 }

function update(dt: number): void {
  if (keys.has('ArrowLeft')) player.x -= player.speed * dt
  if (keys.has('ArrowRight')) player.x += player.speed * dt
  if (keys.has('ArrowUp')) player.y -= player.speed * dt
  if (keys.has('ArrowDown')) player.y += player.speed * dt
  player.x = Math.max(0, Math.min(innerWidth - player.size, player.x))
  player.y = Math.max(0, Math.min(innerHeight - player.size, player.y))
}

function draw(): void {
  ctx.fillStyle = '#101218'
  ctx.fillRect(0, 0, innerWidth, innerHeight)
  ctx.fillStyle = '#4ade80'
  ctx.fillRect(player.x, player.y, player.size, player.size)
  ctx.fillStyle = '#8a8e9a'
  ctx.font = '16px system-ui, sans-serif'
  ctx.fillText(${JSON.stringify(`${title}: use the arrow keys`)}, 16, 28)
}

let last = performance.now()
function frame(now: number): void {
  update(Math.min(0.05, (now - last) / 1000))
  last = now
  draw()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
`
          }
        : {
            'src/style.css': `:root { color-scheme: dark; font-family: system-ui, sans-serif; }\nbody { margin: 0; background: #101218; color: #e6e8ee; }\nmain { max-width: 720px; margin: 0 auto; padding: 64px 24px; }\nh1 { margin: 0 0 8px; }\np { color: #8a8e9a; }\n`,
            'src/main.tsx': `import { StrictMode } from 'react'\nimport { createRoot } from 'react-dom/client'\nimport App from './App'\nimport './style.css'\n\ncreateRoot(document.getElementById('root')!).render(\n  <StrictMode>\n    <App />\n  </StrictMode>\n)\n`,
            'src/App.tsx': `export default function App() {\n  return (\n    <main>\n      <h1>${safeTitle.replace(/[{}]/g, '')}</h1>\n      <p>${(what.trim() || 'A new website.').replace(/[<>{}&]/g, '').split('\n')[0]}</p>\n    </main>\n  )\n}\n`
          })
    }
  }

  if (starter.id === 'desktop') {
    return {
      ...base,
      'CLAUDE.md': claudeMd(
        title,
        what,
        starter,
        '- A desktop app made with Electron, in plain JavaScript with no build step.\n- `main.js` opens the window; the page is `index.html`, `renderer.js` and `style.css`.\n- Releases: pushing a version tag (`npm version minor` then `git push --follow-tags`) runs `.github/workflows/release.yml`, which builds the Windows and Mac installers and publishes them on GitHub.'
      ),
      'package.json': json({
        name: slug,
        productName: title,
        version: '0.1.0',
        private: true,
        main: 'main.js',
        scripts: { dev: 'electron .', 'build:win': 'electron-builder --win --publish never', 'build:mac': 'electron-builder --mac --publish never' },
        devDependencies: { electron: '^33.2.1', 'electron-builder': '^25.1.8' },
        build: { appId: `com.${slug.replace(/-/g, '')}.app`, productName: title, files: ['main.js', 'index.html', 'renderer.js', 'style.css'], win: { target: 'nsis' }, mac: { target: 'dmg' } }
      }),
      'main.js': `const { app, BrowserWindow } = require('electron')
const path = require('path')

function open() {
  const win = new BrowserWindow({ width: 1000, height: 700, backgroundColor: '#101218', webPreferences: { contextIsolation: true } })
  win.removeMenu()
  win.loadFile(path.join(__dirname, 'index.html'))
}

app.whenReady().then(open)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) open()
})
`,
      'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'" />
    <title>${safeTitle}</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main>
      <h1>${safeTitle}</h1>
      <p id="hello"></p>
    </main>
    <script src="renderer.js"></script>
  </body>
</html>
`,
      'renderer.js': `document.getElementById('hello').textContent = ${JSON.stringify((what.trim() || 'Your new app is running.').split('\n')[0])}\n`,
      'style.css': `:root { color-scheme: dark; font-family: system-ui, sans-serif; }\nbody { margin: 0; background: #101218; color: #e6e8ee; }\nmain { padding: 48px; }\nh1 { margin: 0 0 8px; }\np { color: #8a8e9a; }\n`,
      '.github/workflows/release.yml': `name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  build:
    strategy:
      matrix:
        os: [windows-latest, macos-latest]
    runs-on: \${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: npx electron-builder --publish always \${{ matrix.os == 'windows-latest' && '--win' || '--mac' }}
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`
    }
  }

  return {
    ...base,
    'CLAUDE.md': claudeMd(title, what, starter, '- Nothing is chosen yet: pick what suits the app (and say why in the pull request).'),
    'package.json': json({ name: slug, version: '0.1.0', private: true })
  }
}

/** The first card on a new app's board: build the first version, from what you said it's for. */
export function firstCard(name: string, what: string, starterId: StarterId): { title: string; details: string } {
  const starter = STARTERS.find((s) => s.id === starterId)
  return {
    title: `Build the first version of ${name.trim()}`,
    details: [
      what.trim() || `${name.trim()} is a new app.`,
      '',
      starter && starter.id !== 'blank' ? `It started from App Studio's ${starter.label.toLowerCase()} starter, so the basics are there to build on.` : 'It’s empty so far, so choose what to make it with.'
    ].join('\n')
  }
}

/** What runs in a new app's terminal once it's made: the first push to GitHub (if it has a repository), then npm install. */
export function firstRunCommand(windows: boolean, pushToGitHub: boolean, install: boolean): string | null {
  const steps = [...(pushToGitHub ? ['git push -u origin main'] : []), ...(install ? ['npm install'] : [])]
  if (!steps.length) return null
  if (!windows) return steps.join(' && ')
  return steps.reduceRight((rest, step) => `${step}; if ($LASTEXITCODE -eq 0) { ${rest} }`)
}

export interface NewApp {
  /** The folder it goes in (a new folder named after the app is made inside). */
  parent: string
  name: string
  starter: StarterId
  /** What it's for, in your words. */
  what: string
  /** Make a GitHub repository for it: private, public, or none. */
  github: 'private' | 'public' | null
}

export interface MadeApp {
  folder: string
  /** "owner/name" when a GitHub repository was made. */
  repo?: string
  /** Why the GitHub repository wasn't made, when it was asked for. */
  githubError?: string
}
