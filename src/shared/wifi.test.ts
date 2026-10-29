import { describe, expect, it } from 'vitest'
import { macSsid, netshKey, netshSsid, wifiQrText } from './wifi'

describe('wifi', () => {
  it('escapes the QR text', () => {
    expect(wifiQrText({ ssid: 'Home;Net', password: 'a:b"c\\' })).toBe('WIFI:T:WPA;S:Home\\;Net;P:a\\:b\\"c\\\\;;')
    expect(wifiQrText({ ssid: 'Cafe', password: '' })).toBe('WIFI:T:nopass;S:Cafe;;')
  })
  it('reads netsh', () => {
    const iface = '    Name                   : Wi-Fi\n    SSID                   : Looby Home\n    BSSID                  : aa:bb:cc:dd:ee:ff\n'
    expect(netshSsid(iface)).toBe('Looby Home')
    expect(netshKey('Security settings\n    Key Content            : hunter22\n')).toBe('hunter22')
    expect(netshKey('    Security key           : Absent\n')).toBeNull()
  })
  it('reads the Mac network name', () => {
    expect(macSsid('<dictionary> {\n  SSID : Looby Home\n  BSSID : x\n}')).toBe('Looby Home')
    expect(macSsid('Current Wi-Fi Network: Looby 5G\n')).toBe('Looby 5G')
    expect(macSsid('  SSID : <redacted>\n')).toBeNull()
    expect(macSsid('You are not associated with an AirPort network.')).toBeNull()
  })
})
