import { ensureMoney, markReminded, snapshot, useMoney } from '../store/money'
import { isQuiet } from '../store/quiet'
import { notify } from '../store/notify'
import { dayOf, formatPounds } from './money'
import { dueIouReminders, iouLeft } from './moneyAccounts'

/**
 * IOU reminders ("Sam still owes you £8.50 for the takeaway"): shown once on the day you picked,
 * from 9 in the morning (or as soon as Orbit opens after that). Clicking it opens Money → IOUs.
 * Also writes today's net worth once a day, so the chart has a point for each day Orbit is open.
 */

/** What a reminder notification opens (see Shell's reminder handler). */
export const MONEY_IOU_LINK = 'orbit:money-ious'

export async function checkIouReminders(now = new Date()): Promise<void> {
  if (isQuiet()) return
  await ensureMoney()
  snapshot()
  if (now.getHours() < 9) return
  const due = dueIouReminders(useMoney.getState().ious, dayOf(now))
  if (!due.length) return
  for (const i of due.slice(0, 3)) {
    const what = `${formatPounds(iouLeft(i))}${i.note ? ` for ${i.note}` : ''}`
    const title = i.theyOwe ? `${i.person} still owes you ${what}` : `You still owe ${i.person} ${what}`
    window.api.showReminder({ title, body: 'Money → IOUs', path: MONEY_IOU_LINK, line: 0 })
    notify(`💸 ${title}`, 'info')
  }
  if (due.length > 3) notify(`…and ${due.length - 3} more IOU reminders in Money → IOUs`, 'info')
  markReminded(due.map((i) => i.id))
}

let timer: ReturnType<typeof setInterval> | null = null

export function startIouReminders(): void {
  stopIouReminders()
  setTimeout(() => void checkIouReminders().catch(() => undefined), 6000)
  timer = setInterval(() => void checkIouReminders().catch(() => undefined), 5 * 60_000)
}

export function stopIouReminders(): void {
  if (timer) clearInterval(timer)
  timer = null
}
