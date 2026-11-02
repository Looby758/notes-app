/**
 * Back and forward around the app, like a web browser's: every note or page you go to (a link
 * clicked, a tab switched to, a page opened) is remembered, so the mouse's back button takes you to
 * where you were before, and forward takes you there again.
 *
 * This file is the pure list of places; lib/appNavigation.ts records where you go and moves you.
 */

/** A place you were: a tab (note path or page id) and the pane it was in. */
export interface Place {
  pane: string
  tab: string
}

/** How many places are kept; the oldest go first. */
export const HISTORY_LIMIT = 100

export class NavHistory {
  private places: Place[] = []
  private at = -1

  constructor(private readonly limit = HISTORY_LIMIT) {}

  /** Where you are now, if anywhere yet. */
  current(): Place | null {
    return this.places[this.at] ?? null
  }

  /**
   * You went somewhere (not by going back or forward): it becomes the current place, and anything
   * you'd gone back from can't be gone forward to any more. `from` is where that pane was before,
   * so going back after moving into another pane returns to what that pane showed.
   */
  visit(place: Place, from?: Place | null): void {
    const here = this.current()
    if (here && here.tab === place.tab) {
      // The same tab, perhaps moved to another pane.
      this.places[this.at] = place
      return
    }
    this.places.length = this.at + 1
    if (from && from.tab !== place.tab && !(here && here.tab === from.tab && here.pane === from.pane)) this.places.push(from)
    this.places.push(place)
    if (this.places.length > this.limit) this.places.splice(0, this.places.length - this.limit)
    this.at = this.places.length - 1
  }

  canGoBack(): boolean {
    return this.at > 0
  }

  canGoForward(): boolean {
    return this.at < this.places.length - 1
  }

  /**
   * Steps back (-1) or forward (1) to the nearest place `canGo` says still exists, dropping the
   * ones that don't (a note since deleted, a web tab since closed). Returns null if there's none.
   */
  step(dir: 1 | -1, canGo: (place: Place) => boolean): Place | null {
    let i = this.at + dir
    while (i >= 0 && i < this.places.length) {
      const place = this.places[i]
      if (canGo(place)) {
        this.at = i
        return place
      }
      this.places.splice(i, 1)
      if (dir === -1) {
        this.at--
        i--
      }
    }
    return null
  }

  clear(): void {
    this.places = []
    this.at = -1
  }
}
