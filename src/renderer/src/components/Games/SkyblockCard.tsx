import { useEffect } from 'react'
import { create } from 'zustand'
import { Coins, FilePlus2, Gem, Info, Sparkles, X } from 'lucide-react'
import { describeMinutes, MODE_NAMES, RATE_MIN_MINUTES, shortNumber, summaryAsNote, type SkyblockSummary } from '@shared/skyblock'
import { useNoteIndex } from '../../store/noteIndex'
import { useVault } from '../../store/vault'
import { notify } from '../../store/notify'
import { freeNoteName } from '../../lib/chat'

/** The session card that's showing, if any (also opened from the Games page's past sessions). */
export const useSkyblockCard = create<{ summary: SkyblockSummary | null }>(() => ({ summary: null }))
export const showSkyblockSummary = (summary: SkyblockSummary | null): void => useSkyblockCard.setState({ summary })

async function saveAsNote(s: SkyblockSummary): Promise<void> {
  const { title, body } = summaryAsNote(s)
  const { lookup } = useNoteIndex.getState()
  const name = freeNoteName(title, (n) => lookup.has(`SkyBlock/${n}.md`))
  try {
    await useVault.getState().createNoteAt(`SkyBlock/${name}.md`, body)
    showSkyblockSummary(null)
  } catch (err) {
    notify(err)
  }
}

const sign = (n: number): string => `${n >= 0 ? '+' : ''}${shortNumber(n)}`

/** The card that comes up when Minecraft closes: coins an hour, XP, rare drops and what you collected. */
export default function SkyblockCard() {
  const s = useSkyblockCard((st) => st.summary)

  useEffect(() => {
    const offShow = window.api.onSkyblockSummary((summary) => showSkyblockSummary(summary))
    const offUpdate = window.api.onSkyblockUpdated((summary) => {
      if (useSkyblockCard.getState().summary?.id === summary.id) showSkyblockSummary(summary)
    })
    return () => {
      offShow()
      offUpdate()
    }
  }, [])

  useEffect(() => {
    if (!s) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') showSkyblockSummary(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s])

  if (!s) return null
  const xp = [...s.skills, ...s.slayer, ...(s.catacombs ? [s.catacombs] : [])]
  const when = new Date(s.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const endWhen = new Date(s.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const mode = MODE_NAMES[s.mode]
  // A few minutes isn't enough to say what an hour would bring.
  const rates = s.minutes >= RATE_MIN_MINUTES

  return (
    <div className="sb-card" role="dialog" aria-label="SkyBlock session" data-skyblock-card>
      <header className="sb-card-head">
        <div>
          <strong>SkyBlock session</strong>
          <span>
            {describeMinutes(s.minutes)} · {when}–{endWhen} · {s.profileName}
            {mode ? <em className="sb-mode">{mode}</em> : null}
          </span>
        </div>
        <button className="icon-btn" title="Close (Esc)" onClick={() => showSkyblockSummary(null)} data-skyblock-close>
          <X size={14} />
        </button>
      </header>

      <div className="sb-big">
        <div className="sb-big-stat" data-skyblock-coins>
          <Coins size={15} />
          {s.coins && rates ? (
            <>
              <b>{shortNumber(s.coins.perHour)}</b>
              <span>coins an hour</span>
              <small>
                {sign(s.coins.change)} in total{s.coins.bankIncluded ? '' : ' (purse)'}
              </small>
            </>
          ) : s.coins ? (
            <>
              <b>{sign(s.coins.change)}</b>
              <span>coins{s.coins.bankIncluded ? '' : ' (purse)'}</span>
            </>
          ) : (
            <>
              <b>?</b>
              <span>coins</span>
            </>
          )}
        </div>
        <div className="sb-big-stat">
          <Sparkles size={15} />
          <b>{s.skyblockXp ? `+${shortNumber(s.skyblockXp)}` : '0'}</b>
          <span>SkyBlock XP</span>
          {s.kills ? <small>{s.kills.toLocaleString()} kills</small> : null}
        </div>
        <div className="sb-big-stat">
          <Gem size={15} />
          <b>{s.drops ? s.drops.reduce((n, d) => n + d.count, 0) : '?'}</b>
          <span>rare drops</span>
        </div>
      </div>

      {xp.length > 0 && (
        <section className="sb-section" data-skyblock-xp>
          <h4>XP</h4>
          <table className="sb-xp">
            <tbody>
              {xp.map((x) => (
                <tr key={x.id}>
                  <td>{x.name}</td>
                  <td className="num">+{shortNumber(x.gained)}</td>
                  {rates && <td className="num faint">{shortNumber(x.perHour)}/h</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {s.drops && s.drops.length > 0 && (
        <section className="sb-section" data-skyblock-drops>
          <h4>Rare drops</h4>
          <ul className="sb-drops">
            {s.drops.map((d) => (
              <li key={`${d.kind}|${d.item}`}>
                <span className={`sb-drop-kind k-${d.kind.split(' ')[0].toLowerCase()}`}>{d.kind.replace(/!$/, '')}</span>
                <span>{d.item}</span>
                {d.count > 1 && <span className="faint">×{d.count}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {s.collected.length > 0 && (
        <section className="sb-section" data-skyblock-collected>
          <h4>Collected</h4>
          <ul className="sb-collected">
            {s.collected.slice(0, 8).map((c) => (
              <li key={c.id}>
                <span>{c.name}</span>
                <span className="num">{c.count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
          {s.collected.length > 8 && <p className="faint sb-more">and {s.collected.length - 8} more in the note</p>}
        </section>
      )}

      {(s.missing.length > 0 || s.startedLate) && (
        <div className="sb-missing" data-skyblock-missing>
          <Info size={13} />
          <div>
            {s.startedLate && <p>Minecraft was already open when Orbit started watching, so this counts from then.</p>}
            {s.missing.map((m) => (
              <p key={m}>{m}</p>
            ))}
          </div>
        </div>
      )}

      <footer className="sb-card-foot">
        <button className="btn" onClick={() => void saveAsNote(s)} data-skyblock-save>
          <FilePlus2 size={13} /> Save as note
        </button>
        <button className="btn btn-primary" onClick={() => showSkyblockSummary(null)}>
          Done
        </button>
      </footer>
    </div>
  )
}
