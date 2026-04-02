import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { RagModule } from './rag/rag.module';
import { GenerateModule } from './generate/generate.module';
import { FeedbackModule } from './feedback/feedback.module';

@Module({
  imports: [DbModule, RagModule, GenerateModule, FeedbackModule],
})
export class AppModule {}
