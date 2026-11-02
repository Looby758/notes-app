import { contextBridge, ipcRenderer } from 'electron'
import { quietPasskeys } from '@shared/passkeys'
import { classifyField, profileValue, type AutofillProfile, type FieldKind } from '@shared/browser'

/**
 * Runs in every web page (web tabs, private tabs, the messages hub, the YouTube mini window) before
 * the site's own code, in a world of its own: the page can't see or call anything here.
 *
 * Everywhere, it stops passkey prompts popping up as pages load (see quietPasskeys). In web tabs it
 * also:
 * - tells the tab when you're in a login or address form, so Orbit can offer to fill it in (it
 *   only ever fills a form when you pick that, never by itself), and when a login is sent, so
 *   Orbit can offer to save it in Passwords;
 * - turns the page's sound down to the site's volume (Orbit's volume mixer);
 * - passes notifications from sites you've allowed to Orbit, which shows them as its own.
 */

contextBridge.executeInMainWorld({ func: quietPasskeys })

const kind = ((): string => {
  try {
    return String(ipcRenderer.sendSync('web:pageKind'))
  } catch {
    return 'other'
  }
})()

if (kind === 'web' || kind === 'private') {
  setUpSound()
  setUpNotifications()
  if (window === window.top) setUpForms()
}

// ---------- sound ----------

/**
 * In the page's own world: every video and audio's volume is the page's own choice times the site's
 * volume, and the page still sees its own choice (so its volume slider doesn't jump about).
 */
function soundInPage(): void {
  const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume')
  if (!desc?.get || !desc.set) return
  const get = desc.get
  const set = desc.set
  let factor = 1
  const wanted = new WeakMap<HTMLMediaElement, number>()
  const apply = (el: HTMLMediaElement): void => {
    if (!wanted.has(el)) wanted.set(el, get.call(el) as number)
    set.call(el, Math.max(0, Math.min(1, wanted.get(el)! * factor)))
  }
  Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
    configurable: true,
    enumerable: true,
    get(this: HTMLMediaElement) {
      return wanted.has(this) ? wanted.get(this) : get.call(this)
    },
    set(this: HTMLMediaElement, v: number) {
      const n = Number(v)
      if (!(n >= 0 && n <= 1)) return set.call(this, v)
      wanted.set(this, n)
      set.call(this, Math.max(0, Math.min(1, n * factor)))
    }
  })
  document.addEventListener('play', (e) => e.target instanceof HTMLMediaElement && apply(e.target), true)
  window.addEventListener('message', (e) => {
    const data = e.data as { orbitVolume?: unknown } | null
    if (e.source !== window || !data || typeof data.orbitVolume !== 'number') return
    factor = Math.max(0, Math.min(1, data.orbitVolume))
    document.querySelectorAll('audio, video').forEach((el) => apply(el as HTMLMediaElement))
  })
}

function setUpSound(): void {
  contextBridge.executeInMainWorld({ func: soundInPage })
  let last = 1
  const tell = (): void => window.postMessage({ orbitVolume: last }, '*')
  ipcRenderer.on('orbit:volume', (_e, volume: number) => {
    last = Number(volume)
    tell()
  })
  // Pages that start playing after loading get it too.
  window.addEventListener('DOMContentLoaded', () => last !== 1 && tell())
}

// ---------- notifications ----------

/**
 * In the page's own world: `new Notification(…)` (and a service worker's showNotification called
 * from the page) is handed to Orbit, which shows it only if you've allowed the site.
 */
function notificationsInPage(): void {
  const Real = window.Notification
  if (!Real) return
  let next = 1
  const shown = new Map<string, EventTarget & { onclick: ((e: Event) => void) | null }>()
  const send = (title: string, options: NotificationOptions | undefined, id: string): void => {
    window.postMessage({ orbitNotify: { id, title: String(title), body: String(options?.body ?? ''), silent: options?.silent === true } }, '*')
  }
  class OrbitNotification extends EventTarget {
    static get permission(): NotificationPermission {
      return Real.permission
    }
    static requestPermission(callback?: NotificationPermissionCallback): Promise<NotificationPermission> {
      return Real.requestPermission(callback)
    }
    static get maxActions(): number {
      return 0
    }
    // (Declared, not initialised here: this function's source is run in the page as it is, so it
    // can't lean on helpers a build step might add for class fields.)
    declare title: string
    declare body: string
    declare tag: string
    declare data: unknown
    declare icon: string
    declare onclick: ((e: Event) => void) | null
    declare onclose: ((e: Event) => void) | null
    declare onerror: ((e: Event) => void) | null
    declare onshow: ((e: Event) => void) | null
    constructor(title: string, options?: NotificationOptions) {
      super()
      this.onclick = null
      this.onclose = null
      this.onerror = null
      this.onshow = null
      this.title = String(title)
      this.body = String(options?.body ?? '')
      this.tag = String(options?.tag ?? '')
      this.data = options?.data ?? null
      this.icon = String(options?.icon ?? '')
      if (Real.permission !== 'granted') return
      const id = String(next++)
      shown.set(id, this)
      send(title, options, id)
      setTimeout(() => {
        const e = new Event('show')
        this.dispatchEvent(e)
        this.onshow?.(e)
      })
    }
    close(): void {
      const e = new Event('close')
      this.dispatchEvent(e)
      this.onclose?.(e)
    }
  }
  window.addEventListener('message', (e) => {
    const data = e.data as { orbitNotificationClick?: unknown } | null
    if (e.source !== window || !data || typeof data.orbitNotificationClick !== 'string') return
    const n = shown.get(data.orbitNotificationClick)
    if (!n) return
    const click = new Event('click', { cancelable: true })
    n.dispatchEvent(click)
    n.onclick?.(click)
  })
  Object.defineProperty(window, 'Notification', { configurable: true, writable: true, value: OrbitNotification })
  const reg = window.ServiceWorkerRegistration?.prototype
  if (reg?.showNotification) {
    reg.showNotification = function (title: string, options?: NotificationOptions): Promise<void> {
      if (Real.permission === 'granted') send(title, options, String(next++))
      return Promise.resolve()
    }
  }
}

function setUpNotifications(): void {
  contextBridge.executeInMainWorld({ func: notificationsInPage })
  window.addEventListener('message', (e) => {
    const data = e.data as { orbitNotify?: unknown } | null
    if (e.source !== window || !data || !data.orbitNotify || typeof data.orbitNotify !== 'object') return
    ipcRenderer.send('web:notify', data.orbitNotify)
  })
  ipcRenderer.on('orbit:notification-click', (_e, id: string) => window.postMessage({ orbitNotificationClick: String(id) }, '*'))
}

// ---------- forms ----------

const LOGIN_KINDS = new Set<FieldKind>(['username', 'email', 'password'])
const ADDRESS_KINDS = new Set<FieldKind>(['name', 'given', 'family', 'email', 'phone', 'address1', 'address2', 'city', 'county', 'postcode', 'country'])

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

/** The words around a field: its name, id, placeholder, aria-label and label. */
function wordsOf(el: Field): string {
  const label = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent) || el.closest('label')?.textContent || ''
  return [el.name, el.id, 'placeholder' in el ? el.placeholder : '', el.getAttribute('aria-label') ?? '', label].join(' ').slice(0, 300)
}

const kindOfField = (el: Field): FieldKind | null =>
  classifyField({ type: el instanceof HTMLInputElement ? el.type : el instanceof HTMLSelectElement ? 'select' : 'text', autocomplete: el.getAttribute('autocomplete') ?? '', words: wordsOf(el) })

const visible = (el: Element): boolean => {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
}

/** The fields that go with `el`: its form's, or (with no form) the whole page's. */
function fieldsNear(el: Element): Field[] {
  const scope: ParentNode = (el as Field).form ?? el.closest('form') ?? document
  return [...scope.querySelectorAll('input, select, textarea')].filter((f): f is Field => !(f as HTMLInputElement).disabled && !(f as HTMLInputElement).readOnly && visible(f))
}

const passwordsNear = (el: Element): HTMLInputElement[] => fieldsNear(el).filter((f): f is HTMLInputElement => f instanceof HTMLInputElement && f.type === 'password')

/** The username that goes with a password field: the last text or email field before it. */
function usernameFor(password: HTMLInputElement): HTMLInputElement | null {
  const fields = fieldsNear(password).filter((f): f is HTMLInputElement => f instanceof HTMLInputElement)
  const before = fields.slice(0, fields.indexOf(password)).filter((f) => ['text', 'email', 'tel', ''].includes(f.type))
  return before.reverse().find((f) => kindOfField(f) === 'username' || kindOfField(f) === 'email') ?? before[0] ?? null
}

/** Sets a field the way typing would, so the page's own code notices. */
function setValue(el: Field, value: string): void {
  if (el instanceof HTMLSelectElement) {
    const want = value.trim().toLowerCase()
    const option = [...el.options].find((o) => o.value.toLowerCase() === want || o.text.trim().toLowerCase() === want)
    if (!option) return
    el.value = option.value
  } else {
    el.focus()
    el.value = value
  }
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

let focused: Field | null = null
let lastSent = ''

function setUpForms(): void {
  const rectOf = (el: Element): { x: number; y: number; width: number; height: number } => {
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, width: r.width, height: r.height }
  }

  document.addEventListener(
    'focusin',
    (e) => {
      const el = e.target
      if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return
      const what = kindOfField(el)
      if (!what) return
      focused = el
      const inLogin = passwordsNear(el).length > 0
      if (inLogin && LOGIN_KINDS.has(what)) ipcRenderer.sendToHost('orbit:field', { kind: 'login', rect: rectOf(el) })
      else if (!inLogin && ADDRESS_KINDS.has(what) && fieldsNear(el).filter((f) => ADDRESS_KINDS.has(kindOfField(f) as FieldKind)).length >= 1) {
        ipcRenderer.sendToHost('orbit:field', { kind: 'address', rect: rectOf(el) })
      }
    },
    true
  )
  document.addEventListener('focusout', () => ipcRenderer.sendToHost('orbit:field-blur'), true)
  window.addEventListener('scroll', () => focused && ipcRenderer.sendToHost('orbit:field-blur'), { passive: true, capture: true })

  // A login being sent: as the form submits, when its button is clicked, or Enter in the password.
  const loginSent = (from: Element): void => {
    const password = passwordsNear(from).find((p) => p.value)
    if (!password) return
    const user = usernameFor(password)?.value.trim() ?? ''
    const key = `${user}\u0000${password.value}`
    if (key === lastSent) return
    lastSent = key
    ipcRenderer.sendToHost('orbit:login', { username: user, password: password.value })
  }
  document.addEventListener('submit', (e) => e.target instanceof Element && loginSent(e.target), true)
  document.addEventListener(
    'click',
    (e) => {
      const button = (e.target as Element | null)?.closest?.('button, input[type=submit], [role=button]')
      if (button && passwordsNear(button).some((p) => p.value)) loginSent(button)
    },
    true
  )
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement && (e.target.type === 'password' || passwordsNear(e.target).some((p) => p.value))) loginSent(e.target)
    },
    true
  )

  // Filling, only when you've picked it in Orbit's pop-up (checked against the page's site there).
  ipcRenderer.on('orbit:fill-login', (_e, login: { username: string; password: string }) => {
    const near = focused && focused.isConnected ? focused : document.querySelector('input[type=password]')
    if (!near) return
    const password = passwordsNear(near)[0]
    const user = password ? usernameFor(password) : focused instanceof HTMLInputElement && focused.type !== 'password' ? focused : null
    if (user && login.username) setValue(user, login.username)
    if (password) setValue(password, login.password)
    lastSent = `${login.username}\u0000${login.password}`
  })
  ipcRenderer.on('orbit:fill-address', (_e, profile: AutofillProfile) => {
    if (!focused?.isConnected) return
    for (const f of fieldsNear(focused)) {
      const what = kindOfField(f)
      if (!what || !ADDRESS_KINDS.has(what) || (f.value && f !== focused)) continue
      const value = profileValue(profile, what)
      if (value) setValue(f, value)
    }
  })
}
