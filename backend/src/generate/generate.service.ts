import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { RagService } from '../rag/rag.service';
import { FeedbackService } from '../feedback/feedback.service';

const SYSTEM_INSTRUCTION = `You are an expert dating coach who helps men craft genuine, engaging opening messages for dating apps.
Your goal is to write messages that feel personal, natural, and spark real conversation.`;

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
    const [relevantAdvice, pastSuccesses, pastMistakes] = await Promise.all([
      this.ragService.retrieve(profile),
      this.feedbackService.getPositiveExamples(3),
      this.feedbackService.getNegativeExamples(3),
    ]);

    const prompt = this.buildPrompt(profile, name, relevantAdvice, pastSuccesses, pastMistakes);
    const raw = await this.callGemini(prompt);

    return { suggestions: this.parseSuggestions(raw.trim()) };
  }

  private buildPrompt(
    profile: string,
    name: string | undefined,
    relevantAdvice: string,
    pastSuccesses: string,
    pastMistakes: string,
  ): string {
    let prompt = '';

    if (relevantAdvice) {
      prompt += `Relevant advice from your knowledge base:\n${relevantAdvice}\n\n`;
    }

    if (pastSuccesses) {
      prompt += `Examples of messages that worked well for this user in the past:\n${pastSuccesses}\n\n`;
    }

    if (pastMistakes) {
      prompt += `Messages this user found ineffective and why — avoid these patterns:\n${pastMistakes}\n\n`;
    }

    prompt += `Here is her dating profile:\n${profile}`;
    if (name) prompt += `\n\nHer name: ${name}`;

    prompt += `

Generate exactly 3 distinct opening message options. Each should:
- Reference something specific from her profile (never be generic)
- Feel natural and conversational, not salesy
- Be different from each other in tone or angle (e.g. playful, curious, direct)
- Be short — 1 to 3 sentences max

Detect the language from her profile and write all messages in that same language.

Format your response exactly like this:
Option 1: [message]
Option 2: [message]
Option 3: [message]`;

    return prompt;
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
