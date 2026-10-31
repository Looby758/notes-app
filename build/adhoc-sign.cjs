// electron-builder hook: signs the Mac app "ad hoc" (with no certificate) right after it's packed,
// before the dmg and zip are made. Apple Silicon Macs refuse to run apps without any signature.
const { execFileSync } = require('child_process')
const { chmodSync, existsSync } = require('fs')
const { join } = require('path')

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  // The Terminal tab starts shells through node-pty's spawn-helper, which comes without
  // permission to run; fix that before signing.
  for (const arch of ['arm64', 'x64']) {
    const helper = join(app, 'Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds', `darwin-${arch}`, 'spawn-helper')
    if (existsSync(helper)) chmodSync(helper, 0o755)
  }
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}
