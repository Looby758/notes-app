import { useState, type ReactNode } from 'react'
import { ListPlus, Music } from 'lucide-react'
import type { MusicItem } from '@shared/spotify'
import { musicAddToQueue, musicPlay } from '../../store/music'

/** Album picture, or a note when there isn't one. */
export const ItemArt = ({ art }: { art?: string }) => <span className="music-item-art">{art ? <img src={art} alt="" /> : <Music size={14} />}</span>

/**
 * Songs, playlists or albums to play. `queueable`: songs get a + to play them next. `onPlay` replaces
 * playing the item on its own (a song within its playlist, say); `actions` adds buttons to a row.
 */
export function ItemList({
  items,
  queueable,
  onPlay,
  actions
}: {
  items: MusicItem[]
  queueable?: boolean
  onPlay?: (item: MusicItem, index: number) => Promise<unknown>
  actions?: (item: MusicItem, index: number) => ReactNode
}) {
  const [playing, setPlaying] = useState<string | null>(null)
  const [queued, setQueued] = useState<string[]>([])
  return (
    <ul className="music-items">
      {items.map((item, i) => (
        // The queue (and a playlist) can hold the same song twice.
        <li key={`${item.uri}:${i}`}>
          <button
            className={playing === item.uri ? 'active' : ''}
            onClick={async () => {
              setPlaying(item.uri)
              await (onPlay ? onPlay(item, i) : musicPlay(item.uri))
            }}
            title={`Play ${item.name}`}
          >
            <ItemArt art={item.art} />
            <span className="music-item-text">
              <strong>{item.name}</strong>
              <span>{item.detail}</span>
            </span>
          </button>
          {actions?.(item, i)}
          {queueable && item.kind === 'track' && (
            <button
              className={`icon-btn music-row-btn ${queued.includes(item.uri) ? 'done' : ''}`}
              onClick={async () => {
                if (await musicAddToQueue(item.uri)) setQueued((q) => [...q, item.uri])
              }}
              title={queued.includes(item.uri) ? 'Added to the queue' : 'Play next (add to the queue)'}
              data-music-queue-add
            >
              <ListPlus size={14} />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
