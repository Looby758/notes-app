import './ai.css'
import { Copy, Loader2, Sparkles } from 'lucide-react'
import { applyNoteJob, useAi } from '../../store/ai'
import { notify } from '../../store/notify'
import { openSpecialTab, SETTINGS_TAB } from '../../lib/editorController'
import { noteTitle } from '../../lib/paths'
import { openAiSettings } from './AiSettings'

/** "Summarise this note" / "Tidy up this note": shows Claude's result, and changes the note only if you say so. */
export default function AiDialog({ close }: { close: () => void }) {
  const job = useAi((s) => s.job)
  if (!job) return null
  const summary = job.kind === 'summary'
  const done = (): void => {
    useAi.setState({ job: null })
    close()
  }

  return (
    <div className="export-dialog ai-dialog" data-ai-dialog={job.kind} onKeyDown={(e) => e.key === 'Escape' && done()}>
      <div className="export-head">
        <Sparkles size={18} />
        <div>
          <h2>{summary ? 'Summary' : 'Tidied up'}</h2>
          <p>{noteTitle(job.path)}</p>
        </div>
      </div>

      {job.state === 'working' && (
        <p className="ai-working">
          <Loader2 size={14} className="spin" /> {summary ? 'Reading the note…' : 'Tidying up…'}
        </p>
      )}
      {job.state === 'nokey' && (
        <p className="export-note">
          The AI helper needs the offline AI (a free download that runs on this computer) or your own Anthropic API key first.
          Both are in Settings → AI helper, and you only set it up once.
        </p>
      )}
      {job.state === 'error' && <p className="setting-warning">{job.error}</p>}
      {job.state === 'done' && (
        <>
          <div className="ai-result" data-ai-result>
            {job.result}
          </div>
          <p className="export-note">
            {summary
              ? 'Add it to the top of the note, or copy it. You can undo with Ctrl+Z.'
              : 'Nothing has changed yet. Replace the note with this version, or keep the original. You can undo with Ctrl+Z.'}
          </p>
        </>
      )}

      <div className="export-foot">
        <button className="btn" onClick={done} autoFocus={job.state !== 'done'}>
          {job.state === 'done' ? (summary ? 'Close' : 'Keep original') : 'Close'}
        </button>
        {job.state === 'nokey' && (
          <button
            className="btn btn-primary"
            onClick={() => {
              done()
              openSpecialTab(SETTINGS_TAB)
              openAiSettings()
            }}
          >
            Set up the AI helper
          </button>
        )}
        {job.state === 'done' && (
          <>
            <button
              className="btn"
              onClick={() => {
                navigator.clipboard.writeText(job.result!)
                notify('Copied', 'info')
              }}
            >
              <Copy size={13} /> Copy
            </button>
            <button
              className="btn btn-primary"
              autoFocus
              data-ai-apply
              onClick={() => {
                if (applyNoteJob()) close()
                else notify('Open the note first, then try again.')
              }}
            >
              {summary ? 'Add to note' : 'Replace note'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
