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
type CliProvider = 'crush' | 'gemini';

@Injectable()
export class GenerateService {
  private readonly logger = new Logger(GenerateService.name);
  private readonly cliProvider = this.resolveCliProvider();

  constructor(
    private readonly ragService: RagService,
    private readonly feedbackService: FeedbackService,
  ) {}

  async summarizeProfile(profile: string): Promise<string> {
    return this.runModel(
      `Summarize this dating profile in 6–8 words capturing the person's vibe:\n\n${profile}`,
    );
  }

  async callModel(userPrompt: string): Promise<string> {
    return this.runModel(userPrompt, SYSTEM_INSTRUCTION);
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
    const raw = await this.callModel(prompt);

    return { suggestions: this.parseSuggestions(raw.trim()) };
  }

  private resolveCliProvider(): CliProvider {
    const provider = (process.env.LLM_CLI_PROVIDER ?? 'crush').trim().toLowerCase();
    if (provider === 'crush' || provider === 'gemini') {
      return provider;
    }

    throw new Error(`Unsupported LLM_CLI_PROVIDER "${provider}". Use "crush" or "gemini".`);
  }

  private async runModel(prompt: string, systemInstruction?: string): Promise<string> {
    const fullPrompt = systemInstruction
      ? `${systemInstruction}\n\n${prompt}`
      : prompt;

    const { command, args } = this.buildCliCommand(fullPrompt);

    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        env: process.env,
        maxBuffer: 1024 * 1024 * 8,
        timeout: 60000,
      });

      const output = stdout.trim();
      if (!output) {
        throw new Error(stderr.trim() || `${this.cliProvider} CLI returned empty output`);
      }

      return output;
    } catch (error) {
      this.logger.error(`${this.cliProvider} CLI call failed`, error as Error);

      const message = error instanceof Error ? error.message : String(error);
      const stdout = typeof error === 'object' && error !== null && 'stdout' in error
        ? String(error.stdout ?? '')
        : '';
      const stderr = typeof error === 'object' && error !== null && 'stderr' in error
        ? String(error.stderr ?? '')
        : '';
      const combinedOutput = `${stdout}\n${stderr}\n${message}`;

      if (this.cliProvider === 'gemini' && combinedOutput.includes('Opening authentication page in your browser')) {
        throw new Error('Gemini CLI is not authenticated. Run `gemini` once in the terminal and sign in.');
      }
      if (this.cliProvider === 'crush' && combinedOutput.includes('failed to start agent processing stream')) {
        throw new Error('Crush CLI request failed. Check your network connection and Crush provider login/config.');
      }
      if (message.includes('ENOENT')) {
        throw new Error(`${this.providerLabel()} CLI was not found at "${command}". Install it or set the configured CLI path env.`);
      }
      if (message.includes('timed out')) {
        throw new Error(`${this.providerLabel()} CLI timed out.`);
      }

      throw new Error(`${this.providerLabel()} CLI request failed: ${message}`);
    }
  }

  private buildCliCommand(prompt: string): { command: string; args: string[] } {
    if (this.cliProvider === 'crush') {
      const command = process.env.CRUSH_CLI_PATH ?? 'crush';
      const args = ['run', prompt];
      const model = this.resolveCrushModel();
      if (model) {
        args.push('--model', model);
      }
      return { command, args };
    }

    const command = process.env.GEMINI_CLI_PATH ?? 'gemini';
    const args = ['-p', prompt, '-o', 'text'];
    const model = process.env.GEMINI_MODEL;
    if (model) {
      args.unshift(model);
      args.unshift('--model');
    }
    return { command, args };
  }

  private resolveCrushModel(): string | undefined {
    if (process.env.CRUSH_MODEL) return process.env.CRUSH_MODEL;
    if (process.env.LLM_CLI_MODEL) return process.env.LLM_CLI_MODEL;
    if (process.env.ZAI_MODEL) {
      return process.env.ZAI_MODEL.includes('/') ? process.env.ZAI_MODEL : `zai/${process.env.ZAI_MODEL}`;
    }
    return undefined;
  }

  private providerLabel(): string {
    return this.cliProvider === 'crush' ? 'Crush' : 'Gemini';
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
