import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { RagService } from '../rag/rag.service';
import { FeedbackService } from '../feedback/feedback.service';

const SYSTEM_INSTRUCTION = `Write opening messages for dating apps.
Rules:
- Never compliment her looks
- No puns
- No exclamation marks
- No generic questions (e.g. "How's your day?")
- Do not open with Hey or Hi
- 1–3 sentences max
- Match her energy from the profile
- One message per option`;

@Injectable()
export class GenerateService {
  private readonly logger = new Logger(GenerateService.name);
  private readonly genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  private readonly model = this.genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL ?? 'gemini-2.0-flash',
    systemInstruction: SYSTEM_INSTRUCTION,
  });

  constructor(
    private readonly ragService: RagService,
    private readonly feedbackService: FeedbackService,
  ) {}

  async summarizeProfile(profile: string): Promise<string> {
    const summaryModel = this.genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL ?? 'gemini-2.0-flash',
    });
    const result = await summaryModel.generateContent(
      `Summarize this dating profile in 6–8 words capturing the person's vibe:\n\n${profile}`,
    );
    return result.response.text().trim();
  }

  async callGemini(userPrompt: string): Promise<string> {
    const result = await this.model.generateContent(userPrompt);
    return result.response.text();
  }

  async generate(profile: string, name?: string): Promise<{ suggestions: string[] }> {
    const summary = await this.summarizeProfile(profile);

    const [summaryVector, profileVector] = await Promise.all([
      this.ragService.embed(summary),
      this.ragService.embed(profile),
    ]);

    const [relevantAdvice, pastSuccesses, pastMistakes] = await Promise.all([
      this.ragService.retrieve(summaryVector),
      this.feedbackService.getPositiveExamples(profileVector),
      this.feedbackService.getNegativeExamples(profileVector),
    ]);

    const prompt = this.buildPrompt(profile, name, relevantAdvice, pastSuccesses, pastMistakes);
    const raw = await this.callGemini(prompt);

    return { suggestions: this.parseSuggestions(raw.trim()) };
  }

  private buildPrompt(
    profile: string,
    name: string | undefined,
    chunks: string[],
    wins: Array<{ profile: string; message: string }>,
    failures: Array<{ message: string; reason: string }>,
  ): string {
    const parts: string[] = [];

    if (chunks.length > 0) {
      parts.push(chunks.map(c => `— ${c}`).join('\n'));
    }

    if (wins.length > 0) {
      parts.push(wins.map(w => `Profile like: "${w.profile}" → Worked: "${w.message}"`).join('\n'));
    }

    if (failures.length > 0) {
      parts.push(failures.map(f => `"${f.message}" — Why it failed: "${f.reason}"`).join('\n'));
    }

    parts.push(`Profile:\n${profile}`);
    if (name) parts.push(`Name: ${name}`);

    parts.push(`Generate exactly 3 options.

Detect the language from her profile and write all messages in that same language.

Format:
Option 1: [message]
Option 2: [message]
Option 3: [message]`);

    return parts.join('\n\n');
  }

  private parseSuggestions(raw: string): string[] {
    const lines = raw.split('\n').filter(l => l.trim());
    const suggestions: string[] = [];

    for (const line of lines) {
      const match = line.match(/^Option\s*\d+[:\.\)]\s*(.+)/i);
      if (match) suggestions.push(match[1].trim());
    }

    // Fallback: return non-empty lines if format parsing fails
    if (suggestions.length === 0) {
      return lines.filter(l => l.trim().length > 10).slice(0, 3);
    }

    return suggestions;
  }
}
