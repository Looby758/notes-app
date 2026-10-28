import { net } from 'electron'
import { readFile, stat } from 'fs/promises'
import type { GoogleSheetResult } from '@shared/types'
import { gsheetWebUrl, parseGsheetFile, sheetsFromApi } from '@shared/sheet'
import { SHEETS_SCOPE, googleToken } from './calendarSources'

/**
 * .gsheet files are small links that Google Drive puts in the notes folder; the sheet itself lives
 * online. To show one, read the link and fetch the sheet (read-only) with the Google sign-in from
 * Settings → Calendar.
 */

// Overridable for tests, which point it at a local fake Google server.
const API_URL = process.env.NOTES_GOOGLE_SHEETS_URL ?? 'https://sheets.googleapis.com/v4'
const FIELDS =
  'sheets(properties(title,hidden,sheetType),data(startRow,startColumn,rowData(values(formattedValue,effectiveValue)),columnMetadata(pixelSize)))'

export async function readGoogleSheet(file: string): Promise<GoogleSheetResult> {
  if (!file.toLowerCase().endsWith('.gsheet')) return { error: 'That isn’t a .gsheet file.' }
  // A real .gsheet is a few hundred bytes; anything big isn't one.
  const link = (await stat(file)).size < 64 * 1024 ? parseGsheetFile(await readFile(file, 'utf8')) : null
  if (!link) return { error: 'This .gsheet file doesn’t say which Google Sheet it is.' }
  const webUrl = gsheetWebUrl(link.id)

  const access = await googleToken(SHEETS_SCOPE)
  if ('missing' in access) {
    if (access.missing === 'setup') return { webUrl, fix: 'setup', error: 'To see Google Sheets here, set up Google in Settings → Calendar first.' }
    if (access.missing === 'scope') return { webUrl, fix: 'connect', error: 'Connect Google again so Notes may read your Sheets as well as your calendar.' }
    if (access.missing === 'offline') return { webUrl, fix: 'retry', error: access.error ?? 'Couldn’t reach Google right now.' }
    return { webUrl, fix: 'connect', error: access.error ?? 'Connect your Google account to see this sheet.' }
  }

  const url = new URL(`${API_URL}/spreadsheets/${link.id}`)
  url.search = new URLSearchParams({ includeGridData: 'true', fields: FIELDS }).toString()
  const headers: Record<string, string> = { Authorization: `Bearer ${access.token}` }
  if (link.resourceKey) headers['X-Goog-Drive-Resource-Keys'] = `${link.id}/${link.resourceKey}`
  let res: Response
  try {
    res = await net.fetch(url.toString(), { headers })
  } catch {
    return { webUrl, fix: 'retry', error: 'Couldn’t reach Google right now.' }
  }
  if (res.ok) return { webUrl, sheets: sheetsFromApi(await res.json()) }

  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string; details?: { reason?: string }[] } }
  const reasons = (body.error?.details ?? []).map((d) => d.reason)
  const message = body.error?.message ?? ''
  if (reasons.includes('SERVICE_DISABLED') || /has not been used|is disabled/i.test(message)) {
    return { webUrl, fix: 'enable-api', error: 'Switch on the Google Sheets API in the Google project you made for your calendar, then try again.' }
  }
  if (reasons.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
    return { webUrl, fix: 'connect', error: 'Connect Google again so Notes may read your Sheets as well as your calendar.' }
  }
  const owner =
    link.email && access.email && link.email.toLowerCase() !== access.email.toLowerCase()
      ? ` It belongs to ${link.email}, but Notes is signed in as ${access.email}.`
      : ''
  if (res.status === 404) return { webUrl, error: `Google can’t find this sheet. It may have been deleted.${owner}` }
  if (res.status === 403) return { webUrl, error: `Your Google account can’t open this sheet.${owner}` }
  return { webUrl, fix: 'retry', error: `Google Sheets said ${res.status}.` }
}
