import { describe, expect, it } from 'vitest'
import {
  addVisit,
  bookmarkFor,
  chromiumTime,
  classifyField,
  cleanBookmarks,
  cleanSites,
  clipToNote,
  cookieBelongsTo,
  descendantIds,
  drmService,
  folderChoices,
  freeFileName,
  isForeign,
  loginMatchesPage,
  loginsFromCsv,
  moveBookmark,
  parseChromiumBookmarks,
  parseCsv,
  patchSite,
  permissionFor,
  profileValue,
  safeDownloadName,
  searchHistory,
  siteOf,
  stepZoom,
  suggestions,
  translateUrl,
  updateVisit,
  urlsFromArgv,
  EMPTY_PROFILE,
  type Bookmark,
  type HistoryEntry
} from './browser'

const bm = (id: string, parent: string, kind: 'link' | 'folder' = 'link', url = `https://${id}.com`): Bookmark => ({
  id,
  kind,
  title: id,
  ...(kind === 'link' ? { url } : {}),
  parent,
  created: 0
})

describe('sites', () => {
  it('names the site without www', () => {
    expect(siteOf('https://www.bbc.co.uk/news')).toBe('bbc.co.uk')
    expect(siteOf('file:///C:/x')).toBe('')
  })

  it('matches cookies to their site', () => {
    expect(cookieBelongsTo('.google.com', 'google.com')).toBe(true)
    expect(cookieBelongsTo('accounts.google.com', 'google.com')).toBe(true)
    expect(cookieBelongsTo('.google.com', 'mail.google.com')).toBe(true)
    expect(cookieBelongsTo('notgoogle.com', 'google.com')).toBe(false)
    expect(cookieBelongsTo('', 'google.com')).toBe(false)
  })
})

describe('bookmarks', () => {
  it('finds the bookmark for a page, ignoring a trailing slash and #', () => {
    const all = [bm('a', 'bar', 'link', 'https://example.com/page/')]
    expect(bookmarkFor(all, 'https://example.com/page')?.id).toBe('a')
    expect(bookmarkFor(all, 'https://example.com/page#top')?.id).toBe('a')
    expect(bookmarkFor(all, 'https://example.com/other')).toBeUndefined()
  })

  it('moves a bookmark into a folder at a place', () => {
    const all = [bm('f', 'bar', 'folder'), bm('a', 'bar'), bm('b', 'f'), bm('c', 'f')]
    const moved = moveBookmark(all, 'a', 'f', 1)
    expect(moved.filter((b) => b.parent === 'f').map((b) => b.id)).toEqual(['b', 'a', 'c'])
    expect(moveBookmark(all, 'a', 'f').filter((b) => b.parent === 'f').map((b) => b.id)).toEqual(['b', 'c', 'a'])
  })

  it('never puts a folder inside itself', () => {
    const all = [bm('f', 'bar', 'folder'), bm('g', 'f', 'folder')]
    expect(moveBookmark(all, 'f', 'g')).toBe(all)
    expect([...descendantIds(all, 'f')].sort()).toEqual(['f', 'g'])
  })

  it('lists folders with their paths', () => {
    const all = [bm('Recipes', 'bar', 'folder'), bm('Cakes', 'Recipes', 'folder')]
    expect(folderChoices(all).map((f) => f.label)).toEqual(['Bookmarks bar', 'Bookmarks bar / Recipes', 'Bookmarks bar / Recipes / Cakes', 'Other bookmarks'])
  })

  it('repairs a broken saved list', () => {
    const cleaned = cleanBookmarks([
      bm('a', 'gone'),
      { id: 'b', kind: 'link', url: 'javascript:alert(1)', parent: 'bar' },
      bm('x', 'y', 'folder'),
      bm('y', 'x', 'folder'),
      'junk'
    ])
    expect(cleaned.find((b) => b.id === 'a')?.parent).toBe('other')
    expect(cleaned.some((b) => b.id === 'b')).toBe(false)
    // A loop of folders ends up somewhere you can see.
    expect(cleaned.some((b) => b.parent === 'other' && (b.id === 'x' || b.id === 'y'))).toBe(true)
  })
})

describe('history', () => {
  const entry = (url: string, title: string, text = '', visited = 0, visits = 1): HistoryEntry => ({ url, title, text, visited, visits })

  it('keeps the newest visit first, counting visits', () => {
    let list = addVisit([], 'https://a.com', 'A', 1)
    list = addVisit(list, 'https://b.com', 'B', 2)
    list = addVisit(list, 'https://a.com', '', 3)
    expect(list.map((e) => e.url)).toEqual(['https://a.com', 'https://b.com'])
    expect(list[0]).toMatchObject({ title: 'A', visits: 2, visited: 3 })
    expect(addVisit(list, 'file:///x', 'x')).toBe(list)
  })

  it('remembers the words on the page', () => {
    const list = updateVisit([entry('https://a.com', 'A')], 'https://a.com', { text: '  lots\n of   words ' })
    expect(list[0].text).toBe('lots of words')
  })

  it('searches by title, address or what was on the page', () => {
    const list = [
      entry('https://recipes.com/pancakes', 'Fluffy pancakes'),
      entry('https://blog.com/post', 'Weekend', 'We made pancakes with blueberries on Saturday'),
      entry('https://news.com', 'News')
    ]
    expect(searchHistory(list, 'pancakes').map((h) => h.url)).toEqual(['https://recipes.com/pancakes', 'https://blog.com/post'])
    const hit = searchHistory(list, 'blueberries')[0]
    expect(hit.url).toBe('https://blog.com/post')
    expect(hit.snippet).toContain('blueberries')
    expect(searchHistory(list, '').length).toBe(3)
    expect(searchHistory(list, 'pancakes saturday').map((h) => h.url)).toEqual(['https://blog.com/post'])
  })

  it('suggests bookmarks, then often-visited pages', () => {
    const marks = [bm('docs', 'bar', 'link', 'https://docs.example.com')]
    const hist = [entry('https://example.com/a', 'Example A', '', 5, 1), entry('https://example.com/b', 'Example B', '', 1, 9)]
    expect(suggestions(marks, hist, 'example').map((s) => s.url)).toEqual(['https://docs.example.com', 'https://example.com/b', 'https://example.com/a'])
    expect(suggestions(marks, hist, 'e')).toEqual([])
  })
})

describe('site settings', () => {
  it('steps zoom like Chrome', () => {
    expect(stepZoom(1, 1)).toBe(1.1)
    expect(stepZoom(1, -1)).toBe(0.9)
    expect(stepZoom(5, 1)).toBe(5)
    expect(stepZoom(1.5, 0)).toBe(1)
  })

  it('knows what a request is for', () => {
    expect(permissionFor('media', ['audio'])).toEqual(['microphone'])
    expect(permissionFor('media', ['audio', 'video'])).toEqual(['microphone', 'camera'])
    expect(permissionFor('geolocation')).toEqual(['location'])
    expect(permissionFor('openExternal')).toBeNull()
  })

  it('drops settings that are back to normal', () => {
    let sites = patchSite({}, 'a.com', { zoom: 1.25, permissions: { notifications: 'allow' } })
    sites = patchSite(sites, 'a.com', { permissions: { camera: 'block' } })
    expect(sites['a.com']).toEqual({ zoom: 1.25, permissions: { notifications: 'allow', camera: 'block' } })
    expect(patchSite({ 'a.com': { zoom: 1.5 } }, 'a.com', { zoom: 1 })).toEqual({})
    expect(cleanSites({ 'b.com': { zoom: 99, volume: 100, permissions: { camera: 'maybe' } } })).toEqual({})
  })
})

describe('downloads', () => {
  it('finds a free name', () => {
    const taken = new Set(['a.pdf', 'a (2).pdf'])
    expect(freeFileName('a.pdf', (n) => taken.has(n))).toBe('a (3).pdf')
    expect(freeFileName('b.pdf', (n) => taken.has(n))).toBe('b.pdf')
  })

  it('makes names safe', () => {
    expect(safeDownloadName('re:port?.pdf')).toBe('re_port_.pdf')
    expect(safeDownloadName('CON.txt')).toBe('download-CON.txt')
    expect(safeDownloadName('...')).toBe('download')
  })
})

describe('autofill', () => {
  const field = (type: string, autocomplete = '', words = '') => classifyField({ type, autocomplete, words })

  it('reads what a field wants', () => {
    expect(field('text', 'given-name')).toBe('given')
    expect(field('email')).toBe('email')
    expect(field('text', '', 'billing_postcode Postcode')).toBe('postcode')
    expect(field('text', '', 'addressLine2')).toBe('address2')
    expect(field('text', '', 'street address')).toBe('address1')
    expect(field('text', '', 'Full name')).toBe('name')
    expect(field('text', '', 'fullname n Full name')).toBe('name')
    expect(field('text', '', 'lname')).toBe('family')
    expect(field('text', '', 'billing_fname')).toBe('given')
    expect(field('text', '', 'Company name')).toBeNull()
    expect(field('password', '', 'Confirm password')).toBe('newPassword')
    expect(field('password')).toBe('password')
    expect(field('text', '', 'username')).toBe('username')
    expect(field('checkbox', '', 'email')).toBeNull()
  })

  it('splits a name for first and last name fields', () => {
    const p = { ...EMPTY_PROFILE, name: 'Sam Lee Smith' }
    expect(profileValue(p, 'given')).toBe('Sam')
    expect(profileValue(p, 'family')).toBe('Lee Smith')
    expect(profileValue(p, 'password')).toBe('')
  })

  it('matches saved logins to the page', () => {
    expect(loginMatchesPage('netflix.com', 'https://www.netflix.com/login')).toBe(true)
    expect(loginMatchesPage('https://accounts.google.com', 'https://google.com')).toBe(true)
    expect(loginMatchesPage('https://evil-netflix.com', 'https://netflix.com')).toBe(false)
    expect(loginMatchesPage('', 'https://netflix.com')).toBe(false)
  })
})

describe('page tools', () => {
  it('translates into your language', () => {
    expect(translateUrl('https://lemonde.fr/a', 'en-GB')).toBe('https://translate.google.com/translate?sl=auto&tl=en&u=https%3A%2F%2Flemonde.fr%2Fa')
    expect(isForeign('fr', 'en-GB')).toBe(true)
    expect(isForeign('en-US', 'en-GB')).toBe(false)
    expect(isForeign('', 'en-GB')).toBe(false)
  })

  it('knows the streaming sites that need protected video', () => {
    expect(drmService('https://www.nowtv.com/watch/home')).toBe('NOW')
    expect(drmService('https://www.netflix.com/browse')).toBe('Netflix')
    expect(drmService('https://www.amazon.co.uk/gp/video/storefront')).toBe('Prime Video')
    expect(drmService('https://www.amazon.co.uk/dp/B0123')).toBeNull()
    expect(drmService('https://www.youtube.com')).toBeNull()
  })

  it('clips a page into a note with its link', () => {
    const note = clipToNote({ title: 'Pancakes', url: 'https://a.com/p', text: 'Mix and fry.', selection: '', saved: new Date(2026, 10, 1) })
    expect(note).toContain('source: https://a.com/p')
    expect(note).toContain('saved: 2026-11-01')
    expect(note).toContain('[Pancakes](https://a.com/p)')
    expect(note).toContain('Mix and fry.')
    const part = clipToNote({ title: 'P', url: 'https://a.com', text: 'everything', selection: 'just\nthis', saved: new Date() })
    expect(part).toContain('> just\n> this')
    expect(part).not.toContain('everything')
  })
})

describe('default browser', () => {
  it('reads links from the command line', () => {
    expect(urlsFromArgv(['Orbit.exe', '--orbit-url=https://a.com/x'])).toEqual(['https://a.com/x'])
    expect(urlsFromArgv(['Orbit.exe', '--orbit-url', 'https://a.com'])).toEqual(['https://a.com'])
    expect(urlsFromArgv(['Orbit.exe', 'https://b.com'])).toEqual(['https://b.com'])
    expect(urlsFromArgv(['Orbit.exe', '--orbit-url=file:///C:/x'])).toEqual([])
    expect(urlsFromArgv(['https://first-arg-is-the-program.com'])).toEqual([])
  })
})

describe('importing', () => {
  it('reads Opera GX bookmarks', () => {
    const json = JSON.stringify({
      roots: {
        bookmark_bar: { type: 'folder', children: [{ type: 'url', name: 'BBC', url: 'https://bbc.co.uk' }, { type: 'folder', name: 'Games', children: [{ type: 'url', name: 'Steam', url: 'https://store.steampowered.com' }] }] },
        other: { type: 'folder', children: [{ type: 'url', name: 'Bad', url: 'javascript:void 0' }] },
        custom_root: {
          trash: { type: 'folder', children: [{ type: 'url', name: 'Old', url: 'https://old.com' }] },
          unsorted: { type: 'folder', name: 'Unsorted', children: [{ type: 'url', name: 'U', url: 'https://u.com' }] },
          speedDial: { type: 'folder', name: 'Speed Dials', children: [{ type: 'url', name: 'YouTube', url: 'https://youtube.com' }] }
        }
      }
    })
    const { bar, other } = parseChromiumBookmarks(json)
    // Opera's Speed Dial tiles come along as a folder on the bar; its trash doesn't.
    expect(bar.map((b) => b.title)).toEqual(['BBC', 'Games', 'Speed Dial'])
    expect(bar[2].children).toEqual([{ title: 'YouTube', url: 'https://youtube.com' }])
    expect(bar[1].children?.[0].url).toBe('https://store.steampowered.com')
    expect(other).toEqual([{ title: 'Unsorted', children: [{ title: 'U', url: 'https://u.com' }] }])
    expect(parseChromiumBookmarks('not json')).toEqual({ bar: [], other: [] })
  })

  it('converts Chromium times', () => {
    expect(chromiumTime(13_000_000_000_000_000)).toBe(Math.round(13_000_000_000_000 - 11644473600000))
  })

  it('reads a passwords CSV', () => {
    expect(parseCsv('a,"b,c","d ""e"""\n1,2,3\n')).toEqual([['a', 'b,c', 'd "e"'], ['1', '2', '3']])
    const logins = loginsFromCsv('name,url,username,password,note\r\nSite,https://site.com/login,sam,"pa,ss",\r\nEmpty,https://x.com,sam,,\r\n')
    expect(logins).toEqual([{ url: 'https://site.com/login', username: 'sam', password: 'pa,ss' }])
  })
})
