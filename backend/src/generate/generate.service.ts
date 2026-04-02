import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
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

const execFileAsync = promisify(execFile);

@Injectable()
export class GenerateService {
  private readonly logger = new Logger(GenerateService.name);
  private readonly geminiCliPath = process.env.GEMINI_CLI_PATH ?? 'gemini';
  private readonly geminiModel = process.env.GEMINI_MODEL;

  constructor(
    private readonly ragService: RagService,
    private readonly feedbackService: FeedbackService,
  ) {}

  async summarizeProfile(profile: string): Promise<string> {
    return this.runGemini(
      `Summarize this dating profile in 6–8 words capturing the person's vibe:\n\n${profile}`,
    );
  }

  async callGemini(userPrompt: string): Promise<string> {
    return this.runGemini(userPrompt, SYSTEM_INSTRUCTION);
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

  private async runGemini(prompt: string, systemInstruction?: string): Promise<string> {
    const fullPrompt = systemInstruction
      ? `${systemInstruction}\n\n${prompt}`
      : prompt;

    const args = ['-p', fullPrompt, '-o', 'text'];
    if (this.geminiModel) {
      args.unshift(this.geminiModel);
      args.unshift('--model');
    }

    try {
      const { stdout, stderr } = await execFileAsync(this.geminiCliPath, args, {
        env: process.env,
        maxBuffer: 1024 * 1024 * 8,
        timeout: 60000,
      });

      const output = stdout.trim();
      if (!output) {
        throw new Error(stderr.trim() || 'Gemini CLI returned empty output');
      }

      return output;
    } catch (error) {
      this.logger.error('Gemini CLI call failed', error as Error);

      const message = error instanceof Error ? error.message : String(error);
      const stdout = typeof error === 'object' && error !== null && 'stdout' in error
        ? String(error.stdout ?? '')
        : '';
      const stderr = typeof error === 'object' && error !== null && 'stderr' in error
        ? String(error.stderr ?? '')
        : '';
      const combinedOutput = `${stdout}\n${stderr}\n${message}`;

      if (combinedOutput.includes('Opening authentication page in your browser')) {
        throw new Error('Gemini CLI is not authenticated. Run `gemini` once in the terminal and sign in.');
      }
      if (message.includes('ENOENT')) {
        throw new Error(`Gemini CLI was not found at "${this.geminiCliPath}". Install it or set GEMINI_CLI_PATH.`);
      }
      if (message.includes('timed out')) {
        throw new Error('Gemini CLI timed out. If this is the first run, authenticate by running `gemini` once in the terminal.');
      }

      throw new Error(`Gemini CLI request failed: ${message}`);
    }
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
