import { Cloud, Cpu } from 'lucide-react'
import { useAi } from '../../store/ai'

/**
 * Under an offline answer: says it came from this computer, and offers to ask Claude instead.
 * Orbit never goes online by itself; when the offline AI thinks a question is too hard for it,
 * the offer is just made more plainly.
 */
export default function OnlineOffer({ hard, privately, onAsk, busy }: { hard?: boolean; privately?: boolean; onAsk?: () => void; busy?: boolean }) {
  const hasKey = useAi((s) => !!s.status?.hasKey)
  if (privately) {
    return (
      <p className="ai-offline-note" data-ai-offline>
        <Cpu size={12} /> Answered privately by the offline AI. Nothing left this computer.
      </p>
    )
  }
  return (
    <div className={`ai-offline-note ${hard ? 'hard' : ''}`} data-ai-offline data-ai-hard={hard ? '' : undefined}>
      <Cpu size={12} />
      <span>{hard ? 'The offline AI wasn’t sure about this one. Claude may do better.' : 'Answered by the offline AI on this computer.'}</span>
      {onAsk &&
        (hasKey ? (
          <button className={`btn ${hard ? 'btn-primary' : ''}`} disabled={busy} onClick={onAsk} title="Sends the same question (and what it needs) to Anthropic" data-ai-ask-online>
            <Cloud size={12} /> Ask Claude online
          </button>
        ) : (
          hard && <span className="ai-offline-hint">Add an Anthropic key in Settings → AI helper to ask Claude.</span>
        ))}
    </div>
  )
}
