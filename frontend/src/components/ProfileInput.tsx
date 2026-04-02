interface Props {
  profile: string
  name: string
  onProfileChange: (v: string) => void
  onNameChange: (v: string) => void
  onGenerate: () => void
  loading: boolean
}

export default function ProfileInput({ profile, name, onProfileChange, onNameChange, onGenerate, loading }: Props) {
  return (
    <div className="profile-input">
      <input
        type="text"
        placeholder="Her name (optional)"
        value={name}
        onChange={e => onNameChange(e.target.value)}
        className="name-input"
      />
      <textarea
        placeholder="Paste her bio, interests, prompts — anything from her profile..."
        value={profile}
        onChange={e => onProfileChange(e.target.value)}
        rows={8}
        className="profile-textarea"
        dir="auto"
      />
      <button
        onClick={onGenerate}
        disabled={loading || !profile.trim()}
        className="generate-btn"
      >
        {loading ? 'Thinking...' : 'What should I write?'}
      </button>
    </div>
  )
}
