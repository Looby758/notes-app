import { Footprints, Globe2, MapPin, Navigation, Undo2 } from 'lucide-react'
import { DAY, clockText, dayOf } from '@shared/survival'
import { allGroups, areaById, areaNear, describeSpot, isLand, kmBetween, partyPosition, travelDays, type Globe } from '@shared/globe'
import type { GlobePick } from './GlobeView'

const days = (n: number): string => (n < 1 ? 'under a day' : `${Math.round(n)} day${Math.round(n) === 1 ? '' : 's'}`)

/**
 * The side panel while looking at the globe: what's at the spot you clicked, an area's people, a
 * group on the road, and every place and group in the world.
 */
export function GlobePanel({
  globe,
  pick,
  setPick,
  onEnter,
  onOpen,
  travel,
  onSend,
  onCancelTravel,
  onTurnBack
}: {
  globe: Globe
  pick: GlobePick
  setPick: (p: GlobePick) => void
  /** Go down to an area (and look at a group there). */
  onEnter: (areaId: number, groupId?: number) => void
  /** Open a new area at a spot, and go down to it. */
  onOpen: (lat: number, lon: number) => void
  travel: { areaId: number; groupId: number } | null
  onSend: (lat: number, lon: number, name: string) => void
  onCancelTravel: () => void
  onTurnBack: (partyId: number) => void
}) {
  const groups = allGroups(globe)
  const traveller = travel ? groups.find((x) => x.group.id === travel.groupId) : undefined
  const from = travel ? areaById(globe, travel.areaId) : undefined

  return (
    <div className="evo-panel-body" data-sv-globe-panel>
      {travel && traveller && from && (
        <div className="evo-card sv-travel" data-sv-travel>
          <h4>
            <Navigation size={13} /> Where should {traveller.group.name} go?
          </h4>
          {pick?.kind === 'spot' || pick?.kind === 'area' ? (
            (() => {
              const at = pick.kind === 'area' ? areaById(globe, pick.id)! : null
              const lat = at ? at.lat : (pick as { lat: number }).lat
              const lon = at ? at.lon : (pick as { lon: number }).lon
              const spot = describeSpot(lat, lon)
              const name = at ? at.name : spot.name
              const land = at ? true : isLand(lat, lon)
              const km = kmBetween(from.lat, from.lon, lat, lon)
              if (at?.id === from.id) return <p className="muted">That's where they are now. Pick somewhere else.</p>
              return (
                <>
                  <p>
                    <b>{name}</b>
                    <br />
                    <span className="muted">
                      About {Math.round(km)} km from {from.name}: {days(travelDays(from.lat, from.lon, lat, lon))} on foot, with everything they're carrying ({traveller.group.stash.food} food, {traveller.group.stash.water} water).
                    </span>
                  </p>
                  {!land && <p className="sv-callout">That's the sea. Pick somewhere on land.</p>}
                  <div className="sv-row">
                    <button className="btn btn-primary" disabled={!land} onClick={() => onSend(lat, lon, name)} data-sv-send>
                      <Footprints size={13} /> Send them
                    </button>
                    <button className="btn" onClick={onCancelTravel}>
                      Cancel
                    </button>
                  </div>
                  <p className="evo-hint">They'll pack up, walk to the edge of {from.name} heading that way, and set off. Whatever they knew about {from.name} stays with them if they ever come back.</p>
                </>
              )
            })()
          ) : (
            <>
              <p className="muted">Click anywhere on land, a city, or a place you've already opened.</p>
              <button className="btn" onClick={onCancelTravel}>
                Cancel
              </button>
            </>
          )}
        </div>
      )}

      {!travel && pick?.kind === 'spot' && (() => {
        const near = areaNear(globe, pick.lat, pick.lon)
        if (near) return <AreaCard globe={globe} id={near.id} onEnter={onEnter} />
        const land = isLand(pick.lat, pick.lon)
        const spot = describeSpot(pick.lat, pick.lon)
        return (
          <div className="evo-card" data-sv-spot>
            <h4>
              <MapPin size={13} /> {land ? spot.name : 'Open sea'}
            </h4>
            <p className="muted">
              {pick.lat.toFixed(2)}°, {pick.lon.toFixed(2)}°{land ? ` · ${spot.region}` : ''}
            </p>
            {land ? (
              <>
                <p className="evo-hint">
                  Nobody's looked here yet. Opening it builds the area: {spot.city ? `${spot.city.name} itself, with its own streets and buildings` : `made-up towns and farms with local names, near ${spot.near.name}`}. It's empty until you put someone there.
                </p>
                <button className="btn btn-primary" onClick={() => onOpen(pick.lat, pick.lon)} data-sv-open-area>
                  <Globe2 size={13} /> Open this area
                </button>
              </>
            ) : (
              <p className="evo-hint">Nothing out here. Pick somewhere on land.</p>
            )}
          </div>
        )
      })()}

      {!travel && pick?.kind === 'area' && <AreaCard globe={globe} id={pick.id} onEnter={onEnter} />}

      {pick?.kind === 'party' && (() => {
        const p = globe.parties.find((x) => x.id === pick.id)
        if (!p) return null
        const pos = partyPosition(globe, p)
        const left = (p.arrives - globe.tick) / DAY
        return (
          <div className="evo-card" data-sv-party>
            <h4>
              <i className="evo-dot" style={{ background: p.group.color }} /> {p.group.name}
            </h4>
            <p className="muted">
              On the road from {p.from.name} to {p.to.name}: {Math.round(pos.t * 100)}% of the way, about {days(left)} to go. Arrives around Day {dayOf(p.arrives)}, {clockText(p.arrives)}.
            </p>
            <p className="muted">
              {p.people.filter((q) => !q.held).map((q) => q.name.split(' ')[0]).join(', ')} · {p.group.stash.food} food, {p.group.stash.water} water
            </p>
            <button className="btn" onClick={() => onTurnBack(p.id)}>
              <Undo2 size={13} /> Turn back
            </button>
          </div>
        )
      })()}

      <div className="evo-sub">Groups everywhere ({groups.length})</div>
      {groups.length === 0 && <p className="evo-hint">Nobody yet. Open a place and put a group there.</p>}
      <div className="sv-people">
        {groups.map(({ group, area, party, people }) => (
          <button
            key={group.id}
            className="sv-person-row"
            onClick={() => (area ? onEnter(area.id, group.id) : party ? setPick({ kind: 'party', id: party.id }) : undefined)}
            data-sv-everywhere={group.id}
          >
            <b>
              <i className="evo-dot" style={{ background: group.color }} /> {group.name}
            </b>
            <em>
              {people} {people === 1 ? 'person' : 'people'} · {area ? (group.leaving ? `leaving ${area.name} for ${group.leaving.to}` : area.name) : party ? `on the road to ${party.to.name}` : ''}
            </em>
          </button>
        ))}
      </div>

      <div className="evo-sub">Places ({globe.areas.length})</div>
      <div className="sv-people">
        {globe.areas.map((a) => {
          const here = groups.filter((x) => x.area === a)
          return (
            <button key={a.id} className="sv-person-row" onClick={() => setPick({ kind: 'area', id: a.id })} data-sv-place={a.id}>
              <b>{a.name}</b>
              <em>
                {here.length ? here.map((x) => x.group.name).join(', ') : 'Nobody'} · {a.world.walkers.length} walkers
              </em>
            </button>
          )
        })}
      </div>
      <p className="evo-hint">Drag to spin the globe and scroll to zoom. Click land to open a new place; double-click a place to go down to it.</p>
    </div>
  )
}

function AreaCard({ globe, id, onEnter }: { globe: Globe; id: number; onEnter: (areaId: number, groupId?: number) => void }) {
  const a = areaById(globe, id)
  if (!a) return null
  const here = allGroups(globe).filter((x) => x.area === a)
  return (
    <div className="evo-card" data-sv-area-card>
      <h4>
        <MapPin size={13} /> {a.name}
      </h4>
      <p className="muted">
        {a.world.map.region} · {a.world.map.towns.map((t) => t.name).join(', ')}
      </p>
      <p className="muted">
        {here.length ? `${here.length} group${here.length === 1 ? '' : 's'}` : 'Nobody here'} · {a.world.walkers.length} walkers · {a.world.fallen.length} dead so far
      </p>
      <div className="sv-people">
        {here.map(({ group, people }) => (
          <button key={group.id} className="sv-person-row" onClick={() => onEnter(a.id, group.id)}>
            <b>
              <i className="evo-dot" style={{ background: group.color }} /> {group.name}
            </b>
            <em>{people} people</em>
          </button>
        ))}
      </div>
      <button className="btn btn-primary" onClick={() => onEnter(a.id)} data-sv-enter>
        <Navigation size={13} /> Go down there
      </button>
    </div>
  )
}
