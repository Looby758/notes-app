import { CalendarDays, FilePlus, FolderPlus, FolderTree, GitCompare, Hash, LayoutDashboard, Search } from 'lucide-react'
import { useVault } from '../../store/vault'
import { useNotify } from '../../store/notify'
import { showSidebarView, useUI, type SidebarView } from '../../store/ui'
import FileTree from './FileTree'
import StarredSection from './StarredSection'
import SavedSearches from './SavedSearches'
import { useConflicts } from '../Conflicts/ConflictsPage'
import { CONFLICTS_TAB, openSpecialTab } from '../../lib/editorController'
import SearchPane from './SearchPane'
import TagsPane from './TagsPane'
import BulkBar from './BulkBar'
import { showKeys } from '@shared/platform'
import { newBoard } from '../../lib/boards'
import ThemePicture from '../Theme/ThemePicture'
import { dailyPath, openToday } from '../../lib/daily'
import { findNode } from '../../lib/paths'

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
      <ThemePicture page="sidebar" exact />
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
            <TodayButton />
            <button className="icon-btn" title={`New note (${showKeys('Ctrl+N')})`} onClick={() => newNote()}>
              <FilePlus size={15} />
            </button>
            <button className="icon-btn" title="New canvas board" onClick={() => newBoard()}>
              <LayoutDashboard size={15} />
            </button>
            <button className="icon-btn" title={`New folder (${showKeys('Ctrl+Shift+N')})`} onClick={() => newFolder()}>
              <FolderPlus size={15} />
            </button>
          </div>
        )}
      </div>
      {view === 'files' && (
        <>
          <ConflictsNotice />
          <SavedSearches />
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

/** "2 notes have sync copies": shown above the file list when Google Drive made "(1)" copies. */
function ConflictsNotice() {
  const pairs = useConflicts()
  if (pairs.length === 0) return null
  return (
    <button className="conflicts-notice" onClick={() => openSpecialTab(CONFLICTS_TAB)} data-conflicts-notice>
      <GitCompare size={13} />
      {pairs.length === 1 ? '1 note has a sync copy' : `${pairs.length} notes have sync copies`}
      <span>Review</span>
    </button>
  )
}
/** Opens today's daily note, making it first if there isn't one yet. */
function TodayButton() {
  const tree = useVault((s) => s.tree)
  const made = findNode(tree, dailyPath(new Date()))?.type === 'file'
  return (
    <button className="icon-btn" title={`${made ? 'Open' : 'Create'} today’s note (${showKeys('Ctrl+Shift+D')})`} onClick={() => void openToday()} data-today-note>
      <CalendarDays size={15} />
    </button>
  )
}
