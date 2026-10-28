import { openFileTab } from './editorController'
import { writeWorkbook } from './sheets'
import { useVault } from '../store/vault'
import { notify } from '../store/notify'

/** Makes a new, empty "Untitled sheet.xlsx" (in the selected folder, or `folder`), opens it and starts renaming it. */
export async function newSpreadsheet(folder?: string): Promise<void> {
  try {
    const vault = useVault.getState()
    const dir = vault.targetFolder(folder)
    const data = await writeWorkbook([{ name: 'Sheet1', rows: [], cols: 0 }], () => '')
    const path = await window.api.saveAttachment(dir, 'Untitled sheet.xlsx', data)
    vault.expandTo(dir)
    await vault.refresh()
    useVault.setState({ selected: path, renaming: path })
    openFileTab(path)
  } catch (err) {
    notify(err)
  }
}
