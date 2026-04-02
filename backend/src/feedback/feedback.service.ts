import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { DbService } from '../db/db.service';
import { RagService } from '../rag/rag.service';

@Injectable()
export class FeedbackService {
  constructor(
    private readonly db: DbService,
    private readonly ragService: RagService,
  ) {}

  async save(profile: string, message: string, positive: boolean, reason?: string): Promise<void> {
    const vector = await this.ragService.embed(profile);
    await this.db.feedbackTable.add([
      {
        id: uuidv4(),
        profile,
        message,
        positive: positive ? 1 : 0,
        reason: reason ?? '',
        vector,
        timestamp: new Date().toISOString(),
      },
    ]);
  }

  async getPositiveExamples(profileVector: number[], limit = 3): Promise<string> {
    const rows = await this.db.feedbackTable
      .search(profileVector)
      .limit(20)
      .toArray();

    const positives = rows.filter((r: any) => r.positive === 1).slice(0, limit);
    if (positives.length === 0) return '';

    return positives
      .map((r: any) => `Profile like: "${String(r.profile).slice(0, 120)}..." → Worked: "${r.message}"`)
      .join('\n\n');
  }

  async getNegativeExamples(profileVector: number[], limit = 3): Promise<string> {
    const rows = await this.db.feedbackTable
      .search(profileVector)
      .limit(20)
      .toArray();

    const negatives = rows
      .filter((r: any) => r.positive === 0 && r.reason && r.reason !== '')
      .slice(0, limit);
    if (negatives.length === 0) return '';

    return negatives
      .map((r: any) => `"${r.message}" — Why it failed: "${r.reason}"`)
      .join('\n\n');
  }
}
