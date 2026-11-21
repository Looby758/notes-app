import { describe, expect, it } from 'vitest'
import { isClaudeLink, isSiteUrl } from './chatSites'

describe('chat sites', () => {
  it('knows each site’s pages', () => {
    expect(isSiteUrl('claude', 'https://claude.ai/project/abc')).toBe(true)
    expect(isSiteUrl('claude', 'https://claude.ai.evil.example/')).toBe(false)
    expect(isSiteUrl('claude', 'http://claude.ai/')).toBe(false)
    expect(isSiteUrl('grok', 'https://grok.com/c/1')).toBe(true)
    expect(isSiteUrl('grok', 'https://claude.ai/')).toBe(false)
    expect(isClaudeLink('  https://claude.ai/project/x ')).toBe(true)
    expect(isClaudeLink('claude.ai/project/x')).toBe(false)
  })
})
