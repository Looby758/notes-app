import { useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import { upcomingReminders } from '../../lib/reminderScheduler'
import { openNote } from '../../lib/editorController'
import { fromDayKey, formatDate } from '../../lib/dates'
import { noteTitle } from '../../lib/paths'
import { useNoteIndex } from '../../store/noteIndex'
import { IS_MAC } from '@shared/platform'

/** Settings → Calendar → Reminders: try a notification, and see what's coming up. */
export default function RemindersSettings() {
  const [sent, setSent] = useState<null | 'sent' | 'unsupported'>(null)
  const version = useNoteIndex((s) => s.version)
  const [upcoming, setUpcoming] = useState(() => upcomingReminders())
  useEffect(() => setUpcoming(upcomingReminders()), [version])

  const test = async (): Promise<void> => {
    const ok = await window.api.showReminder({ title: 'Test reminder', body: 'If you can see this, reminders will show up here.', path: '', line: 0 })
    setSent(ok === false ? 'unsupported' : 'sent')
  }

  return (
    <section className="settings-group reminders-settings" data-reminders-settings>
      <h3>Reminders</h3>
      <p className="settings-note">
        Add <code>⏰ 2026-10-28 15:00</code> to a task (or press Ctrl+Alt+R on its line) and Notes reminds you then, while it’s open or in the{' '}
        {IS_MAC ? 'menu bar' : 'tray'}.
      </p>
      <div className="reminders-test">
        <button className="btn" onClick={test} data-test-notification>
          <BellRing size={14} /> Send a test notification
        </button>
        {sent === 'sent' && (
          <span>
            Sent. Nothing showed up? {IS_MAC ? 'Check System Settings → Notifications → Notes, and Focus.' : 'Check Windows Settings → System → Notifications: turn Notes on, and Do not disturb off.'}
          </span>
        )}
        {sent === 'unsupported' && <span className="setting-warning">This system can’t show notifications.</span>}
      </div>
      <h4>Coming up</h4>
      {upcoming.length === 0 ? (
        <p className="settings-note">No reminders set.</p>
      ) : (
        <div className="reminders-upcoming">
          {upcoming.map((r) => (
            <button key={r.key} onClick={() => openNote(r.path, { line: r.line })} data-upcoming={r.title}>
              <span className="reminder-when">
                {formatDate(fromDayKey(r.date) ?? new Date(), r.date.startsWith(String(new Date().getFullYear())) ? 'ddd D MMM' : 'D MMM YYYY')} {r.time}
              </span>
              <span className="reminder-what">{r.title || 'Reminder'}</span>
              <span className="reminder-where">{noteTitle(r.path)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
