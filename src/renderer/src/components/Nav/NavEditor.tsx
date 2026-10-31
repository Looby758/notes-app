import './nav.css'
import { RotateCcw } from 'lucide-react'
import { DEFAULT_PREFS } from '@shared/prefs'
import { resetPrefs, usePrefs } from '../../store/prefs'
import { FEATURE_GROUPS, FEATURES, toggleFeatureIn, type FeaturePlace } from '../../lib/features'
import { DECK_EXTRAS } from '../../lib/phoneDeck'

const PLACES: { place: FeaturePlace; label: string }[] = [
  { place: 'topbarFeatures', label: 'Top bar' },
  { place: 'dockFeatures', label: 'Dock' },
  { place: 'radialFeatures', label: 'Radial' },
  { place: 'phoneDeck', label: 'Phone deck' }
]

/** Settings → Finding features: tick where each feature shows up. Everything is always in the launcher. */
export default function NavEditor() {
  const prefs = usePrefs((s) => s.prefs)
  const changed = PLACES.some(({ place }) => JSON.stringify(prefs[place]) !== JSON.stringify(DEFAULT_PREFS[place]))
  return (
    <section className="settings-group nav-editor" data-nav-editor>
      <div className="settings-heading">
        <h3>Where each feature shows up</h3>
        {changed && (
          <button className="btn" onClick={() => resetPrefs(PLACES.map((p) => p.place))}>
            <RotateCcw size={13} /> Back to the usual
          </button>
        )}
      </div>
      <p className="setting-hint">
        Every feature is always in the launcher (the “All features” button, or Ctrl+Shift+Space). Tick the ones you want one click away. New ones go at the end;
        drag them in the top bar or dock to reorder. The phone deck is the Deck tab on your phone’s Orbit page.
      </p>
      <table>
        <thead>
          <tr>
            <th>Feature</th>
            {PLACES.map((p) => (
              <th key={p.place}>{p.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {FEATURE_GROUPS.flatMap((g) => [
            <tr key={g} className="nav-editor-group">
              <td colSpan={5}>{g}</td>
            </tr>,
            ...FEATURES.filter((f) => f.group === g).map((f) => {
              const Icon = f.icon
              return (
                <tr key={f.id} data-feature={f.id}>
                  <td>
                    <span className="nav-editor-name">
                      <Icon size={15} /> {f.name}
                    </span>
                  </td>
                  {PLACES.map(({ place, label }) => (
                    <td key={place}>
                      <input type="checkbox" checked={prefs[place].includes(f.id)} onChange={() => toggleFeatureIn(place, f.id)} aria-label={`${f.name} in the ${label.toLowerCase()}`} />
                    </td>
                  ))}
                </tr>
              )
            })
          ])}
          <tr className="nav-editor-group">
            <td colSpan={5}>Phone deck only</td>
          </tr>
          {DECK_EXTRAS.map((x) => (
            <tr key={x.id} data-feature={x.id}>
              <td>
                <span className="nav-editor-name">
                  <span aria-hidden>{x.icon}</span> {x.name}
                </span>
              </td>
              <td />
              <td />
              <td />
              <td>
                <input type="checkbox" checked={prefs.phoneDeck.includes(x.id)} onChange={() => toggleFeatureIn('phoneDeck', x.id)} aria-label={`${x.name} on the phone deck`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
