import { useState } from 'react'
import { AlertTriangle, ChevronDown, ExternalLink, HeartPulse, Loader2, Send, ShieldAlert, ShieldCheck, Wrench, PackageCheck, RefreshCw } from 'lucide-react'
import { boardKey, healthBoardItem, healthLevel, healthLine, severityCounts, timeAgo, type HealthReport } from '@shared/appStudio'
import type { TerminalProject } from '../../store/terminals'
import { checkHealth, useAppHealth } from '../../store/appHealth'
import { addItem, setBoardApp } from '../../store/appBoard'
import { setSection } from '../../store/appStudio'
import { runProjectCommand } from '../../lib/terminal'
import { notify } from '../../store/notify'

/**
 * An app card's health check: npm says which packages have newer versions and which have known
 * security problems. Safe fixes run in the app's terminal; the rest can go on the board for Claude.
 */
export default function Health({ project, repo }: { project: TerminalProject; repo?: string }) {
  const report = useAppHealth((s) => s.reports[project.folder])
  const checking = useAppHealth((s) => !!s.checking[project.folder])
  const error = useAppHealth((s) => s.errors[project.folder])
  const [open, setOpen] = useState(false)

  if (!report && !checking && !error) {
    return (
      <button className="appstudio-card-line appstudio-pr-link" onClick={() => void checkHealth(project.folder).then(() => setOpen(healthLevel(useAppHealth.getState().reports[project.folder] ?? { checkedAt: '', outdated: [], security: [], problems: [] }) !== 'good'))} title="Asks npm which packages have updates and known security problems">
        <HeartPulse size={13} /> Check health
      </button>
    )
  }
  if (checking && !report) {
    return (
      <div className="appstudio-card-line muted">
        <Loader2 size={13} className="spin" /> Checking its packages…
      </div>
    )
  }
  if (!report) {
    return (
      <div className="appstudio-card-line appstudio-health-error">
        <AlertTriangle size={13} /> <span>{error}</span>
        <button className="link-button" onClick={() => void checkHealth(project.folder)}>
          Try again
        </button>
      </div>
    )
  }
  const level = healthLevel(report)
  return (
    <div className={`appstudio-health ${level}`}>
      <button className="appstudio-health-line" onClick={() => setOpen(!open)} aria-expanded={open}>
        {level === 'attention' ? <ShieldAlert size={13} /> : level === 'good' ? <ShieldCheck size={13} /> : <HeartPulse size={13} />}
        <span className="appstudio-health-text">{healthLine(report)}</span>
        <span className="muted appstudio-health-when">{checking ? <Loader2 size={12} className="spin" /> : timeAgo(report.checkedAt)}</span>
        <ChevronDown size={13} className={open ? 'appstudio-health-chevron open' : 'appstudio-health-chevron'} />
      </button>
      {open && <HealthDetails project={project} repo={repo} report={report} checking={checking} error={error} />}
    </div>
  )
}

function HealthDetails({ project, repo, report, checking, error }: { project: TerminalProject; repo?: string; report: HealthReport; checking: boolean; error?: string }) {
  const easyFixes = report.security.filter((w) => w.easyFix).length
  const safeUpdates = report.outdated.filter((p) => !p.major).length
  const hasWork = report.security.length > 0 || report.outdated.length > 0
  const run = (command: string): void => {
    runProjectCommand(project, command)
    notify(`Running ${command} in ${project.name}’s terminal. Check health again once it’s finished.`, 'info')
  }
  const toClaude = (): void => {
    const app = boardKey({ name: project.name, repo })
    const { title, details } = healthBoardItem(report)
    addItem(app, report.security.length ? 'bug' : 'idea', title, details)
    setBoardApp(app)
    setSection('board')
    notify(`Put “${title}” on ${project.name}’s board. Send it to Claude from there.`, 'info')
  }
  return (
    <div className="appstudio-health-details">
      {error && <div className="appstudio-health-error">{error}</div>}
      {report.problems.map((p) => (
        <div key={p} className="appstudio-health-problem muted">
          <AlertTriangle size={12} /> {p}
        </div>
      ))}
      {report.security.length > 0 && (
        <div className="appstudio-health-group">
          <div className="appstudio-health-head">
            Security warnings
            {severityCounts(report.security).map((c) => (
              <span key={c.severity} className={`appstudio-severity ${c.severity}`}>
                {c.count} {c.severity}
              </span>
            ))}
          </div>
          {report.security.slice(0, 12).map((w) => (
            <div key={w.name} className="appstudio-health-row">
              <span className={`appstudio-severity ${w.severity}`}>{w.severity}</span>
              <strong>{w.name}</strong>
              <span className="appstudio-health-what" title={w.title}>
                {w.title}
              </span>
              {w.majorFix && <span className="appstudio-chip muted" title="The fix is a new major version of a package, which can need code changes">big fix</span>}
              {w.url && (
                <a className="link-button" href={w.url} target="_blank" rel="noreferrer" title="Read about it">
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
          ))}
          {report.security.length > 12 && <div className="muted">and {report.security.length - 12} more</div>}
        </div>
      )}
      {report.outdated.length > 0 && (
        <div className="appstudio-health-group">
          <div className="appstudio-health-head">Updates</div>
          {report.outdated.slice(0, 14).map((p) => (
            <div key={p.name} className="appstudio-health-row">
              <strong>{p.name}</strong>
              <span className="appstudio-health-what muted">
                {p.current ?? 'not installed'} → {p.latest}
              </span>
              {p.major ? (
                <span className="appstudio-chip muted" title="A new major version, which can need code changes">
                  big update
                </span>
              ) : (
                <span className="appstudio-chip">safe</span>
              )}
            </div>
          ))}
          {report.outdated.length > 14 && <div className="muted">and {report.outdated.length - 14} more</div>}
        </div>
      )}
      {!hasWork && !report.problems.length && <div className="muted">Every package is on its newest version and npm knows of no security problems.</div>}
      <div className="appstudio-health-actions">
        {easyFixes > 0 && (
          <button className="btn" onClick={() => run('npm audit fix')} title="Runs npm audit fix in the app’s terminal: fixes what it can without big updates">
            <Wrench size={13} /> Fix {easyFixes === 1 ? 'warning' : 'warnings'}
          </button>
        )}
        {safeUpdates > 0 && (
          <button className="btn" onClick={() => run('npm update')} title="Runs npm update in the app’s terminal: the updates package.json already allows, no big ones">
            <PackageCheck size={13} /> Safe updates
          </button>
        )}
        {hasWork && (
          <button className="btn" onClick={toClaude} title="Puts a card on the app’s board listing all of it, ready to send to Claude">
            <Send size={13} /> Hand to Claude
          </button>
        )}
        <button className="icon-btn" title="Check again" disabled={checking} onClick={() => void checkHealth(project.folder)}>
          {checking ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
        </button>
      </div>
    </div>
  )
}
