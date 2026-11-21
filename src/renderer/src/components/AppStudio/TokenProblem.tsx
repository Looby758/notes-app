import { ExternalLink, X } from 'lucide-react'
import { newTokenUrl } from '@shared/appStudio'
import { setGithub, setSection } from '../../store/appStudio'
import { notify } from '../../store/notify'

/**
 * GitHub said the token can't do that (a fine-grained token without the permission, or without
 * the repository): what it needs, a link to make one with it already ticked, and a way to swap it.
 */
export default function TokenProblem({ message, owner, onDone }: { message: string; owner?: string; onDone: () => void }) {
  const change = (): void => {
    void window.api
      .appsClearToken()
      .then((status) => {
        setGithub(status)
        setSection('pulls')
        onDone()
        document.querySelector('.appstudio-github input')?.scrollIntoView({ block: 'center' })
        ;(document.querySelector('.appstudio-github input') as HTMLInputElement | null)?.focus()
      })
      .catch(notify)
  }
  return (
    <div className="appstudio-token-problem">
      <p>{message}</p>
      <div className="appstudio-pull-actions">
        <a className="btn btn-primary" href={newTokenUrl(owner)} target="_blank" rel="noreferrer" title="Opens GitHub with Pull requests and Contents already set to Read and write">
          <ExternalLink size={13} /> Make a new token
        </a>
        <button className="btn" onClick={change} title="Disconnects the old token so you can paste the new one">
          Paste the new token
        </button>
        <button className="icon-btn" title="Hide" onClick={onDone}>
          <X size={13} />
        </button>
      </div>
    </div>
  )
}
