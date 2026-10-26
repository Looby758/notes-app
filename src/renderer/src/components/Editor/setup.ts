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
import { notePath, pathCompartment } from './facets'
import { livePreview } from './livePreview'
import { editorTheme, highlightStyle } from './theme'
import { hashtagSyntax, wikiLinkCompletions, wikiLinkSyntax } from './wikilinks'
import { EDITOR_COMMANDS } from './formatting'
import { attachmentHandlers } from './attachments'
import { slashCompletions } from './slash'
import { embedDepth, embeds, setEmbedStateFactory } from './embeds'
import { toCodeMirrorKey } from '../../lib/shortcuts'
import { usePrefs } from '../../store/prefs'

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
    drawSelection({ cursorBlinkRate: p.cursorBlink ? 1200 : 0 }),
    // Above the default keymap, which also uses Ctrl+I.
    Prec.high(keymap.of(editorKeys))
  ]
}

const base: Extension = [
  history(),
  dropCursor(),
  EditorView.lineWrapping,
  EditorState.allowMultipleSelections.of(true),
  markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [wikiLinkSyntax, hashtagSyntax] }),
  syntaxHighlighting(highlightStyle),
  highlightSelectionMatches(),
  autocompletion({ override: [wikiLinkCompletions, slashCompletions], icons: false }),
  attachmentHandlers,
  embeds,
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

export function createState(doc: string, path: string, extra: Extension, prefs: Prefs): EditorState {
  return EditorState.create({
    doc,
    extensions: [base, prefsCompartment.of(prefsExtensions(prefs)), pathCompartment.of(notePath.of(path)), extra]
  })
}
