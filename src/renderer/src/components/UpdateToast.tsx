import { useEffect } from 'react'
import { Download, X } from 'lucide-react'
import { useUpdates, watchUpdates } from '../store/updates'

/** A small card in the corner when a new version is ready (Windows) or out (Mac). */
export default function UpdateToast() {
  const status = useUpdates((s) => s.status)
  const dismissed = useUpdates((s) => s.dismissed)

  useEffect(() => watchUpdates(), [])

  if (!status?.version || status.version === dismissed) return null
  const ready = status.state === 'ready'
  const manual = status.state === 'available' && status.manual
  if (!ready && !manual) return null

  return (
    <div className="update-toast" role="status" data-update-toast>
      <Download size={16} className="update-toast-icon" />
      <div className="update-toast-text">
        <strong>Notes {status.version} is {ready ? 'ready' : 'out'}</strong>
        <span>{ready ? 'Restart to update. Your notes are saved first.' : 'Download it to update.'}</span>
      </div>
      <button className="btn btn-primary" onClick={() => window.api.installUpdate()}>
        {ready ? 'Restart' : 'Download'}
      </button>
      <button className="icon-btn" title="Later" onClick={() => useUpdates.setState({ dismissed: status.version! })}>
        <X size={14} />
      </button>
    </div>
  )
}
