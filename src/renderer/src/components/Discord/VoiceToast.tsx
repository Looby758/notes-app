import './voicePopout.css'
import { useEffect } from 'react'
import { Headphones, X } from 'lucide-react'
import { useDiscord, watchDiscord } from '../../store/discord'

/**
 * The small note in the corner when you join a voice call (#discord-toast; main/discordPopout.ts
 * places it and closes it after a few seconds). It never takes the focus and needs no answer.
 */
export default function VoiceToast() {
  useEffect(watchDiscord, [])
  const channel = useDiscord((s) => s.channel)
  return (
    <div className="vt" onPointerEnter={() => void window.api.discordToastHover(true)} onPointerLeave={() => void window.api.discordToastHover(false)}>
      <Headphones size={16} className="vt-icon" />
      <div className="vt-text">
        <b>{channel ? channel.name : 'In a voice call'}</b>
        <span>Pop out the call?</span>
      </div>
      <button className="btn btn-primary vt-yes" onClick={() => void window.api.discordToastAnswer(true)}>
        Pop out
      </button>
      <button className="icon-btn" title="Not now" onClick={() => void window.api.discordToastAnswer(false)}>
        <X size={14} />
      </button>
    </div>
  )
}
