import { File, FileCode, FileImage, FileMusic, FileSpreadsheet, FileText, FileVideo, LayoutDashboard } from 'lucide-react'
import { fileKind } from '../lib/fileKinds'

/** An icon for a non-note file, by its kind. */
export default function FileIcon({ path, size = 15, className }: { path: string; size?: number; className?: string }) {
  const Icon = { image: FileImage, audio: FileMusic, video: FileVideo, pdf: FileText, sheet: FileSpreadsheet, board: LayoutDashboard, text: FileCode, other: File }[fileKind(path)]
  return <Icon size={size} className={className} />
}
