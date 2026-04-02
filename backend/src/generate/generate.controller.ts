import { Controller, Post, Body } from '@nestjs/common';
import { GenerateService } from './generate.service';

@Controller('generate')
export class GenerateController {
  constructor(private readonly generateService: GenerateService) {}

  @Post()
  async generate(@Body() body: { profile: string; name?: string }) {
    return this.generateService.generate(body.profile, body.name);
  }
}
