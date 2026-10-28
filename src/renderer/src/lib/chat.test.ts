import { describe, expect, it } from 'vitest'
import { chatAsNote, chatHtml, chatTitle, freeNoteName, recentMessages } from './chat'
import type { AiChatMessage } from '@shared/types'

describe('chatTitle', () => {
  it('uses the first line', () => {
    expect(chatTitle('What is a mortgage?\nAnd how do they work?')).toBe('What is a mortgage?')
  })
  it('cuts long lines at a word', () => {
    const title = chatTitle('Can you help me write a really long cover letter for a job at the local library please')
    expect(title.endsWith('…')).toBe(true)
    expect(title.length).toBeLessThanOrEqual(49)
    expect(title).toBe('Can you help me write a really long cover…')
  })
  it('has a fallback', () => {
    expect(chatTitle('   ')).toBe('New chat')
  })
})

describe('recentMessages', () => {
  const m = (role: AiChatMessage['role'], n: number): AiChatMessage => ({ role, text: 'x'.repeat(n) })
  it('keeps everything that fits', () => {
    const all = [m('user', 10), m('assistant', 10), m('user', 10)]
    expect(recentMessages(all, 100)).toEqual(all)
  })
  it('drops the oldest and starts with your message', () => {
    const all = [m('user', 50), m('assistant', 50), m('user', 10), m('assistant', 30), m('user', 10)]
    // 10 + 30 + 10 fits; adding the 50 doesn't.
    expect(recentMessages(all, 60)).toEqual(all.slice(2))
    // 10 + 30 fits but would start with Claude's answer, so only the last message goes.
    expect(recentMessages(all, 45)).toEqual(all.slice(4))
  })
  it('always sends the newest message', () => {
    const all = [m('user', 500)]
    expect(recentMessages(all, 10)).toEqual(all)
  })
})

describe('chatHtml', () => {
  it('shows markdown', () => {
    expect(chatHtml('**hi**\n\n- a\n- b')).toContain('<strong>hi</strong>')
    expect(chatHtml('- a\n- b')).toContain('<li>a</li>')
  })
  it('never runs HTML', () => {
    const html = chatHtml('<img src=x onerror="alert(1)"> <script>alert(1)</script>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
  })
  it('keeps only web links', () => {
    expect(chatHtml('[site](https://example.com)')).toContain('<a href="https://example.com">site</a>')
    expect(chatHtml('[bad](javascript:alert(1))')).not.toContain('<a')
  })
})

describe('notes from chats', () => {
  it('writes the chat out', () => {
    const note = chatAsNote({ id: '1', title: 'Dinner ideas', updated: '', messages: [{ role: 'user', text: 'Ideas?' }, { role: 'assistant', text: 'Pasta.' }] })
    expect(note).toBe('# Dinner ideas\n\n**You:** Ideas?\n\n---\n\nPasta.\n')
  })
  it('picks a free name', () => {
    const taken = new Set(['Dinner ideas', 'Dinner ideas 2'])
    expect(freeNoteName('Dinner ideas', (n) => taken.has(n))).toBe('Dinner ideas 3')
    expect(freeNoteName('What is 1/2?', () => false)).toBe('What is 12')
    expect(freeNoteName('A long title…', () => false)).toBe('A long title')
  })
})
