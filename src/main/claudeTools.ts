import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { appMatches, CARD_COLUMNS, redactSecrets, studioErrorsFor, studioErrorText, type ClaudeArea, type StudioError } from '@shared/claudeDesktop'
import type { AppInfo } from '@shared/appStudio'
import type { BuildStatus, MainStatus } from '@shared/releaseCheck'
import type { ReleaseMemory } from './studioErrors'

/**
 * What Claude Desktop can ask Orbit (the tools of the connection in claudeDesktop.ts). App
 * Studio's problems and release checks are answered here in the main process; everything else is
 * asked of Orbit's window, which has your notes, calendar and the rest loaded (the same way the
 * phone remote asks it to play music). Only the parts switched on in Settings are offered, and
 * every answer has anything that looks like a password or token blanked out.
 */

export interface ToolDeps {
  areas: Record<ClaudeArea, boolean>
  /** Asks Orbit's window; the answer is text for Claude. */
  ask(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<string>
  errors(): StudioError[]
  /** Folders the release helper has looked at since Orbit started. */
  knownFolders(): string[]
  memory(folder: string): ReleaseMemory
  look(folder: string): Promise<{ info: AppInfo; main?: MainStatus; build?: BuildStatus; busy?: boolean }>
}

const text = (t: string): CallToolResult => ({ content: [{ type: 'text', text: redactSecrets(t) }] })
const failed = (err: unknown): CallToolResult => ({ content: [{ type: 'text', text: redactSecrets(err instanceof Error ? err.message : String(err)) }], isError: true })

/** Runs a tool, turning a failure into a message Claude can read (and pass on). */
const safely =
  <A>(fn: (args: A) => Promise<string> | string) =>
  async (args: A): Promise<CallToolResult> => {
    try {
      return text(await fn(args))
    } catch (err) {
      return failed(err)
    }
  }

const READ = { readOnlyHint: true, openWorldHint: false } as const
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const

// ---------- App Studio ----------

interface StudioApp {
  name: string
  folder: string
  repo?: string
}

/** The App Studio apps Orbit knows: the window's list, plus any folder the release helper has seen. */
async function studioApps(deps: ToolDeps): Promise<StudioApp[]> {
  let listed: StudioApp[] = []
  try {
    const raw = JSON.parse(await deps.ask('apps.list', {})) as unknown
    if (Array.isArray(raw)) listed = raw.filter((a): a is StudioApp => !!a && typeof a.name === 'string' && typeof a.folder === 'string')
  } catch {
    // The window can't say: the folders seen are still known.
  }
  const seen = deps.knownFolders().filter((f) => !listed.some((a) => a.folder === f))
  return [...listed, ...seen.map((folder) => ({ name: folder.split(/[\\/]/).filter(Boolean).pop() ?? folder, folder }))]
}

async function findApp(deps: ToolDeps, want: string): Promise<StudioApp> {
  const apps = await studioApps(deps)
  const found = apps.filter((a) => appMatches(want, a))
  if (found.length === 1) return found[0]
  if (!apps.length) throw new Error('App Studio has no apps yet. Add one in Orbit’s App Studio first.')
  if (found.length > 1) throw new Error(`More than one app is called “${want}”: ${found.map((a) => a.folder).join(', ')}. Ask about it by its GitHub repository (owner/name).`)
  throw new Error(`App Studio has no app called “${want}”. Its apps are: ${apps.map((a) => (a.repo ? `${a.name} (${a.repo})` : a.name)).join(', ')}.`)
}

const ago = (iso: string): string => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000)
  return mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`
}

/** What the release helper says about an app, as Claude reads it. */
export function releaseStatusText(app: StudioApp, look: Awaited<ReturnType<ToolDeps['look']>>, memory: ReleaseMemory): string {
  const { info, main, build } = look
  const out: string[] = [`App: ${app.name}${info.repo ? ` (${info.repo})` : ''}`, `Folder: ${app.folder}`]
  if (info.error) out.push(`Problem reading it: ${info.error}`)
  if (info.version) out.push(`Version in package.json: ${info.version}`)
  if (info.branch) out.push(`On branch: ${info.branch}${info.changedFiles ? `, ${info.changedFiles} changed file(s) not committed` : ''}`)
  if (info.lastChange) out.push(`Last commit: “${info.lastChange.subject}” by ${info.lastChange.author}, ${info.lastChange.date}`)
  if (look.busy) out.push('The release helper is busy with this app right now (a release or a fix is running), so it wasn’t checked again.')
  if (main) {
    if (!main.linked) out.push('Not linked to GitHub.')
    else if (main.problem) out.push(`Compared with GitHub’s ${main.main}: ${main.problem}`)
    else out.push(`Compared with GitHub’s ${main.main}: ${main.behind} commit(s) behind, ${main.ahead} ahead.`)
  }
  if (build) {
    const run = build.run
    out.push(
      `GitHub’s build of ${build.tag}: ${run ? `${run.status}${run.conclusion ? ` (${run.conclusion})` : ''}, ${run.url}` : 'no build found'}${build.release ? `. Release: ${build.release.draft ? 'draft' : 'published'} ${build.release.url}` : ''}`
    )
    for (const j of run?.jobs ?? []) out.push(`  ${j.name}: ${j.conclusion ?? j.status}${j.failedStep ? ` (failed at “${j.failedStep}”)` : ''}`)
    if (build.problem) out.push(`Why it failed: ${build.problem.title}. ${build.problem.detail}`)
    if (build.error) out.push(`Couldn’t ask GitHub: ${build.error}`)
  } else if (memory.build) out.push(`GitHub’s build of ${memory.build.result.tag} (${ago(memory.build.at)}): ${memory.build.result.run?.conclusion ?? memory.build.result.run?.status ?? 'unknown'}`)
  if (memory.preflight) {
    const p = memory.preflight.result
    out.push('', `Last checks before releasing ${p.tag} (${ago(memory.preflight.at)}):`)
    for (const c of p.checks) {
      const tests = c.id === 'tests' && memory.tests ? memory.tests.result : c
      out.push(`  [${tests.state}] ${tests.label}: ${tests.text}`)
    }
  } else out.push('', 'The release checks haven’t been run since Orbit started. Open the app’s Releases in App Studio and press Check to run them.')
  if (memory.tests?.result.state === 'fail' && memory.tests.result.output) out.push('', 'End of the failing tests’ output:', memory.tests.result.output)
  if (memory.release) {
    const r = memory.release.result
    out.push('', `Last release (${ago(memory.release.at)}): ${r.ok ? `made ${r.tag}` : `didn’t finish at ${r.step}: ${r.problem?.title ?? ''}. ${r.problem?.detail ?? ''}`}`)
  }
  if (memory.fix) out.push(`Last fix tried (${ago(memory.fix.at)}): ${memory.fix.what}, ${memory.fix.result.ok ? 'worked' : 'didn’t work'}: ${memory.fix.result.message}`)
  return out.join('\n')
}

function appStudioTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'get_recent_errors',
    {
      title: 'App Studio’s recent problems',
      description:
        'The latest problems in Orbit’s App Studio (failed release checks, failing tests, failed releases, failed GitHub builds and git problems), newest first, each with the app, when, which step failed, Orbit’s explanation and the full output. Use this when the user says something went wrong in App Studio.',
      inputSchema: { app: z.string().optional().describe('Only this app: its GitHub repository (owner/name), its name or its folder name'), limit: z.number().int().min(1).max(20).optional().describe('How many (default 5)') },
      annotations: READ
    },
    safely(({ app, limit }: { app?: string; limit?: number }) => {
      const list = studioErrorsFor(deps.errors(), app).slice(0, limit ?? 5)
      if (!list.length) return app ? `No problems recorded for “${app}”.` : 'No App Studio problems recorded. (Orbit records them when the release helper runs.)'
      return list.map((e, i) => `#${i + 1}\n${studioErrorText(e)}`).join('\n\n==========\n\n')
    })
  )

  server.registerTool(
    'get_release_status',
    {
      title: 'What the release helper says',
      description:
        'What App Studio’s release helper currently says about one app: its version and branch, how it compares with GitHub, GitHub’s build of the current version (is it built yet?), and the last release checks, tests, release and fix. Checks again without changing anything.',
      inputSchema: { app: z.string().describe('The app: its GitHub repository (owner/name), its name or its folder name') },
      annotations: READ
    },
    safely(async ({ app }: { app: string }) => {
      const found = await findApp(deps, app)
      return releaseStatusText(found, await deps.look(found.folder), deps.memory(found.folder))
    })
  )

  server.registerTool(
    'list_apps',
    { title: 'App Studio’s apps', description: 'The apps in Orbit’s App Studio, with their folders and GitHub repositories.', inputSchema: {}, annotations: READ },
    safely(async () => {
      const apps = await studioApps(deps)
      return apps.length ? apps.map((a) => `${a.name}${a.repo ? ` (${a.repo})` : ''}: ${a.folder}`).join('\n') : 'App Studio has no apps yet.'
    })
  )

  server.registerTool(
    'get_board',
    {
      title: 'Ideas & bugs board',
      description: 'The cards on App Studio’s Ideas & bugs board that aren’t done: id, app, kind (idea or bug), title, details, column (ideas, building, testing, done) and any linked pull request.',
      inputSchema: { app: z.string().optional().describe('Only this app'), include_done: z.boolean().optional().describe('Include cards in Done too') },
      annotations: READ
    },
    safely(({ app, include_done }: { app?: string; include_done?: boolean }) => deps.ask('board.list', { app, includeDone: include_done === true }))
  )

  server.registerTool(
    'update_card',
    {
      title: 'Move a card or link its pull request',
      description: 'Moves a card on the Ideas & bugs board to another column, and/or links the pull request that fixed it. Use get_board for card ids.',
      inputSchema: {
        id: z.string().describe('The card’s id, from get_board'),
        column: z.enum(CARD_COLUMNS as [string, ...string[]]).optional().describe('ideas, building, testing or done'),
        pull: z.string().optional().describe('The pull request: owner/name#12, #12 or its GitHub address')
      },
      annotations: WRITE
    },
    safely(({ id, column, pull }: { id: string; column?: string; pull?: string }) => {
      if (!column && !pull) throw new Error('Say which column to move it to, or which pull request to link, or both.')
      return deps.ask('board.update', { id, column, pull })
    })
  )

  server.registerTool(
    'add_card',
    {
      title: 'Add an idea or bug card',
      description: 'Puts a new idea or bug card in the Ideas & bugs column of App Studio’s board, for one app.',
      inputSchema: {
        app: z.string().describe('The app it’s for'),
        kind: z.enum(['idea', 'bug']),
        title: z.string().min(1).max(200),
        details: z.string().max(10_000).optional()
      },
      annotations: WRITE
    },
    safely(async ({ app, kind, title, details }: { app: string; kind: 'idea' | 'bug'; title: string; details?: string }) => {
      const found = await findApp(deps, app)
      return deps.ask('board.add', { app: found.repo ?? found.name, kind, title, details: details ?? '' })
    })
  )
}

// ---------- Everything the window answers ----------

/** A tool that's answered by Orbit's window, under the same name. */
function windowTool(server: McpServer, deps: ToolDeps, name: string, config: { title: string; description: string; inputSchema: Record<string, z.ZodType>; write?: boolean; timeoutMs?: number }): void {
  server.registerTool(
    name,
    { title: config.title, description: config.description, inputSchema: config.inputSchema, annotations: config.write ? WRITE : READ },
    safely((args: Record<string, unknown>) => deps.ask(name, args ?? {}, config.timeoutMs))
  )
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date like 2026-11-25')
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'A 24-hour time like 09:30')

function notesTools(server: McpServer, deps: ToolDeps): void {
  windowTool(server, deps, 'search_notes', {
    title: 'Search notes',
    description: 'Finds notes in Orbit by words in their title or text (#tag works too). Gives each note’s path and the matching line. Locked notes are never included.',
    inputSchema: { query: z.string().min(1).describe('Words to look for, or #tag'), limit: z.number().int().min(1).max(50).optional() }
  })
  windowTool(server, deps, 'read_note', {
    title: 'Read a note',
    description: 'The full text of one note, by its path (from search_notes or list_notes). Locked notes can’t be read.',
    inputSchema: { path: z.string().min(1) }
  })
  windowTool(server, deps, 'list_notes', {
    title: 'List notes',
    description: 'The notes in a folder (and its folders), by path. Leave the folder out for all of them.',
    inputSchema: { folder: z.string().optional().describe('A folder in the notes, like "School/History"'), limit: z.number().int().min(1).max(500).optional() }
  })
  windowTool(server, deps, 'create_note', {
    title: 'Make a note',
    description: 'Makes a new note in Orbit. If a note with that name is already there, a number is added to the new one’s name.',
    inputSchema: {
      title: z.string().min(1).max(150).describe('The note’s name'),
      content: z.string().max(200_000).describe('Its text, in Markdown'),
      folder: z.string().optional().describe('The folder to put it in, like "Ideas" (made if it isn’t there). Leave out for the top of the notes.')
    },
    write: true
  })
  windowTool(server, deps, 'add_to_note', {
    title: 'Add to a note',
    description: 'Adds text to the end of an existing note.',
    inputSchema: { path: z.string().min(1), text: z.string().min(1).max(100_000) },
    write: true
  })
  windowTool(server, deps, 'edit_note', {
    title: 'Change a note',
    description:
      'Changes text in a note: replaces `find` (copied exactly from read_note) with `replace`, or with whole set, replaces all of the note’s text. The user can undo it with Ctrl+Z in Orbit. Read the note first.',
    inputSchema: {
      path: z.string().min(1),
      find: z.string().max(100_000).optional().describe('The exact text to change'),
      replace: z.string().max(200_000).describe('What to put instead (empty deletes it)'),
      all: z.boolean().optional().describe('Change every place `find` appears, not just one'),
      whole: z.boolean().optional().describe('Replace the whole note with `replace`')
    },
    write: true
  })
  windowTool(server, deps, 'rename_note', {
    title: 'Rename a note',
    description: 'Gives a note a new name (links to it are updated).',
    inputSchema: { path: z.string().min(1), name: z.string().min(1).max(120).describe('The new name, without .md') },
    write: true
  })
  windowTool(server, deps, 'move_note', {
    title: 'Move a note',
    description: 'Moves a note into another folder (made if it isn’t there; empty for the top of the notes). Links to it are updated.',
    inputSchema: { path: z.string().min(1), folder: z.string().describe('Like "School/History", or empty for the top') },
    write: true
  })
  windowTool(server, deps, 'delete_note', {
    title: 'Delete a note',
    description: 'Moves a note to Orbit’s bin, where the user can get it back. Check with the user before deleting unless they asked for it.',
    inputSchema: { path: z.string().min(1) },
    write: true
  })
}

function calendarTools(server: McpServer, deps: ToolDeps): void {
  windowTool(server, deps, 'get_calendar', {
    title: 'What’s on',
    description: 'Events and due tasks between two days: from Orbit’s own calendar (daily notes) and any connected Google or other calendars.',
    inputSchema: { from: day.optional().describe('First day (default today)'), to: day.optional().describe('Last day (default a week after the first)') }
  })
  windowTool(server, deps, 'add_calendar_event', {
    title: 'Add an event',
    description: 'Adds an event to Orbit’s calendar (in that day’s daily note). Leave out the times for an all-day event.',
    inputSchema: { date: day, title: z.string().min(1).max(200), start: time.optional(), end: time.optional() },
    write: true
  })
  windowTool(server, deps, 'get_countdowns', {
    title: 'Countdowns',
    description: 'The countdowns from Orbit’s Countdowns page, with how long is left until each.',
    inputSchema: {}
  })
  windowTool(server, deps, 'add_countdown', {
    title: 'Add a countdown',
    description:
      'Adds a countdown to Orbit’s Countdowns page. It needs what it’s counting down to and the date: if the user didn’t say the date (or it’s unclear which year), ask them before adding it. A time is optional (leave it out for the whole day). Birthdays and other things that come round every year should be yearly.',
    inputSchema: {
      title: z.string().min(1).max(80).describe('What it’s counting down to, like "Holiday to Spain"'),
      date: day.describe('The day, like 2026-12-20'),
      time: time.optional().describe('A 24-hour time on that day, like 18:00'),
      kind: z.enum(['season', 'game', 'trip', 'birthday', 'event', 'other']).optional().describe('season (a TV season), game (a game or update), trip, birthday, event or other'),
      yearly: z.boolean().optional().describe('Comes round every year on the same date')
    },
    write: true
  })
}

function moneyTools(server: McpServer, deps: ToolDeps): void {
  windowTool(server, deps, 'get_money', {
    title: 'Money',
    description: 'A summary of the user’s money in Orbit: the last few months’ spending by category, budgets, savings goals, repeating payments, balance and forecast, plus their entries (the ones matching the question first). Read-only.',
    inputSchema: { question: z.string().optional().describe('What they asked, so matching entries come first') }
  })
}

function flashcardTools(server: McpServer, deps: ToolDeps): void {
  windowTool(server, deps, 'get_flashcards', {
    title: 'Flashcards',
    description: 'Flashcards (lines written "Question :: Answer" in notes) with how each is going: due, and the ones they keep getting wrong first.',
    inputSchema: { folder: z.string().optional().describe('Only cards in notes in this folder or note path'), struggling: z.boolean().optional().describe('Only the ones they keep getting wrong') }
  })
  windowTool(server, deps, 'add_flashcards', {
    title: 'Add flashcards',
    description: 'Adds flashcards to a note (made if it isn’t there), each written "Question :: Answer" on its own line, which is how Orbit’s Flashcards page finds them.',
    inputSchema: {
      note: z.string().min(1).describe('The note’s path or name, like "Flashcards/History"'),
      cards: z.array(z.object({ question: z.string().min(1).max(500), answer: z.string().min(1).max(1000) })).min(1).max(200)
    },
    write: true
  })
}

function filesTools(server: McpServer, deps: ToolDeps): void {
  windowTool(server, deps, 'find_tagged_files', {
    title: 'Colour-tagged files',
    description: 'Files and folders the user colour-tagged in Orbit’s Files tab, newest change first, with when each last changed.',
    inputSchema: { colour: z.enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'grey']), changed_within_days: z.number().int().min(1).max(3650).optional() }
  })
  windowTool(server, deps, 'search_files', {
    title: 'Search files',
    description: 'Finds files on the computer by name, with Orbit’s Whole PC search (when it’s switched on in the Files tab).',
    inputSchema: { query: z.string().min(1) }
  })
  windowTool(server, deps, 'get_downloads', {
    title: 'Downloads',
    description: 'What Orbit’s download manager is downloading, waiting to download, and has finished or failed.',
    inputSchema: {}
  })
  windowTool(server, deps, 'get_drive_space', {
    title: 'Drive space',
    description: 'How full each drive on the computer is.',
    inputSchema: {}
  })
}

function musicTools(server: McpServer, deps: ToolDeps): void {
  windowTool(server, deps, 'get_now_playing', {
    title: 'What’s playing',
    description: 'The song playing in Orbit’s music player (Spotify or the user’s own music) and what’s up next.',
    inputSchema: {}
  })
  windowTool(server, deps, 'control_music', {
    title: 'Play, pause or skip',
    description: 'Presses a button on Orbit’s music player.',
    inputSchema: { action: z.enum(['play', 'pause', 'next', 'previous']) },
    write: true
  })
  windowTool(server, deps, 'play_music', {
    title: 'Play music',
    description:
      'Plays the user’s own music: a playlist (from the start, or from a chosen song and then on through the rest of the playlist), one song, or songs whose title, artist, album or genre match some words (like "chill"). Can also turn shuffle and looping on or off, on its own to change what’s playing. "Play X on loop": song X with loop "song". "Play my gym playlist shuffled on loop": playlist, shuffle true, loop "all".',
    inputSchema: {
      playlist: z.string().optional().describe('A playlist’s name ("Liked" for liked songs)'),
      song: z.string().optional().describe('A song, like "No One Left To Love" or "Lost Boys by Phoebe Bridgers". With a playlist: start from it and carry on through the playlist.'),
      search: z.string().optional().describe('Or words to match, like "chill" or "Arctic Monkeys"'),
      shuffle: z.boolean().optional(),
      loop: z.enum(['off', 'song', 'all']).optional().describe('song: repeat this one song; all: repeat the whole list')
    },
    write: true
  })
  windowTool(server, deps, 'list_playlists', {
    title: 'Playlists',
    description: 'The user’s playlists in Orbit’s music player, with how many songs each has, plus their liked songs count.',
    inputSchema: {}
  })
  windowTool(server, deps, 'get_playlist', {
    title: 'A playlist’s songs',
    description: 'The songs in one playlist (title, artist, album, genre). Use it to recommend songs like the ones in it. "Liked" gives the liked songs.',
    inputSchema: { playlist: z.string().min(1).describe('The playlist’s name') }
  })
  windowTool(server, deps, 'find_songs', {
    title: 'Find songs',
    description:
      'Looks a song up: whether it’s already in the user’s music folder, and matches from the online catalogue (title, artist, album, year). Use it to check which song the user means before downloading.',
    inputSchema: { query: z.string().min(1).describe('A song’s name, and its artist if known') }
  })
  windowTool(server, deps, 'suggest_songs', {
    title: 'Suggest songs',
    description: 'Songs the user doesn’t have yet by artists like the ones in a playlist (from the online catalogue). Add your own ideas too; when they pick some, use download_song for each.',
    inputSchema: { playlist: z.string().min(1).describe('The playlist to base it on') }
  })
  windowTool(server, deps, 'create_playlist', {
    title: 'Make a playlist',
    description: 'Makes a new playlist, with songs from the user’s music folder in it if given. Songs that aren’t in the music folder are listed back so they can be downloaded with download_song.',
    inputSchema: { name: z.string().min(1).max(100), songs: z.array(z.string().min(1)).max(200).optional().describe('Songs, like "Lost Boys by Phoebe Bridgers"') },
    write: true
  })
  windowTool(server, deps, 'add_to_playlist', {
    title: 'Add songs to a playlist',
    description: 'Adds songs already in the user’s music folder to a playlist (made if it isn’t there). Songs that aren’t in the music folder are listed back so they can be downloaded with download_song.',
    inputSchema: { playlist: z.string().min(1), songs: z.array(z.string().min(1)).min(1).max(200).describe('Songs, like "Lost Boys by Phoebe Bridgers"') },
    write: true
  })
  windowTool(server, deps, 'download_song', {
    title: 'Download a song',
    description:
      'Finds a song on YouTube and saves it as an MP3 in the user’s music folder (with its title, artist, album and cover), then adds it to a playlist if one is given (made if it isn’t there). Give the exact title and artist: use find_songs first if unsure which song they mean, and ask them if it’s still unclear. If the song is already in their music, it isn’t downloaded again.',
    inputSchema: {
      title: z.string().min(1).max(200),
      artist: z.string().min(1).max(200),
      playlist: z.string().optional().describe('A playlist to add it to')
    },
    write: true,
    timeoutMs: 90_000
  })
}

function emailTools(server: McpServer, deps: ToolDeps): void {
  windowTool(server, deps, 'search_email', {
    title: 'Search email',
    description: 'The user’s emails (from Gmail, as Orbit shows them) that best match a question, the top few in full. Read-only.',
    inputSchema: { question: z.string().min(1).describe('What to look for, like "emails from school today"') }
  })
}

const AREA_TOOLS: Record<ClaudeArea, (server: McpServer, deps: ToolDeps) => void> = {
  appStudio: appStudioTools,
  notes: notesTools,
  calendar: calendarTools,
  money: moneyTools,
  flashcards: flashcardTools,
  files: filesTools,
  music: musicTools,
  email: emailTools
}

/** Adds the tools for the parts of Orbit that are switched on. */
export function registerOrbitTools(server: McpServer, deps: ToolDeps): void {
  for (const [area, add] of Object.entries(AREA_TOOLS) as [ClaudeArea, (typeof AREA_TOOLS)[ClaudeArea]][]) if (deps.areas[area]) add(server, deps)
}
