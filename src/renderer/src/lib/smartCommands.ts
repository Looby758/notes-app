import { useUI, showSearch } from '../store/ui'
import { usePrefs } from '../store/prefs'
import { notify } from '../store/notify'
import { addEntry, addGoal, ensureMoney, useMoney } from '../store/money'
import { musicControl, musicPlay, setMusicOpen } from '../store/music'
import { useVault } from '../store/vault'
import { askEverything } from '../store/ai'
import { saveCapture } from './capture'
import { featureById, FEATURES } from './features'
import { FEATURE_INFO } from './featureInfo'
import { CONVERT_TAB, MONEY_TAB, openSpecialTab, openWebTab } from './editorController'
import { setPreferredConvertFormat } from './convert/formats'
import { describeSmart, parseSmart, validSmart, CONVERT_FORMATS, type ParseContext, type SmartAction } from './smartParse'
import { formatPounds } from './money'
import { errorMessage } from './paths'

/** Runs smart commands (lib/smartParse.ts) in the main window: Ctrl+K, the launcher and the summon bar all end up here. */

export const featureNames = FEATURE_INFO

export function smartContext(): ParseContext {
  return { categories: useMoney.getState().categories, features: featureNames }
}

export const parseCommand = (text: string): SmartAction | null => parseSmart(text, smartContext())
export const describeCommand = (a: SmartAction): string => describeSmart(a, smartContext())

/** Opens Ctrl+K with some text already typed. */
export function openPalette(query = ''): void {
  useUI.setState({ modal: 'commands', paletteQuery: query })
}

/** Does what the action says. Returns a few words on what happened (for the summon bar), or throws. */
export async function runSmart(a: SmartAction): Promise<string> {
  switch (a.kind) {
    case 'money': {
      await ensureMoney()
      addEntry({ date: a.date, amount: a.amount, income: a.income, category: a.category, note: a.note })
      const cat = useMoney.getState().categories.find((c) => c.id === a.category)?.name ?? 'Other'
      const said = `${formatPounds(a.amount)} added to ${cat}`
      notify(`${said}.`, 'info')
      return said
    }
    case 'event': {
      const r = await saveCapture({ text: a.title, event: { date: a.date, time: a.time, title: a.title, remind: a.remind } })
      if (!r.ok) throw new Error(r.error ?? 'Couldn’t add it.')
      notify(`Added to ${r.where}.`, 'info')
      return `Added to ${r.where}`
    }
    case 'jot': {
      const r = await saveCapture(a.text)
      if (!r.ok) throw new Error(r.error ?? 'Couldn’t save it.')
      notify(`Saved in ${r.where}.`, 'info')
      return `Saved in ${r.where}`
    }
    case 'note': {
      const vault = useVault.getState()
      if (a.title) await vault.createNoteAt(`${vault.targetFolder() ? `${vault.targetFolder()}/` : ''}${a.title.replace(/[\\/:*?"<>|]/g, '-')}`, `# ${a.title}\n\n`)
      else await vault.newNote()
      return 'New note made'
    }
    case 'convert':
      setPreferredConvertFormat(a.format as (typeof CONVERT_FORMATS)[number])
      openSpecialTab(CONVERT_TAB)
      return `Converter set to ${a.format.toUpperCase()}`
    case 'play': {
      let results
      try {
        results = await window.api.musicSearch(a.query)
      } catch (err) {
        throw new Error(`Couldn’t search Spotify: ${errorMessage(err)}`)
      }
      const pick = results.tracks[0] ?? results.playlists[0] ?? results.albums[0]
      if (!pick) throw new Error(`Nothing found on Spotify for “${a.query}”.`)
      setMusicOpen(true)
      if (!(await musicPlay(pick.uri))) throw new Error('Spotify didn’t start playing. Open Spotify on this computer and try again.')
      return `Playing ${pick.name}${pick.detail ? ` – ${pick.detail}` : ''}`
    }
    case 'music':
      await musicControl(a.action)
      return describeCommand(a)
    case 'open': {
      const f = featureById(a.feature)
      if (!f) throw new Error('That isn’t part of Orbit.')
      f.run()
      return `Opened ${f.name}`
    }
    case 'search':
      showSearch(a.query)
      return `Searching for ${a.query}`
    case 'web':
      openWebTab(`https://www.google.com/search?q=${encodeURIComponent(a.query)}`, { beside: true })
      return `Searching the web for ${a.query}`
    case 'calc':
      await navigator.clipboard.writeText(a.result).catch(() => undefined)
      notify(`${a.result} copied.`, 'info')
      return `${a.result} copied`
    case 'goal': {
      await ensureMoney()
      addGoal({ name: a.name, target: a.amount, due: '' })
      openSpecialTab(MONEY_TAB)
      return `Savings goal “${a.name}” made`
    }
    case 'ask':
      void askEverything(a.question)
      return 'Asking…'
  }
}

/** What the AI needs to know to turn a sentence into an action: your categories and Orbit's features. */
function aiContext(): string {
  const cats = useMoney
    .getState()
    .categories.map((c) => `${c.id} (${c.name}${c.income ? ', money coming in' : ''})`)
    .join(', ')
  const features = FEATURES.map((f) => `${f.id} (${f.name})`).join(', ')
  return `Money category ids: ${cats}.\nFeature ids: ${features}.`
}

/** Asks the AI what a sentence means. Only call this after the person said yes. */
export async function interpretWithAi(text: string): Promise<SmartAction> {
  if (!usePrefs.getState().prefs.smartCommandsAi) throw new Error('Asking the AI is turned off in Settings → Finding features.')
  await ensureMoney()
  const raw = (await window.api.aiInterpret(text, aiContext())) as { kind?: string; reason?: string } | null
  if (raw?.kind === 'none') throw new Error(raw.reason || 'That isn’t something Orbit can do yet.')
  const action = validSmart(raw, smartContext())
  if (!action) throw new Error('Claude’s answer didn’t make sense, so nothing was done.')
  return action
}
