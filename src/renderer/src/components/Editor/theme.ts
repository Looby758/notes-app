import { HighlightStyle } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

export const editorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      color: 'var(--text)',
      backgroundColor: 'transparent',
      fontSize: 'var(--editor-font-size)'
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'var(--font-editor)',
      lineHeight: 'var(--editor-line-height)',
      overflow: 'auto'
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      border: 'none',
      color: 'var(--text-faint)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.75em'
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 16px', minWidth: '40px' },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--text) 4%, transparent)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-muted)' },
    // Vim's command line and mode indicator
    '.cm-vim-panel': { padding: '2px 10px', fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--text-muted)' },
    '.cm-vim-panel input': { color: 'var(--text)', fontFamily: 'var(--font-mono)' },
    '.cm-fat-cursor': { background: 'var(--accent) !important', color: 'var(--bg) !important' },
    '&:not(.cm-focused) .cm-fat-cursor': { background: 'none !important', outline: '1px solid var(--accent)' },
    '.cm-content': {
      maxWidth: 'var(--editor-width)',
      margin: '0 auto',
      padding: '36px 32px 45vh',
      caretColor: 'var(--accent)'
    },
    '.cm-line': { padding: '0 2px' },
    '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--accent)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: 'color-mix(in srgb, var(--accent) 28%, transparent)' },
    '.cm-placeholder': { color: 'var(--text-faint)' },

    // headings
    '.cm-h': { fontWeight: '650', lineHeight: '1.35', letterSpacing: '-0.01em' },
    '.cm-h1': { fontSize: '1.9em', paddingTop: '0.5em', paddingBottom: '0.15em' },
    '.cm-h2': { fontSize: '1.5em', paddingTop: '0.45em', paddingBottom: '0.1em' },
    '.cm-h3': { fontSize: '1.25em', paddingTop: '0.35em' },
    '.cm-h4': { fontSize: '1.1em', paddingTop: '0.25em' },
    '.cm-h5, .cm-h6': { fontSize: '1em', color: 'var(--text-muted)' },

    // inline
    '.cm-strike': { textDecoration: 'line-through', color: 'var(--text-muted)' },
    '.cm-inline-code': {
      fontFamily: 'var(--font-mono)',
      fontSize: '0.87em',
      backgroundColor: 'var(--bg-raised)',
      border: '1px solid var(--border)',
      borderRadius: '4px',
      padding: '1px 5px'
    },
    '.cm-link': {
      color: 'var(--accent)',
      textDecoration: 'underline',
      textDecorationColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
      textUnderlineOffset: '3px'
    },
    '.cm-link-syntax': { color: 'var(--text-faint)' },
    '.cm-wikilink': { textDecorationStyle: 'solid' },
    '.cm-link.cm-unresolved': {
      color: 'var(--text-muted)',
      textDecorationStyle: 'dashed',
      textDecorationColor: 'var(--text-faint)'
    },

    '.cm-hashtag': {
      color: 'var(--accent)',
      backgroundColor: 'var(--accent-soft)',
      borderRadius: '10px',
      padding: '1px 7px',
      fontSize: '0.9em'
    },
    '.cm-frontmatter': {
      fontFamily: 'var(--font-mono)',
      fontSize: '0.82em',
      color: 'var(--text-faint)',
      backgroundColor: 'var(--bg-code)',
      padding: '0 14px !important'
    },
    '.cm-frontmatter-start': { borderTopLeftRadius: '6px', borderTopRightRadius: '6px', paddingTop: '4px !important' },
    '.cm-frontmatter-end': {
      borderBottomLeftRadius: '6px',
      borderBottomRightRadius: '6px',
      paddingBottom: '4px !important',
      marginBottom: '8px'
    },

    '.cm-event-time': {
      fontFamily: 'var(--font-ui)',
      fontSize: '0.82em',
      fontWeight: '600',
      color: 'var(--accent)',
      backgroundColor: 'var(--accent-soft)',
      borderRadius: '5px',
      padding: '1px 6px',
      fontVariantNumeric: 'tabular-nums'
    },

    // embeds
    '.cm-embed': {
      margin: '6px 0',
      border: '1px solid var(--border)',
      borderLeft: '3px solid var(--accent-dim)',
      borderRadius: '8px',
      backgroundColor: 'var(--bg-panel)',
      overflow: 'hidden'
    },
    '.cm-embed-header': {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '5px 10px',
      borderBottom: '1px solid var(--border)',
      fontFamily: 'var(--font-ui)',
      fontSize: '12.5px',
      color: 'var(--text-muted)'
    },
    '.cm-embed-icon': { color: 'var(--accent)' },
    '.cm-embed-title': {
      border: 'none',
      background: 'none',
      padding: '0',
      font: 'inherit',
      fontWeight: '600',
      color: 'var(--text)',
      cursor: 'pointer'
    },
    '.cm-embed-title:hover': { color: 'var(--accent)', textDecoration: 'underline' },
    '.cm-embed-heading': { fontWeight: '400', color: 'var(--text-muted)' },
    '.cm-embed-edit': {
      marginLeft: 'auto',
      border: 'none',
      borderRadius: '4px',
      background: 'none',
      padding: '1px 6px',
      font: 'inherit',
      fontSize: '11.5px',
      color: 'var(--text-faint)',
      cursor: 'pointer'
    },
    '.cm-embed-edit:hover': { backgroundColor: 'var(--bg-hover)', color: 'var(--text)' },
    '.cm-embed-body': { maxHeight: '420px', overflowY: 'auto', fontSize: '0.95em' },
    '.cm-embed-missing': { margin: '0', padding: '10px 14px', color: 'var(--text-faint)', fontStyle: 'italic' },
    '.cm-embed-inline::before': { content: '"↳ "', color: 'var(--text-faint)' },

    // Places (a Google Maps link on its own line)
    '.cm-place': {
      maxWidth: '520px',
      margin: '6px 0',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      backgroundColor: 'var(--bg-panel)',
      overflow: 'hidden',
      cursor: 'pointer',
      fontFamily: 'var(--font-ui)'
    },
    '.cm-place:hover': { borderColor: 'var(--accent-dim)' },
    '.cm-place-map': { position: 'relative', overflow: 'hidden', backgroundColor: '#e8e4dc', borderBottom: '1px solid var(--border)' },
    '.cm-place-tiles': { position: 'absolute' },
    '.cm-place-tile': { position: 'absolute', width: '256px', height: '256px', userSelect: 'none', pointerEvents: 'none' },
    '.cm-place-pin': { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -100%)', lineHeight: '0', pointerEvents: 'none', filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.35))' },
    '.cm-place-credit': {
      position: 'absolute',
      right: '0',
      bottom: '0',
      padding: '1px 5px',
      fontSize: '10px',
      color: '#333',
      backgroundColor: 'rgba(255, 255, 255, 0.75)',
      borderTopLeftRadius: '4px'
    },
    // Songs (a Spotify or My music link on its own line)
    '.cm-song': {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      maxWidth: '420px',
      margin: '6px 0',
      padding: '8px 10px 8px 8px',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      backgroundColor: 'var(--bg-panel)',
      cursor: 'pointer',
      fontFamily: 'var(--font-ui)'
    },
    '.cm-song:hover': { borderColor: 'var(--accent-dim)' },
    '.cm-song:hover .cm-song-play': { backgroundColor: 'var(--accent)', color: '#fff' },
    '.cm-song-art': {
      display: 'grid',
      placeItems: 'center',
      flexShrink: '0',
      width: '44px',
      height: '44px',
      borderRadius: '6px',
      overflow: 'hidden',
      backgroundColor: 'var(--bg-hover)',
      color: 'var(--accent)'
    },
    '.cm-song-art img': { width: '100%', height: '100%', objectFit: 'cover' },
    '.cm-song-text': { display: 'flex', flexDirection: 'column', gap: '1px', minWidth: '0', flex: '1' },
    '.cm-song-name': { fontWeight: '600', fontSize: '13.5px', color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    '.cm-song-artist': { fontSize: '12px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    '.cm-song-play': {
      display: 'grid',
      placeItems: 'center',
      width: '30px',
      height: '30px',
      borderRadius: '50%',
      backgroundColor: 'var(--bg-hover)',
      color: 'var(--text-strong)',
      transition: 'background-color 120ms, color 120ms'
    },
    '.cm-place-info': { display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 10px' },
    '.cm-place-icon': { fontSize: '16px' },
    '.cm-place-text': { display: 'flex', flexDirection: 'column', minWidth: '0', flex: '1' },
    '.cm-place-name': { fontWeight: '600', fontSize: '13.5px', color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    '.cm-place-address': { fontSize: '12px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    '.cm-place-actions': { display: 'flex', alignItems: 'center', gap: '4px', flexShrink: '0' },
    '.cm-place-open': { fontSize: '12px', color: 'var(--accent)' },
    '.cm-place-edit': {
      border: 'none',
      borderRadius: '4px',
      background: 'none',
      padding: '1px 6px',
      font: 'inherit',
      fontSize: '11.5px',
      color: 'var(--text-faint)',
      cursor: 'pointer'
    },
    '.cm-place-edit:hover': { backgroundColor: 'var(--bg-hover)', color: 'var(--text)' },

    // [[ autocomplete
    '.cm-tooltip': {
      backgroundColor: 'var(--bg-raised)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
      overflow: 'hidden'
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': {
      fontFamily: 'var(--font-ui)',
      fontSize: '13.5px',
      maxHeight: '280px',
      minWidth: '240px',
      padding: '4px'
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
      padding: '5px 10px',
      borderRadius: '5px',
      color: 'var(--text)'
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'var(--accent-soft)',
      color: 'var(--text-strong)'
    },
    '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--accent)', fontWeight: '600' },
    '.cm-completionDetail': { marginLeft: '10px', color: 'var(--text-faint)', fontStyle: 'normal', fontSize: '12px' },

    // blocks
    '.cm-quote': {
      borderLeft: '3px solid var(--accent-dim)',
      paddingLeft: '16px !important',
      color: 'var(--text-muted)'
    },
    '.cm-codeblock': {
      fontFamily: 'var(--font-mono)',
      fontSize: '0.86em',
      backgroundColor: 'var(--bg-code)',
      padding: '0 18px !important',
      borderLeft: '1px solid var(--border)',
      borderRight: '1px solid var(--border)'
    },
    '.cm-codeblock-start': {
      borderTop: '1px solid var(--border)',
      borderTopLeftRadius: '8px',
      borderTopRightRadius: '8px',
      paddingTop: '6px !important'
    },
    '.cm-codeblock-end': {
      borderBottom: '1px solid var(--border)',
      borderBottomLeftRadius: '8px',
      borderBottomRightRadius: '8px',
      paddingBottom: '6px !important'
    },
    '.cm-code-fence': { color: 'var(--text-faint)' },
    // ▶ Run on JavaScript blocks, and what the code printed under the block.
    '.cm-run-anchor': { position: 'relative', height: '0' },
    '.cm-run-button': {
      position: 'absolute',
      right: '8px',
      top: '5px',
      zIndex: '2',
      font: '500 11.5px var(--font-ui, inherit)',
      padding: '2px 9px',
      borderRadius: '6px',
      border: '1px solid var(--border)',
      backgroundColor: 'var(--bg)',
      color: 'var(--text-muted)',
      cursor: 'pointer'
    },
    '.cm-run-button:hover:not(:disabled)': { color: 'var(--accent)', borderColor: 'var(--accent-dim)' },
    '.cm-run-button:disabled': { cursor: 'default', opacity: '0.7' },
    '.cm-run-output': {
      margin: '6px 0 10px',
      border: '1px solid var(--border)',
      borderLeft: '3px solid var(--accent-dim)',
      borderRadius: '8px',
      overflow: 'hidden'
    },
    '.cm-run-output-head': {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '3px 6px 3px 12px',
      fontSize: '11.5px',
      color: 'var(--text-faint)'
    },
    '.cm-run-clear': {
      border: 'none',
      background: 'none',
      color: 'var(--text-faint)',
      cursor: 'pointer',
      fontSize: '12px',
      padding: '2px 6px',
      borderRadius: '4px'
    },
    '.cm-run-clear:hover': { color: 'var(--text-strong)' },
    '.cm-run-lines': {
      margin: '0',
      padding: '4px 12px 8px',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.84em',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      maxHeight: '320px',
      overflowY: 'auto',
      userSelect: 'text'
    },
    '.cm-run-line': { color: 'var(--text)' },
    '.cm-run-result': { color: 'var(--accent)' },
    '.cm-run-warn': { color: '#d9a43b' },
    '.cm-run-error': { color: '#e5534b' },
    '.cm-run-empty': { color: 'var(--text-faint)', fontStyle: 'italic' },
    '.cm-hr': {
      display: 'inline-block',
      width: '100%',
      verticalAlign: 'middle',
      borderTop: '1px solid var(--border-strong)'
    },

    // lists and tasks
    '.cm-bullet': { color: 'var(--text-faint)', display: 'inline-block', width: '1ch', fontWeight: '700' },
    '.cm-list-number': { color: 'var(--text-faint)' },
    // The task checkbox is drawn in styles/motion.css, so its tick can animate.
    '.cm-task-done': { color: 'var(--text-faint)', textDecoration: 'line-through' },

    // images and tables
    '.cm-image': { display: 'block', maxWidth: '100%', maxHeight: '480px', borderRadius: '8px', margin: '8px 0' },
    '.cm-image-missing': { color: 'var(--text-faint)', fontStyle: 'italic', fontSize: '0.9em' },
    '.cm-table-wrap': { overflowX: 'auto', margin: '6px 0', cursor: 'text' },
    '.cm-table-wrap table': { borderCollapse: 'collapse', fontSize: '0.94em', minWidth: '50%' },
    '.cm-table-wrap th, .cm-table-wrap td': {
      border: '1px solid var(--border)',
      padding: '6px 12px',
      lineHeight: '1.5'
    },
    '.cm-table-wrap th': { backgroundColor: 'var(--bg-raised)', fontWeight: '600' },
    '.cm-table-total': { color: 'var(--accent)', fontWeight: '600' },

    // the inline calculator
    '.cm-calc': { marginLeft: '0.6em', color: 'var(--text-faint)', cursor: 'pointer', whiteSpace: 'nowrap' },
    '.cm-calc-value': { color: 'var(--accent)', fontWeight: '600', padding: '1px 6px', borderRadius: '4px', backgroundColor: 'var(--bg-raised)' },
    '.cm-calc:hover .cm-calc-value': { textDecoration: 'underline' },
    '.cm-calc-copied .cm-calc-value': { fontWeight: '400' },

    // maths and diagrams
    '.cm-math': { cursor: 'text' },
    '.cm-math .katex': { fontSize: '1.08em' },
    '.cm-math-block': { padding: '6px 0', overflowX: 'auto', overflowY: 'hidden', cursor: 'text' },
    '.cm-math-block .katex-display': { margin: '0.4em 0' },
    '.cm-diagram': {
      display: 'flex',
      justifyContent: 'center',
      margin: '8px 0',
      padding: '12px',
      overflowX: 'auto',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      cursor: 'text'
    },
    '.cm-diagram svg': { maxWidth: '100%', height: 'auto' },
    '.cm-diagram-loading': { color: 'var(--text-faint)', fontStyle: 'italic', fontSize: '0.9em' },
    '.cm-diagram-error': {
      display: 'block',
      whiteSpace: 'pre-wrap',
      color: 'var(--text-muted)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.82em'
    },

    // in-note search (Ctrl+F)
    '.cm-panels': { backgroundColor: 'var(--bg-panel)', color: 'var(--text)' },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
    '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
    '.cm-search': { fontFamily: 'var(--font-ui)', fontSize: '13px', padding: '6px 10px !important' },
    '.cm-search input, .cm-search button': {
      fontFamily: 'inherit',
      fontSize: 'inherit',
      color: 'var(--text)',
      backgroundColor: 'var(--bg-raised)',
      border: '1px solid var(--border)',
      borderRadius: '5px',
      backgroundImage: 'none'
    },
    '.cm-search input[type=checkbox]': { accentColor: 'var(--accent)' },
    '.cm-search input:focus': { outline: 'none', borderColor: 'var(--accent)' },
    '.cm-searchMatch': { backgroundColor: 'rgba(255, 203, 107, 0.22)', borderRadius: '2px' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(255, 203, 107, 0.45)' },
    '.cm-selectionMatch': { backgroundColor: 'var(--accent-soft)' }
  },
  { dark: true }
)

export const highlightStyle = HighlightStyle.define([
  // markdown
  { tag: t.heading, fontWeight: '650', color: 'var(--text-strong)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700', color: 'var(--text-strong)' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--text-faint)' },
  { tag: t.quote, color: 'var(--text-muted)' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--text-faint)' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)' },

  // code inside fenced blocks
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syn-function)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--syn-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--syn-property)' },
  { tag: [t.operator, t.punctuation], color: 'var(--syn-property)' },
  { tag: [t.tagName], color: 'var(--syn-tag)' },
  { tag: t.variableName, color: 'var(--syn-variable)' }
])
