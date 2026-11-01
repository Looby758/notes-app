import { useEffect, useRef } from 'react'
import VideoPage from './VideoPage'
import { useVideoPlayer } from '../../store/videoPlayer'
import { useNotify } from '../../store/notify'

/**
 * The video player's own window ("Pop out" in the player): one video, which can go full screen on
 * its screen while you carry on using Orbit. Going back to the list of videos closes it.
 */
export default function VideoWindow() {
  const current = useVideoPlayer((s) => s.current)
  const message = useNotify((s) => s.message)
  const hadOne = useRef(false)

  useEffect(() => {
    void window.api.videoWindowCurrent().then((path) => path && useVideoPlayer.setState({ current: path }))
    return window.api.onVideoWindow((event, path) => event === 'play' && useVideoPlayer.setState({ current: path }))
  }, [])

  useEffect(() => {
    if (current) {
      hadOne.current = true
      document.title = current.slice(Math.max(current.lastIndexOf('/'), current.lastIndexOf('\\')) + 1)
    } else if (hadOne.current) window.close()
  }, [current])

  return (
    <div className="video-window">
      {current && <VideoPage autoFocus />}
      {message && <div className="video-window-toast">{message}</div>}
    </div>
  )
}
