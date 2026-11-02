import { useEffect, useState, type FormEvent } from 'react'
import { Check, Download, Eraser, FileUp, Globe, Loader2, MapPin } from 'lucide-react'
import { EMPTY_PROFILE, loginMatchesPage, siteOf, type AutofillProfile, type ImportedLogin } from '@shared/browser'
import { IS_MAC } from '@shared/platform'
import type { DefaultBrowserState } from '@shared/types'
import { useBrowser } from '../../store/browser'
import { notify } from '../../store/notify'
import { addLogins, unlockVault, usePasswords } from '../../lib/passwords/session'
import { blankLogin, type Login } from '../../lib/passwords/entries'
import { openSpecialTab, PASSWORDS_TAB } from '../../lib/editorController'
import FolderPicker from './FolderPicker'
import { SitesPanel } from './WebPanels'
import { clearBrowsingData } from './WebPage'

/** Adds logins from another browser to Passwords (each site and username once). Returns how many were new. */
export async function importLogins(found: ImportedLogin[]): Promise<number> {
  const have = usePasswords.getState().logins.filter((l) => !l.deleted)
  const now = Date.now()
  const fresh: Login[] = []
  for (const f of found) {
    const url = /^[a-z][a-z0-9+.-]*:/i.test(f.url) ? f.url : `https://${f.url}`
    const dupe = [...have, ...fresh].some((l) => l.username === f.username && l.password === f.password && loginMatchesPage(l.url, url))
    if (dupe) continue
    fresh.push({ ...blankLogin(now), title: siteOf(url) || f.url, username: f.username, password: f.password, url })
  }
  await addLogins(fresh)
  return fresh.length
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="settings-group browser-settings-group">
      <h3>{title}</h3>
      {children}
    </div>
  )
}

function DefaultBrowser() {
  const [state, setState] = useState<DefaultBrowserState | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void window.api.webDefaultBrowser().then(setState)
    // Coming back from Windows' settings page: look again.
    const again = (): void => void window.api.webDefaultBrowser().then(setState)
    window.addEventListener('focus', again)
    return () => window.removeEventListener('focus', again)
  }, [])
  if (!state?.supported) return null
  const make = async (): Promise<void> => {
    setBusy(true)
    try {
      setState(await window.api.webMakeDefault())
    } catch (err) {
      notify(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="browser-setting-row" data-default-browser={state.isDefault ? 'yes' : 'no'}>
      <div>
        <strong>{state.isDefault ? 'Orbit is your default browser' : 'Make Orbit your default browser'}</strong>
        <p>
          {state.isDefault
            ? 'Links from Discord, email and other apps open in a web tab here. “Open in your other browser” uses ' + (IS_MAC ? 'Safari.' : 'Microsoft Edge.')
            : IS_MAC
              ? 'Links from Discord, email and other apps open in a web tab here. macOS asks you to confirm.'
              : 'Links from Discord, email and other apps open in a web tab here. Windows doesn’t let apps choose this themselves: Orbit opens Windows’ Default apps page, where you pick Orbit for web links (http and https).'}
        </p>
      </div>
      {!state.isDefault && (
        <button className="btn btn-primary" disabled={busy} onClick={() => void make()}>
          {busy ? <Loader2 size={13} className="spin" /> : <Globe size={13} />} Make default
        </button>
      )}
    </div>
  )
}

function DownloadFolder() {
  const [folder, setFolder] = useState<{ folder: string; chosen: boolean } | null>(null)
  const [picking, setPicking] = useState(false)
  useEffect(() => {
    void window.api.webDownloadFolder().then(setFolder)
  }, [])
  if (!folder) return null
  const set = async (f: string): Promise<void> => {
    await window.api.webSetDownloadFolder(f)
    setFolder(await window.api.webDownloadFolder())
    setPicking(false)
  }
  return (
    <div className="browser-setting-row column">
      <div className="browser-setting-row">
        <div>
          <strong>Downloads folder</strong>
          <p title={folder.folder}>{folder.folder}</p>
        </div>
        <div className="browser-setting-buttons">
          <button className="btn" onClick={() => setPicking(!picking)}>
            <Download size={13} /> Change…
          </button>
          {folder.chosen && (
            <button className="btn" onClick={() => void set('')}>
              Use Downloads
            </button>
          )}
        </div>
      </div>
      {picking && <FolderPicker start={folder.folder} onPick={(f) => void set(f)} onCancel={() => setPicking(false)} pickLabel="Use" />}
    </div>
  )
}

const PROFILE_FIELDS: { key: keyof AutofillProfile; label: string; type?: string; wide?: boolean }[] = [
  { key: 'name', label: 'Full name', wide: true },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'address1', label: 'Address line 1', wide: true },
  { key: 'address2', label: 'Address line 2', wide: true },
  { key: 'city', label: 'Town or city' },
  { key: 'county', label: 'County / state' },
  { key: 'postcode', label: 'Postcode' },
  { key: 'country', label: 'Country' }
]

function AutofillDetails() {
  const saved = useBrowser((s) => s.profile)
  const [draft, setDraft] = useState<AutofillProfile>(saved)
  useEffect(() => setDraft(saved), [saved])
  const changed = PROFILE_FIELDS.some((f) => draft[f.key] !== saved[f.key])
  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    try {
      const { profile, saved } = await window.api.webSetAutofill(draft)
      useBrowser.setState({ profile })
      notify(saved ? 'Your details are saved.' : 'This computer can’t keep them encrypted, so your details are only kept until Orbit closes.', saved ? 'info' : 'error')
    } catch (err) {
      notify(err)
    }
  }
  return (
    <form className="browser-autofill" onSubmit={save} data-autofill-form>
      <p className="browser-setting-note">
        <MapPin size={12} /> Offered in a pop-up when you’re in a form that asks for them. Kept on this computer only, encrypted.
      </p>
      <div className="browser-autofill-grid">
        {PROFILE_FIELDS.map((f) => (
          <label key={f.key} className={f.wide ? 'wide' : ''}>
            <span>{f.label}</span>
            <input className="text-input" type={f.type ?? 'text'} value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} autoComplete="off" />
          </label>
        ))}
      </div>
      <div className="browser-setting-buttons">
        <button className="btn btn-primary" disabled={!changed}>
          <Check size={13} /> Save details
        </button>
        {PROFILE_FIELDS.some((f) => saved[f.key]) && (
          <button type="button" className="btn" onClick={() => setDraft({ ...EMPTY_PROFILE })}>
            Clear
          </button>
        )}
      </div>
    </form>
  )
}

function OperaImport() {
  const [found, setFound] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<string[] | null>(null)
  // Logins waiting for Passwords to be unlocked.
  const [waiting, setWaiting] = useState<ImportedLogin[] | null>(null)
  const [master, setMaster] = useState('')
  const setUp = usePasswords((s) => s.setUp)
  const unlocked = usePasswords((s) => s.unlocked)
  useEffect(() => {
    void window.api.webOperaFound().then(setFound)
  }, [])

  const keepLogins = async (logins: ImportedLogin[], lines: string[]): Promise<void> => {
    if (!logins.length) return setReport(lines)
    if (!usePasswords.getState().unlocked) {
      setWaiting(logins)
      return setReport([...lines, `${logins.length} saved logins are ready to go into Passwords: unlock Passwords below to add them.`])
    }
    const added = await importLogins(logins)
    setWaiting(null)
    setReport([...lines, `${added} logins added to Passwords${added < logins.length ? ` (${logins.length - added} were already there)` : ''}.`])
  }

  const run = async (): Promise<void> => {
    setBusy(true)
    setReport(null)
    try {
      const r = await window.api.webImportOpera()
      if (!r.profile) return setReport(['Opera GX isn’t on this computer (or its profile is somewhere unusual).'])
      const lines = [`${r.bookmarks} bookmarks and ${r.history} pages of history brought in.`]
      if (r.lockedLogins) {
        lines.push(
          `${r.lockedLogins} saved passwords are locked to Opera GX and can’t be read by another app. In Opera GX, open Settings → Passwords, choose ⋮ → Export passwords, then press “Import a passwords file” here.`
        )
      }
      lines.push(...r.problems.map((p) => `Couldn’t read ${p}`))
      await keepLogins(r.logins, lines)
    } catch (err) {
      notify(err)
    } finally {
      setBusy(false)
    }
  }

  const csv = async (): Promise<void> => {
    try {
      const logins = await window.api.webImportCsv()
      if (logins) await keepLogins(logins, [`${logins.length} logins found in the file.`])
    } catch (err) {
      notify(err)
    }
  }

  const unlock = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    try {
      await unlockVault(master)
      setMaster('')
      if (waiting) await keepLogins(waiting, [])
    } catch (err) {
      notify(err)
    }
  }

  return (
    <div className="browser-setting-row column" data-opera-import>
      <div className="browser-setting-row">
        <div>
          <strong>Import from Opera GX</strong>
          <p>
            {found === false
              ? 'Opera GX wasn’t found on this computer. You can still import a passwords file exported from any browser.'
              : 'Brings in your bookmarks and history, and puts your saved logins in Orbit’s Passwords. Close Opera GX first. Your Opera GX stays as it is.'}
          </p>
        </div>
        <div className="browser-setting-buttons">
          {found && (
            <button className="btn btn-primary" disabled={busy} onClick={() => void run()}>
              {busy ? <Loader2 size={13} className="spin" /> : <FileUp size={13} />} Import
            </button>
          )}
          <button className="btn" onClick={() => void csv()} title="A passwords .csv exported from Opera GX, Chrome, Edge or Firefox">
            Import a passwords file…
          </button>
        </div>
      </div>
      {report && (
        <ul className="browser-import-report">
          {report.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      {waiting && !unlocked && (
        setUp ? (
          <form className="web-unlock" onSubmit={unlock}>
            <input type="password" className="text-input" placeholder="Master password" value={master} onChange={(e) => setMaster(e.target.value)} autoFocus />
            <button className="btn btn-primary" disabled={!master}>
              Unlock and add
            </button>
          </form>
        ) : (
          <button className="btn btn-primary" onClick={() => openSpecialTab(PASSWORDS_TAB)}>
            Set up Passwords first
          </button>
        )
      )}
    </div>
  )
}

/** Settings → Web browser: the parts that aren't simple switches. */
export default function BrowserSettings() {
  return (
    <div className="browser-settings" data-browser-settings>
      <Section title="Default browser">
        <DefaultBrowser />
      </Section>
      <Section title="Downloads">
        <DownloadFolder />
      </Section>
      <Section title="Your details for forms">
        <AutofillDetails />
      </Section>
      <Section title="Switching from another browser">
        <OperaImport />
      </Section>
      <Section title="Site permissions">
        <p className="browser-setting-note">What each site may use (notifications, the microphone, the camera, your location…), its zoom and its sound. Sites ask the first time; you can change your answer here, or clear one site’s data without signing out of the rest.</p>
        <div className="browser-sites">
          <SitesPanel />
        </div>
      </Section>
      <Section title="Browsing data">
        <div className="browser-setting-row">
          <div>
            <strong>Clear browsing data</strong>
            <p>Signs you out of every website and forgets your history. Bookmarks and Passwords stay.</p>
          </div>
          <button className="btn" onClick={() => void clearBrowsingData()}>
            <Eraser size={13} /> Clear…
          </button>
        </div>
      </Section>
    </div>
  )
}
