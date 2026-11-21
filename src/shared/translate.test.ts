import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TARGET,
  isTarget,
  OCR_LANGS,
  ocrLangSetting,
  ocrLangUrl,
  onlineTranslateUrl,
  parseTranslation,
  sameLanguage,
  tidyReading,
  TRANSLATE_MAX_CHARS,
  TRANSLATE_TARGETS,
  translationNote,
  translatePrompt
} from './translate'

describe('parseTranslation', () => {
  it('splits the language from the translation', () => {
    expect(parseTranslation('From: Japanese\nStart the game')).toEqual({ from: 'Japanese', text: 'Start the game' })
  })
  it('keeps line breaks', () => {
    expect(parseTranslation('From: Spanish\nLine one\nLine two').text).toBe('Line one\nLine two')
  })
  it('copes with bold labels, a Translation label and quotes', () => {
    expect(parseTranslation('**From:** French\n**Translation:** "Hello everyone"')).toEqual({ from: 'French', text: 'Hello everyone' })
    expect(parseTranslation('From: German.\n「Guten Tag」').from).toBe('German')
  })
  it('drops thinking and code fences', () => {
    expect(parseTranslation('<think>hmm</think>\nFrom: Korean\n```\nNew quest\n```')).toEqual({ from: 'Korean', text: 'New quest' })
  })
  it('still gives the text when the model leaves out the From line', () => {
    expect(parseTranslation('Open the door')).toEqual({ from: '', text: 'Open the door' })
  })
  it('does not strip quotes inside the text', () => {
    expect(parseTranslation('From: Italian\n"Yes" she said "no"').text).toBe('"Yes" she said "no"')
  })
})

describe('sameLanguage', () => {
  it('spots text already in the target language', () => {
    expect(sameLanguage('English', 'English')).toBe(true)
    expect(sameLanguage('english', 'English')).toBe(true)
    expect(sameLanguage('Chinese (Simplified)', 'Chinese')).toBe(true)
    expect(sameLanguage('Japanese', 'English')).toBe(false)
    expect(sameLanguage('', 'English')).toBe(false)
  })
})

describe('reading other alphabets', () => {
  it('uses English alone, or the extra reader with English', () => {
    expect(ocrLangSetting(undefined)).toBe('eng')
    expect(ocrLangSetting('jpn')).toBe('jpn+eng')
    expect(ocrLangSetting('nope')).toBe('eng')
  })
  it('pins every download to a version, size and hash', () => {
    for (const l of OCR_LANGS) {
      expect(ocrLangUrl(l)).toBe(`https://cdn.jsdelivr.net/npm/@tesseract.js-data/${l.code}@1.0.0/4.0.0_best_int/${l.code}.traineddata.gz`)
      expect(l.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(l.bytes).toBeGreaterThan(100_000)
      expect(l.bytes).toBeLessThan(4_000_000)
    }
    expect(new Set(OCR_LANGS.map((l) => l.code)).size).toBe(OCR_LANGS.length)
  })
  it('takes out the spaces Tesseract puts between Japanese and Chinese characters', () => {
    expect(tidyReading('ゲーム を 始める \n 設定', 'jpn')).toBe('ゲームを始める\n 設定')
    expect(tidyReading('开始 游戏', 'chi_sim')).toBe('开始游戏')
    // What Tesseract really read from a picture of Japanese text (jpn+eng).
    expect(tidyReading('ゲー ム を 始め る\n設定 を 保存 し まし た\n', 'jpn')).toBe('ゲームを始める\n設定を保存しました')
    expect(tidyReading('Start  game', 'jpn')).toBe('Start  game')
    expect(tidyReading('Hola amigo  \nqué tal', undefined)).toBe('Hola amigo\nqué tal')
  })
})

describe('the prompt and the online fallback', () => {
  it('asks for the target and cuts very long snips', () => {
    expect(translatePrompt('hola', 'English')).toBe('Translate into English:\n\nhola')
    expect(translatePrompt('x'.repeat(TRANSLATE_MAX_CHARS + 50), 'English').length).toBe('Translate into English:\n\n'.length + TRANSLATE_MAX_CHARS)
  })
  it('only knows real targets', () => {
    expect(isTarget(DEFAULT_TARGET)).toBe(true)
    expect(isTarget('Klingon')).toBe(false)
    expect(isTarget(undefined)).toBe(false)
  })
  it('opens Google Translate in the chosen language', () => {
    for (const t of TRANSLATE_TARGETS) expect(onlineTranslateUrl('a', t)).not.toContain('tl=undefined')
    expect(onlineTranslateUrl('こんにちは', 'English')).toBe('https://translate.google.com/?sl=auto&tl=en&op=translate&text=%E3%81%93%E3%82%93%E3%81%AB%E3%81%A1%E3%81%AF')
    expect(onlineTranslateUrl('hi', 'Chinese')).toContain('tl=zh-CN')
  })
  it('saves the text and its translation together', () => {
    expect(translationNote('こんにちは', 'Hello', 'Japanese', 'English')).toBe('Snipped (Japanese → English):\nこんにちは\n\nTranslation:\nHello')
    expect(translationNote('x', 'y', '', 'English')).toContain('Snipped (→ English)')
  })
})
