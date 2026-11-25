import './music.css'
import { useEffect } from 'react'
import { startMusic } from '../../store/music'
import { watchSongIdShortcut } from '../../store/songId'
import { useAddonOn } from '../../lib/addons'
import { addHomeCard } from '../../lib/home'
import MusicHomeCard from './MusicHomeCard'
import { SongPopup } from './SongPopup'
import { FullPlayer } from './FullPlayer'

addHomeCard({ id: 'music', order: 35, title: 'Now playing', Card: MusicHomeCard })

/**
 * What the Music add-on keeps running behind every page: keeping "now playing" up to date, the
 * song popup, the full-screen player and the "What's this song?" shortcut. The songs themselves
 * live on the Music page.
 */
export default function MusicHost() {
  useEffect(() => startMusic(), [])
  const songIdOn = useAddonOn('songid')
  useEffect(() => (songIdOn ? watchSongIdShortcut() : undefined), [songIdOn])
  return (
    <>
      <SongPopup />
      <FullPlayer />
    </>
  )
}
