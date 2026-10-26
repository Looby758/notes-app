// Draws each app icon design (build/app-icons.cjs) to a 512×512 PNG in src/renderer/public/icons.
//   npx electron scripts/make-app-icons.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const icons = require('../build/app-icons.cjs')

app.whenReady().then(async () => {
  const out = path.join(__dirname, '..', 'src', 'renderer', 'public', 'icons')
  fs.mkdirSync(out, { recursive: true })
  const win = new BrowserWindow({ show: false, width: 512, height: 512, transparent: true, frame: false, webPreferences: { offscreen: true } })
  for (const [id, { svg }] of Object.entries(icons)) {
    const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`
    await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
    await new Promise((r) => setTimeout(r, 200))
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 })
    fs.writeFileSync(path.join(out, `${id}.png`), img.resize({ width: 512, height: 512 }).toPNG())
    console.log('wrote', id)
  }
  app.exit(0)
})
