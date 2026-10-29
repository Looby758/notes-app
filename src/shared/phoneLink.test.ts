import { describe, expect, it } from 'vitest'
import { contentDisposition, escapeHtml, formatBytes, isShareableLink, pickLanAddress } from './phoneLink'

const v4 = (address: string, internal = false) => ({ address, family: 'IPv4', internal })

describe('pickLanAddress', () => {
  it('prefers the Wi-Fi over loopback, IPv6 and virtual adapters', () => {
    expect(
      pickLanAddress({
        lo: [v4('127.0.0.1', true)],
        'vEthernet (WSL)': [v4('172.20.0.1')],
        'Wi-Fi': [{ address: 'fe80::1', family: 'IPv6', internal: false }, v4('192.168.1.42')]
      })
    ).toBe('192.168.1.42')
  })
  it('accepts the numeric family older Node versions report', () => {
    expect(pickLanAddress({ en0: [{ address: '10.0.0.5', family: 4, internal: false }] })).toBe('10.0.0.5')
  })
  it('falls back to a virtual adapter, but never a self-assigned address', () => {
    expect(pickLanAddress({ docker0: [v4('172.17.0.1')] })).toBe('172.17.0.1')
    expect(pickLanAddress({ en0: [v4('169.254.3.3')] })).toBeNull()
    expect(pickLanAddress({})).toBeNull()
  })
})

describe('share helpers', () => {
  it('keeps unicode file names', () => {
    expect(contentDisposition('café "menu".pdf', false)).toBe(`attachment; filename="caf_ _menu_.pdf"; filename*=UTF-8''caf%C3%A9%20%22menu%22.pdf`)
  })
  it('only shares web links', () => {
    expect(isShareableLink('https://example.com/a')).toBe(true)
    expect(isShareableLink('javascript:alert(1)')).toBe(false)
    expect(isShareableLink('file:///etc/passwd')).toBe(false)
    expect(isShareableLink('not a url')).toBe(false)
  })
  it('escapes and sizes', () => {
    expect(escapeHtml('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;')
    expect(formatBytes(2_500_000)).toBe('2.4 MB')
  })
})
