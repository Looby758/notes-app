import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state'
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
  placeholder
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { indentUnit, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { vim } from '@replit/codemirror-vim'
import type { Prefs } from '@shared/prefs'
import { notePath, pathCompartment, readingFacet } from './facets'
import { livePreview } from './livePreview'
import { editorTheme, highlightStyle } from './theme'
import { hashtagSyntax, highlightSyntax, wikiLinkCompletions, wikiLinkSyntax } from './wikilinks'
import { EDITOR_COMMANDS } from './formatting'
import { attachmentHandlers } from './attachments'
import { slashCompletions } from './slash'
import { snippetCompletions, snippetExpander } from './snippets'
import { selectionToolbar, wrapOnType } from './selectionTools'
import { smartPaste } from './smartPaste'
import { noteFont } from './noteFont'
import { embedDepth, embeds, setEmbedStateFactory } from './embeds'
import { places } from './places'
import { songs } from './songs'
import { toCodeMirrorKey } from '../../lib/shortcuts'
import { typewriter } from './typewriter'
import { calculator } from './calculator'
import { codeRunner } from './codeRunner'
import { autocomplete } from './autocomplete'
import { usePrefs } from '../../store/prefs'

/** Zen mode turns typewriter mode on for as long as it lasts (without changing your settings). */
export const zenCompartment = new Compartment()

/** Holds everything Settings can change, so it can be swapped without rebuilding the editor. */
export const prefsCompartment = new Compartment()

/** The editor's share of the preferences. */
export function prefsExtensions(p: Prefs): Extension {
  const editorKeys = EDITOR_COMMANDS.flatMap((cmd) => {
    const shortcut = cmd.id in p.shortcuts ? p.shortcuts[cmd.id] : cmd.shortcut
    return shortcut ? [{ key: toCodeMirrorKey(shortcut), run: cmd.run }] : []
  })
  return [
    // Vim needs to see keys before anything else.
    p.vimMode ? Prec.highest(vim()) : [],
    p.livePreview ? livePreview : [],
    EditorView.contentAttributes.of({
      spellcheck: p.spellcheck ? 'true' : 'false',
      autocorrect: 'off',
      autocapitalize: 'off'
    }),
    EditorState.tabSize.of(p.tabSize),
    indentUnit.of(p.indentWithTabs ? '\t' : ' '.repeat(p.tabSize)),
    p.lineNumbers ? lineNumbers() : [],
    p.highlightActiveLine ? highlightActiveLine() : [],
    p.autoPair ? [closeBrackets(), keymap.of(closeBracketsKeymap)] : [],
    p.wrapSelection && !p.vimMode ? wrapOnType : [],
    p.selectionToolbar && !p.readingMode ? selectionToolbar : [],
    p.smartPaste ? smartPaste : [],
    p.aiAutocomplete && !p.readingMode ? autocomplete : [],
    drawSelection({ cursorBlinkRate: p.cursorBlink ? 1200 : 0 }),
    // Typewriter mode is for writing; reading mode turns it off.
    p.readingMode ? [] : typewriter(p),
    p.readingMode ? [EditorState.readOnly.of(true), EditorView.editable.of(false), readingFacet.of(true), EditorView.editorAttributes.of({ class: 'cm-reading' })] : [],
    // Above the default keymap, which also uses Ctrl+I.
    Prec.high(keymap.of(editorKeys))
  ]
}

const base: Extension = [
  history(),
  dropCursor(),
  EditorView.lineWrapping,
  EditorState.allowMultipleSelections.of(true),
  markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [wikiLinkSyntax, hashtagSyntax, highlightSyntax] }),
  syntaxHighlighting(highlightStyle),
  highlightSelectionMatches(),
  autocompletion({ override: [wikiLinkCompletions, slashCompletions, snippetCompletions], icons: false }),
  snippetExpander,
  noteFont,
  attachmentHandlers,
  embeds,
  places,
  songs,
  calculator,
  codeRunner,
  editorTheme,
  placeholder('Start writing…'),
  keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab])
]

// Embeds show other notes in read-only editors built from the same pieces.
setEmbedStateFactory((text, path, depth) => {
  const prefs = usePrefs.getState().prefs
  return EditorState.create({
    doc: text,
    extensions: [
      base,
      prefs.livePreview ? livePreview : [],
      notePath.of(path),
      embedDepth.of(depth),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false)
    ]
  })
})

let zenOn = false

/** Typewriter centring and fading while in zen mode (unless reading). */
export function zenExtensions(on: boolean): Extension {
  zenOn = on
  const p = usePrefs.getState().prefs
  return on && !p.readingMode ? typewriter({ typewriterCenter: !p.typewriterCenter, typewriterDim: !p.typewriterDim, typewriterDimUnit: p.typewriterDimUnit }) : []
}

export function createState(doc: string, path: string, extra: Extension, prefs: Prefs): EditorState {
  return EditorState.create({
    doc,
    extensions: [base, prefsCompartment.of(prefsExtensions(prefs)), zenCompartment.of(zenExtensions(zenOn)), pathCompartment.of(notePath.of(path)), extra]
  })
}
