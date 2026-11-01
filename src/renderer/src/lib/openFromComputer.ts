import { isComicBookFile } from '@shared/comics'
import { isVideoFile } from '@shared/videoPlayer'
import { openComicFile } from '../store/comics'
import { openVideo } from '../store/videoPlayer'
import { showInFiles } from '../store/filesReveal'

/**
 * A file opened with "Open in Orbit" from File Explorer or Finder (its full path): videos play in
 * the video player, comics open in the comic reader, and anything else (zips, RARs, 7z…) shows in
 * the Files tab, where its preview shows what's inside.
 */
export function openFromComputer(path: string): void {
  if (isVideoFile(path)) openVideo(path)
  else if (isComicBookFile(path)) void openComicFile(path)
  else showInFiles(path)
}
