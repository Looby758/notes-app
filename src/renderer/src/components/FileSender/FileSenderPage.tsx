import { useState, type DragEvent } from 'react'
import { Check, Cloud, Copy, Download, ExternalLink, FolderOpen, FolderUp, Loader2, Play, Send, Server, ShieldCheck, Trash2, TriangleAlert, Upload, X } from 'lucide-react'
import { DRIVE_KEEP_DAYS, ROUTE_TEXT, runnableFiles, type DriveShare, type FileSendState, type Transfer } from '@shared/fileSend'
import { sizeText, speedText, timeLeft } from '@shared/downloadManager'
import { acceptReceive, declineReceive, useFileSend } from '../../store/fileSend'
import { notify } from '../../store/notify'

/**
 * Big file sender: send huge files or folders to a friend's computer with a short code. They go
 * straight between the two computers (or through the relay when that's not possible), locked the
 * whole way, and carry on where they stopped if the connection drops. For a friend without Orbit,
 * "Google Drive link" uploads to your Drive instead and gives a normal link (taken off after a week).
 * The work is done in main/fileSend.ts and store/fileSend.ts, so it carries on with this tab closed.
 */

const STATUS: Record<Transfer['status'], string> = {
  waiting: 'Waiting for your friend to type the code',
  connecting: 'Connecting…',
  asking: 'Waiting for them to accept',
  sending: 'Sending',
  reconnecting: 'Connection lost, getting it back…',
  paused: 'Stopped when Orbit closed',
  done: 'Done',
  failed: 'Didn’t work',
  cancelled: 'Stopped'
}

const until = (at: number): string => {
  const m = Math.max(1, Math.round((at - Date.now()) / 60_000))
  return m < 60 ? `${m} min` : `${Math.round(m / 60)} hr`
}

function statusLine(t: Transfer): string {
  if (t.error && (t.status === 'failed' || t.status === 'cancelled')) return t.error
  const receiving = t.direction === 'receive'
  if (t.status === 'waiting' && receiving) return 'Waiting for the sender’s Orbit to come online…'
  if (t.status === 'asking' && receiving) return `From ${t.peer ?? 'someone'} · ${sizeText(t.total)}`
  if (t.status === 'sending') {
    return [
      `${sizeText(t.done)} of ${sizeText(t.total)}`,
      t.speed ? speedText(t.speed) : '',
      timeLeft(t.total - t.done, t.speed),
      t.route ? ROUTE_TEXT[t.route] : ''
    ]
      .filter(Boolean)
      .join(' · ')
  }
  if (t.status === 'done') return `${sizeText(t.total)} · ${receiving ? `from ${t.peer ?? 'them'}` : `to ${t.peer ?? 'them'}`}`
  if (t.status === 'waiting' && t.expires) return `${STATUS.waiting} · code works for ${until(t.expires)}`
  return STATUS[t.status] + (t.done ? ` · ${sizeText(t.done)} of ${sizeText(t.total)}` : '')
}

function Bar({ value }: { value: number }) {
  return (
    <div className="vdl-bar">
      <div style={{ width: `${Math.min(1, value) * 100}%` }} />
    </div>
  )
}

function ServerBar({ state, onChange }: { state: FileSendState; onChange: () => void }) {
  const [copied, setCopied] = useState(false)
  const [relayOpen, setRelayOpen] = useState(false)
  const [keyId, setKeyId] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [busy, setBusy] = useState(false)
  const relayOn = async (manual: boolean): Promise<void> => {
    setBusy(true)
    try {
      await window.api.fileSendRelayOn(manual ? keyId : undefined, manual ? apiToken : undefined)
      notify('The relay is on.', 'info')
      setRelayOpen(false)
    } catch (err) {
      if (manual) notify(err)
      else setRelayOpen(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fsend-serverbar" data-fsend-serverbar>
      <div className="fsend-serverbar-row">
        <Server size={14} />
        <span className="fsend-serverbar-text">
          Ready to send with a code{state.relay ? ' · relay on' : ''}
        </span>
        <button
          className="btn"
          title="Your friends paste this into their Big file sender once"
          onClick={() => {
            void navigator.clipboard.writeText(state.server)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy address for friends'}
        </button>
        {state.ownServer && !state.relay && (
          <button className="btn" disabled={busy} onClick={() => void relayOn(false)} title="For friends whose internet blocks direct connections" data-fsend-relay>
            {busy ? <Loader2 size={13} className="spin" /> : <ShieldCheck size={13} />} Turn on the relay
          </button>
        )}
        <button className="btn fsend-link-btn" onClick={onChange}>
          Change
        </button>
      </div>
      {relayOpen && (
        <div className="fsend-relay-manual">
          <p>Orbit’s key isn’t allowed to make the relay, so make it on Cloudflare’s site instead:</p>
          <ol className="fsend-steps">
            <li>
              <button className="btn" onClick={() => void window.api.fileSendOpen('turn')}>
                <ExternalLink size={13} /> Open Cloudflare’s relay (TURN) page
              </button>{' '}
              and press <b>Create</b>.
            </li>
            <li>
              Copy the two things it shows into here:
              <div className="fsend-relay-fields">
                <input className="text-input" placeholder="Turn Token ID" value={keyId} spellCheck={false} onChange={(e) => setKeyId(e.target.value)} />
                <input className="text-input" placeholder="API Token" type="password" value={apiToken} onChange={(e) => setApiToken(e.target.value)} />
                <button className="btn primary" disabled={busy || !keyId.trim() || !apiToken.trim()} onClick={() => void relayOn(true)}>
                  Turn it on
                </button>
              </div>
            </li>
          </ol>
        </div>
      )}
    </div>
  )
}

function SetupBox({ state, onDone }: { state: FileSendState; onDone: () => void }) {
  const [mode, setMode] = useState<'own' | 'friend'>('own')
  const [token, setToken] = useState('')
  const [address, setAddress] = useState(state.server)
  const [busy, setBusy] = useState(false)
  const setUp = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.api.fileSendSetUp(token)
      setToken('')
      notify(r.relay ? 'All set. You can send with a code now.' : `All set. ${r.relayNote ?? ''}`, 'info')
      onDone()
    } catch (err) {
      notify(err)
    } finally {
      setBusy(false)
    }
  }
  const saveAddress = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.fileSendSetServer(address)
      onDone()
    } catch (err) {
      notify(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fsend-setup" data-fsend-setup>
      <h3>
        <Server size={15} /> Set up sending with a code
      </h3>
      <p>
        Once, about 5 minutes, free. Sending with a code needs a small “intro server” that helps the two computers find each other (it never sees your files). Only one of you needs to set it up; the other
        just pastes its address.
      </p>
      <div className="fsend-tabs" role="tablist">
        <button className={mode === 'own' ? 'on' : ''} onClick={() => setMode('own')} role="tab" aria-selected={mode === 'own'}>
          I’ll set it up
        </button>
        <button className={mode === 'friend' ? 'on' : ''} onClick={() => setMode('friend')} role="tab" aria-selected={mode === 'friend'} data-fsend-friend-tab>
          A friend already did
        </button>
      </div>
      {mode === 'own' ? (
        <ol className="fsend-steps">
          <li>
            <b>Make a free Cloudflare account</b> (skip this if you have one).
            <div>
              <button className="btn" onClick={() => void window.api.fileSendOpen('signup')}>
                <ExternalLink size={13} /> Open Cloudflare sign-up
              </button>
            </div>
          </li>
          <li>
            <b>Make a key for Orbit.</b> On the page that opens, press <b>Create Token</b>, then <b>Use template</b> next to <b>Edit Cloudflare Workers</b>. Under <b>Account Resources</b> pick your
            account, and under <b>Zone Resources</b> pick <b>All zones</b>. Then press <b>Continue to summary</b>, <b>Create Token</b>, and <b>Copy</b>.
            <div>
              <button className="btn" onClick={() => void window.api.fileSendOpen('token')} data-fsend-token-page>
                <ExternalLink size={13} /> Open the key page
              </button>
            </div>
          </li>
          <li>
            <b>Paste the key here.</b> Orbit does the rest.
            <div className="vdl-form">
              <input
                className="text-input vdl-link"
                type="password"
                placeholder="Paste the key from Cloudflare"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && token.trim() && void setUp()}
                data-fsend-token
              />
              <button className="btn primary" disabled={busy || !token.trim()} onClick={() => void setUp()} data-fsend-setup-go>
                {busy ? <Loader2 size={14} className="spin" /> : 'Set it up'}
              </button>
            </div>
          </li>
        </ol>
      ) : (
        <div className="fsend-friend">
          <p>Ask them to press “Copy address for friends” in their Big file sender, then paste it here.</p>
          <div className="vdl-form">
            <input
              className="text-input vdl-link"
              placeholder="https://orbit-file-sender.something.workers.dev"
              value={address}
              spellCheck={false}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void saveAddress()}
              data-fsend-server
            />
            <button className="btn primary" disabled={busy || !address.trim()} onClick={() => void saveAddress()}>
              {busy ? <Loader2 size={14} className="spin" /> : 'Save'}
            </button>
          </div>
        </div>
      )}
      {state.setupSteps && state.setupSteps.length > 0 && (
        <ul className="fsend-progress" data-fsend-progress>
          {state.setupSteps.map((st, i) => (
            <li key={i} className={st.state}>
              {st.state === 'doing' ? <Loader2 size={13} className="spin" /> : st.state === 'done' ? <Check size={13} /> : st.state === 'failed' ? <X size={13} /> : <TriangleAlert size={13} />}{' '}
              {st.text}
            </li>
          ))}
        </ul>
      )}
      {state.server && (
        <button className="btn fsend-link-btn" onClick={onDone}>
          Keep using {state.server.replace(/^https?:\/\//, '')}
        </button>
      )}
    </div>
  )
}

function Asking({ t }: { t: Transfer }) {
  const [busy, setBusy] = useState(false)
  const programs = t.manifest ? runnableFiles(t.manifest.files) : []
  const accept = async (choose: boolean): Promise<void> => {
    setBusy(true)
    try {
      await acceptReceive(t.id, choose)
    } catch (err) {
      if ((err as Error).message !== 'cancelled') notify(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fsend-ask" data-fsend-ask>
      <div>
        <b>{t.peer ?? 'Someone'}</b> wants to send you <b>{t.title}</b> ({sizeText(t.total)}
        {t.manifest && t.manifest.files.length > 1 ? `, ${t.manifest.files.length.toLocaleString()} files` : ''}).
      </div>
      {programs.length > 0 && (
        <div className="fsend-warn">
          <TriangleAlert size={14} /> This includes {programs.length === 1 ? 'a program' : `${programs.length} programs`} ({programs.slice(0, 2).map((p) => p.split('/').pop()).join(', ')}
          {programs.length > 2 ? '…' : ''}). Only open {programs.length === 1 ? 'it' : 'them'} if you trust who sent it. Your antivirus may check {programs.length === 1 ? 'it' : 'them'} too.
        </div>
      )}
      <div className="fsend-ask-actions">
        <button className="btn primary" disabled={busy} onClick={() => void accept(false)} data-fsend-accept>
          <Download size={14} /> Accept (save in Downloads)
        </button>
        <button className="btn" disabled={busy} onClick={() => void accept(true)}>
          <FolderOpen size={14} /> Choose where…
        </button>
        <button className="btn" disabled={busy} onClick={() => void declineReceive(t.id).catch(notify)} data-fsend-decline>
          No thanks
        </button>
      </div>
    </div>
  )
}

function TransferItem({ t }: { t: Transfer }) {
  const [copied, setCopied] = useState(false)
  const going = t.status === 'sending' || t.status === 'reconnecting'
  const ended = t.status === 'done' || t.status === 'failed' || t.status === 'cancelled'
  const copy = (): void => {
    void navigator.clipboard.writeText(t.code ?? '')
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <li className={`convert-item fsend-item ${t.status}`} data-fsend-item={t.status}>
      {t.direction === 'send' ? <Upload size={16} className="convert-kind" /> : <Download size={16} className="convert-kind" />}
      <div className="convert-name">
        <span>
          {t.direction === 'send' ? 'Sending ' : 'Getting '}
          {t.title}
        </span>
        <small>{statusLine(t)}</small>
        {t.code && (t.status === 'waiting' || t.status === 'connecting' || t.status === 'asking') && (
          <div className="fsend-code" data-fsend-code>
            <code>{t.code}</code>
            <button className="btn" onClick={copy}>
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy code'}
            </button>
          </div>
        )}
        {t.status === 'asking' && t.direction === 'receive' && <Asking t={t} />}
        {(going || (t.status === 'paused' && t.done > 0)) && t.total > 0 && (
          <div className="vdl-progress">
            <Bar value={t.done / t.total} />
            <span className="vdl-percent">{Math.floor((t.done / t.total) * 100)}%</span>
          </div>
        )}
      </div>
      <div className="vdl-actions">
        {t.status === 'paused' && (
          <button className="btn fsend-resume" title="Carry on from where it stopped" onClick={() => void window.api.fileSendResume(t.id).catch(notify)} data-fsend-resume>
            <Play size={13} /> Carry on
          </button>
        )}
        {t.status === 'done' && (
          <button className="icon-btn" title={t.direction === 'receive' ? 'Show in folder' : 'Show the original'} onClick={() => void window.api.fileSendReveal(t.id)}>
            <FolderOpen size={14} />
          </button>
        )}
        {!ended && (
          <button className="icon-btn" title="Stop" onClick={() => void window.api.fileSendCancel(t.id).catch(notify)} data-fsend-cancel>
            <X size={14} />
          </button>
        )}
        {ended && (
          <button className="icon-btn" title="Remove from the list" onClick={() => void window.api.fileSendForget(t.id).catch(notify)}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </li>
  )
}

function DriveItem({ d }: { d: DriveShare }) {
  const [copied, setCopied] = useState(false)
  const status =
    d.status === 'uploading'
      ? [`Uploading ${sizeText(d.done)} of ${sizeText(d.total)}`, d.speed ? speedText(d.speed) : '', timeLeft(d.total - d.done, d.speed)].filter(Boolean).join(' · ')
      : d.status === 'ready'
        ? `${sizeText(d.total)} · anyone with the link can download it · taken off your Drive in ${d.expires ? until(d.expires) : `${DRIVE_KEEP_DAYS} days`}`
        : d.status === 'removed'
          ? 'Taken off your Drive'
          : (d.error ?? 'Didn’t work')
  return (
    <li className={`convert-item fsend-item ${d.status === 'removed' ? 'cancelled' : d.status}`} data-fsend-drive={d.status}>
      <Cloud size={16} className="convert-kind" />
      <div className="convert-name">
        <span>{d.title}</span>
        <small>{status}</small>
        {d.status === 'uploading' && d.total > 0 && (
          <div className="vdl-progress">
            <Bar value={d.done / d.total} />
            <span className="vdl-percent">{Math.floor((d.done / d.total) * 100)}%</span>
          </div>
        )}
        {d.status === 'ready' && d.link && (
          <div className="fsend-code">
            <code className="fsend-link">{d.link}</code>
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard.writeText(d.link!)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        )}
      </div>
      <div className="vdl-actions">
        {d.status === 'ready' && d.link && (
          <button className="icon-btn" title="Open in the browser" onClick={() => window.open(d.link, '_blank')}>
            <ExternalLink size={14} />
          </button>
        )}
        {(d.status === 'uploading' || d.status === 'ready') && (
          <button className="icon-btn" title={d.status === 'ready' ? 'Take it off your Drive now (the link stops working)' : 'Stop'} onClick={() => void window.api.fileSendDriveRemove(d.id).catch(notify)}>
            <X size={14} />
          </button>
        )}
        {(d.status === 'failed' || d.status === 'removed') && (
          <button className="icon-btn" title="Remove from the list" onClick={() => void window.api.fileSendDriveForget(d.id).catch(notify)}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </li>
  )
}

export default function FileSenderPage() {
  const state = useFileSend()
  const [over, setOver] = useState(false)
  const [code, setCode] = useState('')
  const [viaDrive, setViaDrive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [changing, setChanging] = useState(false)
  if (!state) return <div className="convert-page" data-fsend-page />

  const send = async (paths: string[]): Promise<void> => {
    if (!paths.length) return
    setBusy(true)
    try {
      if (viaDrive) await window.api.fileSendDrive(paths)
      else await window.api.fileSendStart(paths)
    } catch (err) {
      notify(err)
    } finally {
      setBusy(false)
    }
  }
  const pick = async (kind: 'files' | 'folder'): Promise<void> => send(await window.api.fileSendPick(kind))
  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setOver(false)
    void send(Array.from(e.dataTransfer.files).map((f) => window.api.pathForFile(f)).filter(Boolean))
  }
  const receive = async (): Promise<void> => {
    if (!code.trim()) return
    setBusy(true)
    try {
      await window.api.fileSendReceive(code)
      setCode('')
    } catch (err) {
      notify(err)
    } finally {
      setBusy(false)
    }
  }
  const needsServer = !state.server && !viaDrive

  return (
    <div className="convert-page" data-fsend-page>
      <div className="convert-inner">
        <h2>
          <Send size={18} /> Big file sender
        </h2>
        <p className="convert-intro">
          Send huge files or whole folders to a friend’s computer, anywhere. You get a code; they type it into their Orbit and it comes straight from your computer to theirs, locked the whole way. No size limit, and if
          the connection drops it carries on where it stopped. Keep Orbit open on both until it’s done (your computer won’t go to sleep meanwhile).
        </p>

        {state.server && !changing ? <ServerBar state={state} onChange={() => setChanging(true)} /> : <SetupBox state={state} onDone={() => setChanging(false)} />}

        <div className="fsend-columns">
          <section className="fsend-box">
            <h3>
              <Upload size={15} /> Send
            </h3>
            <div className="fsend-how" role="radiogroup">
              <label>
                <input type="radio" checked={!viaDrive} onChange={() => setViaDrive(false)} /> With a code <small>(they have Orbit)</small>
              </label>
              <label>
                <input type="radio" checked={viaDrive} onChange={() => setViaDrive(true)} data-fsend-drive-mode /> Google Drive link <small>(they don’t)</small>
              </label>
            </div>
            {viaDrive && state.driveAccess !== 'ready' ? (
              <div className="fsend-drive-setup">
                {state.driveAccess === 'setup' ? (
                  <>Drive links use the Google sign-in from Settings → Calendar. Set that up first, then switch on the Google Drive API in the same Google project.</>
                ) : (
                  <>
                    Orbit needs your OK to put files in your Drive (only files it makes, nothing else there).{' '}
                    <button className="btn" onClick={() => void window.api.fileSendDriveConnect().catch(notify)} data-fsend-drive-connect>
                      Allow Drive
                    </button>
                  </>
                )}
              </div>
            ) : (
              <button
                className={`convert-drop${over ? ' over' : ''}`}
                disabled={busy || needsServer}
                onDragOver={(e) => {
                  e.preventDefault()
                  setOver(true)
                }}
                onDragLeave={() => setOver(false)}
                onDrop={onDrop}
                onClick={() => void pick('files')}
                data-fsend-drop
              >
                {busy ? <Loader2 size={22} className="spin" /> : viaDrive ? <Cloud size={22} /> : <FolderUp size={22} />}
                {viaDrive ? 'Drop files or a folder to put on Google Drive' : needsServer ? 'Set up sending with a code first (above)' : 'Drop files or a folder here'}
                <span>{viaDrive ? `Free Drive holds 15 GB. Taken off after ${DRIVE_KEEP_DAYS} days.` : needsServer ? 'Or pick “Google Drive link”, which works without it' : 'or click to pick files'}</span>
              </button>
            )}
            {!(viaDrive && state.driveAccess !== 'ready') && (
              <button className="btn fsend-folder" disabled={busy || needsServer} onClick={() => void pick('folder')}>
                <FolderOpen size={14} /> Pick a folder
              </button>
            )}
          </section>

          <section className="fsend-box">
            <h3>
              <Download size={15} /> Get
            </h3>
            <p className="fsend-hint">{state.server ? 'Type the code your friend gave you.' : 'Set up sending with a code first (above). If a friend set it up, choose “A friend already did”.'}</p>
            <div className="vdl-form">
              <input
                className="text-input vdl-link"
                placeholder="4821-tiger-piano-river"
                value={code}
                spellCheck={false}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void receive()}
                data-fsend-code-input
              />
              <button className="btn primary" disabled={busy || !code.trim() || !state.server} onClick={() => void receive()} data-fsend-get>
                Get
              </button>
            </div>
            <p className="fsend-hint">
              <ShieldCheck size={13} /> You’ll see who it’s from and how big it is before anything is saved.
            </p>
          </section>
        </div>

        {state.transfers.length > 0 && (
          <ul className="convert-list" data-fsend-list>
            {state.transfers.map((t) => (
              <TransferItem key={t.id} t={t} />
            ))}
          </ul>
        )}
        {state.drive.length > 0 && (
          <>
            <div className="dm-head">
              <h3>Google Drive links</h3>
            </div>
            <ul className="convert-list" data-fsend-drive-list>
              {state.drive.map((d) => (
                <DriveItem key={d.id} d={d} />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
