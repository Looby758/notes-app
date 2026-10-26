import { FolderOpen, NotebookPen } from 'lucide-react'

interface Props {
  onPick: () => void
}

export default function WelcomeScreen({ onPick }: Props) {
  return (
    <div className="welcome">
      <div className="titlebar-drag" />
      <div className="welcome-card">
        <div className="welcome-icon">
          <NotebookPen size={28} strokeWidth={1.6} />
        </div>
        <h1>Notes</h1>
        <p>
          Your notes are plain markdown files in a folder you choose. To sync with Google Drive, pick a
          folder inside your Drive (for example <code>G:\My Drive\Notes</code>).
        </p>
        <button className="btn btn-primary" onClick={onPick} autoFocus>
          <FolderOpen size={16} />
          Choose notes folder
        </button>
        <span className="welcome-hint">You can create a new folder from the picker.</span>
      </div>
    </div>
  )
}
