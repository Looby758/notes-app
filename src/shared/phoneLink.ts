/**
 * Pure helpers for the phone link: picking the address a phone on the same Wi-Fi can reach, and
 * the small bits of HTTP the share pages need. The server itself is in src/main/phoneLink.ts.
 */

export interface NetAddress {
  address: string
  family: string | number
  internal: boolean
}

/** Private ranges a home router hands out, best first (192.168.x is by far the most common Wi-Fi). */
const PRIVATE = [/^192\.168\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./]

/** The computer's address on the local network, from os.networkInterfaces(); null if it isn't on one. */
export function pickLanAddress(interfaces: Record<string, NetAddress[] | undefined>): string | null {
  const v4: { name: string; address: string }[] = []
  for (const [name, list] of Object.entries(interfaces)) {
    for (const a of list ?? []) {
      if (!a.internal && (a.family === 'IPv4' || a.family === 4)) v4.push({ name, address: a.address })
    }
  }
  // Virtual adapters (VPNs, WSL, Docker, VirtualBox) aren't the Wi-Fi the phone is on.
  const virtual = /vethernet|wsl|docker|vbox|virtualbox|vmware|vmnet|utun|tun|tap|zerotier|tailscale|hyper-v|loopback/i
  const ranked = [...v4.filter((a) => !virtual.test(a.name)), ...v4.filter((a) => virtual.test(a.name))]
  for (const range of PRIVATE) {
    const hit = ranked.find((a) => range.test(a.address))
    if (hit) return hit.address
  }
  return ranked.find((a) => !a.address.startsWith('169.254.'))?.address ?? null
}

/** A Content-Disposition header that keeps non-English file names intact on phones. */
export function contentDisposition(name: string, inline: boolean): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/** Only web links go to the phone (not file:, javascript: or app links). */
export function isShareableLink(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}
