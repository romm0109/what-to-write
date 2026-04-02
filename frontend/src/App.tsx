import { useState } from 'react'
import ProfileInput from './components/ProfileInput'
import MessageCard from './components/MessageCard'
import { generateMessages, saveFeedback } from './api'

export default function App() {
  const [profile, setProfile] = useState('')
  const [name, setName] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState<Record<number, boolean>>({})

  const handleGenerate = async () => {
    if (!profile.trim()) return
    setLoading(true)
    setError('')
    setSuggestions([])
    setFeedback({})
    try {
      const results = await generateMessages(profile, name || undefined)
      setSuggestions(results)
    } catch {
      setError('Something went wrong. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  const handleFeedback = async (index: number, positive: boolean, reason?: string) => {
    setFeedback(prev => ({ ...prev, [index]: positive }))
    await saveFeedback(profile, suggestions[index], positive, reason)
  }

  return (
    <div className="app">
      <header>
        <h1>What To Write</h1>
        <p>Paste her profile — get 3 opening messages</p>
      </header>

      <main>
        <ProfileInput
          profile={profile}
          name={name}
          onProfileChange={setProfile}
          onNameChange={setName}
          onGenerate={handleGenerate}
          loading={loading}
        />

        {error && <p className="error">{error}</p>}

        {suggestions.length > 0 && (
          <div className="suggestions">
            {suggestions.map((msg, i) => (
              <MessageCard
                key={i}
                index={i}
                message={msg}
                feedback={feedback[i] ?? null}
                onFeedback={(positive, reason) => handleFeedback(i, positive, reason)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
