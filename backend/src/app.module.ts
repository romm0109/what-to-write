import { Module } from '@nestjs/common';
import { RagModule } from './rag/rag.module';
import { GenerateModule } from './generate/generate.module';
import { FeedbackModule } from './feedback/feedback.module';

@Module({
  imports: [RagModule, GenerateModule, FeedbackModule],
})
export class AppModule {}
