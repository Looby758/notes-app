import { create } from 'zustand'

/** The folder each Files tab is showing, so its tab can be named after it. */
export const useExplorerTabs = create<{ dirs: Record<string, string> }>(() => ({ dirs: {} }))

export const setExplorerTabDir = (tab: string, dir: string): void => {
  if (useExplorerTabs.getState().dirs[tab] !== dir) useExplorerTabs.setState((s) => ({ dirs: { ...s.dirs, [tab]: dir } }))
}
