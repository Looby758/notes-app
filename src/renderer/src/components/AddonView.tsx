import { useEffect, useState, type ComponentType } from 'react'
import { Download, Puzzle, RotateCw } from 'lucide-react'
import { addonById } from '@shared/addons'
import { loadAddon } from '../lib/addonHost'
import { useAddonFile } from '../store/addonFiles'

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/**
 * A page that comes from a downloaded add-on: shows the download while it happens, then the
 * add-on's own page (its default export).
 */
export default function AddonView({ id }: { id: string }) {
  const file = useAddonFile(id)
  const name = addonById(id)?.name ?? 'This add-on'
  const [Page, setPage] = useState<ComponentType | null>(null)
  const [error, setError] = useState('')
  const ready = file?.state === 'ready'

  useEffect(() => {
    if (!ready || Page) return
    let live = true
    loadAddon(id).then(
      (mod) => live && setPage(() => mod.default as ComponentType),
      (err: Error) => live && setError(err.message)
    )
    return () => {
      live = false
    }
  }, [id, ready, Page])

  if (Page) return <Page />
  const failed = file?.state === 'failed' ? file.error : error
  return (
    <div className="addon-missing" data-addon-view={id}>
      {failed ? <Puzzle size={28} /> : <Download size={28} />}
      {failed ? (
        <>
          <h2>Couldn’t get {name}</h2>
          <p>{failed[0].toUpperCase() + failed.slice(1)}.</p>
          <div className="addon-missing-actions">
            <button
              className="btn btn-primary"
              onClick={() => {
                setError('')
                void window.api.retryAddonDownload(id)
              }}
            >
              <RotateCw size={14} /> Try again
            </button>
          </div>
        </>
      ) : (
        <>
          <h2>{file?.state === 'downloading' ? `Downloading ${name}…` : `Getting ${name} ready…`}</h2>
          <p>{file?.state === 'downloading' && file.total ? `${mb(file.received)} of ${mb(file.total)}` : ' '}</p>
        </>
      )}
    </div>
  )
}
