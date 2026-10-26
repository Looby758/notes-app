# Notes

A dark, fast note-taking app for Windows and Mac. Every note is a plain `.md` file in a folder you choose, so your notes stay yours: open them in any editor, back them up however you like, and sync them with Google Drive.

## Install

Download the latest version from the [Releases page](https://github.com/Looby758/notes-app/releases/latest).

**Windows:** download `Notes-Setup-<version>.exe` and run it. Windows shows a SmartScreen warning because the installer isn't code-signed: click **More info → Run anyway**.

**Mac:** download `Notes-<version>-arm64.dmg` for Apple Silicon Macs (M1 and newer), or `Notes-<version>-x64.dmg` for older Intel Macs (Apple menu → About This Mac shows which). Open it and drag Notes into Applications. The first time you open it, macOS says it can't check the app for malicious software, because it isn't signed with a paid Apple certificate:

1. Click **Done** (or **OK**).
2. Open **System Settings → Privacy & Security**, scroll down to the message about Notes, and click **Open Anyway**. Confirm with your password.

You only need to do that once.

## Updates

Notes checks the Releases page every few hours (Settings → About shows the result and has *Check now*).

- **Windows:** a new version downloads in the background; a card in the corner offers **Restart**, or it installs the next time you quit.
- **Mac:** Notes tells you a new version is out and opens its download page. Install it the same way as above. (Updating itself in place needs a paid Apple certificate.)

## Syncing with Google Drive

Install [Google Drive for Desktop](https://www.google.com/drive/download/), create a folder such as `G:\My Drive\Notes`, and choose it as your notes folder (on first launch, or via the folder name at the top left → *Switch notes folder…*). Drive syncs the files; the app picks up changes from other devices as they arrive.

## Seeing your Google Calendar (read-only)

There are two ways. Both are in **Settings → Calendar**, and both are read-only: Notes never changes your calendar.

**Easiest: a calendar link (no sign-in, never expires).** In Google Calendar on the web, open *Settings → (your calendar) → Integrate calendar* and copy the **Secret address in iCal format**. Paste it under *Calendar links* with a name. Repeat for each calendar you want. Outlook and Apple calendar links work too.

**Or sign in with Google.** This needs a free Google Cloud project of your own (about 5 minutes, once):

1. Open [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) and create a project.
2. In *APIs & Services → Library*, enable the **Google Calendar API**.
3. In *OAuth consent screen*, pick **External**, give the app a name, and add your own Google account under **Test users**.
4. In *Credentials*, choose *Create credentials → OAuth client ID → Desktop app*. Copy the **client ID** and **client secret** into Notes and click **Connect Google Calendar**.
5. Your browser opens Google's sign-in page; approve read-only access. Pick which calendars to show.

While the project is in Google's "Testing" mode, Google ends the sign-in after 7 days and Notes will ask you to reconnect. The calendar link method above doesn't have that limit.

Your sign-in, client secret and calendar links are stored encrypted with the system's own protection (Windows' data protection, or the Mac Keychain) in `calendars.json` in the settings folder (see below). Events are refreshed every 10 minutes and when you come back to the app; the last copy is kept so they still show when you're offline.

## Features

- **Live preview editor** — markdown renders as you type; the raw syntax shows only on the line you're editing. Headings, bold/italic/strike, code blocks with highlighting, tables, checkboxes, quotes, images, links.
- **Autosave** — half a second after you stop typing, written safely (temp file + swap). Unsaved edits are saved before the window closes.
- **Folders** — create, rename, drag to move, delete (to the Recycle Bin / Bin).
- **Links** — `[[Note]]`, `[[Note|shown text]]`, `[[Note#Heading]]`, plus normal `[text](path.md)` links. Type `[[` for suggestions. Links to missing notes are grey; Ctrl+click to create them. Renaming or moving a note offers to fix every link to it.
- **Backlinks and outline** — the right panel shows which notes link to the current one, or the current note's headings.
- **Unlinked mentions** — under Backlinks: other notes that mention this note's name (exactly, as a whole word) without linking to it. **Link** turns one into a link, **Link all** does them all.
- **Properties** — a note's frontmatter shows as a small form at the top: a date picker for dates, chips for tags and people, one-click status and priority, tick boxes, links… *Add property* adds common ones or your own; `</>` shows the raw text.
- **Graph** (Ctrl+Shift+G) — how your notes connect, two ways: **Neighbourhood** (one note in the middle, its links in rings around it; click to move around) or **Constellation** (every note as a glowing dot, coloured by folder).
- **Export** (Ctrl+Shift+P, or right-click a note or folder) — to PDF, Word (.docx) or a web page, with images built in. Folders export as one file (links between notes still work) or a file per note.
- **Typewriter mode** (Settings → Editor, off by default) — keep the line you're writing in the middle of the screen, and/or fade everything but the current paragraph or line.
- **Tags** — `#idea`, `#project/alpha`, or `tags: [a, b]` in frontmatter. The Tags view lists them all.
- **Search** — full text, typo-tolerant, with `#tag` filters.
- **Tabs** — opening a note changes the current tab; Ctrl+click (Mac: ⌘-click) or middle-click opens it in a new one (or turn on *Open notes in a new tab* in Settings → Editor). Blank tabs wait for you to pick a note. Pin a tab (right-click → *Pin tab*) to keep it at the front; Ctrl+W leaves pinned tabs open.
- **Split view** — split any pane right or down as often as you like, drag the dividers, drag tabs between panes (or onto a pane's edge to split it), and drag notes from the file tree onto a pane. Presets: two or three columns, two rows, a grid of four. The same note can be open in two panes at once.
- **Starred notes** — star notes (right-click → *Star*, or Ctrl+Alt+S) to keep them at the top of the Files view. Stars are saved in your notes folder (`.notesapp/starred.json`) so they sync too.
- **Slash commands** — type `/` for headings, lists, checklists, tables, code blocks, dividers, links, embeds, images, dates and your templates.
- **Templates** — any note in your templates folder (Settings → Files). Tags in templates are passed on to new notes without the templates themselves showing under those tags (*Hide templates from tags*, on by default). Use one with Ctrl+Alt+N or `/template`. Placeholders: `{{title}}`, `{{date}}`, `{{time}}`, `{{weekday}}`, `{{date:dddd D MMMM}}`, `{{cursor}}`.
- **Images and files** — paste a screenshot or drop files in; they're saved to your attachments folder and linked. Ctrl+click a file link to open it in its usual app.
- **Embeds** — a line with just `![[Note]]` or `![[Note#Heading]]` shows that note (or section) inline, kept up to date.
- **Calendar** — daily notes (Ctrl+Shift+D for today's), events under a `## Schedule` heading (`- 09:30-10:30 Standup`), tasks with due dates (`- [ ] Pay rent 📅 2026-10-30`), notes with `date:`/`due:` in frontmatter. A month calendar and agenda in the right panel, and a full month/week calendar (Ctrl+Shift+C) where you can click to add events.
- **Quick capture** — press **Win+Shift+N** (Mac: **⌃⌥Space**) in any app, type, press Enter: it's added to today's note (under *Captured*) or your Inbox note. Closing the window keeps Notes running in the tray (Mac: the menu bar) so this always works; quit from its icon (or ⌘Q). It can also start when you log in (Settings → Quick capture).
- **Settings** (Ctrl+,) — five dark themes, any accent colour, fonts, text size and spacing, note width, density, zoom; editor options (live preview, spellcheck language, autosave delay, line numbers, Vim keys…); every keyboard shortcut can be changed. Everything is stored in `settings.json` (Windows: `%APPDATA%\Notes`; Mac: `~/Library/Application Support/Notes`), which you can also edit by hand.
- **Spellcheck** — right-click a misspelled word for suggestions.

## Keyboard shortcuts

All of these can be changed in **Settings → Shortcuts**. On a Mac, Ctrl is **⌘** and Alt is **⌥** (so Ctrl+P is ⌘P); tab switching stays on the Control key.

| Shortcut | Action |
| --- | --- |
| Ctrl+P | Open a note (type a new name to create it) |
| Ctrl+K | All commands |
| Ctrl+N / Ctrl+Shift+N | New note / new folder |
| Ctrl+T / Ctrl+W | New tab / close tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+Shift+F | Search all notes |
| Ctrl+Shift+E | Show files |
| Ctrl+Shift+O | Show outline |
| Ctrl+\\ | Focus mode (hide both sidebars) |
| Ctrl+= / Ctrl+- / Ctrl+0 | Bigger / smaller / reset text |
| Win+Shift+N (Mac: ⌃⌥Space) | Quick capture (from any app) |
| Ctrl+, | Settings |
| Ctrl+Alt+N | New note from template |
| Ctrl+Shift+D | Today's daily note |
| Ctrl+Shift+C | Calendar |
| Ctrl+Shift+G | Graph |
| Ctrl+Shift+P | Export the current note |
| Ctrl+Alt+\\ / Ctrl+Alt+- | Split right / split down |
| Ctrl+Alt+→ / Ctrl+Alt+← | Next / previous pane |
| Ctrl+Alt+P | Pin / unpin tab |
| Ctrl+Alt+S | Star / unstar note |
| / | Slash commands (at the start of a line) |
| Ctrl+S | Save now |
| Ctrl+F | Find in this note |
| Ctrl+B / Ctrl+I / Ctrl+E / Ctrl+Shift+X | Bold / italic / code / strikethrough |
| Ctrl+click | Open a link or tag |
| F2 / Delete | Rename / delete the selected item in the file tree |
| ↑ ↓ ← → Enter | Move around the file tree |

## Development

Requires Node 20+.

```bash
npm install
npm run dev        # run the app with hot reload
npm test           # unit tests
npm run build:win  # typecheck, test, and build dist/Notes-Setup-<version>.exe
npm run build:mac  # the same for a Mac (must be run on a Mac)
```

### Releasing a new version

1. Change `version` in `package.json` (e.g. 1.2.1) and commit.
2. Tag it and push: `git tag v1.2.1` then `git push && git push --tags`.

GitHub Actions (`.github/workflows/release.yml`) then builds the Windows and Mac installers and publishes them as a release. Installed copies of Notes pick it up from there.

Project layout:

- `src/main` — the Electron main process: file access (`vault.ts`), file watching, settings, window, the tray and quick capture (`capture.ts`), Google Calendar and calendar links (`calendarSources.ts`), updates (`updater.ts`).
- `src/shared` — types and logic used by both sides: preferences (`prefs.ts`), themes, the iCal reader (`ics.ts`), Windows/Mac differences (`platform.ts`).
- `src/preload` — the small, typed bridge between the main process and the UI.
- `src/renderer` — the React UI. The editor is CodeMirror 6 (`components/Editor`); `lib/editorController.ts` handles panes, tabs and saving; `store/noteIndex.ts` keeps the link, tag, calendar and search index; `lib/settingsSchema.ts` describes every setting.
- `build/` — the app icon (`icon.svg` is the source; `icon.png` is generated from it), the Mac menu bar icon, and the Mac signing step (`adhoc-sign.cjs`).
