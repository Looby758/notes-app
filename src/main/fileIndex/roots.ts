import { join } from 'path'

/** Where the Whole PC list starts and where it's saved (the main process's side; rules.ts is the worker's). */

/** Where Whole PC search starts from: every drive on Windows; on a Mac the home folder, Applications and other drives. */
export function rootsFor(platform: NodeJS.Platform, home: string, drives: string[]): string[] {
  if (platform === 'win32') return drives
  if (platform === 'darwin') return [home, '/Applications', ...drives.filter((d) => d.startsWith('/Volumes/'))]
  return [home]
}

export const indexFile = (userData: string): string => join(userData, 'file-index.json.gz')
