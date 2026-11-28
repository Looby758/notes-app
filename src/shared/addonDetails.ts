/** The store's categories, in order, and the add-ons in each (every add-on the store shows is in exactly one). */
export const ADDON_CATEGORIES: { name: string; addons: string[] }[] = [
  { name: 'Notes and writing', addons: ['summon-bar', 'canvas-board', 'mind-map', 'sketch', 'graph', 'random-note', 'flashcards', 'zen'] },
  { name: 'Plan your time', addons: ['calendar', 'weather', 'countdowns', 'clocks'] },
  { name: 'Money and passwords', addons: ['money', 'passwords'] },
  { name: 'Friends and messages', addons: ['email', 'messages', 'discord-voice'] },
  { name: 'AI and the web', addons: ['ask', 'ai-chat', 'claude', 'grok', 'offline-ai', 'web'] },
  { name: 'Music and sound', addons: ['music', 'songid', 'soundboard', 'mixer', 'audio-editor'] },
  { name: 'Watch and read', addons: ['video-player', 'comics', 'wiki'] },
  { name: 'Gaming', addons: ['games', 'skyblock', 'mini-games', 'evolution', 'clips'] },
  { name: 'Make videos', addons: ['video-projects', 'studio', 'screenshots', 'timeline', 'streamer'] },
  { name: 'Files and downloads', addons: ['files', 'downloads', 'convert', 'pdf-editor', 'filesender'] },
  { name: 'Phone and screens', addons: ['phone', 'second-screen', 'screens'] },
  { name: 'Your computer', addons: ['snip', 'task-manager', 'uninstaller', 'macros', 'keyremap', 'terminal', 'appstudio'] }
]

/**
 * What each add-on is, in a few sentences, for its page on the Add-ons page (the store later).
 * Every add-on the store shows has one (addons.test.ts checks). Pictures are in
 * renderer/public/addons/<id>.webp, made by scripts/addon-pictures.mjs (a new add-on needs an entry there).
 */
export const ADDON_ABOUT: Record<string, string> = {
  // Notes
  'summon-bar':
    'A bar that pops up over any app with a shortcut. Jot a thought into a note, ask the AI something, work out a sum or convert units, or run any Orbit command, then carry on with what you were doing.',
  graph: 'A map of your notes and the links between them. See which notes are connected, spot ones that are on their own, and click any dot to open that note.',
  'random-note': 'Opens a note at random, so old ideas come back round. You can choose whether daily notes are included.',
  'canvas-board':
    'Free-form boards where notes, pictures, sketches and sticky notes sit anywhere you like, joined with arrows. Good for planning, mood boards and working things out visually.',
  'mind-map': 'Shows a note as a mind map, with its headings and lists branching out from the middle. Switch back and forth any time; the note itself doesn’t change.',
  sketch:
    'Draw or write by hand straight into a note, with a pen, highlighter and eraser. Handwriting can be turned into typed text, by the AI helper or on this computer.',

  // Plan
  calendar:
    'Your week and month in one place. Events come from your daily notes, Google calendars or calendar links, and reminders from your notes. With Money added your bills and paydays show too, and with Weather the forecast for each day.',
  weather: 'Today’s weather and the week ahead on Home, plus a forecast beside outdoor events in the calendar. Pick your town once; there’s nothing to sign up for.',
  'video-projects':
    'Everything for each video in one place: the script, research, pictures, recordings and where it’s up to. Publishing then helps with the title, description, tags and chapters when it’s time to upload.',
  countdowns: 'Count the days until a new season, a game update, a trip or a birthday. They can show on Home so you always know how long is left.',
  clocks: 'The time where your friends are, with daylight saving taken care of. See at a glance whether someone’s likely to be awake before you message them.',
  screenshots: 'Keep screenshots tagged by character, season and episode, so the right picture is easy to find when you’re writing a script.',
  timeline: 'Put a story in order by era and episode, including what was shown in flashbacks, so you can see what really happened when.',
  flashcards: 'Turn notes into flashcards and review the ones that are due each day. Cards you find hard come back sooner, and easy ones wait longer.',
  zen: 'Full screen with nothing but you and your note. Comes with a focus timer that counts work and breaks for you.',

  // Money
  money:
    'Read in your bank statements and see where your money goes, set budgets and savings goals, and keep track of subscriptions. Spots the bills and paydays that repeat, so nothing catches you out.',
  passwords: 'Your logins, kept locked on this computer behind your own password. Fill them into web pages in Orbit, and see which ones are weak or used twice.',

  // Connect
  email: 'Read and answer your Gmail in a tab, beside your notes. Ask everything can look through it for you too, if you let it.',
  'discord-voice':
    'See who’s in your Discord voice call and who’s talking, mute and deafen yourself, and pop the call out over a game on your second monitor. Can turn your music down while people speak.',
  messages: 'WhatsApp and Discord in tabs, so your chats are beside your notes without another app open.',
  phone:
    'Connect your phone with a QR code. Send files and links both ways, use it as a remote, touchpad or Stream Deck, or use its camera as your computer’s webcam.',
  'second-screen': 'Use your MacBook as a second screen for the PC, or see and use the Mac from the PC in a window.',
  web: 'Web pages in tabs beside your notes, with bookmarks, downloads, saved logins and translating. Links in notes can open here instead of your usual browser.',
  claude: 'Claude (claude.ai) in a tab or floating over your notes, signed in as you. App Studio can send your ideas and bugs straight to a Claude project.',
  grok: 'Grok in a tab or floating over your notes, signed in as you.',
  'ai-chat': 'Chat with Claude about anything, in a tab. Chats are kept, so you can come back to them.',
  ask: 'Ask questions and get answers from your own notes. If you allow it, it can also look at your email, calendar and money to answer things like “what’s on this week?”',

  // Media
  music:
    'Your own songs as a full music library of albums, artists, playlists and likes, with Spotify in the Home page’s Now playing box. Download a song from a video link straight into it, and see lyrics and a visualiser while it plays.',
  songid: 'Listen to whatever’s playing in a video, game or stream and find out what the song is. Add it to your music or a playlist in one click.',
  'video-player': 'Plays almost any video, with subtitles, playback speed and an Up next list. Pop it out over other windows to watch while you work.',
  comics: 'A shelf for your .cbz and .cbr comic books, and a reader that shows a page or one panel at a time. Remembers where you were in each one.',
  wiki: 'Download a Fandom wiki to read offline without the ads, and ask an AI questions that it answers from that wiki.',
  soundboard:
    'Sounds on buttons and hotkeys, played into Discord calls as well as to you. Includes a voice changer, and you can cut a sound straight from a video link.',

  // Play
  games: 'All your Steam and other games in one place, with their covers. For Hypixel SkyBlock, it can sum up each session: coins per hour, drops and XP.',
  skyblock: 'See a SkyBlock profile like SkyCrypt does, plan ironman goals step by step, and keep an eye on event timers.',
  evolution:
    'Build a world and design the species in it, then watch them evolve. Nobody tells them how to survive: they get better by trial and error, generation after generation, and you can pause, speed up or rewind any time.',
  'mini-games': 'Quick games for a break: Sudoku, Minesweeper, Nonograms, Jigsaw, Wordle, Word search, Hangman, Solitaire, Blackjack, 2048, Breakout and Chess.',

  // Tools
  snip: 'Drag a box anywhere on screen to copy it as a picture, or grab the text in it to copy, search, translate or ask the AI about. Works from a shortcut, the tray or the taskbar.',
  'task-manager': 'See what’s running and what it’s using: CPU, memory, disk and network. End an app that’s stuck or slowing everything down.',
  uninstaller: 'Remove an app properly, along with the files, settings and leftovers it would normally leave behind, and see how much space you get back.',
  mixer: 'A volume slider for each app, so games, Discord and Spotify can each be as loud as you want.',
  'audio-editor': 'Trim a song, voice memo or recording: see its waveform, listen, pick the part you want and save it as a new MP3 or WAV. The original stays as it is.',
  screens: 'Change your monitors’ brightness, contrast and input from Orbit, with hotkeys for each, without touching the buttons on the screen.',
  files: 'Browse the files on your computer in a tab, with previews, tags, zips and a search of the whole PC. Open two folders side by side to drag files between them.',
  'pdf-editor': 'Sign PDFs, fill in forms, and merge, split, rotate or reorder pages, all on this computer.',
  convert: 'Turn files into other kinds: photos, documents, audio and video. Make a GIF from a video, a PDF from pictures, an MP3 from a video and more.',
  filesender: 'Send huge files or whole folders straight to a friend with a short code. Nothing’s uploaded to a website in between.',
  downloads:
    'Download files and videos from links (YouTube, X, TikTok, Reddit and more). Pause, queue, or leave them to run overnight, with a speed limit if you need one.',
  clips: 'Instant replay: press a key to save the last 30 seconds of your game, then trim it, caption it and send it to a Discord channel.',
  'offline-ai': 'Run an AI on your own graphics card, so it works with no internet and nothing leaves your computer. Get a model and manage it here.',
  terminal: 'Command lines in tabs, with run buttons for the apps you’re working on.',
  appstudio: 'Your apps made with Claude Code in one place: keep a board of ideas and bugs, try and merge what Claude made, and run your apps.',
  studio:
    'Record your screen, webcam or a voiceover with a teleprompter, or go live. Your mic gets cleaned up as it records, and presets keep your setups ready.',
  macros: 'Record keys and mouse clicks and play them back exactly, on a hotkey. Includes an auto-clicker.',
  keyremap: 'Make any key act as another key or a shortcut, everywhere or just while one game is open.',
  streamer: 'Blurs private things, like note names and messages, while you share your screen or stream.'
}

/**
 * How each add-on works, step by step, for its page on the Add-ons page: a few points, each a short
 * bold lead and a sentence or two. Every add-on the store shows has at least three (addons.test.ts
 * checks).
 */
export const ADDON_HOW: Record<string, [lead: string, text: string][]> = {
  // Notes and writing
  'summon-bar': [
    ['Press the shortcut anywhere', 'Win+Shift+N (⌃⌥Space on a Mac) opens a small bar over whatever app you’re in. Type, press Enter, and you’re back where you were.'],
    ['It works out what you meant', 'A thought goes into today’s note (or your Inbox). Write a time, like “dinner with Jack at 8 tomorrow”, and it goes in the calendar instead, with a reminder if you want one.'],
    ['Send it anywhere', 'The → menu at the top puts it in any other note or folder. ✨ tidies it up with the AI helper first, and ↶ undoes that.'],
    ['More than notes', 'Ask the AI a question, work out a sum (“15% of 80”, “5 km in miles”) or run any Orbit command, all from the same bar.']
  ],
  'canvas-board': [
    ['Start a board', 'Press the board button at the top of the file list, or right-click a folder → New canvas board. It’s an endless space you can scroll and zoom.'],
    ['Fill it', 'Drag notes and pictures in from the sidebar, double-click for a sticky note, or use the toolbar to add a note, a picture, a sketch or a group.'],
    ['Join things up', 'Drag from the dot on a card’s edge to another card to draw an arrow. Groups keep related cards together when you move them.'],
    ['Your notes stay notes', 'A note on a board is the real note: edit it there or in its own tab and both stay the same.']
  ],
  'mind-map': [
    ['Turn any note into a map', 'Switch a note to its mind map and its headings and lists become bubbles branching out from the title in the middle.'],
    ['Move around it', 'Drag bubbles to arrange them, drag the background to move around and scroll to zoom. Fit shows the whole map, and Tidy puts every bubble back in place.'],
    ['Jump back to the text', 'Double-click a bubble to go to that part of the note. The note itself never changes: the map is just another way of looking at it.']
  ],
  sketch: [
    ['Draw in a note', 'Type /sketch, or right-click → Draw a sketch. You get a pen that follows pen pressure, a highlighter, an eraser, colours, and squared or lined paper.'],
    ['It’s saved as a picture', 'The sketch goes in your attachments folder and shows in the note. Hover over it and press Edit sketch to add more later.'],
    ['Handwriting to text', 'Turn into text reads what you wrote and shows it as typed text to check, then adds it to the note, with or without the drawing. The AI helper copes with messy writing; the offline reader works best with neat letters.']
  ],
  graph: [
    ['Two ways to look', 'Neighbourhood puts one note in the middle with what it links to in rings around it. Constellation shows every note at once as a glowing dot, coloured by folder.'],
    ['Find what’s on its own', 'Notes with no links stand apart, so you can spot ideas you never connected to anything.'],
    ['Click to go there', 'Click a dot to move the map to that note, or open it. Ctrl+Shift+G opens the graph from anywhere.']
  ],
  'random-note': [
    ['One click', 'Open Random note from Ctrl+K or the launcher and Orbit opens a note you wrote at some point, picked at random.'],
    ['Old ideas come back round', 'It’s a quick way to stumble on things you’d forgotten, and maybe link them to what you’re doing now.'],
    ['Daily notes or not', 'Choose in Settings whether your daily notes can come up, or only your other notes.']
  ],
  flashcards: [
    ['Write cards in any note', 'Put Question :: Answer on its own line (or as a list item) and it becomes a card. Your cards live in your notes, so they sync like everything else.'],
    ['Review what’s due', 'The Flashcards page shows how many are due today. Press Space to see the answer, then Again, Hard, Good or Easy (1 to 4).'],
    ['It spaces them out', 'Cards you know come back less and less often; ones you get wrong come back soon. Review everything at once or just one note’s cards.']
  ],
  zen: [
    ['Just the note', 'Ctrl+Alt+Z goes full screen with only the note you’re writing. Everything else is hidden until you leave.'],
    ['Stay on the line you’re writing', 'Typewriter mode keeps the current line in the middle of the screen and can fade everything but the paragraph you’re on.'],
    ['A focus timer', 'Set how long to focus and rest and how many rounds. It counts for you and plays a chime when it’s time for a break.']
  ],

  // Plan your time
  calendar: [
    ['Your week from your notes', 'Events under a ## Schedule heading in a daily note (like “- 09:30-10:30 Standup”), tasks with due dates, and notes with a date all show up by themselves.'],
    ['Add your other calendars', 'Paste a Google, Outlook or Apple calendar link to see it here, or sign in with Google to add, move and edit those events from Orbit too.'],
    ['Drag things around', 'Month, week and day views. Drag an event to another time or day and drag its bottom edge to change how long it is. Repeating events like “every Tuesday” just work.'],
    ['It knows about the rest', 'With Money added, bills and paydays show on their days. With Weather, each day gets a forecast, and outdoor plans get the forecast for that hour.']
  ],
  weather: [
    ['Pick your town once', 'Type your town or postcode in the Weather box on Home and choose it. There’s no account or sign-up.'],
    ['On Home', 'What it’s like now, today’s high and low, the chance of rain, and the week ahead.'],
    ['In the calendar', 'Each of the next two weeks gets a small forecast, and anything that sounds like it’s outside (a walk, football, the beach) shows the forecast for when it starts.'],
    ['Works offline', 'It checks every half hour while it’s on screen and keeps the last forecast, so it still shows without the internet.']
  ],
  countdowns: [
    ['Add what you’re waiting for', 'A new season, a game update, a trip or a birthday: give it a name and a date.'],
    ['See how long is left', 'Each one counts down the days, and the soonest show big on Home so you see them every day.'],
    ['Gone when it’s happened', 'Once the day comes it’s done, so the list stays about what’s still ahead.']
  ],
  clocks: [
    ['Add a friend', 'Type their name and pick their town, and they get a clock of their own.'],
    ['Daylight saving handled', 'Every clock follows its own town’s clock changes, so you never have to work out the difference yourself.'],
    ['Awake or asleep?', 'See at a glance what time it is where they are before you message or call.']
  ],

  // Money and passwords
  money: [
    ['Read in your statements', 'Drop in a bank statement (CSV) and Orbit lays out every payment. If the columns look wrong you can change them, and it remembers for next time.'],
    ['See where it goes', 'Payments are sorted into categories (the offline AI can do this privately), with monthly budgets so you can see what’s left.'],
    ['Spots what repeats', 'Subscriptions, bills and paydays that come round regularly are picked out and shown in the calendar, so nothing catches you out. Mark one cancelled and Orbit warns you if it charges again.'],
    ['Saving for something', 'Add a goal with an amount and a date, and see how close you are and how much to put aside each week.']
  ],
  passwords: [
    ['Locked behind your own password', 'Everything is encrypted (AES-256) with a master password only you know, kept on this computer.'],
    ['Save and copy logins', 'Keep the name, username, password, website and notes for each one. Search, and copy a username or password in one click.'],
    ['Fill them in for you', 'In Orbit’s web browser, signing in offers to save the login, and next time it offers to fill it in.'],
    ['Make them stronger', 'Make strong random passwords, and see which of yours are weak or used in more than one place.']
  ],

  // Friends and messages
  email: [
    ['Connect Gmail once', 'It uses the same Google sign-in as the calendar. After that your inbox opens in a tab next to your notes.'],
    ['Read and reply', 'Inbox, Unread, Starred, Sent and All mail, Gmail’s own search, and Reply, Reply all, Forward and Write.'],
    ['Turn emails into things', 'Save as note keeps an email in your notes with a link back to it. Add to calendar puts it on its day, picking up times like “Friday at 7pm”.'],
    ['Private by default', 'Emails aren’t saved on your computer, and pictures stay hidden until you choose to show them, so senders can’t tell you opened one.']
  ],
  messages: [
    ['Sign in once', 'WhatsApp and Discord open as tabs. Sign in the way you would in a browser and they stay signed in.'],
    ['Beside your notes', 'Put a chat in split view next to a note, so you don’t need another app open.'],
    ['Notifications too', 'New messages show as Orbit notifications, and clicking one takes you to the chat.']
  ],
  'discord-voice': [
    ['Connect Discord', 'Sign in once and Orbit sees the voice call you’re in.'],
    ['See who’s talking', 'Everyone in the call, with a ring that lights up when they speak and who’s muted or deafened. Mute and deafen yourself from here, and set each person’s volume.'],
    ['Pop it out', 'Put the call in a window of its own to keep on your second monitor while you play.'],
    ['Music ducks for you', 'With the volume mixer it can turn your music down while people speak and bring it back after.']
  ],

  // AI and the web
  ask: [
    ['Ask in your own words', 'Type a question like “what did I decide about the trip?” and the AI answers from the notes that match best, with links to them.'],
    ['More than notes, if you allow it', 'It can also look at your email, calendar and money to answer things like “what’s on this week?” or “how much did I spend on food?”'],
    ['You choose the AI', 'It uses Claude with your own key, or the offline AI so nothing leaves your computer. Locked notes are never sent.']
  ],
  'ai-chat': [
    ['Chat about anything', 'Questions, explanations, writing help and ideas, like any chat with Claude.'],
    ['Your chats are kept', 'They’re listed on the side so you can go back, rename or delete them, and any chat can be saved as a note.'],
    ['Your key, your account', 'Add your own Anthropic key in Settings (it usually costs a cent or two a chat), or use the offline AI. Chat doesn’t see your notes.']
  ],
  claude: [
    ['claude.ai, signed in as you', 'Claude’s own website in a tab, so your projects, chats and subscription are all there.'],
    ['Float it over your notes', 'Pop it out into a small window that stays on top while you write.'],
    ['Send ideas from App Studio', 'App Studio can send your ideas and bug reports straight into a Claude project.']
  ],
  grok: [
    ['Grok, signed in as you', 'Grok’s own website in a tab, with your account and chats.'],
    ['Float it over your notes', 'Pop it out into a small window that stays on top while you write.'],
    ['Next to anything', 'Put it in split view beside a note or a web page to work with both.']
  ],
  'offline-ai': [
    ['Download a model once', 'Pick Smart (about 9 GB, for graphics cards with 12 GB or more) or Quick (about 5 GB) and press Download. You can keep using Orbit meanwhile.'],
    ['Nothing leaves your computer', 'It runs on your own graphics card with no internet. Use it for summaries, tidy-ups, Ask everything, Chat, sorting your spending and more.'],
    ['Gets out of the way', 'It only loads when something asks it a question, unloads after 10 quiet minutes, and stays unloaded while a game is running.']
  ],
  web: [
    ['A full browser in a tab', 'Bookmarks bar, history you can search, downloads, find on page, zoom, translate and private tabs.'],
    ['Saved logins and autofill', 'Logins go in Orbit’s Passwords and fill themselves in next time. Your name and address can fill in forms too.'],
    ['Works with your notes', 'Save what you’ve highlighted (or the whole page) to your Inbox, summarise a page with the AI, or drag a link into a note.'],
    ['Ads blocked', 'Ads and trackers are blocked on every site. YouTube’s ads are muted and skipped instead.']
  ],

  // Music and sound
  music: [
    ['Your songs and Spotify together', 'A small player in the corner plays Spotify and your own music files. Choose your music folder once and Orbit reads each song’s name, artist, album and picture.'],
    ['A full music library', 'Albums, artists, playlists and liked songs, with search, shuffle, a sleep timer and a floating mini player that stays on top.'],
    ['Grab songs from links', 'Paste a video link and the song downloads straight into your library.'],
    ['Lyrics and a visualiser', 'See the words as the song plays, and a visualiser that moves with the music. Your keyboard’s media keys work even when Orbit isn’t in front.']
  ],
  songid: [
    ['Listen to what’s playing', 'Press it while a video, game or stream plays and Orbit listens to the sound coming out of your computer.'],
    ['Find out what it is', 'It tells you the song and who it’s by.'],
    ['Keep it', 'Add it to your music or a playlist in one click.']
  ],
  soundboard: [
    ['Sounds on buttons and hotkeys', 'Each sound gets a button and a hotkey that works everywhere, even in a full-screen game.'],
    ['Into your Discord call', 'Orbit plays the sounds into your mic, so everyone in the call hears them as well as you.'],
    ['Cut one from a video', 'Paste a YouTube, TikTok, Instagram or X link. Only the sound downloads; drag to pick the part you want and it becomes a button.'],
    ['Voice changer', 'Change how your voice sounds in the call while you talk.']
  ],
  mixer: [
    ['A slider for each app', 'Everything making sound gets its own volume, so a game, Discord and Spotify can each be as loud as you like.'],
    ['Mute one thing', 'Silence just one app without touching the rest.'],
    ['Quieter music while people talk', 'In a Discord call, music dips while someone speaks and comes back a moment after.']
  ],
  'audio-editor': [
    ['Open a sound file', 'Drop one in, or press Trim audio on a sound file in Files. MP3, WAV, M4A, FLAC, OGG and more.'],
    ['Pick the part', 'Drag on the waveform, nudge the edges, or type exact times. Keep that part, or cut it out and join the rest.'],
    ['Listen first', 'Play hears it exactly as it will be saved, fades and all.'],
    ['Save a copy', 'As an MP3 or WAV. It all happens on this computer and your original isn’t touched.']
  ],

  // Watch and read
  'video-player': [
    ['Plays almost anything', 'MP4, MKV, AVI, WMV, MOV and more. Open a video from Files or your notes folder, or from the player itself.'],
    ['Subtitles and speed', 'Pick subtitles and sound tracks, change the playback speed, and keep an Up next list.'],
    ['Watch while you work', 'Pop it out into a window that floats over your other apps.']
  ],
  comics: [
    ['A shelf for your comics', 'Add .cbz and .cbr files or a whole folder. Covers show with a progress bar, and the one you’re reading is at the top.'],
    ['Read your way', 'One page, two-page spreads or a long scroll, right to left for manga, and Orbit remembers exactly where you were.'],
    ['Panel by panel', 'Click a panel and it fills the screen; → goes to the next one. Jump between issues and chapters in big collections.'],
    ['Zen reading', 'Full screen and dark, with pop-ups held back and a playlist to read to.']
  ],
  wiki: [
    ['Download a wiki', 'Paste a Fandom address, like walkingdead.fandom.com, and Orbit saves the pages to read offline, with no ads.'],
    ['No spoilers', 'Tell it how far you are in the show or comics and pages past that point stay hidden.'],
    ['Ask it questions', 'The wiki brain answers questions like “How did Glenn meet Maggie?” from the wiki’s own pages, using the offline AI, so nothing is sent online.']
  ],

  // Gaming
  games: [
    ['Every game in one place', 'Steam and Epic games (and Mac games in Applications) appear by themselves, with their covers and a Play button.'],
    ['How long you’ve played', 'Each game shows your time this week and in all, and when you last played. Sort by recent, most played or A to Z.'],
    ['SkyBlock sessions', 'For Hypixel SkyBlock, each session is summed up for you: coins per hour, drops and XP.']
  ],
  skyblock: [
    ['Look up a profile', 'Type a player’s name to see their SkyBlock profile laid out like SkyCrypt: skills, slayers, dungeons, accessories, pets and more.'],
    ['Plan ironman goals', 'Pick an item you want and Orbit breaks it into a crafting tree with every raw material, then tracks what you’ve got.'],
    ['Keep an eye on timers', 'Event timers show what’s coming up, so you don’t miss one.']
  ],
  evolution: [
    ['You decide everything', 'Make your own species: what they eat, who they hunt, how big, fast and sharp-eyed they start, and whether the ones they catch turn into one of them.'],
    ['Shape the world', 'Draw walls, lush land, barren land and danger zones, and set how fast food grows, how harsh life is and how much babies change.'],
    ['Evolution by trial and error', 'Every creature has a small brain that starts out random. The ones that happen to survive have babies with their genes, changed a little, so each generation gets better.'],
    ['Watch it happen', 'Pause, speed up to thousands of steps a second, or rewind. Click a creature to follow it and see its brain light up, and see the charts of how each species is changing.']
  ],
  'mini-games': [
    ['Twelve games in one tab', 'Sudoku, Minesweeper, Nonograms, Jigsaw, Wordle, Word search, Hangman, Solitaire, Blackjack, 2048, Breakout and Chess.'],
    ['Pick your level', 'Most have easy to hard levels. Jigsaw cuts any photo you choose into 12 to 150 pieces.'],
    ['Your stats', 'Each game keeps your wins and best times, so you can try to beat them next break.']
  ],
  clips: [
    ['Always ready to save', 'Instant replay keeps the last 30 seconds of your screen in memory. Press the hotkey and that moment is saved.'],
    ['Sorted by game', 'Clips go into a folder for the game you were playing.'],
    ['Trim and caption', 'Pick a clip, drag the start and end (or press I and O), and add a caption.'],
    ['Send it to Discord', 'Send it to a Discord channel in one click (Orbit makes it small enough), or drag the video into any chat.']
  ],

  // Make videos
  'video-projects': [
    ['Catch ideas first', 'Jot a video idea here, or type “video idea: …” in Ctrl+K or the summon bar, before it’s gone. Turn one into a project when you’re ready.'],
    ['Everything for one video', 'Each project keeps its script, research, pictures, recordings and thumbnail ideas together, and shows where it’s up to.'],
    ['Ready to publish', 'Publishing helps you write title options, the description, tags and chapters, and shows how your pick looks on YouTube.']
  ],
  studio: [
    ['Record or go live', 'Record your screen, webcam or a voiceover, or stream live. Arrange your screen, webcam, pictures and text in scenes.'],
    ['A teleprompter', 'Put any script note on the teleprompter, split into sections, so you can read while you record.'],
    ['A cleaner mic', 'Your voice is cleaned up as it records, and a meter shows you’re at the right level.'],
    ['Presets', 'Save your setups so they’re ready next time.']
  ],
  screenshots: [
    ['Every picture in your notes', 'Screenshots you paste or drag into notes show up here, ready to tag.'],
    ['Tag them', 'Add the characters in each one and the episode or comic issue it’s from. Ctrl+click or Shift+click to tag several at once.'],
    ['Find the right one fast', 'Search by name, character or episode (like “maggie s4”) when you’re writing a script.']
  ],
  timeline: [
    ['Eras and episodes', 'Add the story’s eras (like “Hilltop”) and put what happened in each, with the episode or issue it’s from.'],
    ['Quick add while watching', 'Type something like “S4E9 12:30 Maggie and Glenn find the cell block” and it’s added in the right place.'],
    ['What really happened when', 'Flashbacks go where they really happened, not where they were shown. Pick two or more characters to see their stories side by side.']
  ],
  streamer: [
    ['One switch', 'Turn it on with the eye at the top or Ctrl+Alt+B. A red LIVE badge shows it’s on.'],
    ['Private things blurred', 'Note names, emails, messages, money, logins, calendar events and your weather town are blurred while you share your screen or stream.'],
    ['Click to peek', 'Click something blurred to show just that, without opening it. Turning it off and on hides everything again.']
  ],

  // Files and downloads
  files: [
    ['Browse your computer', 'Every folder and file in a tab, with previews, back and forward, and tabs of their own. Open two folders side by side to drag files between them.'],
    ['Search the whole PC', 'Pick Whole PC next to the search box and results show as you type, from every drive.'],
    ['Tags and favourites', 'Give files and folders colour tags (Alt+1 to Alt+7) and star the folders you use most.'],
    ['Zips and the Recycle Bin', 'Look inside zips, see folder sizes, and put things back from the Recycle Bin.']
  ],
  downloads: [
    ['Paste links', 'Files, or videos from YouTube, X, Instagram, TikTok, Reddit, Twitch and more. They download in order, a couple at a time.'],
    ['Pause and carry on', 'Pause any of them and carry on later, even after closing Orbit. Move them up and down the queue.'],
    ['Tonight', 'Leave big ones to download overnight, with a speed limit if you need the internet for something else.']
  ],
  convert: [
    ['Drop files in', 'Pictures, sound files, videos and documents. Convert lots at once.'],
    ['Pick what you want', 'iPhone photos to JPG, PNG or WebP (and smaller), sound to MP3 or WAV, Word to PDF, notes to PDF or Word, and more.'],
    ['Make things from videos', 'Make a GIF or an MP3 from a video, or a PDF from pictures.'],
    ['All on this computer', 'Nothing is uploaded to a website to be converted.']
  ],
  'pdf-editor': [
    ['Open a PDF', 'From the PDF editor, or Edit PDF on a PDF in Files.'],
    ['Sign and fill in', 'Draw your signature or type your name in a handwriting font, then drag it where it goes. Tick Remember it to use it again. Fill in forms the same way.'],
    ['Change the pages', 'Merge PDFs, split them, and rotate, reorder or take out pages.'],
    ['All on this computer', 'Your documents never leave it.']
  ],
  filesender: [
    ['Drop files on Send', 'Files or whole folders, with no size limit. You get a short code like 4821-tiger-piano-river.'],
    ['Your friend types the code', 'In their Orbit, under Get. They see who it’s from and how big it is, and press Accept.'],
    ['Straight between you', 'The files go directly from your computer to theirs, locked so only they can open them. If it drops, it carries on where it stopped.'],
    ['Friend without Orbit?', 'Make a Google Drive link instead. It’s taken down again after 7 days.']
  ],

  // Phone and screens
  phone: [
    ['Scan a code', 'Press the phone button and scan the code with your phone’s camera. There’s nothing to install, and everything stays on your Wi-Fi.'],
    ['Send things both ways', 'Photos, videos and files go into the note you have open. Share the clipboard either way.'],
    ['A remote and touchpad', 'Control your music, move the pointer and type from your phone, or use it as a Stream Deck.'],
    ['Its camera as your webcam', 'Use your phone’s camera as the computer’s webcam in calls and recordings.']
  ],
  'second-screen': [
    ['Your MacBook as a screen', 'Use the MacBook next to your PC as an extra monitor for the PC.'],
    ['Or see the Mac from the PC', 'Show the Mac’s screen in a window on the PC and use it from there.'],
    ['Over your Wi-Fi', 'Both run Orbit on the same network; the picture goes straight between them.']
  ],
  screens: [
    ['Every monitor in one place', 'Orbit finds your screens and shows a slider for each one’s brightness and contrast.'],
    ['Switch inputs', 'Change a screen to HDMI, DisplayPort or USB-C from Orbit instead of its buttons.'],
    ['Hotkeys', 'Give brightness and inputs hotkeys of their own. If a screen doesn’t answer, turn on DDC/CI in its own menu.']
  ],

  // Your computer
  snip: [
    ['Drag a box', 'From a shortcut, the tray or the taskbar, drag a box anywhere on screen.'],
    ['Copy it as a picture', 'It’s copied, ready to paste into a note, a chat or anywhere else.'],
    ['Or grab the text', 'Orbit reads the words in the box so you can copy them, search them, translate them, ask the AI about them, or add them to today’s note.']
  ],
  'task-manager': [
    ['See what’s running', 'Every app and process, with the CPU, memory, disk and network each one is using.'],
    ['Find the slow one', 'Sort by what’s using the most, or search by name.'],
    ['End a stuck app', 'Close an app that’s frozen or slowing everything down.']
  ],
  uninstaller: [
    ['Pick an app', 'See everything installed, with search.'],
    ['Remove it properly', 'Orbit runs the app’s own uninstaller, then finds the files, settings and caches it left behind.'],
    ['See what you get back', 'Choose which leftovers to delete and see how much space it frees.']
  ],
  macros: [
    ['Record', 'Press record and do something with the keyboard and mouse. Orbit saves exactly what you did, with the timing.'],
    ['Play it back', 'Give it a hotkey that works anywhere, even in a full-screen game. Press it again to stop.'],
    ['Auto-clicker', 'Click or hold a key over and over at the speed you pick.'],
    ['Failsafes', 'A stop hotkey always works, and removing the add-on stops anything running straight away.']
  ],
  keyremap: [
    ['Pick a key', 'Choose the key you press and what it should do: another key, or a shortcut.'],
    ['Everywhere or just one game', 'Remaps can work in every app, or only while a certain game is in front. Open the game for a moment and it shows up to pick.'],
    ['Switch them off any time', 'One switch turns every remap on or off. Orbit never turns them off by itself.']
  ],
  terminal: [
    ['Command lines in tabs', 'PowerShell on Windows, your usual shell on a Mac. They keep running while you switch tabs.'],
    ['Run buttons', 'Add an app you’re working on and its commands become buttons, like npm run dev.'],
    ['Copy and paste as usual', 'Ctrl+C copies when text is selected and stops the running command otherwise.']
  ],
  appstudio: [
    ['Your apps in one place', 'Add the folders of apps you make with Claude Code and see their branch, last change and open pull requests.'],
    ['Try what Claude made', 'Try a pull request in a test copy of its own, then merge it or close it from here. Try Orbit as a new user, too.'],
    ['A board of ideas and bugs', 'Keep ideas and bugs for each app, and send them to Claude.'],
    ['Releases', 'Check an app’s health and release new versions.']
  ]
}
