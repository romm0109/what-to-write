import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

interface FeedbackEntry {
  profile: string;
  message: string;
  positive: boolean;
  reason?: string;
  timestamp: string;
}

@Injectable()
export class FeedbackService {
  private readonly dataDir = path.join(process.cwd(), 'data');
  private readonly feedbackFile = path.join(process.cwd(), 'data', 'feedback.json');

  private ensureFile() {
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
    if (!fs.existsSync(this.feedbackFile)) fs.writeFileSync(this.feedbackFile, '[]');
  }

  async save(profile: string, message: string, positive: boolean, reason?: string): Promise<void> {
    this.ensureFile();
    const entries: FeedbackEntry[] = JSON.parse(fs.readFileSync(this.feedbackFile, 'utf-8'));
    entries.push({ profile, message, positive, ...(reason && { reason }), timestamp: new Date().toISOString() });
    fs.writeFileSync(this.feedbackFile, JSON.stringify(entries, null, 2));
  }

  async getPositiveExamples(limit: number): Promise<string> {
    this.ensureFile();
    const entries: FeedbackEntry[] = JSON.parse(fs.readFileSync(this.feedbackFile, 'utf-8'));

    const positives = entries.filter(e => e.positive).slice(-limit);
    if (positives.length === 0) return '';

    return positives
      .map(e => `Profile: "${e.profile.slice(0, 120)}..."\nMessage that worked: "${e.message}"`)
      .join('\n\n');
  }

  async getNegativeExamples(limit: number): Promise<string> {
    this.ensureFile();
    const entries: FeedbackEntry[] = JSON.parse(fs.readFileSync(this.feedbackFile, 'utf-8'));

    const negatives = entries.filter(e => !e.positive && e.reason).slice(-limit);
    if (negatives.length === 0) return '';

    return negatives
      .map(e => `Message to avoid: "${e.message}" — Reason: "${e.reason}"`)
      .join('\n\n');
  }
}
