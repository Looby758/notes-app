/** Wi-Fi QR codes for guests: the standard "WIFI:" text phone cameras understand, and reading the network from the system. */

export interface WifiNetwork {
  ssid: string
  password: string
}

const esc = (s: string): string => s.replace(/([\\;,:"])/g, '\\$1')

/** The text for a Wi-Fi QR code (iPhone and Android cameras offer to join). An empty password means an open network. */
export function wifiQrText({ ssid, password }: WifiNetwork): string {
  return password ? `WIFI:T:WPA;S:${esc(ssid)};P:${esc(password)};;` : `WIFI:T:nopass;S:${esc(ssid)};;`
}

/** The connected network's name from `netsh wlan show interfaces` (Windows). */
export function netshSsid(output: string): string | null {
  return /^\s*SSID\s*:\s*(.+?)\s*$/m.exec(output)?.[1] ?? null
}

/** The password from `netsh wlan show profile name=… key=clear` (Windows). */
export function netshKey(output: string): string | null {
  return /^\s*Key Content\s*:\s*(.+?)\s*$/m.exec(output)?.[1] ?? null
}

/** The network's name from `ipconfig getsummary en0` or `networksetup -getairportnetwork en0` (Mac); null if hidden or not joined. */
export function macSsid(output: string): string | null {
  const name = /^\s*SSID\s*:\s*(.+?)\s*$/m.exec(output)?.[1] ?? /Current Wi-Fi Network:\s*(.+?)\s*$/m.exec(output)?.[1] ?? null
  return name && name !== '<redacted>' ? name : null
}
