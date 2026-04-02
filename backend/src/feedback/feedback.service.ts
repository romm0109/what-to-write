import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

interface FeedbackEntry {
  profile: string;
  message: string;
  positive: boolean;
  reason?: string;
  timestamp: string;
  profileVector?: number[];
}

@Injectable()
export class FeedbackService {
  private readonly dataDir = path.join(process.cwd(), 'data');
  private readonly feedbackFile = path.join(process.cwd(), 'data', 'feedback.json');

  private ensureFile() {
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
    if (!fs.existsSync(this.feedbackFile)) fs.writeFileSync(this.feedbackFile, '[]');
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  async save(profile: string, message: string, positive: boolean, reason?: string, profileVector?: number[]): Promise<void> {
    this.ensureFile();
    const entries: FeedbackEntry[] = JSON.parse(fs.readFileSync(this.feedbackFile, 'utf-8'));
    entries.push({ profile, message, positive, ...(reason && { reason }), timestamp: new Date().toISOString(), ...(profileVector && { profileVector }) });
    fs.writeFileSync(this.feedbackFile, JSON.stringify(entries, null, 2));
  }

  async getPositiveExamples(profileVector: number[], topK = 3): Promise<string> {
    this.ensureFile();
    const entries: FeedbackEntry[] = JSON.parse(fs.readFileSync(this.feedbackFile, 'utf-8'));

    const positives = entries.filter(e => e.positive);
    if (positives.length === 0) return '';

    const ranked = positives
      .map(e => ({ entry: e, score: e.profileVector ? this.cosineSimilarity(profileVector, e.profileVector) : 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return ranked
      .map(({ entry: e }) => `Profile: "${e.profile.slice(0, 120)}..."\nMessage that worked: "${e.message}"`)
      .join('\n\n');
  }

  async getNegativeExamples(profileVector: number[], topK = 3): Promise<string> {
    this.ensureFile();
    const entries: FeedbackEntry[] = JSON.parse(fs.readFileSync(this.feedbackFile, 'utf-8'));

    const negatives = entries.filter(e => !e.positive && e.reason);
    if (negatives.length === 0) return '';

    const ranked = negatives
      .map(e => ({ entry: e, score: e.profileVector ? this.cosineSimilarity(profileVector, e.profileVector) : 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return ranked
      .map(({ entry: e }) => `Message to avoid: "${e.message}" — Reason: "${e.reason}"`)
      .join('\n\n');
  }
}
