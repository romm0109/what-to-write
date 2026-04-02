const BASE_URL = 'http://localhost:3000';

export async function generateMessages(profile: string, name?: string): Promise<string[]> {
  const res = await fetch(`${BASE_URL}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile, name }),
  });
  if (!res.ok) throw new Error('Generation failed');
  const data = await res.json();
  return data.suggestions;
}

export async function saveFeedback(profile: string, message: string, positive: boolean, reason?: string): Promise<void> {
  await fetch(`${BASE_URL}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile, message, positive, reason }),
  });
}
