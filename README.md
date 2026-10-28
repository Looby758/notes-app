# Notes

A dark, fast note-taking app for Windows and Mac. Every note is a plain `.md` file in a folder you choose, so your notes stay yours: open them in any editor, back them up however you like, and sync them with Google Drive.

## Install

Download the latest version from the [Releases page](https://github.com/Looby758/notes-app/releases/latest).

**Windows:** download `Notes-Setup-<version>.exe` and run it. Windows shows a SmartScreen warning because the installer isn't code-signed: click **More info → Run anyway**.

**Mac:** download `Notes-<version>-arm64.dmg` for Apple Silicon Macs (M1 and newer), or `Notes-<version>-x64.dmg` for older Intel Macs (Apple menu → About This Mac shows which). Open it and drag Notes into Applications (if you open Notes straight from the disk image, it offers to move itself there; say yes). The first time you open it, macOS says it can't check the app for malicious software, because it isn't signed with a paid Apple certificate:

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

## Email (Gmail)

The **Email** page (Ctrl+Shift+A, or the envelope at the top) shows your Gmail inbox inside Notes. It uses the same Google sign-in as the calendar, so set that up first (above). Then, once:

1. Open the [Gmail API page](https://console.cloud.google.com/apis/library/gmail.googleapis.com) in the same Google Cloud project and press **Enable**.
2. On the [Audience page](https://console.cloud.google.com/auth/audience), make sure your Gmail address is listed under **Test users** (*Add users* if not). Without it, Google says "Access blocked: Notes has not completed the Google verification process".
3. On the Email page, press **Connect Gmail**. Google says it hasn't verified the app (it's your own project, so that's expected): press **Continue**, tick the Gmail box, and continue.

What you can do:

- Read your Inbox, Unread, Starred, Sent or All mail, and search everything with Gmail's own search words (`from:sam invoice`, `has:attachment`…).
- **Reply**, **Reply all**, **Forward** and **Write** new emails (plain text; Ctrl+Enter sends).
- Star, mark unread, archive, or move to Gmail's Bin.
- **Save as note** makes a note in the `Emails` folder with who sent it, when, a link back to it in Gmail, and the message.
- **Add to calendar** puts it in that day's note under Schedule. Notes fills in the date and time when the email mentions one ("Friday at 7pm"); change them before you add it.
- Unread emails also show on the **Home** page.

Emails are fetched from Google while you look at them and aren't saved on your computer. Pictures in emails are hidden until you choose to show them, so senders can't tell when you've opened one. Notes can't delete email for good: the Bin is emptied by Gmail after 30 days.

## Weather

The **Home** page shows the weather where you are: what it's like now, today's high and low, the chance of rain, and the week ahead. The first time, type your town (or postcode) in the Weather box and pick it from the list; *Change town* switches it later.

The calendar shows the forecast too, for the next two weeks: a small picture and the high on each day, and beside anything that sounds like it's outside (a walk, football, a BBQ, parkrun, the beach… or anything with "outside" or "outdoor" in it), the forecast for the hour it starts. Hover for the details.

The forecast comes from [Open-Meteo](https://open-meteo.com), which is free and needs no account. It's checked every half hour while it's on screen, and the last one is kept (in `weather.json` in the settings folder) so it still shows when you're offline. Turn either part off in **Settings → Calendar → Weather**.

## AI helper (optional)

Notes can use Claude, made by Anthropic, to help with your notes. It's off until you add your own Anthropic API key in **Settings → AI helper** (sign up at [console.anthropic.com](https://console.anthropic.com/settings/keys), add a little credit, create a key, paste it in). Anthropic bills your account directly, usually a cent or two each time.

- **Summarise** (hover over a note → *Summarise*): a short summary you can add to the top of the note or copy.
- **Tidy up** (hover over a note → *Tidy up*, or ✨ in quick capture): fixes typos and adds headings, bullets and checkboxes. You see the result first, and Ctrl+Z (or ↶ in quick capture) undoes it.
- **Ask my notes** (Ctrl+K → *AI helper: ask my notes*): ask a question in your own words; Claude answers from the notes that best match it, with links to them.
- **Chat** (the speech bubble at the top, or Ctrl+K → *AI helper: chat with Claude*): ask Claude anything, like a normal chat. Your chats are listed on the side so you can go back to one, rename or delete it, and any chat can be saved as a note. Chats are kept in `ai-chats.json` in the settings folder, on this computer only. Chat doesn't see your notes.

Nothing is sent unless you press one of these. Then only what's needed goes to Anthropic: the note you're working on, for a question the best-matching notes, or in Chat the conversation so far. Locked notes are never sent. The key is stored encrypted, like calendar sign-ins, in `ai.json` in the settings folder.

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
- **Calculator** — start a line with `=` and the answer shows at the end of it as you type: `= 12 * 4.5`, `= 15% of 80`, `= £12.50 * 3`. Converts units too: `= 5 km in miles`, `= 100 f in c`, `= 2 hours + 45 min in minutes` (length, weight, volume, time, speed, area, temperature and file sizes; pints and gallons are British). Click an answer to copy it. In a table, a row whose first cell says **Total** or **Average** fills in each number column's total. Answers are only shown, never written into the note.
- **Dictionary and synonyms** — right-click any word in a note to see what it means; click the meaning for all of them, with examples. *Synonyms* swaps in another word, with the same ending ("running" → "sprinting"). Works offline, using Princeton's [WordNet](https://wordnet.princeton.edu/).
- **Search** — full text, typo-tolerant, with `#tag` filters.
- **Tabs** — opening a note changes the current tab; Ctrl+click (Mac: ⌘-click) or middle-click opens it in a new one (or turn on *Open notes in a new tab* in Settings → Editor). Blank tabs wait for you to pick a note. Pin a tab (right-click → *Pin tab*) to keep it at the front; Ctrl+W leaves pinned tabs open.
- **Split view** — split any pane right or down as often as you like, drag the dividers, drag tabs between panes (or onto a pane's edge to split it), and drag notes from the file tree onto a pane. Presets: two or three columns, two rows, a grid of four. The same note can be open in two panes at once.
- **Starred notes** — star notes (right-click → *Star*, or Ctrl+Alt+S) to keep them at the top of the Files view. Stars are saved in your notes folder (`.notesapp/starred.json`) so they sync too.
- **Slash commands** — type `/` for headings, lists, checklists, tables, code blocks, dividers, links, embeds, images, dates and your templates.
- **Templates** — any note in your templates folder (Settings → Files). Tags in templates are passed on to new notes without the templates themselves showing under those tags (*Hide templates from tags*, on by default). Use one with Ctrl+Alt+N or `/template`. Placeholders: `{{title}}`, `{{date}}`, `{{time}}`, `{{weekday}}`, `{{date:dddd D MMMM}}`, `{{cursor}}`.
- **Images and files** — paste a screenshot or drop files in; they're saved to your attachments folder and linked. Ctrl+click a file link to open it in its usual app.
- **Embeds** — a line with just `![[Note]]` or `![[Note#Heading]]` shows that note (or section) inline, kept up to date.
- **Places** — type `/place` (or *Add a place* in the command palette), search for a shop, an address or a town, and pick one: it goes into the note as a 📍 link that opens Google Maps, shown as a card with a small map and the address. Pasting a Google Maps link on its own line shows a card too. No account or key needed: searching and the maps come from [OpenStreetMap](https://www.openstreetmap.org/copyright), so it needs an internet connection.
- **Calendar** — daily notes (Ctrl+Shift+D for today's), events under a `## Schedule` heading (`- 09:30-10:30 Standup`), tasks with due dates (`- [ ] Pay rent 📅 2026-10-30`), notes with `date:`/`due:` in frontmatter. A month calendar and agenda in the right panel, and a full month/week calendar (Ctrl+Shift+C) where you can click to add events.
- **Quick capture** — press **Win+Shift+N** (Mac: **⌃⌥Space**) in any app, type, press Enter: it's added to today's note (under *Captured*) or your Inbox note. The **→** menu at the top sends it to any other note or folder instead. Write a time (*"dinner with Jack at 8 tomorrow"*) and it goes into the calendar instead, optionally with a reminder; or pick a day with the 📅 button. Closing the window keeps Notes running in the tray (Mac: the menu bar) so this always works; quit from its icon (or ⌘Q). It can also start when you log in (Settings → Quick capture).
- **Settings** (Ctrl+,) — five dark and three light themes (or switch with your system's light/dark mode), any accent colour, fonts, text size and spacing, note width, density, zoom; editor options (live preview, spellcheck language, autosave delay, line numbers, Vim keys…); every keyboard shortcut can be changed. Everything is stored in `settings.json` (Windows: `%APPDATA%\Notes`; Mac: `~/Library/Application Support/Notes`), which you can also edit by hand.
- **Spellcheck** — right-click a misspelled word for suggestions.
- **Highlighter** — `==text==` (Ctrl+Shift+H), in several colours.
- **Callouts** — `> [!tip] Title` boxes (note, tip, warning, danger…), foldable with `-` or `+`; insert with `/callout`.
- **Table editor** — edit cells right in the rendered table instead of the raw markdown.
- **Reading mode** (Ctrl+Shift+R) — every note in every tab becomes read-only until you switch back; links open with a plain click.
- **Find and replace in all notes** (Ctrl+Alt+F) — match case, whole words, regular expressions, a single folder; untick matches you want to keep, and undo afterwards.
- **Bulk actions** — Ctrl/⌘-click or Shift-click several notes (or tick search results) to move, delete, star, tag, set a property or export them together.
- **Email** (Ctrl+Shift+A) — your Gmail inbox: read, reply, write, and turn an email into a note or a calendar event in one click. See *Email (Gmail)* above.
- **Flashcards** (Ctrl+Shift+Y, or the cards button at the top) — write `Question :: Answer` on its own line (or as a list item) in any note and it becomes a card. The Flashcards page shows how many are due today; review them all or one note's cards: *Show answer* (Space), then **Again**, **Hard**, **Good** or **Easy** (1–4). Cards you know come back less and less often (tomorrow, a few days, a week…); ones you miss come back in the same session. Your notes aren't changed: progress is saved in your notes folder (`.notesapp/flashcards.json`) so it syncs too, and follows notes you rename or move. Changing a card's question makes it a new card.
- **Terminal** (Ctrl+Alt+T, or the terminal button at the top) — a command line in its own tab, starting in your notes folder: PowerShell on Windows, your usual shell on a Mac. It keeps running while you switch tabs; closing the tab ends it. Copy and paste work as usual (on Windows, Ctrl+C copies when text is selected and otherwise stops the running command). It only runs what you type into it.
- **Passwords** (Ctrl+Alt+K, or the key button at the top) — a password vault in its own tab. Save logins (name, username, password, website, notes), search them, copy a username or password with one click, and make strong random passwords (pick the length and which characters). Everything is encrypted with AES-256 under a **master password** of its own (separate from the locked-notes password, never saved), with an optional recovery key, and kept in your notes folder (`.notesapp/passwords.json`) so it syncs. Copied passwords clear from the clipboard after 30 seconds. The vault locks with locked notes (Ctrl+Alt+L, the auto-lock time, or closing Notes); if auto-lock is set to Never, passwords still lock after 30 minutes. It warns when the same password is used for more than one login. Passwords never appear in search, links, the AI helper or exports. If you forget the master password and have no recovery key, the passwords can't be recovered.
- **Convert files** (the ⇄ button at the top, or *Convert files* in Ctrl+K) — drop in pictures, sound files and documents and turn them into other kinds: iPhone photos (HEIC) to JPG, PNG or WebP (and make them smaller), WAV, M4A and other sound files to MP3 or WAV, Word documents to PDF, Markdown or plain text, and Markdown, text or web pages to PDF or Word. Convert lots at once and save them all into one folder. It all happens on your computer, nothing is uploaded, and your original files aren't changed. Word documents keep their text, headings, lists, tables and pictures, but fancy layouts (columns, text boxes) won't look exactly the same. Videos and PDFs can't be converted.
- **Web browser tab** (Ctrl+Shift+I, or the globe at the top) — browse the web beside a note in split view, with an address bar (type an address or a search), back, forward and reload. Ctrl/⌘-click a web link in a note and it opens in a web tab next to the note (turn this off in Settings → Editor → Tabs to use your usual browser). Pages run walled off from your notes and the app; links that open a new window open a new web tab. Sign-ins are remembered, separately from your normal browser, until you choose *Clear browsing data* in a web tab's ⋯ menu. It's a simple browser: no extensions, some video sites won't play protected films, and Google sometimes refuses to sign in inside other apps (use the ↗ button to open the page in your usual browser).
- **YouTube mini window** (Ctrl+Alt+Y, or the screen-with-a-play-button at the top) — YouTube in a small window that floats over everything (other apps too), so a video keeps playing in the corner while you work. Drag it by its top bar and resize it from the edges. Search or paste a link at the top; on a video it shows just the video (the square button switches back to the whole page), and the pin button stops it floating on top. You're signed in to YouTube if you are in the web tabs. Watching a YouTube video in a web tab? Its play button carries it on in the mini window from where you were. Closing the window remembers the video and the spot, so it picks up there next time.
- **Random note**, **related notes** (under Backlinks, with the reason), and **on this day** (notes from this date in past months and years, in the calendar panel).
- **Banners and icons** — give a note a banner image or colour and an emoji icon, shown above the title and in the file list.
- **App icon** — pick from several designs (including green) in Settings → Appearance. On Windows it also goes on the Start menu, desktop and pinned taskbar shortcuts.
- **Zen mode** (Ctrl+Alt+Z) — full screen, just the note, with typewriter mode and a focus timer you can set up (focus and break lengths, rounds, chime).
- **Reminders** — add `⏰ 2026-10-28 15:00` to a task (Ctrl+Alt+R or `/reminder`) and you'll get a notification then; click it to open the note. Reminders missed while Notes was closed are listed at the next start.
- **Voice notes** — record with `/voice`, right-click → *Record a voice note*, or the mic in quick capture. The recording is saved in your attachments folder and plays in the note.
- **Sketch notes** — draw with `/sketch` or right-click → *Draw a sketch*: pen (pressure-sensitive), highlighter, eraser, colours, squared or lined paper. Sketches are saved as pictures in your attachments folder; hover one in a note and click *Edit sketch* to add to it.
- **Canvas boards** — an endless board for laying out ideas: click the board button at the top of the file list (or right-click a folder → *New canvas board*). Drag notes and pictures in from the sidebar, double-click the board for a sticky note, or use the toolbar to add a note, a picture, a sketch or a group. Drag from the dot on a card's edge to another card to draw an arrow (let go on empty space for a new sticky note); double-click an arrow to label it. Drag the board to move around and scroll to zoom. Double-click a note card to open it. Right-click anything for more, and pick colours from the bar that appears. Boards are `.canvas` files in your notes folder, in the same open format as Obsidian, and cards keep up when you rename or move notes.
- **Handwriting to text** — in the sketch pad, *Turn into text* reads what you wrote with the pen and shows it as typed text to check and fix, then adds it to your note (with or without the drawing). It's read either by the AI helper, which copes with messy and joined-up writing, or offline on your computer (best with neat printed letters); pick in Settings → Editor → Sketches.
- **Locked notes** — Ctrl+K → *Lock this note* (or right-click a note). Locked notes are encrypted (AES-256) with your notes password, or a password of their own, and need it to open. Set a recovery key in case you forget the password. They lock again after a while away (Settings → Files) or with Ctrl+Alt+L, and stay out of search, links and the graph. **There's no way in without the password or recovery key.**
- **Formatting menu and toolbar** — select text and right-click for bold, italic, highlight colours, links, headings, lists, quotes, callouts and *Clear formatting*; a small toolbar also appears above selected text. With text selected, typing `*` `=` `~` or ``` wraps it instead of replacing it.
- **Text snippets** — save bits of text in Settings → Editor; type `;name` and a space to insert one (`{{date}}` and friends work in them).
- **Smart paste** — a pasted web address becomes a link with the page's title (or links the selected text); a table copied from Excel or a web page becomes a markdown table. Ctrl+Shift+V pastes plain text.
- **All your files** — pictures, recordings, videos and PDFs show in the file list and open in a tab; other files open in their usual app. Drag one into a note to show it there. Renaming or moving them keeps your notes' links working.
- **A font per note** — add a *Font* property: serif, sans, mono, handwriting or any installed font.
- **Saved searches** — click the bookmark in the search box to keep a search in the file list.
- **Sync copies** — when Google Drive keeps two versions of a note (*Plan (1)*), Notes points it out and lets you compare them, combine them or keep one.
- **Import** — Ctrl+K → *Import notes…* brings in notes from Google Keep (Takeout), Notion (Markdown & CSV export), Evernote (.enex), a folder of markdown or text files, or (on a Mac) Apple Notes. They go into an *Imported* folder.
- **Template placeholders** — type `/placeholder` in a template, or see the list in Settings → Calendar. Daily templates keep the date heading unless they have their own.
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
| Ctrl+Shift+A | Open email |
| Ctrl+Shift+O | Show outline |
| Ctrl+\\ | Focus mode (hide both sidebars) |
| Ctrl+= / Ctrl+- / Ctrl+0 | Bigger / smaller / reset text |
| Win+Shift+N (Mac: ⌃⌥Space) | Quick capture (from any app) |
| Ctrl+, | Settings |
| Ctrl+Alt+N | New note from template |
| Ctrl+Shift+D | Today's daily note |
| Ctrl+Shift+C | Calendar |
| Ctrl+Shift+G | Graph |
| Ctrl+Alt+Y | YouTube mini window |
| Ctrl+Shift+P | Export the current note |
| Ctrl+Alt+\\ / Ctrl+Alt+- | Split right / split down |
| Ctrl+Alt+→ / Ctrl+Alt+← | Next / previous pane |
| Ctrl+Alt+P | Pin / unpin tab |
| Ctrl+Alt+S | Star / unstar note |
| / | Slash commands (at the start of a line) |
| Ctrl+Alt+F | Find and replace in all notes |
| Ctrl+Shift+R | Reading mode / writing mode |
| Ctrl+Alt+Z | Zen mode |
| Ctrl+Shift+H | Highlight |
| Ctrl+Alt+R | Add a reminder to this line |
| Ctrl+Alt+L | Lock all locked notes now |
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

- `src/main` — the Electron main process: file access (`vault.ts`), file watching, settings, window, the tray and quick capture (`capture.ts`), Google Calendar and calendar links (`calendarSources.ts`), Gmail (`email.ts`, with the email format itself in `mail.ts`), updates (`updater.ts`).
- `src/shared` — types and logic used by both sides: preferences (`prefs.ts`), themes, the iCal reader (`ics.ts`), Windows/Mac differences (`platform.ts`).
- `src/preload` — the small, typed bridge between the main process and the UI.
- `src/renderer` — the React UI. The editor is CodeMirror 6 (`components/Editor`); `lib/editorController.ts` handles panes, tabs and saving; `store/noteIndex.ts` keeps the link, tag, calendar and search index; `lib/settingsSchema.ts` describes every setting.
- `build/` — the app icon (`icon.svg` is the source; `icon.png` is generated from it), the Mac menu bar icon, and the Mac signing step (`adhoc-sign.cjs`).
