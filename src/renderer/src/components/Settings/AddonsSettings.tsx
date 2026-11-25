import { useEffect, useMemo, useState } from 'react'
import { Check, CloudSun, Network, PenLine, Puzzle, Search, StickyNote, type LucideIcon } from 'lucide-react'
import { ADDONS, addAddon, addonById, neededBy, removeAddon, type AddonInfo } from '@shared/addons'
import { ADDON_ABOUT, ADDON_CATEGORIES } from '@shared/addonDetails'
import { FEATURE_INFO } from '../../lib/featureInfo'
import { featureById } from '../../lib/features'
import { setPrefs, usePrefs } from '../../store/prefs'
import { openAddons } from '../../lib/editorController'

/** Icons for add-ons that are part of a page rather than a feature with its own icon. */
const EXTRA_ICONS: Record<string, LucideIcon> = { 'canvas-board': StickyNote, 'mind-map': Network, sketch: PenLine, weather: CloudSun }
/** One-line blurbs for the same. */
const EXTRA_BLURBS: Record<string, string> = {
  'canvas-board': 'Free-form boards of cards and pictures',
  'mind-map': 'See a note as ideas branching out from the middle',
  sketch: 'Draw or write by hand in a note',
  weather: 'The forecast on Home and in the calendar'
}

const INFO = new Map(FEATURE_INFO.map((f) => [f.id, f]))
const CATEGORY_OF = new Map(ADDON_CATEGORIES.flatMap((c) => c.addons.map((id) => [id, c.name] as const)))

const blurbOf = (a: AddonInfo): string => EXTRA_BLURBS[a.id] ?? INFO.get(a.features[0])?.blurb ?? ''
const iconOf = (a: AddonInfo): LucideIcon => EXTRA_ICONS[a.id] ?? featureById(a.features[0])?.icon ?? Puzzle
const nameOf = (id: string): string => addonById(id)?.name ?? id
const list = (ids: string[]): string => (ids.length < 2 ? ids.join('') : `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`)

/** Things other add-ons can't work without, shown under "Comes with" (the shared tools have no page of their own). */
const comesWith = (a: AddonInfo): string[] => (a.needs ?? []).map(nameOf)

const ADDED = 'Added'
const SHOWN = ADDONS.filter((a) => !a.helper)

/**
 * Settings → Add-ons: everything beyond the core. Categories on the left, their add-ons in the
 * middle, and the one you picked on the right, with a picture and what it does. An add-on you
 * haven't added is hidden everywhere and doesn't run. (Later each one will be its own download.)
 */
export default function AddonsSettings() {
  const installed = usePrefs((s) => s.prefs.installedAddons)
  const [category, setCategory] = useState<string>(ADDON_CATEGORIES[0].name)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string>(ADDON_CATEGORIES[0].addons[0])
  const [removing, setRemoving] = useState<string | null>(null)
  const count = SHOWN.filter((a) => installed.includes(a.id)).length

  const q = query.trim().toLowerCase()
  const rows = useMemo(() => {
    if (q) {
      return SHOWN.filter((a) =>
        [a.name, blurbOf(a), ADDON_ABOUT[a.id] ?? '', ...a.features.map((f) => INFO.get(f)?.keywords ?? '')].join(' ').toLowerCase().includes(q)
      )
    }
    if (category === ADDED) return SHOWN.filter((a) => installed.includes(a.id))
    const ids = ADDON_CATEGORIES.find((c) => c.name === category)?.addons ?? []
    return ids.map((id) => addonById(id)).filter((a): a is AddonInfo => !!a)
  }, [q, category, installed])

  // Keep the details on something in the list.
  useEffect(() => {
    if (rows.length && !rows.some((a) => a.id === picked)) setPicked(rows[0].id)
  }, [rows, picked])

  const pickCategory = (name: string): void => {
    setQuery('')
    setCategory(name)
    setRemoving(null)
  }

  return (
    <div className="addon-store" data-addon-store>
      <nav className="addon-store-cats" aria-label="Add-on categories">
        <label className="addon-store-search">
          <Search size={14} />
          <input type="search" placeholder="Search add-ons" aria-label="Search add-ons" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button className={`addon-cat ${!q && category === ADDED ? 'active' : ''}`} onClick={() => pickCategory(ADDED)}>
          <span>Added</span>
          <span className="addon-cat-count">
            {count} of {SHOWN.length}
          </span>
        </button>
        <div className="addon-cat-gap" />
        {ADDON_CATEGORIES.map((c) => (
          <button key={c.name} className={`addon-cat ${!q && category === c.name ? 'active' : ''}`} onClick={() => pickCategory(c.name)} data-addon-cat={c.name}>
            <span>{c.name}</span>
            <span className="addon-cat-count">{c.addons.filter((id) => installed.includes(id)).length || ''}</span>
          </button>
        ))}
      </nav>

      <div className="addon-store-list" role="list">
        {rows.length === 0 && <p className="addon-store-empty">{q ? 'No add-ons match.' : 'Nothing added yet.'}</p>}
        {rows.map((a) => {
          const Icon = iconOf(a)
          const on = installed.includes(a.id)
          return (
            <button
              key={a.id}
              role="listitem"
              className={`addon-row ${a.id === picked ? 'active' : ''}`}
              onClick={() => {
                setPicked(a.id)
                setRemoving(null)
              }}
              data-addon={a.id}
            >
              <span className="addon-icon">
                <Icon size={18} />
              </span>
              <span className="addon-row-text">
                <span className="addon-row-name">{a.name}</span>
                <span className="addon-row-blurb">{blurbOf(a)}</span>
              </span>
              {on && (
                <span className="addon-row-added" title="Added">
                  <Check size={14} />
                </span>
              )}
            </button>
          )
        })}
      </div>

      {addonById(picked) && <Details addon={addonById(picked)!} installed={installed} removing={removing === picked} setRemoving={(on) => setRemoving(on ? picked : null)} />}
    </div>
  )
}

function Details({ addon: a, installed, removing, setRemoving }: { addon: AddonInfo; installed: string[]; removing: boolean; setRemoving: (on: boolean) => void }) {
  const Icon = iconOf(a)
  const on = installed.includes(a.id)
  const users = on ? neededBy(a.id, installed).filter((id) => !addonById(id)?.helper) : []
  const needs = comesWith(a)
  const usedBy = ADDONS.filter((x) => !x.helper && x.needs?.includes(a.id)).map((x) => x.name)
  const [noPicture, setNoPicture] = useState(false)
  useEffect(() => setNoPicture(false), [a.id])

  const remove = (): void => {
    setRemoving(false)
    setPrefs({ installedAddons: removeAddon(installed, a.id) })
  }

  return (
    <section className="addon-details" aria-label={a.name} data-addon-details={a.id}>
      <div className="addon-details-head">
        <span className="addon-icon big">
          <Icon size={30} />
        </span>
        <div className="addon-details-title">
          <h3>{a.name}</h3>
          <p>{CATEGORY_OF.get(a.id)}</p>
        </div>
        {on ? (
          <button className="btn addon-details-btn" onClick={() => (users.length ? setRemoving(true) : remove())} data-addon-remove>
            Remove
          </button>
        ) : (
          <button className="btn btn-primary addon-details-btn" onClick={() => setPrefs({ installedAddons: addAddon(installed, a.id) })} data-addon-add>
            Add
          </button>
        )}
      </div>
      {removing && (
        <p className="addon-confirm">
          Removing {a.name} also removes {list(users.map(nameOf))}, which need it.{' '}
          <button className="btn" onClick={remove}>
            Remove all
          </button>{' '}
          <button className="btn" onClick={() => setRemoving(false)}>
            Keep
          </button>
        </p>
      )}
      <div className="addon-picture">
        {noPicture ? (
          <span className="addon-picture-none" aria-hidden="true">
            <Icon size={56} strokeWidth={1.4} />
          </span>
        ) : (
          <img key={a.id} src={`./addons/${a.id}.webp`} alt={`${a.name} in Orbit`} onError={() => setNoPicture(true)} />
        )}
      </div>
      <p className="addon-about">{ADDON_ABOUT[a.id] ?? blurbOf(a)}</p>
      {(needs.length > 0 || usedBy.length > 0) && (
        <div className="addon-facts">
          {needs.length > 0 && (
            <div className="addon-fact">
              <h4>Comes with</h4>
              <p>{list(needs)}</p>
            </div>
          )}
          {usedBy.length > 0 && (
            <div className="addon-fact">
              <h4>Other add-ons that need it</h4>
              <p>{list(usedBy)}</p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** The Add-ons page (its own tab): a heading, a line on what add-ons are, and the store. */
export function AddonsPage() {
  return (
    <div className="addons-page" data-addons-page>
      <header className="addons-page-head">
        <h1>
          <Puzzle size={20} /> Add-ons
        </h1>
        <p>Notes, to-do lists, Home, search and Settings are always here. Add whatever else you want; an add-on you haven’t added is hidden everywhere and never runs.</p>
      </header>
      <AddonsSettings />
    </div>
  )
}

/** Shown in place of a page whose add-on isn't added (a tab left open, or a link to it). */
export function AddonMissing({ addon: id }: { addon: string }) {
  const addon = addonById(id)
  const name = addon?.name ?? 'This'
  return (
    <div className="addon-missing">
      <Puzzle size={28} />
      <h2>{name} isn’t added</h2>
      <p>{addon ? (ADDON_ABOUT[addon.id] ?? blurbOf(addon)) : ''}</p>
      <div className="addon-missing-actions">
        {addon && (
          <button className="btn btn-primary" onClick={() => setPrefs({ installedAddons: addAddon(usePrefs.getState().prefs.installedAddons, addon.id) })}>
            Add {name}
          </button>
        )}
        <button className="btn" onClick={openAddons}>
          See all add-ons
        </button>
      </div>
    </div>
  )
}
