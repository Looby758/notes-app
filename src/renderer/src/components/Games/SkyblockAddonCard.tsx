import { useState } from 'react'
import { ArrowDown, ArrowUp, Download, Image, Pause, RefreshCw, Trash2 } from 'lucide-react'
import { DEFAULT_PACKS, ITEM_LIST_MB, TEXTURE_PACKS, VANILLA_MB } from '@shared/skyblockTextures'
import { errorMessage } from '../../lib/paths'
import { notify } from '../../store/notify'
import { useSkyblockAddon } from './SkyblockPic'

const clean = (err: unknown): string => errorMessage(err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Pick texture packs: tick the ones you want, and move them up or down (the top one wins). */
function PackPicker({ packs, setPacks }: { packs: string[]; setPacks: (p: string[]) => void }) {
  const order = [...packs, ...TEXTURE_PACKS.map((p) => p.id).filter((id) => !packs.includes(id))]
  const move = (id: string, by: number): void => {
    const i = packs.indexOf(id)
    const j = i + by
    if (i < 0 || j < 0 || j >= packs.length) return
    const next = packs.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    setPacks(next)
  }
  return (
    <ul className="sba-packs" data-sba-packs>
      {order.map((id) => {
        const p = TEXTURE_PACKS.find((x) => x.id === id)!
        const on = packs.includes(id)
        const rank = packs.indexOf(id)
        return (
          <li key={id} className={on ? 'on' : ''}>
            <label>
              <input type="checkbox" checked={on} onChange={() => setPacks(on ? packs.filter((x) => x !== id) : [...packs, id])} data-sba-pack={id} />
              <span>
                <strong>{p.name}</strong>
                {rank === 0 && packs.length > 1 && <span className="sbg-tag">First choice</span>} <span className="faint">· {p.mb} MB</span>
                <small>{p.about}</small>
              </span>
            </label>
            {on && packs.length > 1 && (
              <span className="sba-move">
                <button className="icon-btn" disabled={rank === 0} title="Prefer this pack" onClick={() => move(id, -1)}>
                  <ArrowUp size={12} />
                </button>
                <button className="icon-btn" disabled={rank === packs.length - 1} title="Prefer this pack less" onClick={() => move(id, 1)}>
                  <ArrowDown size={12} />
                </button>
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

const mbOf = (packs: string[], kept = false): number =>
  Math.round(
    (VANILLA_MB +
      packs.reduce((a, id) => {
        const p = TEXTURE_PACKS.find((x) => x.id === id)
        return a + ((kept ? p?.keepMb : undefined) ?? p?.mb ?? 0)
      }, 0)) *
      10
  ) / 10

/**
 * The SkyBlock add-on: get it, watch it download, change texture packs, or remove it. Everything
 * SkyBlock in Orbit (profile, goal planner, session summaries) is off until it's downloaded.
 */
export default function SkyblockAddonCard({ compact = false }: { compact?: boolean }) {
  const s = useSkyblockAddon()
  const [packs, setPacks] = useState<string[] | null>(null)
  const [changing, setChanging] = useState(false)
  if (!s) return null
  const chosen = packs ?? (s.packs.length ? s.packs : DEFAULT_PACKS)

  const install = async (list: string[]): Promise<void> => {
    try {
      const done = await window.api.skyblockAddonInstall(list)
      if (done.state === 'ready') {
        setChanging(false)
        setPacks(null)
      }
    } catch (err) {
      notify(clean(err))
    }
  }
  const remove = async (): Promise<void> => {
    const ok = await window.api.confirm({
      message: 'Remove the SkyBlock add-on?',
      detail:
        'The profile, goal planner, session summaries and item pictures switch off and their downloads are deleted. Your goals, Hypixel key and past session cards are kept for if you get it again.',
      ok: 'Remove',
      type: 'warning'
    })
    if (ok) await window.api.skyblockAddonRemove()
  }

  if (s.state === 'installing')
    return (
      <section className="sba" data-sba="installing">
        <h3>
          <RefreshCw size={16} className="spin" /> Getting the SkyBlock add-on
        </h3>
        <p>
          {s.stage} {Math.round(s.progress * 100)}%
        </p>
        <div className="offline-ai-bar">
          <span style={{ width: `${Math.round(s.progress * 100)}%` }} />
        </div>
        <div className="offline-ai-row">
          <button className="btn" onClick={() => void window.api.skyblockAddonCancel()} data-sba-pause>
            <Pause size={13} /> Pause
          </button>
          <span className="money-hint">You can keep using Orbit while it downloads. A paused download carries on where it stopped.</span>
        </div>
      </section>
    )

  if (s.state === 'ready' && !changing)
    return (
      <section className={`sba ${compact ? 'compact' : ''}`} data-sba="ready">
        <div className="cal-connected">
          <span className="cal-connected-dot" />
          <span>
            SkyBlock add-on installed ({s.mb} MB) with{' '}
            {s.packs.length ? s.packs.map((id) => TEXTURE_PACKS.find((p) => p.id === id)?.name ?? id).join(', ') : 'plain Minecraft pictures'}.
          </span>
        </div>
        <div className="offline-ai-row">
          <button className="btn" onClick={() => setChanging(true)} data-sba-change>
            <Image size={13} /> Change texture packs
          </button>
          <button className="btn" onClick={() => void remove()} data-sba-remove>
            <Trash2 size={13} /> Remove
          </button>
        </div>
        {s.error && <p className="setting-warning">{s.error}</p>}
      </section>
    )

  return (
    <section className="sba" data-sba={s.state}>
      {s.state === 'missing' ? (
        <>
          <h3>SkyBlock add-on</h3>
          <p className="cal-sources-intro">
            Everything Hypixel SkyBlock in Orbit is an optional download: your profile (like SkyCrypt, just for you), the ironman goal planner, the summary card after each session,
            and pictures for every item. Pick the texture packs the pictures come from. The top one wins; items it doesn’t cover fall back to the next, then to plain Minecraft.
          </p>
        </>
      ) : (
        <h3>Change texture packs</h3>
      )}
      <PackPicker packs={chosen} setPacks={setPacks} />
      <div className="offline-ai-row">
        <button className="btn btn-primary" onClick={() => void install(chosen)} data-sba-get>
          <Download size={13} /> {s.state === 'missing' ? `Download (about ${Math.round(mbOf(chosen) + ITEM_LIST_MB)} MB)` : 'Apply'}
        </button>
        {s.state === 'ready' && (
          <button className="btn" onClick={() => setChanging(false)}>
            Cancel
          </button>
        )}
        <span className="money-hint">Keeps about {Math.round(mbOf(chosen, true) + 3)} MB on this computer.</span>
      </div>
      {s.error && <p className="setting-warning">{s.error}</p>}
      <p className="cal-note">
        Recipes come from the NEU item repo, and item pictures from skyblock-assets by mat (MIT licence) with packs by their own makers (FurfSky Reborn, PacksHQ, Hypixel+, RNBW,
        Worlds and Beyond, Ectoplasm and FurfSky), all from GitHub. Hypixel’s own pack comes straight from Hypixel and stays © Hypixel Inc. under its licence.
      </p>
    </section>
  )
}
