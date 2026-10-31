// electron-builder hook helper: the file converter's video program (ffmpeg) is downloaded by npm
// for the computer doing the build. Mac apps are built for both Apple Silicon and Intel on one
// computer, so the other kind of Mac gets its own copy of ffmpeg here.
const { createGunzip } = require('zlib')
const { createWriteStream, existsSync, chmodSync, copyFileSync, mkdirSync, renameSync } = require('fs')
const { pipeline } = require('stream/promises')
const { Readable } = require('stream')
const { join } = require('path')
const os = require('os')

exports.fixFfmpegArch = async function fixFfmpegArch(app, arch) {
  if (arch === process.arch) return
  const target = join(app, 'Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg')
  if (!existsSync(target)) return
  const release = require('ffmpeg-static/package.json')['ffmpeg-static']['binary-release-tag']
  const cache = join(os.tmpdir(), 'orbit-ffmpeg', release)
  const cached = join(cache, `ffmpeg-darwin-${arch}`)
  if (!existsSync(cached)) {
    mkdirSync(cache, { recursive: true })
    const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/${release}/ffmpeg-darwin-${arch}.gz`
    console.log(`  • downloading ffmpeg for ${arch} Macs`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Couldn't download ffmpeg for ${arch} Macs (${res.status}): ${url}`)
    await pipeline(Readable.fromWeb(res.body), createGunzip(), createWriteStream(`${cached}.part`))
    renameSync(`${cached}.part`, cached)
  }
  copyFileSync(cached, target)
  chmodSync(target, 0o755)
}
