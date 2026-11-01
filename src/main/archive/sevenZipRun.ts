/**
 * Runs one 7-Zip command with 7-Zip itself, built for WebAssembly (the 7z-wasm package), so
 * there's nothing to install. Real folders are mounted inside 7-Zip's own pretend file system
 * (at /a, /o and so on), so it can only ever see and write the folders it's given.
 *
 * This file has no Electron or app imports: it runs in a worker thread (sevenZipWorker.ts) so a
 * big archive never freezes the app, and in tests directly.
 */

export interface SevenZipMount {
  /** Where it appears inside 7-Zip ("/a"). */
  at: string
  /** The real folder. */
  root: string
}

export interface SevenZipJob {
  args: string[]
  mounts: SevenZipMount[]
  /** The folder 7-Zip starts in (one of the mounts). */
  cwd?: string
}

export interface SevenZipResult {
  /** 0 is "Everything is Ok", 1 a warning, 2 and up an error; null when 7-Zip stopped without saying. */
  code: number | null
  out: string
  err: string
}

interface SevenZipModule {
  FS: {
    mkdir(path: string): void
    mount(type: unknown, opts: { root: string }, at: string): void
    chdir(path: string): void
  }
  NODEFS: unknown
  callMain(args: string[]): number | undefined
}

export type SevenZipFactory = (opts: Record<string, unknown>) => Promise<SevenZipModule>

/** A fresh copy of 7-Zip for each command (its runtime can't be reused once a command ends). */
export async function runSevenZip(factory: SevenZipFactory, job: SevenZipJob): Promise<SevenZipResult> {
  const out: string[] = []
  const err: string[] = []
  const sz = await factory({
    print: (s: string) => out.push(s),
    printErr: (s: string) => err.push(s),
    // Nothing to type: 7-Zip asking for a password gets "no answer" rather than waiting for ever.
    stdin: () => null
  })
  for (const m of job.mounts) {
    sz.FS.mkdir(m.at)
    sz.FS.mount(sz.NODEFS, { root: m.root }, m.at)
  }
  if (job.cwd) sz.FS.chdir(job.cwd)
  let code: number | null
  try {
    code = sz.callMain(job.args) ?? null
  } catch (e) {
    // An exit() comes as an object with a status; anything else (a C++ exception) has no code.
    const status = (e as { status?: unknown })?.status
    code = typeof status === 'number' ? status : null
  }
  return { code, out: out.join('\n'), err: err.join('\n') }
}
