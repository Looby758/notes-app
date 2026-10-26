import { Compartment, Facet, StateEffect } from '@codemirror/state'

/** Dispatched when the set of notes changes, so links re-check whether they point anywhere. */
export const linksChanged = StateEffect.define<null>()

/** The vault-relative path of the note an editor state belongs to. */
export const notePath = Facet.define<string, string>({ combine: (values) => values[0] ?? '' })

/** Lets the path be swapped when a note is renamed or moved without rebuilding the state. */
export const pathCompartment = new Compartment()

/** Which pane an editor state is shown in (one state per pane per note). */
export const paneFacet = Facet.define<string, string>({ combine: (values) => values[0] ?? '' })
export const paneCompartment = new Compartment()
