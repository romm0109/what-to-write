import { Controller, Post, Body } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { RagService } from '../rag/rag.service';

@Controller('feedback')
export class FeedbackController {
  constructor(
    private readonly feedbackService: FeedbackService,
    private readonly ragService: RagService,
  ) {}

  @Post()
  async save(@Body() body: { profile: string; message: string; positive: boolean; reason?: string }) {
    const profileVector = await this.ragService.embed(body.profile);
    await this.feedbackService.save(body.profile, body.message, body.positive, body.reason, profileVector);
    return { ok: true };
  }
}
