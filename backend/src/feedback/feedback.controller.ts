import { Controller, Post, Body } from '@nestjs/common';
import { FeedbackService } from './feedback.service';

@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  async save(@Body() body: { profile: string; message: string; positive: boolean; reason?: string }) {
    await this.feedbackService.save(body.profile, body.message, body.positive, body.reason);
    return { ok: true };
  }
}
