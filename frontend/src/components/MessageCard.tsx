import { useState } from 'react'

interface Props {
  index: number
  message: string
  feedback: boolean | null
  onFeedback: (positive: boolean, reason?: string) => void
}

export default function MessageCard({ index, message, feedback, onFeedback }: Props) {
  const [copied, setCopied] = useState(false)
  const [reason, setReason] = useState('')

  const copy = async () => {
    await navigator.clipboard.writeText(message)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const submitReason = () => {
    onFeedback(false, reason.trim() || undefined)
  }

  return (
    <div className="message-card">
      <span className="option-label">Option {index + 1}</span>
      <p className="message-text" dir="auto">{message}</p>
      <div className="card-actions">
        <button onClick={copy} className="copy-btn">
          {copied ? 'Copied!' : 'Copy'}
        </button>
        <div className="feedback-btns">
          <button
            onClick={() => onFeedback(true)}
            className={`thumb-btn ${feedback === true ? 'active-positive' : ''}`}
          >
            👍
          </button>
          <button
            onClick={() => onFeedback(false)}
            className={`thumb-btn ${feedback === false ? 'active-negative' : ''}`}
          >
            👎
          </button>
        </div>
      </div>

      {feedback === false && (
        <div className="reason-box">
          <input
            type="text"
            placeholder="Why wasn't this good? (optional)"
            value={reason}
            onChange={e => setReason(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submitReason()}
            className="reason-input"
            dir="auto"
            autoFocus
          />
          <button onClick={submitReason} className="reason-save-btn">Save</button>
        </div>
      )}
    </div>
  )
}
