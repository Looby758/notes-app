// Mac check, run on GitHub's Macs (.github/workflows/mac-check.yml): opens the built app on a
// throwaway notes folder, deletes notes the way a person would, closes and reopens the window,
// and writes down everything that happens to the window along the way.
//   npx electron-vite build && npx electron tests/mac/delete-check.js
const { app, BrowserWindow, dialog } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const outDir = path.join(__dirname, '..', '..', 'mac-check-results')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-check-'))
const vault = path.join(work, 'vault')
const userData = path.join(work, 'userData')
fs.mkdirSync(path.join(vault, 'Folder'), { recursive: true })
fs.mkdirSync(userData, { recursive: true })
for (const n of ['Keep', 'Delete me', 'Delete me too', 'Folder/Inside']) fs.writeFileSync(path.join(vault, `${n}.md`), `# ${path.basename(n)}\n\nText.\n`)
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ vaultPath: vault, window: { width: 1200, height: 800 } }))
app.setPath('userData', userData)

const log = []
const note = (msg) => {
  const line = `${new Date().toISOString().slice(11, 23)} ${msg}`
  log.push(line)
  console.log(line)
}
const results = []
const check = (ok, name) => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  note(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
}

// Answer "Move to Bin" like a person would, but keep the real dialog code path observable.
const realShowMessageBox = dialog.showMessageBox
dialog.showMessageBox = async (...args) => {
  const opts = args.find((a) => a && typeof a === 'object' && 'message' in a)
  note(`dialog: ${opts && opts.message} [${opts && opts.buttons}] (sheet: ${args[0] instanceof BrowserWindow})`)
  if (process.env.REAL_DIALOG) {
    // Show the real sheet, then close it after a moment (counts as Cancel).
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 800)
    const r = await realShowMessageBox.call(dialog, args[0], { ...opts, signal: ctrl.signal })
    note(`real dialog closed: ${JSON.stringify(r)}`)
    return { response: 0 }
  }
  return { response: 0 }
}

app.on('before-quit', () => note('app: before-quit'))
app.on('will-quit', () => note('app: will-quit'))
app.on('browser-window-created', (_e, win) => {
  const id = win.id
  for (const ev of ['ready-to-show', 'close', 'closed', 'hide', 'show', 'blur', 'focus', 'minimize', 'restore', 'enter-full-screen', 'leave-full-screen', 'unresponsive', 'responsive']) {
    win.on(ev, () => note(`window ${id}: ${ev}`))
  }
  win.webContents.on('render-process-gone', (_e, d) => note(`window ${id}: renderer gone ${JSON.stringify(d)}`))
  win.webContents.on('console-message', (_e, level, message) => level >= 2 && note(`window ${id} console: ${message.slice(0, 500)}`))
  win.webContents.on('did-finish-load', () => note(`window ${id}: loaded ${win.webContents.getURL().slice(-30)}`))
})

require('../../out/main/index.js')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mainWin = () => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !w.webContents.getURL().includes('#capture'))
const state = () => {
  const w = mainWin()
  return w ? `window ${w.id}: visible=${w.isVisible()} destroyed=${w.isDestroyed()} crashed=${w.webContents.isCrashed()} bounds=${JSON.stringify(w.getBounds())}` : 'no main window'
}
let shots = 0
const shot = async (name) => {
  const w = mainWin()
  if (!w || !w.isVisible()) return note(`(no screenshot for ${name}: ${state()})`)
  fs.writeFileSync(path.join(outDir, `${String(++shots).padStart(2, '0')}-${name}.png`), (await w.webContents.capturePage()).toPNG())
}
const js = (code) => mainWin().webContents.executeJavaScript(code)

async function rightClickDelete(rel) {
  await js(`(() => {
    const row = document.querySelector('.tree-row[data-path="${rel}"]')
    const r = row.getBoundingClientRect()
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.x + 20, clientY: r.y + 5 }))
  })()`)
  await sleep(300)
  await shot(`menu-${rel.replace(/\W/g, '_')}`)
  await js(`[...document.querySelectorAll('.context-menu button, .menu button')].find(b => b.textContent.trim() === 'Delete').click()`)
}

app.whenReady().then(async () => {
  try {
    await sleep(4000)
    note(`start: ${state()}`)
    await shot('start')

    // 1. Open a note, then right-click → Delete it.
    await js(`document.querySelector('.tree-row[data-path="Delete me.md"]').click()`)
    await sleep(800)
    await shot('opened')
    await rightClickDelete('Delete me.md')
    await sleep(2500)
    note(`after delete: ${state()}`)
    check(!fs.existsSync(path.join(vault, 'Delete me.md')), 'the note was moved to the Bin')
    check(!!mainWin() && mainWin().isVisible(), `the window is still there (${state()})`)
    check(mainWin() && !mainWin().webContents.isCrashed() && (await js('1 + 1')) === 2, 'the page still works')
    await shot('after-delete')

    // 2. ⌘⌫ in the file list, then right-click → Delete (what happened on the MacBook).
    await js(`document.querySelector('.tree-row[data-path="Delete me too.md"]').click()`)
    await sleep(600)
    await js(`document.querySelector('.tree').focus()`)
    const wc = mainWin().webContents
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace', modifiers: ['meta'] })
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace', modifiers: ['meta'] })
    await sleep(800)
    note(`after ⌘⌫: ${state()}`)
    await rightClickDelete('Delete me too.md')
    await sleep(2500)
    note(`after second delete: ${state()}`)
    check(!!mainWin() && mainWin().isVisible(), `still there after ⌘⌫ and Delete (${state()})`)
    await shot('after-second-delete')

    // 3. Close the window (red button), then click the Dock icon.
    mainWin().close()
    await sleep(1500)
    note(`after close: ${state()}`)
    app.emit('activate', {}, false)
    await sleep(2000)
    note(`after Dock click: ${state()}`)
    check(!!mainWin() && mainWin().isVisible(), `Dock click brings it back (${state()})`)
    await shot('after-dock')
  } catch (err) {
    note(`ERROR ${err && err.stack}`)
    results.push(`FAIL  crashed: ${err && err.message}`)
  }
  const userLog = path.join(userData, 'notes.log')
  if (fs.existsSync(userLog)) note(`notes.log:\n${fs.readFileSync(userLog, 'utf8')}`)
  fs.writeFileSync(path.join(outDir, 'log.txt'), log.join('\n'))
  fs.writeFileSync(path.join(outDir, 'results.txt'), results.join('\n'))
  app.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0)
})
