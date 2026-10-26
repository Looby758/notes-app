import { FilePlus, FolderPlus, FolderTree, Hash, Search } from 'lucide-react'
import { useVault } from '../../store/vault'
import { useNotify } from '../../store/notify'
import { showSidebarView, useUI, type SidebarView } from '../../store/ui'
import FileTree from './FileTree'
import StarredSection from './StarredSection'
import SearchPane from './SearchPane'
import TagsPane from './TagsPane'
import BulkBar from './BulkBar'
import { showKeys } from '@shared/platform'

const VIEWS: { id: SidebarView; title: string; icon: typeof Search }[] = [
  { id: 'files', title: `Files (${showKeys('Ctrl+Shift+E')})`, icon: FolderTree },
  { id: 'search', title: `Search (${showKeys('Ctrl+Shift+F')})`, icon: Search },
  { id: 'tags', title: 'Tags', icon: Hash }
]

export default function Sidebar() {
  const view = useUI((s) => s.sidebarView)
  const error = useNotify((s) => s.message)
  const kind = useNotify((s) => s.kind)
  const { newNote, newFolder } = useVault.getState()

  return (
    <div className="sidebar-inner">
      <div className="panel-header">
        <div className="view-switch">
          {VIEWS.map(({ id, title, icon: Icon }) => (
            <button
              key={id}
              className={`icon-btn ${view === id ? 'active selected' : ''}`}
              title={title}
              onClick={() => showSidebarView(id)}
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
        {view === 'files' && (
          <div className="panel-actions">
            <button className="icon-btn" title={`New note (${showKeys('Ctrl+N')})`} onClick={() => newNote()}>
              <FilePlus size={15} />
            </button>
            <button className="icon-btn" title={`New folder (${showKeys('Ctrl+Shift+N')})`} onClick={() => newFolder()}>
              <FolderPlus size={15} />
            </button>
          </div>
        )}
      </div>
      {view === 'files' && (
        <>
          <StarredSection />
          <FileTree />
        </>
      )}
      {view === 'search' && <SearchPane />}
      {view === 'tags' && <TagsPane />}
      {view !== 'tags' && <BulkBar />}
      {error && <div className={`toast ${kind}`}>{error}</div>}
    </div>
  )
}
