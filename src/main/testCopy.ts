import { app } from 'electron'

/**
 * A test copy: Orbit started from its code (`npm run dev`, or App Studio's Try it on Orbit itself)
 * rather than installed. It keeps its own settings and data in "Orbit Test Copy", so it runs next to
 * your normal Orbit (only one copy of each may run) and never touches your real notes or settings.
 */
export const TEST_COPY = !app.isPackaged

export const TEST_COPY_FOLDER = 'Orbit Test Copy'
