import { app } from 'electron'
import { basename, dirname } from 'path'

/**
 * A test copy: Orbit started from its code (`npm run dev`, or App Studio's Try it on Orbit itself)
 * rather than installed. It keeps its own settings and data in "Orbit Test Copy", so it runs next to
 * your normal Orbit (only one copy of each may run) and never touches your real notes or settings.
 */
export const TEST_COPY = !app.isPackaged

/**
 * App Studio's test copies of Orbit (a pull request's version, in "notes-app-test-copies/<branch>")
 * each get a data folder of their own, so several can run side by side.
 */
const copyOf = (dir: string): string | null => (/-test-copies$/.test(basename(dirname(dir))) ? basename(dir) : null)
const copy = TEST_COPY ? copyOf(app.getAppPath()) : null

export const TEST_COPY_FOLDER = copy ? `Orbit Test Copy (${copy})` : 'Orbit Test Copy'
