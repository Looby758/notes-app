import { useState, type FormEvent } from 'react'
import { Check, Download, Link2, Music, X } from 'lucide-react'
import { cancelMp3, forgetMp3, saveMp3, useMusicLinks, type MusicLinkJob } from '../../store/musicLink'
import './saveMp3.css'

/**
 * Paste a link, get the song as an MP3 in your music folder: a small panel used by the YouTube
 * window and the Music page. The same downloader as the Downloads page does the work.
 */
export default function SaveMp3({ link: suggested, onClose }: { link?: string; onClose?: () => void }) {
  const [link, setLink] = useState('')
  const jobs = useMusicLinks((s) => s.jobs)
  const submit = (e: FormEvent): void => {
    e.preventDefault()
    const next = link.trim() || suggested
    if (!next) return
    void saveMp3(next)
    setLink('')
  }
  return (
    <div className="save-mp3" data-save-mp3>
      <form onSubmit={submit}>
        <Link2 size={13} />
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder={suggested ? 'This video, or paste another link' : 'Paste a YouTube link'}
          spellCheck={false}
          autoFocus
          onKeyDown={(e) => e.key === 'Escape' && onClose?.()}
          data-save-mp3-link
        />
        <button className="btn btn-primary" type="submit" disabled={!link.trim() && !suggested} data-save-mp3-go>
          <Download size={13} /> Save MP3
        </button>
        {onClose && (
          <button type="button" className="icon-btn" onClick={onClose} title="Close">
            <X size={13} />
          </button>
        )}
      </form>
      {jobs.length === 0 ? (
        <p className="save-mp3-note">Goes straight into your music folder, with the song’s name, artist and cover filled in when it can find them.</p>
      ) : (
        <ul>
          {jobs.map((j) => (
            <JobRow key={j.id} job={j} />
          ))}
        </ul>
      )}
    </div>
  )
}

function JobRow({ job }: { job: MusicLinkJob }) {
  const working = job.stage === 'downloading' || job.stage === 'details'
  const name = job.title ? `${job.artist ? `${job.artist} – ` : ''}${job.title}` : job.link
  let status: string
  if (job.stage === 'downloading') status = typeof job.done === 'number' ? `Downloading ${Math.round(job.done * 100)}%` : 'Getting ready…'
  else if (job.stage === 'details') status = 'Finding its details and cover…'
  else if (job.stage === 'done') status = job.matched ? 'In your music, with its cover' : 'In your music'
  else if (job.stage === 'cancelled') status = 'Stopped'
  else status = job.error ?? 'Didn’t work'
  return (
    <li className={`save-mp3-job ${job.stage}`} data-save-mp3-job={job.stage}>
      <span className="save-mp3-icon">{job.stage === 'done' ? <Check size={13} /> : <Music size={13} />}</span>
      <span className="save-mp3-text">
        <strong title={name}>{name}</strong>
        <em>{status}</em>
        {job.stage === 'downloading' && typeof job.done === 'number' && (
          <span className="save-mp3-bar">
            <i style={{ width: `${Math.round(job.done * 100)}%` }} />
          </span>
        )}
      </span>
      <button className="icon-btn" onClick={() => (working ? void cancelMp3(job.id) : forgetMp3(job.id))} title={working ? 'Stop' : 'Clear'}>
        <X size={12} />
      </button>
    </li>
  )
}
