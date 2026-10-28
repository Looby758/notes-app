import { useEffect, useRef } from 'react'
import { attachTerminal } from '../../lib/terminal'

/** The Terminal tab: a command line that starts in the notes folder. */
export default function TerminalPage() {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => attachTerminal(host.current!), [])
  return <div ref={host} className="terminal-page" data-terminal />
}
