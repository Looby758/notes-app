import { describe, expect, it } from 'vitest'
import { X509Certificate } from 'crypto'
import { createServer } from 'https'
import { request } from 'https'
import { makeCertificate } from './selfSignedCert'

describe('makeCertificate', () => {
  it('makes a certificate that parses, is signed by its own key and names the address', () => {
    const { cert } = makeCertificate('Orbit', ['192.168.1.20'])
    const x = new X509Certificate(cert)
    expect(x.subject).toBe('CN=Orbit')
    expect(x.verify(x.publicKey)).toBe(true)
    expect(x.checkIP('192.168.1.20')).toBe('192.168.1.20')
    expect(x.checkHost('localhost')).toBe('localhost')
    expect(x.ca).toBe(false)
    const days = (Date.parse(x.validTo) - Date.parse(x.validFrom)) / 86_400_000
    expect(days).toBeLessThanOrEqual(825)
    expect(x.keyUsage).toContain('1.3.6.1.5.5.7.3.1')
  })

  it('works for a real https server', async () => {
    const { key, cert } = makeCertificate('Orbit', ['127.0.0.1'])
    const server = createServer({ key, cert }, (_req, res) => res.end('hi'))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    const text = await new Promise<string>((resolve, reject) => {
      // Trusting it the way a phone does once you tap "visit this website".
      request({ host: '127.0.0.1', port, ca: cert, servername: undefined }, (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve(body))
      })
        .on('error', reject)
        .end()
    })
    server.close()
    expect(text).toBe('hi')
  })
})
