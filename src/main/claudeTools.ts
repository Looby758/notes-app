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
  /** A word's meanings from Orbit's dictionary. */
  define?(word: string): Promise<string>
  /** What's been copied lately (only kept while the Clipboard part is on), and copying text. */
  clipboard?: { list(): { text: string; at: number }[]; copy(text: string): void }
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
    description: 'A summary of the user’s money in Orbit: the last few months’ spending by category, budgets, savings goals, repeating payments, balance and forecast, plus their entries (the ones matching the question first).',
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
    description: 'The songs in one playlist, numbered (title, artist, album, genre). Use it to recommend songs like the ones in it. "Liked" gives the liked songs.',
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
  windowTool(server, deps, 'remove_from_playlist', {
    title: 'Take songs out of a playlist',
    description: 'Takes songs out of a playlist (the songs stay in the user’s music). Give song names, or their numbers from get_playlist.',
    inputSchema: {
      playlist: z.string().min(1),
      songs: z.array(z.string().min(1)).max(200).optional().describe('Songs, like "Lost Boys by Phoebe Bridgers"'),
      numbers: z.array(z.number().int().min(1)).max(200).optional().describe('Their numbers from get_playlist')
    },
    write: true
  })
  windowTool(server, deps, 'move_in_playlist', {
    title: 'Move a song in a playlist',
    description: 'Moves one song to a new place in a playlist (1 is the top). Give its name or its number from get_playlist.',
    inputSchema: { playlist: z.string().min(1), song: z.string().optional(), number: z.number().int().min(1).optional(), to: z.number().int().min(1) },
    write: true
  })
  windowTool(server, deps, 'rename_playlist', {
    title: 'Rename a playlist',
    description: 'Gives a playlist a new name.',
    inputSchema: { playlist: z.string().min(1), name: z.string().min(1).max(100) },
    write: true
  })
  windowTool(server, deps, 'delete_playlist', {
    title: 'Delete a playlist',
    description: 'Deletes a playlist. The songs in it stay in the user’s music. Check with the user first.',
    inputSchema: { playlist: z.string().min(1) },
    write: true
  })
  windowTool(server, deps, 'get_queue', {
    title: 'Up next',
    description: 'The songs in Up next, numbered, after the one playing now.',
    inputSchema: {}
  })
  windowTool(server, deps, 'queue_songs', {
    title: 'Add to Up next',
    description: 'Adds songs from the user’s music to Up next: at the end, or straight after this song with next true.',
    inputSchema: { songs: z.array(z.string().min(1)).min(1).max(200).describe('Songs, like "Lost Boys by Phoebe Bridgers"'), next: z.boolean().optional() },
    write: true
  })
  windowTool(server, deps, 'remove_from_queue', {
    title: 'Take songs out of Up next',
    description: 'Takes one song out of Up next (by its number from get_queue or its name), or clears it with all true.',
    inputSchema: { number: z.number().int().min(1).optional(), song: z.string().optional(), all: z.boolean().optional() },
    write: true
  })
  windowTool(server, deps, 'music_settings', {
    title: 'Volume, shuffle, loop and more',
    description: 'Changes how the music plays: shuffle, loop, volume (0 to 100), jump to a point in the song, or a sleep timer (minutes, "end_of_song", or "off").',
    inputSchema: {
      shuffle: z.boolean().optional(),
      loop: z.enum(['off', 'song', 'all']).optional(),
      volume: z.number().min(0).max(100).optional(),
      seek_seconds: z.number().min(0).optional().describe('Jump to this many seconds into the song'),
      sleep: z.union([z.number().int().min(1).max(600), z.enum(['end_of_song', 'off'])]).optional().describe('Stop the music after this many minutes, at the end of this song, or "off"')
    },
    write: true
  })
  windowTool(server, deps, 'like_songs', {
    title: 'Like songs',
    description: 'Likes songs (adds them to Liked), or unlikes them with liked false.',
    inputSchema: { songs: z.array(z.string().min(1)).min(1).max(200).describe('Songs, like "Lost Boys by Phoebe Bridgers"'), liked: z.boolean().optional() },
    write: true
  })
  windowTool(server, deps, 'rate_song', {
    title: 'Rate a song',
    description: 'Gives a song 1 to 5 stars, or 0 to clear the rating.',
    inputSchema: { song: z.string().min(1), stars: z.number().int().min(0).max(5) },
    write: true
  })
  windowTool(server, deps, 'tag_songs', {
    title: 'Tag songs',
    description: 'Puts a tag (like "gym" or "sad") on songs, or takes it off with remove true. Find tagged songs with search_my_music.',
    inputSchema: { songs: z.array(z.string().min(1)).min(1).max(200).describe('Songs, like "Lost Boys by Phoebe Bridgers"'), tag: z.string().min(1).max(40), remove: z.boolean().optional() },
    write: true
  })
  windowTool(server, deps, 'search_my_music', {
    title: 'Search my music',
    description: 'Searches the user’s own music by words (title, artist, album, genre) or by tag, with ratings, likes and tags.',
    inputSchema: { query: z.string().optional(), tag: z.string().optional() }
  })
  windowTool(server, deps, 'music_stats', {
    title: 'Most played and recently added',
    description: 'The user’s most played songs, recently added songs and how much music they have.',
    inputSchema: { limit: z.number().int().min(1).max(50).optional() }
  })
  windowTool(server, deps, 'edit_song', {
    title: 'Fix a song’s details',
    description: 'Changes a song’s title, artist, album, year or genre (saved in the file).',
    inputSchema: {
      song: z.string().min(1),
      title: z.string().max(200).optional(),
      artist: z.string().max(200).optional(),
      album: z.string().max(200).optional(),
      year: z.string().max(10).optional(),
      genre: z.string().max(100).optional()
    },
    write: true
  })
  windowTool(server, deps, 'delete_songs', {
    title: 'Delete songs',
    description: 'Deletes songs from the user’s music folder (they go to the Recycle Bin or Bin, and out of every playlist). Orbit asks the user to confirm first. To only take a song out of one playlist, use remove_from_playlist.',
    inputSchema: { songs: z.array(z.string().min(1)).min(1).max(200).describe('Songs, like "Lost Boys by Phoebe Bridgers"') },
    write: true,
    timeoutMs: 120_000
  })
}

function emailTools(server: McpServer, deps: ToolDeps): void {
  windowTool(server, deps, 'search_email', {
    title: 'Search email',
    description: 'The user’s emails (from Gmail, as Orbit shows them) that best match a question, the top few in full. Read-only.',
    inputSchema: { question: z.string().min(1).describe('What to look for, like "emails from school today"') }
  })
}

// ---------- More of each part (claude/*Answers.ts in the window) ----------

const pounds = z.number().describe('Pounds, like 12.50')

function notesMoreTools(server: McpServer, deps: ToolDeps): void {
  windowTool(server, deps, 'open_note', {
    title: 'Open a note in Orbit',
    description: 'Opens a note on the user’s screen in Orbit, so they can see it.',
    inputSchema: { path: z.string().min(1), new_tab: z.boolean().optional() },
    write: true
  })
  windowTool(server, deps, 'get_daily_note', {
    title: 'Daily note',
    description: 'The daily note for a day (today if no date), if there is one.',
    inputSchema: { date: day.optional() }
  })
  windowTool(server, deps, 'add_to_daily_note', {
    title: 'Add to the daily note',
    description: 'Adds text (Markdown) to the end of a day’s daily note (today if no date), making the note if needed. open: also show it.',
    inputSchema: { text: z.string().min(1).max(100_000), date: day.optional(), open: z.boolean().optional() },
    write: true
  })
  windowTool(server, deps, 'list_tasks', {
    title: 'Tasks in notes',
    description: 'Tick-box tasks ("- [ ] ...") across the notes: unticked ones, or ticked ones with done true. Can be limited to a folder or words.',
    inputSchema: { folder: z.string().optional(), search: z.string().optional(), done: z.boolean().optional(), limit: z.number().int().min(1).max(500).optional() }
  })
  windowTool(server, deps, 'tick_note_task', {
    title: 'Tick a task in a note',
    description: 'Ticks (or unticks, with done false) a tick-box task in a note, found by its words.',
    inputSchema: { note: z.string().min(1), task: z.string().min(1), done: z.boolean().optional() },
    write: true
  })
  windowTool(server, deps, 'get_tags', { title: 'Tags', description: 'Every #tag in the notes, with how many notes use it.', inputSchema: {} })
  windowTool(server, deps, 'notes_with_tag', {
    title: 'Notes with a tag',
    description: 'The notes that have a #tag (and its sub-tags).',
    inputSchema: { tag: z.string().min(1) }
  })
  windowTool(server, deps, 'get_links', {
    title: 'Links to and from a note',
    description: 'Which notes link to a note (with the line each link is on), and which notes it links to.',
    inputSchema: { note: z.string().min(1) }
  })
  windowTool(server, deps, 'create_folder', {
    title: 'Make a folder',
    description: 'Makes a folder (and any folders above it) in the notes folder, like "School/History".',
    inputSchema: { folder: z.string().min(1).max(300) },
    write: true
  })
  windowTool(server, deps, 'copy_note', {
    title: 'Copy a note',
    description: 'Makes a copy of a note, with a new name and folder if given (otherwise "<name> copy" beside it).',
    inputSchema: { path: z.string().min(1), name: z.string().max(200).optional(), folder: z.string().optional() },
    write: true
  })
  windowTool(server, deps, 'add_under_heading', {
    title: 'Add under a heading',
    description: 'Adds text at the end of one section of a note (under a heading like "Shopping"), adding the heading at the end if it isn’t there.',
    inputSchema: { path: z.string().min(1), heading: z.string().min(1).max(200), text: z.string().min(1).max(100_000) },
    write: true
  })
}

function calendarMoreTools(server: McpServer, deps: ToolDeps): void {
  windowTool(server, deps, 'add_calendar_event', {
    title: 'Add an event',
    description:
      'Adds an event to Orbit’s calendar (in that day’s daily note), or to one of the user’s Google calendars (see list_calendars). Leave out the times for an all-day event. repeat makes it repeat, in plain words like "every Tuesday", "every weekday", "every 2 weeks on Thursday", "every month on the 1st", "every year", with "until 2027-03-31" if it ends.',
    inputSchema: {
      date: day.describe('The day (for a repeating event, the first day)'),
      title: z.string().min(1).max(200),
      start: time.optional(),
      end: time.optional(),
      repeat: z.string().max(200).optional(),
      calendar: z.string().optional().describe('A Google calendar’s name; leave out for Orbit’s own')
    },
    write: true
  })
  windowTool(server, deps, 'list_calendars', { title: 'Calendars', description: 'The calendars events can be added to: Orbit’s own, and Google calendars Orbit can change.', inputSchema: {} })
  const which = { date: day.describe('The day it’s on now'), title: z.string().min(1).describe('Its name as get_calendar shows it') }
  windowTool(server, deps, 'move_calendar_event', {
    title: 'Move or change the time of an event',
    description:
      'Moves an event to another day and/or time (Orbit’s own or an editable Google one). Changing only the start keeps how long it lasts. all_day true makes it all day. For a repeating Orbit event, which "one" moves just that day; "all" (default) moves every repeat.',
    inputSchema: { ...which, to_date: day.optional(), start: time.optional(), end: time.optional(), all_day: z.boolean().optional(), which: z.enum(['one', 'all']).optional() },
    write: true
  })
  windowTool(server, deps, 'rename_calendar_event', {
    title: 'Rename an event',
    description: 'Changes an event’s name.',
    inputSchema: { ...which, new_title: z.string().min(1).max(200) },
    write: true
  })
  windowTool(server, deps, 'delete_calendar_event', {
    title: 'Delete an event',
    description: 'Deletes an event. For a repeating Orbit event: which "one" skips just that day, "from_here" stops it repeating from that day on, "all" (default) deletes every repeat. Check with the user first for anything repeating.',
    inputSchema: { ...which, which: z.enum(['one', 'from_here', 'all']).optional() },
    write: true
  })
  windowTool(server, deps, 'tick_task', {
    title: 'Tick a dated task',
    description: 'Ticks (or unticks, with done false) a task shown in the calendar on a day.',
    inputSchema: { ...which, done: z.boolean().optional() },
    write: true
  })
  windowTool(server, deps, 'get_due_tasks', {
    title: 'Tasks with dates',
    description: 'Unticked tasks with a date or due date between two days (default the next 30 days).',
    inputSchema: { from: day.optional(), to: day.optional() }
  })
  windowTool(server, deps, 'edit_countdown', {
    title: 'Change a countdown',
    description: 'Changes a countdown’s name, date, time (empty for the whole day), kind or whether it’s yearly.',
    inputSchema: {
      countdown: z.string().min(1).describe('Its name'),
      title: z.string().max(80).optional(),
      date: day.optional(),
      time: z.string().optional().describe('Like 18:00, or empty for the whole day'),
      kind: z.enum(['season', 'game', 'trip', 'birthday', 'event', 'other']).optional(),
      yearly: z.boolean().optional()
    },
    write: true
  })
  windowTool(server, deps, 'delete_countdown', { title: 'Delete a countdown', description: 'Deletes a countdown.', inputSchema: { countdown: z.string().min(1) }, write: true })
}

function clockTools(server: McpServer, deps: ToolDeps): void {
  const place = z.string().min(1).describe('A city or country ("Tokyo"), a friend on the world clocks ("Sam"), a time zone ("America/New_York") or "here"')
  windowTool(server, deps, 'get_world_clocks', {
    title: 'World clocks',
    description: 'The time now on each of the user’s world clocks (places and friends), how far ahead or behind each is, whether it’s a good time to message friends, and clock changes coming up.',
    inputSchema: {}
  })
  windowTool(server, deps, 'time_in', { title: 'Time somewhere', description: 'The time now anywhere in the world, and how far ahead or behind it is.', inputSchema: { place } })
  windowTool(server, deps, 'convert_time', {
    title: 'Convert a time',
    description: 'What a time in one place is somewhere else ("7pm in New York in my time"). Leave out "to" for here and every world clock.',
    inputSchema: { time, from: place, to: place.optional(), date: day.optional().describe('The day in the "from" place (default today)') }
  })
  windowTool(server, deps, 'add_world_clock', {
    title: 'Add a world clock',
    description: 'Adds a place to World clocks, or a friend (person) and where they live.',
    inputSchema: { place, person: z.string().max(40).optional().describe('A friend’s name, for a friend’s clock'), name: z.string().max(60).optional().describe('What to call the place') },
    write: true
  })
  const clock = z.string().min(1).describe('The clock’s place or friend’s name')
  windowTool(server, deps, 'remove_world_clock', { title: 'Remove a world clock', description: 'Takes a clock off World clocks.', inputSchema: { clock }, write: true })
  windowTool(server, deps, 'rename_world_clock', { title: 'Rename a world clock', description: 'Renames a clock (a friend’s name, or a place’s label).', inputSchema: { clock, name: z.string().min(1).max(60) }, write: true })
  windowTool(server, deps, 'move_world_clock', { title: 'Reorder world clocks', description: 'Moves a clock to a new place in the list (1 is first).', inputSchema: { clock, position: z.number().int().min(1) }, write: true })
  windowTool(server, deps, 'good_time_to_message', { title: 'When to message a friend', description: 'Whether it’s a good time to message a friend on the world clocks now, and if not, when it will be.', inputSchema: { clock } })
}

function moneyMoreTools(server: McpServer, deps: ToolDeps): void {
  const type = z.enum(['spent', 'received'])
  windowTool(server, deps, 'add_money_entry', {
    title: 'Add spending or money in',
    description: 'Adds something the user spent or received to Money. The category is matched by name (default Other).',
    inputSchema: { amount: pounds, type, note: z.string().max(200).optional().describe('What it was, like "Tesco" or "Pay"'), category: z.string().optional(), date: day.optional().describe('Default today') },
    write: true
  })
  windowTool(server, deps, 'find_money_entries', {
    title: 'Find money entries',
    description: 'Entries in Money (newest first, with their ids and totals), matching words in the note, dates and/or a category.',
    inputSchema: { search: z.string().optional(), from: day.optional(), to: day.optional(), category: z.string().optional(), limit: z.number().int().min(1).max(300).optional() }
  })
  windowTool(server, deps, 'edit_money_entry', {
    title: 'Change a money entry',
    description: 'Changes an entry (by its id from find_money_entries).',
    inputSchema: { id: z.string().min(1), amount: pounds.optional(), type: type.optional(), note: z.string().max(200).optional(), category: z.string().optional(), date: day.optional() },
    write: true
  })
  windowTool(server, deps, 'delete_money_entry', { title: 'Delete a money entry', description: 'Deletes an entry (by its id). Ctrl+Z in Orbit brings it back.', inputSchema: { id: z.string().min(1) }, write: true })
  windowTool(server, deps, 'set_budget', { title: 'Set a budget', description: 'Sets a spending category’s monthly budget (0 takes it off).', inputSchema: { category: z.string().min(1), amount: pounds }, write: true })
  windowTool(server, deps, 'add_money_category', { title: 'Add a money category', description: 'Adds a spending category (or a money-in one with income true).', inputSchema: { name: z.string().min(1).max(40), income: z.boolean().optional() }, write: true })
  windowTool(server, deps, 'add_savings_goal', {
    title: 'Add a savings goal',
    description: 'Adds a savings goal, like "New PC £1,200 by June".',
    inputSchema: { name: z.string().min(1).max(60), target: pounds, due: day.optional(), saved: pounds.optional().describe('Already saved') },
    write: true
  })
  const goal = z.string().min(1).describe('The goal’s name')
  windowTool(server, deps, 'savings_goal_money', { title: 'Put money into a goal', description: 'Puts money into a savings goal (or takes it out, with a negative amount).', inputSchema: { goal, amount: pounds }, write: true })
  windowTool(server, deps, 'edit_savings_goal', { title: 'Change a savings goal', description: 'Changes a goal’s name, target or date (empty date for none).', inputSchema: { goal, name: z.string().max(60).optional(), target: pounds.optional(), due: z.string().optional() }, write: true })
  windowTool(server, deps, 'delete_savings_goal', { title: 'Delete a savings goal', description: 'Deletes a savings goal.', inputSchema: { goal }, write: true })
  windowTool(server, deps, 'get_ious', { title: 'Who owes who', description: 'Money friends owe the user, and money the user owes them.', inputSchema: {} })
  windowTool(server, deps, 'add_iou', {
    title: 'Note who owes who',
    description: 'Notes that someone owes the user money (they_owe true, the default) or the user owes them (false), with an optional reminder day.',
    inputSchema: { person: z.string().min(1).max(40), amount: pounds, they_owe: z.boolean().optional(), note: z.string().max(100).optional(), remind: day.optional() },
    write: true
  })
  windowTool(server, deps, 'pay_back_iou', {
    title: 'Pay back',
    description: 'Records money paid back between the user and someone (all of it if no amount), oldest first.',
    inputSchema: { person: z.string().min(1), amount: pounds.optional() },
    write: true
  })
  windowTool(server, deps, 'get_subscriptions', { title: 'Subscriptions and bills', description: 'Repeating payments: found from statements and added by hand, with the next payment day.', inputSchema: {} })
  windowTool(server, deps, 'add_subscription', {
    title: 'Add a subscription',
    description: 'Adds a subscription or bill by hand.',
    inputSchema: { name: z.string().min(1).max(60), amount: pounds, interval: z.enum(['weekly', 'monthly', 'yearly']).optional(), next_payment: day.optional(), category: z.string().optional() },
    write: true
  })
  windowTool(server, deps, 'cancel_subscription', { title: 'Mark a subscription cancelled', description: 'Marks a subscription as cancelled, so it’s no longer listed (unless it charges again).', inputSchema: { name: z.string().min(1) }, write: true })
  windowTool(server, deps, 'set_balance', { title: 'Set the bank balance', description: 'What’s in the user’s main account today (negative if overdrawn), for the forecast.', inputSchema: { amount: pounds }, write: true })
  windowTool(server, deps, 'set_account_balance', {
    title: 'Set another account’s balance',
    description: 'What’s in one of the user’s other accounts (savings, cash, a credit card as a negative amount). Adds the account if it isn’t there.',
    inputSchema: { account: z.string().min(1).max(40), amount: pounds, kind: z.enum(['current', 'savings', 'cash', 'credit', 'other']).optional() },
    write: true
  })
}

function studioMoreTools(server: McpServer, deps: ToolDeps): void {
  const app = z.string().min(1).describe('The app (name or owner/name)')
  windowTool(server, deps, 'edit_card', {
    title: 'Change a card',
    description: 'Changes a card’s title, details or kind on Ideas & bugs (by its id from get_board).',
    inputSchema: { id: z.string().min(1), title: z.string().max(200).optional(), details: z.string().max(10_000).optional(), kind: z.enum(['idea', 'bug']).optional() },
    write: true
  })
  windowTool(server, deps, 'delete_card', { title: 'Delete a card', description: 'Deletes a card from Ideas & bugs.', inputSchema: { id: z.string().min(1) }, write: true })
  windowTool(server, deps, 'get_pull_requests', { title: 'Pull requests', description: 'Open pull requests on GitHub for one app, or all of them.', inputSchema: { app: app.optional() } })
  windowTool(server, deps, 'merge_pull_request', {
    title: 'Merge a pull request',
    description: 'Merges a pull request. Orbit asks the user to confirm first.',
    inputSchema: { app, number: z.number().int().min(1) },
    write: true,
    timeoutMs: 180_000
  })
  windowTool(server, deps, 'close_pull_request', {
    title: 'Close a pull request',
    description: 'Closes a pull request without merging it. Orbit asks the user to confirm first.',
    inputSchema: { app, number: z.number().int().min(1) },
    write: true,
    timeoutMs: 180_000
  })
  windowTool(server, deps, 'get_releases', { title: 'Releases', description: 'An app’s latest releases on GitHub, with their notes and downloads.', inputSchema: { app, limit: z.number().int().min(1).max(30).optional() } })
  windowTool(server, deps, 'get_bug_reports', { title: 'Bug reports', description: 'Open bug reports (GitHub issues) for an app.', inputSchema: { app } })
  windowTool(server, deps, 'close_bug_report', {
    title: 'Close a bug report',
    description: 'Closes a bug report, with a comment if given. Check with the user first.',
    inputSchema: { app, number: z.number().int().min(1), comment: z.string().max(5000).optional() },
    write: true
  })
  windowTool(server, deps, 'run_tests', {
    title: 'Run an app’s tests',
    description: 'Runs an app’s type check and tests on this computer (as the release helper does) and gives what failed. Can take a few minutes.',
    inputSchema: { app },
    timeoutMs: 15 * 60_000
  })
  windowTool(server, deps, 'get_latest_code', {
    title: 'Get the latest code',
    description: 'Gets the latest main branch from GitHub into the app’s folder on this computer.',
    inputSchema: { app },
    write: true,
    timeoutMs: 5 * 60_000
  })
  windowTool(server, deps, 'check_packages', { title: 'Check packages', description: 'Outdated npm packages and security warnings for an app.', inputSchema: { app }, timeoutMs: 5 * 60_000 })
}

function convertTools(server: McpServer, deps: ToolDeps): void {
  windowTool(server, deps, 'convert_formats', {
    title: 'What a file can become',
    description: 'What Orbit’s file converter can turn files into (pictures, sound, video and documents).',
    inputSchema: { paths: z.array(z.string().min(1)).min(1).max(50).describe('Full paths, from search_files, get_downloads or find_tagged_files') }
  })
  windowTool(server, deps, 'convert_file', {
    title: 'Convert files',
    description:
      'Converts files on this computer with Orbit’s converter (like HEIC to jpg, mp4 to mp3, mov to mp4, docx to pdf, md to docx), each saved in the same folder as the original, never over another file. Videos need the video converter downloaded once from Orbit’s Convert page.',
    inputSchema: {
      paths: z.array(z.string().min(1)).min(1).max(50).describe('Full paths of the files'),
      to: z.enum(['jpg', 'png', 'webp', 'mp3', 'wav', 'mp4', 'mov', 'webm', 'gif', 'pdf', 'docx', 'md', 'txt', 'html']),
      max_size: z.number().int().min(16).max(20_000).optional().describe('Pictures: shrink so the longest side is at most this many pixels'),
      video_height: z.number().int().min(144).max(4320).optional().describe('Videos: shrink to at most this many pixels tall')
    },
    write: true,
    timeoutMs: 15 * 60_000
  })
}

function computerTools(server: McpServer, deps: ToolDeps): void {
  windowTool(server, deps, 'get_running_apps', {
    title: 'What’s running',
    description: 'The programs running on the computer with their CPU, memory and disk use (busiest first), from Orbit’s task manager.',
    inputSchema: { sort: z.enum(['cpu', 'memory', 'disk', 'name']).optional(), search: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }
  })
  windowTool(server, deps, 'get_computer_usage', {
    title: 'How busy the computer is',
    description: 'CPU, memory, disk and network use, how long it’s been on, and the busiest programs.',
    inputSchema: {}
  })
  windowTool(server, deps, 'close_app', {
    title: 'Close a program',
    description: 'Closes (ends) a program that’s running, like one that’s stuck. Orbit asks the user to confirm first; anything unsaved in it is lost.',
    inputSchema: { app: z.string().min(1).describe('Its name as get_running_apps shows it') },
    write: true,
    timeoutMs: 120_000
  })
}

function videoTools(server: McpServer, deps: ToolDeps): void {
  const show = z.string().min(1).describe('The show’s name, like "Breaking Bad"')
  windowTool(server, deps, 'find_videos', {
    title: 'Find videos',
    description: 'Videos in the user’s notes folder (with the show and episode when it’s a TV episode, and how much has been watched).',
    inputSchema: { search: z.string().optional(), limit: z.number().int().min(1).max(300).optional() }
  })
  windowTool(server, deps, 'list_shows', { title: 'TV shows', description: 'The TV shows in the notes folder and how many episodes each has.', inputSchema: {} })
  windowTool(server, deps, 'list_episodes', { title: 'A show’s episodes', description: 'A show’s episodes in order, with which have been watched.', inputSchema: { show } })
  windowTool(server, deps, 'play_video', {
    title: 'Play a video',
    description:
      'Plays a video from the notes folder in Orbit’s video player. A show on its own carries on where the user is up to (the episode they stopped in, or the next one). With season and episode: that episode. With only a season: its first episode. It carries on from where it was left unless from_start is true.',
    inputSchema: {
      video: z.string().optional().describe('A video’s name or path (for a video that isn’t a show)'),
      show: show.optional(),
      season: z.number().int().min(1).optional(),
      episode: z.number().int().min(1).optional(),
      from_start: z.boolean().optional()
    },
    write: true
  })
  windowTool(server, deps, 'next_episode', { title: 'Next episode', description: 'Plays the episode after the one open in the video player.', inputSchema: {}, write: true })
  windowTool(server, deps, 'queue_videos', {
    title: 'Add videos to Up next',
    description: 'Adds videos to the video player’s Up next: by name, or several episodes of a show (count episodes from from_episode, default the first).',
    inputSchema: { videos: z.array(z.string().min(1)).max(50).optional(), show: show.optional(), season: z.number().int().min(1).optional(), from_episode: z.number().int().min(1).optional(), count: z.number().int().min(1).max(50).optional() },
    write: true
  })
  windowTool(server, deps, 'get_video_queue', { title: 'Video Up next', description: 'The video that’s open and what’s in Up next.', inputSchema: {} })
  windowTool(server, deps, 'video_history', { title: 'Recently watched', description: 'Videos watched lately, with where each was left.', inputSchema: { limit: z.number().int().min(1).max(50).optional() } })
  windowTool(server, deps, 'video_controls', {
    title: 'Control the video',
    description:
      'Controls the video that’s open: status (what’s playing and where), play, pause, forward / back (value: seconds, default 10), seek (value: seconds from the start), restart, speed (value 0.25 to 3), volume (value 0 to 100), mute, unmute, fullscreen, exit_fullscreen, next (next in Up next) or close.',
    inputSchema: {
      action: z.enum(['status', 'play', 'pause', 'forward', 'back', 'seek', 'restart', 'speed', 'volume', 'mute', 'unmute', 'fullscreen', 'exit_fullscreen', 'next', 'close']),
      value: z.number().optional()
    },
    write: true
  })
}

// ---------- Planning: briefing, free time, reminders, weather, any page ----------

function plannerTools(server: McpServer, deps: ToolDeps): void {
  windowTool(server, deps, 'get_weather', {
    title: 'Weather',
    description: 'The weather where the user is (the town set on Orbit’s Home page): now, and each day with 3-hourly detail and the chance of rain. Up to 14 days ahead.',
    inputSchema: { date: day.optional().describe('First day (default today)'), days: z.number().int().min(1).max(14).optional() }
  })
  windowTool(server, deps, 'add_reminder', {
    title: 'Add a reminder',
    description: 'Orbit pops up a reminder at a time (it’s saved as a task in that day’s daily note; ticking it stops it).',
    inputSchema: { text: z.string().min(1).max(300), time, date: day.optional().describe('Default today') },
    write: true
  })
  windowTool(server, deps, 'get_reminders', { title: 'Reminders coming up', description: 'The reminders still to come, soonest first.', inputSchema: { limit: z.number().int().min(1).max(100).optional() } })
  windowTool(server, deps, 'find_free_time', {
    title: 'Find free time',
    description:
      'The free gaps in the user’s days (around Orbit’s events and timed tasks and their connected calendars), for planning a week: "plan my week", "when can I study 3 hours?". Then add_calendar_event can block the time.',
    inputSchema: {
      from: day.optional().describe('Default today'),
      to: day.optional().describe('Default a week on'),
      day_start: time.optional().describe('Default 09:00'),
      day_end: time.optional().describe('Default 21:00'),
      min_minutes: z.number().int().min(10).max(600).optional().describe('Shortest gap worth listing (default 30)')
    },
    timeoutMs: 60_000
  })
}

function briefingTool(server: McpServer, deps: ToolDeps): void {
  const areas = (['calendar', 'money', 'music'] as const).filter((a) => deps.areas[a])
  server.registerTool(
    'morning_briefing',
    {
      title: 'Morning briefing',
      description: 'One summary of the user’s day: today’s calendar, tasks due soon, reminders, the weather, countdowns, money this week and what’s playing (whichever parts are switched on). For "good morning" or "what’s my day like?".',
      inputSchema: { date: day.optional().describe('Default today') },
      annotations: READ
    },
    safely(({ date }: { date?: string }) => deps.ask('morning_briefing', { date, areas }, 60_000))
  )
}

const PAGE_LIST = 'home, calendar, music, money, flashcards, countdowns, world clocks, email, messages, app studio, convert, comics, videos, video player, games, mini games, skyblock, task manager, volume mixer, files, downloads, screenshots, clips, soundboard, macros, discord, wiki, graph, timeline, terminal, ask ai, ai chat, pdf editor, publishing, screens, studio, send files, find and replace, add-ons, uninstaller, key remapper, web, settings'

function pageTool(server: McpServer, deps: ToolDeps): void {
  windowTool(server, deps, 'open_page', {
    title: 'Open a page in Orbit',
    description: `Opens one of Orbit’s pages in its window, like the Calendar or Money. The pages: ${PAGE_LIST}.`,
    inputSchema: { page: z.string().min(1) },
    write: true
  })
}

// ---------- More money ----------

function moneyExtraTools(server: McpServer, deps: ToolDeps): void {
  windowTool(server, deps, 'money_check_in', {
    title: 'Money check-in',
    description: 'How the user’s money has gone lately: spent and received, the biggest categories and shops, budgets running out, and what’s coming up. For a weekly check-in.',
    inputSchema: { days: z.number().int().min(1).max(92).optional().describe('Default 7') }
  })
  windowTool(server, deps, 'split_bill', {
    title: 'Split a bill',
    description: 'Splits a bill evenly between the user and friends and notes who owes who (with an optional reminder day). paid_by: who paid, if not the user.',
    inputSchema: {
      total: pounds,
      people: z.array(z.string().min(1).max(40)).min(1).max(20).describe('Everyone else, not the user'),
      paid_by: z.string().optional(),
      note: z.string().max(100).optional(),
      remind: day.optional(),
      record_spending: z.boolean().optional().describe('Also add the user’s share as spending'),
      category: z.string().optional()
    },
    write: true
  })
  windowTool(server, deps, 'read_receipt', {
    title: 'Read a receipt',
    description: 'Reads a photo of a receipt (its full path): the shop, total and date, and its text. With add true, adds it as spending.',
    inputSchema: { path: z.string().min(1), add: z.boolean().optional(), category: z.string().optional() },
    write: true,
    timeoutMs: 90_000
  })
  windowTool(server, deps, 'read_statement', {
    title: 'Read a bank statement',
    description: 'Reads a bank statement (CSV or PDF, its full path) and says which entries are new. With import true, adds the new ones to Money (Orbit asks the user first).',
    inputSchema: { path: z.string().min(1), import: z.boolean().optional() },
    write: true,
    timeoutMs: 180_000
  })
}

// ---------- More music: moods, the DJ, routines ----------

function musicMoreTools(server: McpServer, deps: ToolDeps): void {
  windowTool(server, deps, 'music_library', { title: 'What’s in their music', description: 'The genres, artists and tags in the user’s music folder, with counts, for picking songs by mood.', inputSchema: {} })
  windowTool(server, deps, 'songs_for_mood', {
    title: 'Songs for a mood',
    description:
      'Picks songs from the user’s music for a mood or activity ("something chill for studying", "an hour of upbeat rock"), by genres, artists, tags and words (see music_library), adding up to about some minutes. Can save them as a playlist and/or play them.',
    inputSchema: {
      genres: z.array(z.string()).optional(),
      artists: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      words: z.array(z.string()).optional(),
      minutes: z.number().int().min(0).max(600).optional().describe('Default 60; 0 for all that fit'),
      playlist_name: z.string().max(80).optional(),
      play: z.boolean().optional()
    },
    write: true,
    timeoutMs: 60_000
  })
  windowTool(server, deps, 'dj', {
    title: 'DJ: fill Up next',
    description: 'Adds songs that go well after what’s playing (same artists and genre, songs from the same playlists, liked and well-rated ones, not played lately) to Up next. If nothing is playing, give a song to start from (like).',
    inputSchema: { count: z.number().int().min(1).max(50).optional(), like: z.string().optional() },
    write: true,
    timeoutMs: 60_000
  })
  windowTool(server, deps, 'save_music_routine', {
    title: 'Save a music routine',
    description:
      'Saves a named music routine, like "gym" (a playlist shuffled, volume 90) or "bedtime" (calm songs, volume 30, stop after 45 minutes). With at (and days, 0 = Sunday), it starts by itself at that time while Orbit is open. Saving one with the same name replaces it.',
    inputSchema: {
      name: z.string().min(1).max(40),
      playlist: z.string().optional(),
      search: z.string().optional().describe('Songs matching these words, if no playlist'),
      shuffle: z.boolean().optional(),
      loop: z.enum(['off', 'song', 'all']).optional(),
      volume: z.number().int().min(0).max(100).optional(),
      sleep_minutes: z.number().int().min(1).max(600).optional(),
      at: time.optional(),
      days: z.array(z.number().int().min(0).max(6)).optional()
    },
    write: true
  })
  windowTool(server, deps, 'get_music_routines', { title: 'Music routines', description: 'The user’s saved music routines.', inputSchema: {} })
  windowTool(server, deps, 'start_music_routine', { title: 'Start a music routine', description: 'Starts a saved music routine now ("gym mode").', inputSchema: { name: z.string().min(1) }, write: true, timeoutMs: 60_000 })
  windowTool(server, deps, 'delete_music_routine', { title: 'Delete a music routine', description: 'Deletes a saved music routine.', inputSchema: { name: z.string().min(1) }, write: true })
}

// ---------- Screenshots ----------

function screenshotTools(server: McpServer, deps: ToolDeps): void {
  windowTool(server, deps, 'find_screenshots', {
    title: 'Find screenshots',
    description: 'The user’s screenshots (newest first) from the last few days. With search, reads the words in each one and keeps those that have them, like "error".',
    inputSchema: { days: z.number().int().min(1).max(365).optional().describe('Default 7'), search: z.string().optional(), limit: z.number().int().min(1).max(50).optional() },
    timeoutMs: 180_000
  })
  windowTool(server, deps, 'read_screenshot', {
    title: 'Read a screenshot',
    description: 'The words in a screenshot or picture (its full path, or "latest" for the newest screenshot).',
    inputSchema: { path: z.string().optional() },
    timeoutMs: 90_000
  })
}

// ---------- Mind maps ----------

function mindMapTools(server: McpServer, deps: ToolDeps): void {
  const note = z.string().min(1).describe('The note’s name or path')
  windowTool(server, deps, 'show_mind_map', { title: 'Show a mind map', description: 'Shows a note as a mind map in Orbit (its headings are the branches).', inputSchema: { note }, write: true })
  windowTool(server, deps, 'mind_map_outline', { title: 'A mind map’s outline', description: 'A note’s mind map as an indented outline of its headings.', inputSchema: { note } })
  windowTool(server, deps, 'create_mind_map', {
    title: 'Make a mind map',
    description: 'Makes a new mind map note from an indented outline ("- Plants\n  - Roots\n  - Leaves") and shows it.',
    inputSchema: { title: z.string().min(1).max(120), outline: z.string().min(1).max(20_000), folder: z.string().optional() },
    write: true
  })
}

// ---------- Home page, themes and focus ----------

function lookTools(server: McpServer, deps: ToolDeps): void {
  windowTool(server, deps, 'get_home_page', { title: 'The Home page', description: 'The boxes on Orbit’s Home page, in order, and which are hidden.', inputSchema: {} })
  windowTool(server, deps, 'arrange_home_page', {
    title: 'Arrange the Home page',
    description: 'Changes Orbit’s Home page: put boxes first in an order, move one to a place (to, from 1), hide or show boxes, or reset it.',
    inputSchema: {
      order: z.array(z.string()).optional(),
      move: z.string().optional(),
      to: z.number().int().min(1).optional(),
      hide: z.array(z.string()).optional(),
      show: z.array(z.string()).optional(),
      reset: z.boolean().optional()
    },
    write: true
  })
  windowTool(server, deps, 'list_themes', { title: 'Themes', description: 'Orbit’s themes, which one is on, and the accent colour.', inputSchema: {} })
  windowTool(server, deps, 'set_theme', {
    title: 'Change the theme',
    description: 'Switches Orbit’s theme and/or accent colour (#rrggbb, or empty for the theme’s own), or makes it follow the system’s light/dark.',
    inputSchema: { theme: z.string().optional(), accent: z.string().optional(), follow_system: z.boolean().optional() },
    write: true
  })
  windowTool(server, deps, 'make_theme', {
    title: 'Make a theme',
    description:
      'Makes a new theme from one colour (like #2a1650 for dark purple) and switches to it, optionally with a picture behind every page: a picture’s full path or an https address (for "a space background", find a suitable picture’s address first).',
    inputSchema: {
      name: z.string().min(1).max(60),
      colour: z.string().describe('#rrggbb'),
      light: z.boolean().optional().describe('A light theme (default dark)'),
      accent: z.string().optional().describe('#rrggbb (default the colour)'),
      picture: z.string().optional(),
      picture_strength: z.number().min(0.03).max(0.6).optional().describe('How strongly the picture shows (default 0.2)')
    },
    write: true,
    timeoutMs: 90_000
  })
  windowTool(server, deps, 'remove_theme', { title: 'Remove a theme', description: 'Removes a theme that was made or imported (not a built-in one).', inputSchema: { theme: z.string().min(1) }, write: true })
  windowTool(server, deps, 'start_focus', {
    title: 'Start focus mode',
    description:
      'Starts a focus (study) timer: minutes per round and rounds with breaks between. By default Orbit’s pop-ups and reminders wait until it’s over (quiet false to keep them). Can switch on zen mode and play a playlist or songs matching words.',
    inputSchema: {
      minutes: z.number().int().min(1).max(240).optional(),
      rounds: z.number().int().min(1).max(12).optional(),
      quiet: z.boolean().optional(),
      zen: z.boolean().optional(),
      playlist: z.string().optional(),
      search: z.string().optional()
    },
    write: true,
    timeoutMs: 60_000
  })
  windowTool(server, deps, 'focus_timer', {
    title: 'The focus timer',
    description: 'How long is left on the focus timer, or pause, resume, add minutes or stop it.',
    inputSchema: { action: z.enum(['status', 'pause', 'resume', 'add', 'stop']).optional(), minutes: z.number().int().min(1).max(120).optional() },
    write: true
  })
}

// ---------- Games, SkyBlock and comics ----------

function gamesTools(server: McpServer, deps: ToolDeps): void {
  windowTool(server, deps, 'list_games', { title: 'Games', description: 'The games on the computer, with time played in all and this week, and when each was last played.', inputSchema: {} })
  windowTool(server, deps, 'play_game', { title: 'Start a game', description: 'Starts one of the computer’s games.', inputSchema: { game: z.string().min(1) }, write: true })
  windowTool(server, deps, 'mini_game_stats', { title: 'Mini game scores', description: 'Orbit’s mini games: games played and won, win streaks and best times.', inputSchema: {} })
  windowTool(server, deps, 'open_mini_game', {
    title: 'Open a mini game',
    description: 'Opens one of Orbit’s mini games: Sudoku, Minesweeper, Nonogram, Jigsaw, Wordle, Word search, Hangman, Solitaire, Blackjack, 2048, Breakout or Chess (none: the list).',
    inputSchema: { game: z.string().optional() },
    write: true
  })
  windowTool(server, deps, 'skyblock_profile', { title: 'SkyBlock profile', description: 'The user’s Hypixel SkyBlock profile as Orbit shows it: skills, slayers, dungeons, collections, coins and the rest (JSON).', inputSchema: {}, timeoutMs: 60_000 })
  windowTool(server, deps, 'skyblock_goals', { title: 'SkyBlock goals', description: 'The user’s Hypixel SkyBlock goals and how far along each is (JSON).', inputSchema: {}, timeoutMs: 60_000 })
  windowTool(server, deps, 'skyblock_sessions', {
    title: 'SkyBlock sessions',
    description: 'The user’s recent Hypixel SkyBlock play sessions: how long, coins made per hour, skill XP and collections gained (JSON).',
    inputSchema: { limit: z.number().int().min(1).max(50).optional() }
  })
  windowTool(server, deps, 'list_comics', { title: 'Comics', description: 'The comics on Orbit’s shelf, last read first, with the page they’re up to.', inputSchema: {} })
  windowTool(server, deps, 'open_comic', { title: 'Open a comic', description: 'Opens a comic in Orbit where they left off.', inputSchema: { comic: z.string().min(1) }, write: true })
  windowTool(server, deps, 'next_comic', {
    title: 'Open the next comic',
    description: 'Opens the next issue they haven’t finished in a series (default: the series they read last; if they’re part way through one, that one).',
    inputSchema: { series: z.string().optional() },
    write: true
  })
}

// ---------- Discord ----------

function discordTools(server: McpServer, deps: ToolDeps): void {
  windowTool(server, deps, 'discord_status', { title: 'Discord call', description: 'The Discord voice channel the user is in, who’s there and talking, their own mute/deafen, and the recent chat.', inputSchema: {} })
  windowTool(server, deps, 'discord_set', { title: 'Mute or deafen on Discord', description: 'Mutes/unmutes and/or deafens/undeafens the user on Discord.', inputSchema: { mute: z.boolean().optional(), deaf: z.boolean().optional() }, write: true })
  windowTool(server, deps, 'discord_leave', { title: 'Leave the Discord call', description: 'Leaves the Discord voice channel.', inputSchema: {}, write: true })
  windowTool(server, deps, 'discord_user_voice', {
    title: 'Someone’s volume on Discord',
    description: 'Changes how loud the user hears someone in the call (0 to 200, 100 is normal), or mutes them just for the user.',
    inputSchema: { user: z.string().min(1), volume: z.number().int().min(0).max(200).optional(), mute: z.boolean().optional() },
    write: true
  })
  windowTool(server, deps, 'discord_calls', { title: 'Past Discord calls', description: 'The user’s recent Discord calls (newest first): when, how long, who with, and the call notes.', inputSchema: { limit: z.number().int().min(1).max(100).optional() } })
  windowTool(server, deps, 'discord_call_note', {
    title: 'Write a call note',
    description: 'Sets the note for the call the user is in (things to say or remember), or a past call’s note with call_id. append true adds to it.',
    inputSchema: { text: z.string().max(5000), call_id: z.string().optional(), append: z.boolean().optional() },
    write: true
  })
}

// ---------- The phone ----------

function phoneTools(server: McpServer, deps: ToolDeps): void {
  windowTool(server, deps, 'send_to_phone', {
    title: 'Send to the phone',
    description: 'Sends a note (by name), a file in the notes folder (path) or a web link (url) to the user’s phone: Orbit shows a code to scan with the phone’s camera.',
    inputSchema: { note: z.string().optional(), path: z.string().optional(), url: z.string().optional() },
    write: true
  })
  windowTool(server, deps, 'phone_alert', {
    title: 'Alert the phone',
    description: 'Shows an alert on the user’s paired phone.',
    inputSchema: { title: z.string().max(80).optional(), message: z.string().min(1).max(300) },
    write: true
  })
}

// ---------- The web, wikis and the dictionary ----------

function webTools(server: McpServer, deps: ToolDeps): void {
  windowTool(server, deps, 'open_website', {
    title: 'Open a website',
    description: 'Opens a website (or a search, for words) in Orbit’s own browser.',
    inputSchema: { url: z.string().min(1), private: z.boolean().optional() },
    write: true
  })
  windowTool(server, deps, 'web_history', {
    title: 'Browser history',
    description: 'Pages the user visited in Orbit’s browser that match some words (in the title, address or the page’s text).',
    inputSchema: { search: z.string(), limit: z.number().int().min(1).max(100).optional() }
  })
  windowTool(server, deps, 'get_bookmarks', { title: 'Bookmarks', description: 'The bookmarks in Orbit’s browser.', inputSchema: {} })
  windowTool(server, deps, 'add_bookmark', { title: 'Add a bookmark', description: 'Bookmarks a page in Orbit’s browser.', inputSchema: { url: z.string().min(1), title: z.string().max(120).optional() }, write: true })
  windowTool(server, deps, 'wiki_search', {
    title: 'Search the wikis',
    description: 'Searches the wikis the user downloaded into Orbit (all of them, or one), within their spoiler limit.',
    inputSchema: { query: z.string().min(1), wiki: z.string().optional() },
    timeoutMs: 60_000
  })
  windowTool(server, deps, 'wiki_page', { title: 'Read a wiki page', description: 'A page of a downloaded wiki, as text.', inputSchema: { title: z.string().min(1), wiki: z.string().optional() }, timeoutMs: 60_000 })
  windowTool(server, deps, 'wiki_ask', {
    title: 'Ask the wikis',
    description: 'Answers a question from the downloaded wikis, with the pages it came from, without spoilers past where the user is.',
    inputSchema: { question: z.string().min(1).max(500), wiki: z.string().optional() },
    timeoutMs: 120_000
  })
  const define = deps.define
  if (define)
    server.registerTool(
      'define_word',
      { title: 'Look up a word', description: 'A word’s meanings, examples and synonyms from Orbit’s built-in dictionary.', inputSchema: { word: z.string().min(1).max(60) }, annotations: READ },
      safely(({ word }: { word: string }) => define(word))
    )
}

// ---------- Clipboard ----------

function clipboardTools(server: McpServer, deps: ToolDeps): void {
  const clip = deps.clipboard
  if (!clip) return
  server.registerTool(
    'get_clipboard_history',
    {
      title: 'Clipboard history',
      description: 'Text the user copied since the Clipboard part was switched on (newest first, the last 50, kept only while Orbit is open). Passwords and keys are never kept.',
      inputSchema: { search: z.string().optional() },
      annotations: READ
    },
    safely(({ search }: { search?: string }) => {
      const want = (search ?? '').toLowerCase()
      const list = clip.list().filter((c) => !want || c.text.toLowerCase().includes(want))
      if (!list.length) return want ? 'Nothing copied matches that.' : 'Nothing copied yet.'
      return list.map((c, i) => `${i + 1}. ${new Date(c.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: ${c.text.length > 1500 ? `${c.text.slice(0, 1500)}…` : c.text}`).join('\n\n')
    })
  )
  server.registerTool(
    'copy_to_clipboard',
    { title: 'Copy text', description: 'Puts some text on the user’s clipboard, ready to paste.', inputSchema: { text: z.string().min(1).max(100_000) }, annotations: WRITE },
    safely(({ text: t }: { text: string }) => {
      clip.copy(t)
      return 'Copied. It’s ready to paste.'
    })
  )
}

const AREA_TOOLS: Record<ClaudeArea, (server: McpServer, deps: ToolDeps) => void> = {
  appStudio: (s, d) => (appStudioTools(s, d), studioMoreTools(s, d)),
  notes: (s, d) => (notesTools(s, d), notesMoreTools(s, d), mindMapTools(s, d)),
  calendar: (s, d) => (calendarTools(s, d), calendarMoreTools(s, d), plannerTools(s, d)),
  clocks: clockTools,
  money: (s, d) => (moneyTools(s, d), moneyMoreTools(s, d), moneyExtraTools(s, d)),
  flashcards: flashcardTools,
  files: (s, d) => (filesTools(s, d), convertTools(s, d), screenshotTools(s, d)),
  music: (s, d) => (musicTools(s, d), musicMoreTools(s, d)),
  videos: videoTools,
  computer: computerTools,
  look: lookTools,
  games: gamesTools,
  discord: discordTools,
  phone: phoneTools,
  web: webTools,
  clipboard: clipboardTools,
  email: emailTools
}

/** Adds the tools for the parts of Orbit that are switched on. */
export function registerOrbitTools(server: McpServer, deps: ToolDeps): void {
  for (const [area, add] of Object.entries(AREA_TOOLS) as [ClaudeArea, (typeof AREA_TOOLS)[ClaudeArea]][]) if (deps.areas[area]) add(server, deps)
  // Always there: opening any page, and the briefing (with whatever parts are on).
  pageTool(server, deps)
  briefingTool(server, deps)
}
