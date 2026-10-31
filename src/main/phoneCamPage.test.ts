import { describe, expect, it } from 'vitest'
import { phoneCamHtml } from './phoneCamPage'
import { camHelperScript } from './phoneCamHelper'
import { queueLayout } from '@shared/phoneCam'

describe('phoneCamHtml', () => {
  it('puts in the address and quality, and its script is valid JavaScript', () => {
    const html = phoneCamHtml('/c/abc', 'hd')
    expect(html).toContain('var BASE = "/c/abc";')
    expect(html).toContain('var quality = "hd";')
    const script = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'))
    expect(() => new Function(script)).not.toThrow()
  })
})

describe('camHelperScript', () => {
  it('starts the helper with the camera size and layout', () => {
    const l = queueLayout(1280, 720, 30)
    const ps = camHelperScript(1280, 720, l, true)
    expect(ps).toContain(`[OrbitCam]::Run('OBSVirtualCamVideo', 1280, 720, 333333, ${l.size}, ${l.offsets.join(', ')}, $true)`)
    // A here-string ends at a line starting '@, so the C# mustn't have one.
    expect(ps.split('\n').filter((line) => line.startsWith("'@"))).toHaveLength(1)
  })
})
