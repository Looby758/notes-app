import './share.css'
import { useEffect, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react'
import type { ShareSide } from '@shared/mouseShare'

const ARROWS = { left: ArrowLeft, right: ArrowRight, above: ArrowUp, below: ArrowDown }

/**
 * The strip along the screen edge that appears while you drag something to it (mouse sharing):
 * drop files on it and they go to the other computer's Downloads.
 */
export default function ShareDrop() {
  const [info, setInfo] = useState<{ name: string; side: ShareSide }>({ name: 'the other computer', side: 'right' })
  const [over, setOver] = useState(false)
  const [notFiles, setNotFiles] = useState(false)

  useEffect(
    () =>
      window.api.onShareDrop((i) => {
        setInfo(i)
        setOver(false)
        setNotFiles(false)
      }),
    []
  )

  const Arrow = ARROWS[info.side]
  const across = info.side === 'above' || info.side === 'below'
  return (
    <div
      className={`share-drop ${over ? 'over' : ''} ${across ? 'across' : ''} side-${info.side}`}
      onDragEnter={(e) => {
        e.preventDefault()
        setOver(true)
        setNotFiles(!e.dataTransfer.types.includes('Files'))
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean)
        if (paths.length) window.api.shareDropped(paths)
        else window.api.shareDropCancel()
      }}
    >
      <Arrow size={26} />
      <span>{notFiles ? 'Only files can go across' : `Drop to send to ${info.name}`}</span>
    </div>
  )
}
