// electron-builder hook: signs the Mac app right after it's packed, before the dmg and zip are made.
// Apple Silicon Macs refuse to run apps without any signature.
//
// With no certificate it signs "ad hoc". That works, but macOS then knows each build only by its
// exact contents, so after every update it treats Orbit as a different app: the Keychain asks for
// your password again (Orbit keeps sign-ins there) and permissions like the microphone or
// Accessibility have to be given again.
//
// With a free self-made certificate (scripts/make-mac-signing-cert.sh, kept in the repository's
// secrets as MAC_SIGNING_CERT and MAC_SIGNING_CERT_PASSWORD), every build is signed by the same
// identity, so macOS recognises updates as the same app and keeps the Keychain access and
// permissions. It isn't an Apple certificate, so it doesn't change the first-open "Open Anyway".
const { execFileSync } = require('child_process')
const { randomBytes } = require('crypto')
const { chmodSync, existsSync, rmSync, writeFileSync } = require('fs')
const { tmpdir } = require('os')
const { join } = require('path')

function signWithCertificate(app, p12Base64, password) {
  const dir = join(tmpdir(), `orbit-sign-${process.pid}-${Date.now()}`)
  const keychain = `${dir}.keychain-db`
  const p12 = `${dir}.p12`
  const kcPass = randomBytes(16).toString('hex')
  const sec = (...args) => execFileSync('/usr/bin/security', args, { encoding: 'utf8' })
  try {
    writeFileSync(p12, Buffer.from(p12Base64, 'base64'))
    sec('create-keychain', '-p', kcPass, keychain)
    sec('set-keychain-settings', keychain)
    sec('unlock-keychain', '-p', kcPass, keychain)
    sec('import', p12, '-k', keychain, '-P', password, '-T', '/usr/bin/codesign')
    sec('set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', kcPass, keychain)
    // codesign only signs with a certificate this Mac trusts for code signing. A self-made one
    // isn't, so trust it (on GitHub's Macs sudo needs no password; elsewhere it asks).
    const certPem = `${dir}.pem`
    writeFileSync(certPem, execFileSync('/usr/bin/security', ['find-certificate', '-p', '-c', 'Orbit Code Signing', keychain]))
    try {
      execFileSync('sudo', ['/usr/bin/security', 'add-trusted-cert', '-d', '-r', 'trustRoot', '-p', 'codeSign', '-k', '/Library/Keychains/System.keychain', certPem], { stdio: 'inherit' })
    } finally {
      rmSync(certPem, { force: true })
    }
    // codesign also looks for identities only in the keychains on the search list.
    const before = sec('list-keychains', '-d', 'user').split('\n').map((l) => l.trim().replace(/^"|"$/g, '')).filter(Boolean)
    sec('list-keychains', '-d', 'user', '-s', keychain, ...before)
    try {
      const found = sec('find-identity', '-v', '-p', 'codesigning', keychain).match(/\b([0-9A-F]{40})\b/)
      if (!found) throw new Error('No code signing identity in MAC_SIGNING_CERT.')
      execFileSync('codesign', ['--force', '--deep', '--keychain', keychain, '--sign', found[1], app], { stdio: 'inherit' })
    } finally {
      sec('list-keychains', '-d', 'user', '-s', ...before)
    }
  } finally {
    try {
      sec('delete-keychain', keychain)
    } catch {
      // Already gone.
    }
    rmSync(p12, { force: true })
  }
}

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  // The Terminal tab starts shells through node-pty's spawn-helper, which comes without
  // permission to run; fix that before signing.
  for (const arch of ['arm64', 'x64']) {
    const helper = join(app, 'Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds', `darwin-${arch}`, 'spawn-helper')
    if (existsSync(helper)) chmodSync(helper, 0o755)
  }
  const cert = process.env.MAC_SIGNING_CERT
  if (cert) {
    console.log('  • signing with the Orbit certificate')
    signWithCertificate(app, cert, process.env.MAC_SIGNING_CERT_PASSWORD || '')
  } else {
    console.log('  • signing ad hoc (no MAC_SIGNING_CERT)')
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  }
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}
