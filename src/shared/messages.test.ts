import { describe, expect, it } from 'vitest'
import { badgeText, isMessagesUrl, needsPageSizedWindow, unreadFromTitle, windowSizedToPage } from './messages'

describe('unreadFromTitle', () => {
  it('reads WhatsApp’s count', () => {
    expect(unreadFromTitle('(3) WhatsApp')).toEqual({ count: 3, dot: false })
    expect(unreadFromTitle('WhatsApp')).toEqual({ count: 0, dot: false })
    expect(unreadFromTitle('(120) WhatsApp Business')).toEqual({ count: 120, dot: false })
  })

  it('reads Discord’s count and dot', () => {
    expect(unreadFromTitle('(2) Discord | #general | Friends')).toEqual({ count: 2, dot: false })
    expect(unreadFromTitle('• Discord | #general | Friends')).toEqual({ count: 0, dot: true })
    expect(unreadFromTitle('Discord | Friends')).toEqual({ count: 0, dot: false })
  })

  it('ignores numbers elsewhere in the title', () => {
    expect(unreadFromTitle('Discord | (5) channel')).toEqual({ count: 0, dot: false })
    expect(unreadFromTitle('')).toEqual({ count: 0, dot: false })
  })
})

describe('isMessagesUrl', () => {
  it('keeps the sites’ own pages in the hub', () => {
    expect(isMessagesUrl('https://web.whatsapp.com/')).toBe(true)
    expect(isMessagesUrl('https://discord.com/channels/@me')).toBe(true)
    expect(isMessagesUrl('https://cdn.discordapp.com/x.png')).toBe(true)
  })

  it('sends everything else elsewhere', () => {
    expect(isMessagesUrl('https://youtube.com/watch?v=1')).toBe(false)
    expect(isMessagesUrl('https://notwhatsapp.com/')).toBe(false)
    expect(isMessagesUrl('http://web.whatsapp.com/')).toBe(false)
    expect(isMessagesUrl('file:///etc/passwd')).toBe(false)
  })
})

describe('badgeText', () => {
  it('caps at 99+', () => {
    expect(badgeText(0)).toBe('')
    expect(badgeText(7)).toBe('7')
    expect(badgeText(150)).toBe('99+')
  })
})

describe('windowSizedToPage', () => {
  it('makes the outer size the page size, so Discord does not think its developer tools are open', () => {
    const win = { innerWidth: 900, innerHeight: 700, outerWidth: 1400, outerHeight: 760 } as unknown as Window
    windowSizedToPage(win)
    expect(win.outerWidth - win.innerWidth).toBe(0)
    expect(win.outerHeight - win.innerHeight).toBe(0)
    ;(win as unknown as { innerWidth: number }).innerWidth = 500
    expect(win.outerWidth).toBe(500)
  })
})

describe('needsPageSizedWindow', () => {
  it("is only Discord's pages, never Google's sign-in", () => {
    expect(needsPageSizedWindow('https://discord.com/app')).toBe(true)
    expect(needsPageSizedWindow('https://ptb.discord.com/channels/@me')).toBe(true)
    expect(needsPageSizedWindow('https://discordapp.com/login')).toBe(true)
    expect(needsPageSizedWindow('https://accounts.google.com/v3/signin/identifier')).toBe(false)
    expect(needsPageSizedWindow('https://grok.com/')).toBe(false)
    expect(needsPageSizedWindow('https://web.whatsapp.com/')).toBe(false)
    expect(needsPageSizedWindow('https://notdiscord.com/')).toBe(false)
    expect(needsPageSizedWindow('not a url')).toBe(false)
  })
})
