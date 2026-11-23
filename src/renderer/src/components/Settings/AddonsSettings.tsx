import { useMemo, useState } from 'react'
import { Puzzle } from 'lucide-react'
import { ADDONS, addAddon, addonById, neededBy, removeAddon, type AddonInfo } from '@shared/addons'
import { FEATURE_GROUPS, FEATURE_INFO, type FeatureGroup } from '../../lib/featureInfo'
import { setPrefs, usePrefs } from '../../store/prefs'
import { openAddons } from '../../lib/editorController'

/** For add-ons that are part of a page rather than a feature of their own. */
const EXTRA: Record<string, { group: FeatureGroup; blurb: string }> = {
  'canvas-board': { group: 'Notes', blurb: 'Free-form boards of cards and pictures' },
  'mind-map': { group: 'Notes', blurb: 'See a note as ideas branching out from the middle' },
  sketch: { group: 'Notes', blurb: 'Draw or write by hand in a note' },
  weather: { group: 'Plan', blurb: 'The forecast on Home' }
}

const INFO = new Map(FEATURE_INFO.map((f) => [f.id, f]))

function describe(a: AddonInfo): { group: FeatureGroup; blurb: string } {
  if (EXTRA[a.id]) return EXTRA[a.id]
  const first = INFO.get(a.features[0])
  return { group: first?.group ?? 'Tools', blurb: first?.blurb ?? '' }
}

const nameOf = (id: string): string => addonById(id)?.name ?? id
const list = (ids: string[]): string => (ids.length < 2 ? ids.join('') : `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`)

/**
 * Settings → Add-ons: everything beyond the core, to add or remove. An add-on you haven't added
 * is hidden everywhere and doesn't run. (Later each one will be its own download.)
 */
export default function AddonsSettings() {
  const installed = usePrefs((s) => s.prefs.installedAddons)
  const [removing, setRemoving] = useState<string | null>(null)
  const shown = useMemo(() => ADDONS.filter((a) => !a.helper), [])
  const count = shown.filter((a) => installed.includes(a.id)).length

  const remove = (id: string): void => {
    setRemoving(null)
    setPrefs({ installedAddons: removeAddon(installed, id) })
  }

  return (
    <>
      <p className="addons-intro">
        Orbit always has notes, to-do lists, Home, search and Settings. Everything else is an add-on: add the ones you want, and
        the rest stay out of the way. An add-on you haven’t added is hidden everywhere and never runs in the background.
        <br />
        <span className="addons-count">
          {count} of {shown.length} added
        </span>
      </p>
      {FEATURE_GROUPS.map((group) => {
        const addons = shown.filter((a) => describe(a).group === group)
        if (!addons.length) return null
        return (
          <section key={group} className="settings-group">
            <h3>{group}</h3>
            {addons.map((a) => {
              const on = installed.includes(a.id)
              const needs = (a.needs ?? []).map(nameOf)
              const users = on ? neededBy(a.id, installed).filter((id) => !addonById(id)?.helper) : []
              return (
                <div key={a.id} className="setting-row addon-row" data-addon={a.id}>
                  <div className="setting-text">
                    <label>{a.name}</label>
                    <p>
                      {describe(a).blurb}
                      {needs.length > 0 && <span className="addon-needs"> · Comes with {list(needs).toLowerCase()}</span>}
                    </p>
                    {removing === a.id && (
                      <p className="addon-confirm">
                        Removing {a.name} also removes {list(users.map(nameOf))}, which need it.{' '}
                        <button className="btn" onClick={() => remove(a.id)}>
                          Remove all
                        </button>{' '}
                        <button className="btn" onClick={() => setRemoving(null)}>
                          Keep
                        </button>
                      </p>
                    )}
                  </div>
                  <div className="setting-control">
                    {on ? (
                      <button className="btn" onClick={() => (users.length ? setRemoving(a.id) : remove(a.id))}>
                        Remove
                      </button>
                    ) : (
                      <button className="btn btn-primary" onClick={() => setPrefs({ installedAddons: addAddon(installed, a.id) })}>
                        Add
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </section>
        )
      })}
    </>
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
      <p>{addon ? describe(addon).blurb : ''}</p>
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
