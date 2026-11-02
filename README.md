# Orbit

A dark, fast note-taking app for Windows and Mac. Every note is a plain `.md` file in a folder you choose, so your notes stay yours: open them in any editor, back them up however you like, and sync them with Google Drive.

## Install

Download the latest version from the [Releases page](https://github.com/Looby758/notes-app/releases/latest).

**Windows:** download `Orbit-Setup-<version>.exe` and run it. Windows shows a SmartScreen warning because the installer isn't code-signed: click **More info → Run anyway**.

**Mac:** download `Orbit-<version>-arm64.dmg` for Apple Silicon Macs (M1 and newer), or `Orbit-<version>-x64.dmg` for older Intel Macs (Apple menu → About This Mac shows which). Open it and drag Orbit into Applications (if you open Orbit straight from the disk image, it offers to move itself there; say yes). The first time you open it, macOS says it can't check the app for malicious software, because it isn't signed with a paid Apple certificate:

1. Click **Done** (or **OK**).
2. Open **System Settings → Privacy & Security**, scroll down to the message about Orbit, and click **Open Anyway**. Confirm with your password.

You only need to do that once.

## Updates

Orbit checks the Releases page every few hours (Settings → About shows the result and has *Check now*).

- **Windows:** a new version downloads in the background; a card in the corner offers **Restart**, or it installs the next time you quit.
- **Mac:** Orbit tells you a new version is out and opens its download page. Install it the same way as above. (Updating itself in place needs a paid Apple certificate.)

## Syncing with Google Drive

Install [Google Drive for Desktop](https://www.google.com/drive/download/), create a folder such as `G:\My Drive\Notes`, and choose it as your notes folder (on first launch, or via the folder name at the top left → *Switch notes folder…*). Drive syncs the files; the app picks up changes from other devices as they arrive.

## Seeing your Google Calendar (read-only)

There are two ways. Both are in **Settings → Calendar**, and both are read-only: Orbit never changes your calendar.

**Easiest: a calendar link (no sign-in, never expires).** In Google Calendar on the web, open *Settings → (your calendar) → Integrate calendar* and copy the **Secret address in iCal format**. Paste it under *Calendar links* with a name. Repeat for each calendar you want. Outlook and Apple calendar links work too.

**Or sign in with Google.** This needs a free Google Cloud project of your own (about 5 minutes, once):

1. Open [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) and create a project.
2. In *APIs & Services → Library*, enable the **Google Calendar API**.
3. In *OAuth consent screen*, pick **External**, give the app a name, and add your own Google account under **Test users**.
4. In *Credentials*, choose *Create credentials → OAuth client ID → Desktop app*. Copy the **client ID** and **client secret** into Orbit and click **Connect Google Calendar**.
5. Your browser opens Google's sign-in page; approve read-only access. Pick which calendars to show.

While the project is in Google's "Testing" mode, Google ends the sign-in after 7 days and Orbit will ask you to reconnect. The calendar link method above doesn't have that limit.

Your sign-in, client secret and calendar links are stored encrypted with the system's own protection (Windows' data protection, or the Mac Keychain) in `calendars.json` in the settings folder (see below). Events are refreshed every 10 minutes and when you come back to the app; the last copy is kept so they still show when you're offline.

## Email (Gmail)

The **Email** page (Ctrl+Shift+A, or the envelope at the top) shows your Gmail inbox inside Orbit. It uses the same Google sign-in as the calendar, so set that up first (above). Then, once:

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

## Streamer mode

For sharing your screen with friends or on a stream. Turn it on with the eye at the top, **Ctrl+Alt+B**, or **Settings → Appearance → Streamer mode**; a red **LIVE** badge in the corner shows it's on (click it to turn it off).

While it's on, private things are blurred until you click them: your weather town, email senders, subjects and the email you're reading, money amounts and the Money page, your saved logins (the password vault also locks), WhatsApp and Discord, calendar events, note names in the file list, tabs and recent notes, and the notes folder's path. Clicking something blurred only shows it, so you never open an email or a note by accident; click again to open it. Notes you open stay covered until you press **Show note**, and close the tab to hide it again. Reminder pop-ups just say "Reminder", and WhatsApp and Discord can't pop up notifications.

Turning streamer mode off and on again hides everything again. Whether notes and note names are hidden can be changed in Settings.

## Music player (Spotify)

Press ♫ at the top (or Ctrl+Alt+M) to show a small player in the bottom-left corner. It shows the song that's playing, with play/pause, skip, a progress bar you can click to jump, and underneath it a volume slider, shuffle, repeat (press repeat again to repeat just this song) and a **sleep timer** (the moon) that pauses the music after 15 minutes to 1.5 hours, or at the end of the song. Hiding it doesn't stop the music. Ctrl+K also has *Music: play / pause*, *next* and *previous*, which you can give your own keys in Settings → Shortcuts.

**On a Mac it works straight away** with the Spotify app (free or Premium), no sign-in. The first time, macOS asks whether Notes may control Spotify: press **OK**. (If you pressed *Don't Allow*, turn it back on in *System Settings → Privacy & Security → Automation*.) If Spotify isn't open, the player has an **Open Spotify** button. Under **Link** in the player you can paste a Spotify share link (*Share → Copy link*) to play a song, album or playlist.

**Connect your Spotify account** (Settings → Music) to also **search** Spotify and pick from **your playlists** in the player, and to control Spotify on your phone, speakers or a Windows PC. With your account you also get:

- **♥ Like** a song to save it to your Liked Songs.
- **Up next** shows what's queued. The **+** next to a song in Search or Recent adds it to the queue.
- **Recent** shows what you've played lately, to get back to it quickly.
- **Make and change playlists**: under Playlists, press **New playlist**, or the **›** next to one of yours to rename or delete it, add songs (search right there, or add the song that's playing), take songs out with **×**, and drag songs into a new order.
- **Choose where it plays**: press the device name at the bottom right of the player and pick this computer, your phone or a speaker. The music moves there and carries on.

Spotify only allows this for Premium accounts, and you make a free developer app on Spotify's site once (about 3 minutes):

1. Open the [Spotify developer dashboard](https://developer.spotify.com/dashboard) and log in with your Spotify account.
2. Press **Create app**, give it any name and description.
3. Under **Redirect URIs**, add exactly `http://127.0.0.1:43117/callback`.
4. Tick **Web API**, accept the terms and **Save**.
5. Copy the **Client ID** into Settings → Music and press **Connect Spotify**, then **Agree** in your browser.

There's no secret to copy. The sign-in is stored encrypted, like the Google one, in `spotify.json` in the settings folder. If Spotify says your account isn't allowed, add your Spotify email under **User Management** in the developer app. If you connected before liking, Recent and playlist editing were added, Settings → Music asks you to connect once more (Disconnect, then Connect) so Notes gets permission for them.

Also under the player:

- **Floating mini player** (the picture-in-picture button, or Ctrl+K → *Music: floating mini player*): a small window with the song, play/pause and skip that stays on top of your other apps. Drag it anywhere; it comes back where you left it, and reopens with Notes if it was showing.
- **Add to note** (the notebook button): puts the song that's playing into the note you're writing, as a card with its picture. Click the card to play the song (Spotify songs and your own files both work); click **Edit** to see the link.
- A **"Now playing" pop-up** in the top corner when the next song starts. Turn it off in Settings → Music.

### Your own music files

**My music** in the player plays music files on your computer (MP3, M4A, FLAC, WAV, OGG), with no Spotify or account needed. The first time, press **Choose music folder**. Notes reads each song's name, artist, album and picture from the file (or from its name, like `01 - Artist - Title.mp3`). Find songs by typing, press one to play it and the rest of the list after it, or press **Shuffle all**. Volume, shuffle, repeat, skip, Up next, the sleep timer and your keyboard's play/pause keys all work the same, and a **visualiser** shows moving bars to the music (switch it off with the bars button, or in Settings → Music; Spotify doesn't let other apps see its sound, so it's only for your own files). Playing something on Spotify stops your music, and **Back to Spotify** at the bottom right of the player hands it back. The folder you chose and what was read from your files are kept in `local-music.json` in the settings folder, so only new or changed files are read again (press ↻ to look for new ones).

## AI helper (optional)

Notes can use Claude, made by Anthropic, to help with your notes. It's off until you add your own Anthropic API key in **Settings → AI helper** (sign up at [console.anthropic.com](https://console.anthropic.com/settings/keys), add a little credit, create a key, paste it in). Anthropic bills your account directly, usually a cent or two each time.

- **Summarise** (hover over a note → *Summarise*): a short summary you can add to the top of the note or copy.
- **Tidy up** (hover over a note → *Tidy up*, or ✨ in quick capture): fixes typos and adds headings, bullets and checkboxes. You see the result first, and Ctrl+Z (or ↶ in quick capture) undoes it.
- **Ask my notes** (Ctrl+K → *AI helper: ask my notes*): ask a question in your own words; Claude answers from the notes that best match it, with links to them.
- **Chat** (the speech bubble at the top, or Ctrl+K → *AI helper: chat with Claude*): ask Claude anything, like a normal chat. Your chats are listed on the side so you can go back to one, rename or delete it, and any chat can be saved as a note. Chats are kept in `ai-chats.json` in the settings folder, on this computer only. Chat doesn't see your notes.

Nothing is sent unless you press one of these. Then only what's needed goes to Anthropic: the note you're working on, for a question the best-matching notes, or in Chat the conversation so far. Locked notes are never sent. The key is stored encrypted, like calendar sign-ins, in `ai.json` in the settings folder.

### Offline AI (optional download)

The AI helper can also run on your own computer, with no internet and nothing sent anywhere. It isn't installed with Orbit: get it from **Settings → AI helper → Offline AI** (or *Offline AI* in the launcher). Pick a model (**Smart**, Qwen3 14B, about 9 GB, for graphics cards with 12 GB or more; or **Quick**, Qwen3 8B, about 5 GB) and press **Download**. It downloads the [llama.cpp](https://github.com/ggml-org/llama.cpp) engine (the NVIDIA CUDA build on Windows with an NVIDIA card, Vulkan for other cards, Metal on Apple Silicon Macs) and the model from Hugging Face, checks both against the SHA-256 their site publishes, and keeps them in `local-ai` in the settings folder. A paused download carries on where it stopped. **Remove** deletes it all.

- Under **Which AI to use**, pick the offline AI or Claude for summaries, tidy-ups, Ask everything, Chat and Ctrl+K's sentence reader. Reading handwriting in sketches always uses Claude.
- An offline answer says so, with an **Ask Claude online** button. When the offline AI thinks a question is too hard for it, it says so and the button stands out. Orbit never goes online by itself.
- **Money:** when you import a statement, *Sort them* puts each payment in a category with the offline AI (shops you've picked a category for before keep it). *Ask about your money* on the Money page answers privately with the offline AI. Bank details never leave the computer.
- **Dictionary:** right-click a word → *Meaning*, then *Explain it as it's used here* for what it means in that sentence.
- It's loaded into the graphics card only when something asks it a question, and unloaded after 10 quiet minutes (or with *Unload now*). While a game from the Games page is running it stays unloaded, so the game gets the whole card (switch that off in Settings if you like).

## Themes from a file

Besides the built-in themes, Notes can wear themes that don't come with the app. A theme file (`.notestheme`) can change the colours, fonts, the pictures behind each part of the app, the loading screen, the icon on starred notes and the app icon. In **Settings → Appearance**, press **Import a theme…** and pick the file; it shows up with the other themes. Hover over it and press **×** to remove it. Importing a newer copy of the same theme replaces the old one.

A theme file only holds looks (colours, pictures, fonts and a few words), never code, so a theme someone sends you can't do anything harmful. Its own app icon is used while the theme is on, unless you turn off **Use a theme's own icon**.

**Making one:** a theme is a folder with a `theme.json` and its pictures and fonts. [src/shared/themePack.ts](src/shared/themePack.ts) describes every field and which parts of the app can have a picture. Pack the folder into a theme file with `npm run pack-theme -- path/to/folder`.

## Send to phone

Right-click a note or file in the sidebar → **Send to phone…**, or press the phone button in a web tab. A QR code appears; point your phone's camera at it and tap the link. The file downloads (or the web page opens) straight from this computer over your Wi-Fi: nothing to install on the phone, no account, and nothing goes through the internet. The phone needs to be on the same Wi-Fi. Each code stops working after 10 minutes, or when you close it. The first time, Windows or macOS asks whether Notes may accept incoming connections: allow it on private networks.

## Your phone and Notes

Press the phone button at the top (or Ctrl+K → *Phone: connect your phone*) and scan the code with your phone's camera. Your phone gets a page with:

- **Send**: photos, videos and files go into the note you have open (or the attachments folder).
- **Clipboard**: see what's copied on the computer and copy it to the phone, or paste something on the phone and send it to the computer's clipboard.
- **Remote**: play/pause and skip music, and control the YouTube mini window (±10 seconds, play/pause, next).
- **Touchpad**: drag to move the pointer, tap to click, two fingers to right-click or scroll, and type on the computer from the phone's keyboard. On a Mac, allow Notes under System Settings → Privacy & Security → Accessibility the first time.
- **Talk**: tap the microphone on the phone's keyboard and talk; the words appear in the open note as you speak.
- **Scan**: take a photo of a page, drag the corners onto it, and it's straightened and cleaned up into the open note. **Add receipt to Money** reads the shop, total and date and adds it as spending.

On an iPhone, tap Share → **Add to Home Screen** to keep the page: it reconnects by itself whenever Notes is open. **New code** or **Forget phone** in the same window stops the old one working. Everything goes over your own Wi-Fi, never the internet, so anyone on the same Wi-Fi who had the code could use it: only pair on networks you trust.

**Wi-Fi for guests** (Ctrl+K → *Phone: Wi-Fi QR code for guests*) shows a code guests scan to join your Wi-Fi without typing the password. Notes fills in the network and password (a Mac asks for your Keychain first); you can change them.


## One mouse, two computers

Use one mouse and keyboard on a Windows PC and a Mac side by side, both running Orbit on the same Wi-Fi. Turn on **Settings → Two computers → Share mouse and keyboard** on both, press **Pair** next to the other computer, and check the same 6-digit code shows on both screens. Then say which side the other computer is on.

- **Push the pointer off that edge** of the screen and it carries on onto the other computer, with the keyboard. Push it back to come home. **Ctrl+Alt+Esc** (⌃⌥Esc on a Mac) brings it straight back, and so does touching the other computer's own mouse or trackpad.
- **Copy on one, paste on the other**: text, formatted text and pictures go across with the pointer. Passwords copied from the vault stay put.
- **Drag a file or folder to the edge** and drop it on the strip that appears: it goes to the other computer's Downloads.
- **Ctrl works as ⌘ on the Mac** (so Ctrl+C, Ctrl+V and Ctrl+Z work the same on both); you can turn this off in the Mac's Orbit settings.
- On a Mac, allow Orbit under System Settings → Privacy & Security → **Accessibility** so the PC's mouse can work there, and allow it on the local network when asked. Windows asks once whether Orbit may accept connections: allow it on private networks.
- Everything goes straight between the two computers over your Wi-Fi, encrypted with keys only they know (what you type is passwords too). Nothing goes through the internet.
## Comic books

Open **Comics** (in All features, or "Read comics" in the command list) and add .cbz or .cbr files, or a whole folder of them. Comics also open straight from the Files tab. Your files stay where they are; Orbit only reads them. A .cbr is unpacked into Orbit's settings folder the first time you open it (the last few you've read are kept, older ones are cleared away), and a .cbz is read straight from the file.

- **Shelf**: covers with a progress bar, and the one you're reading at the top to carry on with.
- **One page, two-page spreads or a long scroll**, fit to the screen or to the width, and right to left for manga. Orbit remembers the exact page (and how far down it, in the long scroll).
- **Issues and chapters**: found from the folders or file names inside big compendiums, to jump between. If none are found, mark where they start yourself.
- **Panel zoom** (Z): click a panel and it fills the screen; → goes to the next panel, then the next page.
- **Zen mode** (F): full screen, dark, Orbit's pop-ups and reminders wait until you're done. Pick a Spotify playlist when you start (or have it remembered for that comic), with a reading timer and pages read today.
- **Scan text** (S): draw a box round a speech bubble or caption to copy its text or add it to a note (read offline). Save a page, a panel or the part you boxed into a note as a picture.

Orbit never makes notes for you: you choose what goes where. Where you're up to is kept by the comic's file name and size, ready to follow you to another computer once Orbit syncs its settings.

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
- **Games** (the game controller at the top, or *Games* in Ctrl+K) — all your games in one place with a **Play** button: Steam games, Epic games, and on a Mac any game in Applications (App Store and Apple Arcade games included). Each shows how long you've played it in all, this week, and when you last played; *Recently played*, *Most played* or *A to Z*, and a search. Time is counted while Notes is running (even with its window closed), by spotting the game running; for Steam games, Steam's own count is used when it's higher, so time from before is there too. Click **Add a game** for anything that isn't found by itself, and use a game's ⋯ menu to hide it or show it in Finder. Times are kept on this computer only.
- **Discord voice pop-out** (*Pop out* on the Discord voice tab, or *Discord: pop out the voice call* in Ctrl+K) — your voice call in a window of its own, to keep on a second screen (it doesn't float over games). It shows everyone in the call with a ring that lights up when they talk and icons for who's muted or deafened, a volume slider for each person and a button to mute someone just for you (only you hear the difference), your own **Mute**, **Deafen**, **Leave** and a hold-to-talk button (it unmutes you while it's held, when you're muted), your mic level so you can see you're coming through, a call timer, the call's text chat, your games with Roblox first (from the Games page; Orbit finds Roblox by itself), your soundboard's sounds, and a **Clip last 30s** button. It opens on the same screen, at the same size and place, every time. When you join a call a small note in the corner offers to pop it out; ignore it and it goes away by itself after a few seconds (turn it off in Settings → Studio). Nothing pops out by itself.
  - **The chat** is read-only: Discord only lets apps read a channel's messages, so **Reply in Discord** opens the channel there. Sign-ins made before this version are asked to sign in again once, so Discord can allow reading the chat.
  - **Watching a stream**: someone sharing their screen shows *LIVE*, with a button that shows Discord's window in Orbit's pop-out window. Discord doesn't let other apps receive a stream, so start watching it in Discord (pop it out of Discord to have just the stream) and Orbit shows that window.
  - **Call clips** work like instant replay: while you're in a call with the pop-out open, the last 30 seconds of what you hear (Windows; on a Mac only your mic) and your mic are kept in memory, and nothing is saved until you press the button. The clip is saved as *Call clip ….webm* in your recordings folder and shows in Clips. It needs the free video add-on (ffmpeg), like instant replay. Untick *Keep ready* to stop recording.
  - **Call history** (on the pop-out and the Discord voice tab): which channel, who was there and for how long, kept only on this computer (`discord-calls.json` in the settings folder). Calls under 15 seconds aren't kept.
- **Web browser tab** (Ctrl+Shift+I, or the globe at the top) — browse the web beside a note in split view. Pages run walled off from your notes and the app. More in [Web browser](#web-browser) below.
- **Video player** (*Video player* in Ctrl+K or All features, or open a video from Files or the notes folder) — plays any video on your computer: MP4, MKV, AVI, WMV, MOV, FLV, TS and more. MP4s and most MKVs play straight away; for the rest (and for MKVs with Dolby/DTS sound, a choice of sound tracks, or their own subtitles) the player uses ffmpeg, the same free one-time download (about 25 MB) as Convert files and the Studio. Those are converted as they play, nothing is saved, and only the sound is converted when the picture can play as it is. **Subtitles**: a subtitle file beside the video with the same name (`Film.srt`, `Film.en.srt`) is used automatically, or pick one (SRT, VTT, ASS/SSA), drop one on the video, or choose one of the video's own tracks; the **Timing** buttons fix subtitles that are early or late. **Speed** from 0.25× to 3× (`[` and `]`). Every video **carries on where you stopped** and remembers its sound track, subtitles and speed; the player's first page lists them under *Carry on watching*. Keys: Space or K play/pause, ← → 5 seconds, J L 10 seconds, ↑ ↓ volume, M mute, F full screen, C subtitles on/off, 0–9 jump to 0–90%.
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
- **Text files** — .txt, .json, .yaml, .ini and other config files, code and other plain text files open in a tab where you can edit them, with line numbers and colours for the language. Changes save as you type (Ctrl+S saves straight away), and Windows line endings are kept. JSON files show whether they're valid and have a *Format* button to lay them out neatly.
- **A font per note** — add a *Font* property: serif, sans, mono, handwriting or any installed font.
- **Saved searches** — click the bookmark in the search box to keep a search in the file list.
- **Sync copies** — when Google Drive keeps two versions of a note (*Plan (1)*), Notes points it out and lets you compare them, combine them or keep one.
- **Import** — Ctrl+K → *Import notes…* brings in notes from Google Keep (Takeout), Notion (Markdown & CSV export), Evernote (.enex), a folder of markdown or text files, or (on a Mac) Apple Notes. They go into an *Imported* folder.
- **Template placeholders** — type `/placeholder` in a template, or see the list in Settings → Calendar. Daily templates keep the date heading unless they have their own.
## Web browser

Web tabs (Ctrl+Shift+I) are a full browser beside your notes. Everything below is in the address bar, the ⋯ menu, or **Settings → Web browser**.

- **Save to Inbox**: the note button saves what you've highlighted (or the whole page, with nothing highlighted) as a note with its link, in the `Inbox` folder, without leaving the page. Also Ctrl+Shift+S, or right-click → *Save selection / page to Inbox*.
- **Page summary**: the ✦ button summarises the page with the AI helper (the offline AI or your key), with *Save to Inbox* for the summary.
- **Bookmarks**: ☆ or Ctrl+D bookmarks a page; a bookmarks bar sits under the address bar (folders open as menus; middle-click opens in a new tab), and ⋯ → *Bookmarks* has them all, with folders, renaming, moving and search.
- **History** (Ctrl+H): search by a page's title, its address, or words that were on it. Private tabs aren't remembered.
- **Downloads**: each download asks which folder it goes in, picked inside Orbit (your usual places, then any folder, with a *New folder* button); untick that in Settings to send them straight to your downloads folder. Ctrl+J shows recent downloads, with *Open* (inside Orbit where it can: pictures, PDFs, videos, comics, zips) and *Show in folder* (the Files tab).
- **Passwords**: signing in to a site offers to save the login in Orbit's Passwords (locked with your master password), and next time a pop-up under the field offers to fill it in. *Never for this site* stops the offers there.
- **Autofill**: save your name, email and address in Settings → Web browser; a pop-up under a form's field offers to fill them in. Nothing is filled until you pick it.
- **Find on page** (Ctrl+F, Enter / Shift+Enter for next and previous), **zoom** (Ctrl+= / Ctrl+- / Ctrl+0, remembered for each site), and **Translate** (offered on pages in another language, or ⋯ → *Translate page*, via Google Translate).
- **Sound**: a speaker shows on any tab playing sound; click it to mute the tab. ⋯ → *Mute* mutes a whole site, and sites playing sound get their own slider in the **volume mixer**, remembered for next time.
- **Private tabs** (⋯ → *New private tab*, or Ctrl+Shift+N in a page): no history, no offers to save logins, and their sign-ins and cookies are forgotten when Orbit closes. They never reopen.
- **Site permissions**: a site that wants notifications, the microphone, the camera, your location or the clipboard asks first with an *Allow / Block* bar. Change your answers (and each site's zoom and sound) in ⋯ → *Site settings* or Settings → Web browser, where *Clear site data* signs you out of just that site.
- **Notifications** from sites you've allowed (Discord, X…) show as Orbit's own; clicking one brings its tab forward. They're held back in streamer mode.
- **Right-click** a link for *Open link in new tab / private tab* and *Copy link*; a picture (Google Images too) for *Save image as…* (you pick the folder inside Orbit), *Save image to attachments* or *Copy image*; or selected text for *Search Google*.
- **Drag a link** from a web page into a note and it becomes a proper link, named after the link's text or the page's title.
- **Web tabs reopen** where you left them when Orbit starts (turn it off in Settings → Web browser).
- **Default browser**: Settings → Web browser → *Make default*. On Windows, Orbit registers itself as a browser and opens Windows' Default apps page, where you pick Orbit for web links (Windows doesn't let apps choose this themselves); macOS asks you to confirm. Links from Discord and other apps then open in a web tab, and *Open in your other browser* uses Edge (or Safari).
- **Import from Opera GX**: Settings → Web browser → *Import* brings in Opera GX's bookmarks and history, and puts its saved logins in Passwords (close Opera GX first). Passwords that newer versions of Opera lock to themselves can't be read by another app: export them from Opera GX (Settings → Passwords → ⋮ → *Export passwords*) and use *Import a passwords file*.
- **Ad blocking**: ads and trackers are blocked on every site except YouTube, where blocking makes YouTube hold videos on "loading". YouTube's ads are muted, sped through and skipped instead.

**Paid streaming sites (NOW, Netflix, Disney+, Prime Video…)** play only protected (DRM) video, which needs Google's Widevine. The version of Electron Orbit is built on doesn't include it, so on those sites Orbit says so and offers to open the page in your other browser. Browsing and signing in still work.

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
| Ctrl+Alt+B | Streamer mode on / off |
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
