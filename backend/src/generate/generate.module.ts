import { Module } from '@nestjs/common';
import { GenerateController } from './generate.controller';
import { GenerateService } from './generate.service';
import { RagModule } from '../rag/rag.module';
import { FeedbackModule } from '../feedback/feedback.module';

@Module({
  imports: [RagModule, FeedbackModule],
  controllers: [GenerateController],
  providers: [GenerateService],
})
export class GenerateModule {}
