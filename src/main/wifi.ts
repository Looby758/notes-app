import { execFile } from 'child_process'
import { promisify } from 'util'
import { IS_MAC } from '@shared/platform'
import { macSsid, netshKey, netshSsid, type WifiNetwork } from '@shared/wifi'

/**
 * The Wi-Fi this computer is on, for the guest QR code. Windows hands over the saved password
 * (netsh); a Mac keeps it in the Keychain, which asks you first. Anything we can't read is left
 * blank for you to type.
 */

const run = promisify(execFile)
const out = async (cmd: string, args: string[]): Promise<string> => {
  try {
    return (await run(cmd, args, { timeout: 60_000, windowsHide: true })).stdout
  } catch {
    return ''
  }
}

export async function currentWifi(): Promise<WifiNetwork> {
  if (IS_MAC) {
    const ssid = macSsid(await out('ipconfig', ['getsummary', 'en0'])) ?? macSsid(await out('networksetup', ['-getairportnetwork', 'en0']))
    if (!ssid) return { ssid: '', password: '' }
    return { ssid, password: (await out('security', ['find-generic-password', '-wa', ssid])).trim() }
  }
  if (process.platform === 'win32') {
    const ssid = netshSsid(await out('netsh', ['wlan', 'show', 'interfaces']))
    if (!ssid) return { ssid: '', password: '' }
    return { ssid, password: netshKey(await out('netsh', ['wlan', 'show', 'profile', `name=${ssid}`, 'key=clear'])) ?? '' }
  }
  return { ssid: '', password: '' }
}
