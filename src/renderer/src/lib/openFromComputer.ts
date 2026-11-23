import { isComicBookFile } from '@shared/comics'
import { isVideoFile } from '@shared/videoPlayer'
import { openComicFile } from '../store/comics'
import { openVideo } from '../store/videoPlayer'
import { featureOn, notAddedText } from './addons'
import { notify } from '../store/notify'
import { openAddons } from './editorController'
import { showInFiles } from '../store/filesReveal'

/**
 * A file opened with "Open in Orbit" from File Explorer or Finder (its full path): videos play in
 * the video player, comics open in the comic reader, and anything else (zips, RARs, 7z…) shows in
 * the Files tab, where its preview shows what's inside.
 */
export function openFromComputer(path: string): void {
  // Each needs its add-on; without it Orbit says which one to add.
  const needs = isVideoFile(path) ? 'video' : isComicBookFile(path) ? 'comics' : 'explorer'
  if (!featureOn(needs)) return notify(notAddedText(needs), 'info', { label: 'Add-ons', run: openAddons })
  if (needs === 'video') openVideo(path)
  else if (needs === 'comics') void openComicFile(path)
  else showInFiles(path)
}
