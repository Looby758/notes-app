// electron-builder hook: signs the Mac app "ad hoc" (with no certificate) right after it's packed,
// before the dmg and zip are made. Apple Silicon Macs refuse to run apps without any signature.
const { execFileSync } = require('child_process')
const { chmodSync, existsSync } = require('fs')
const { join } = require('path')
const { Arch } = require('electron-builder')
const { fixFfmpegArch } = require('./ffmpeg-arch.cjs')

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  // The video converter's ffmpeg has to match the kind of Mac this copy is for.
  await fixFfmpegArch(app, Arch[context.arch])
  // The Terminal tab starts shells through node-pty's spawn-helper, and the video converter runs
  // ffmpeg; both come without permission to run, so fix that before signing.
  for (const arch of ['arm64', 'x64']) {
    const helper = join(app, 'Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds', `darwin-${arch}`, 'spawn-helper')
    if (existsSync(helper)) chmodSync(helper, 0o755)
  }
  const ffmpeg = join(app, 'Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg')
  if (existsSync(ffmpeg)) chmodSync(ffmpeg, 0o755)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}
