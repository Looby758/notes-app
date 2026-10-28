/**
 * Tidies what the offline reader sends back: it pads lines with spaces, leaves runs of blank
 * lines, and reads stray dots and specks as punctuation on lines of their own.
 */
export function cleanReading(text: string): string {
  return (
    text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim())
      // A line with no letters or digits is a speck read as punctuation, not writing.
      .map((l) => (/[\p{L}\p{N}]/u.test(l) ? l : ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}
