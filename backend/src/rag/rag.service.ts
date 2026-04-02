import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { DbService } from '../db/db.service';
import { v4 as uuidv4 } from 'uuid';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');

@Injectable()
export class RagService implements OnModuleInit {
  private readonly logger = new Logger(RagService.name);
  private embedder: any = null;

  private readonly pdfsDir = path.join(process.cwd(), 'pdfs');

  constructor(private readonly db: DbService) {}

  async onModuleInit() {
    if (!fs.existsSync(this.pdfsDir)) fs.mkdirSync(this.pdfsDir, { recursive: true });

    await this.db.ensureReady();
    const count = await this.db.knowledgeTable.countRows();
    if (count === 0) {
      const pdfFiles = fs.existsSync(this.pdfsDir)
        ? fs.readdirSync(this.pdfsDir).filter(f => f.endsWith('.pdf'))
        : [];

      if (pdfFiles.length === 0) {
        this.logger.warn('No PDFs found in pdfs/ — drop your PDFs there and restart to build the index');
        return;
      }

      this.logger.log(`Building index from ${pdfFiles.length} PDFs...`);
      await this.buildIndex(pdfFiles);
      this.logger.log('Index build complete');
    } else {
      this.logger.log(`Knowledge table has ${count} chunks — skipping index build`);
    }
  }

  private async buildIndex(pdfFiles: string[]) {
    for (const file of pdfFiles) {
      this.logger.log(`Processing ${file}...`);
      const buffer = fs.readFileSync(path.join(this.pdfsDir, file));
      const data = await pdfParse(buffer);
      const chunks = this.chunkText(data.text);

      const rows: { id: string; text: string; vector: number[]; source: string }[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const vector = await this.embed(chunks[i]);
        rows.push({ id: uuidv4(), text: chunks[i], vector, source: file });

        if ((i + 1) % 20 === 0) {
          this.logger.log(`  ${file}: ${i + 1}/${chunks.length} chunks done`);
        }
      }

      await this.db.knowledgeTable.add(rows);
    }
  }

  // Split text into overlapping word windows
  private chunkText(text: string, wordsPerChunk = 200, overlap = 40): string[] {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const chunks: string[] = [];

    for (let i = 0; i < words.length; i += wordsPerChunk - overlap) {
      const chunk = words.slice(i, i + wordsPerChunk).join(' ').trim();
      if (chunk.length > 80) chunks.push(chunk);
    }

    return chunks;
  }

  // Lazy-load the local embedding model (downloads ~25MB on first run, then cached)
  private async getEmbedder() {
    if (!this.embedder) {
      this.logger.log('Loading local embedding model (first time may take a moment)...');
      const { pipeline } = await import('@xenova/transformers');
      this.embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      this.logger.log('Embedding model ready');
    }
    return this.embedder;
  }

  public async embed(text: string): Promise<number[]> {
    const embedder = await this.getEmbedder();
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data) as number[];
  }

  async retrieve(vector: number[]): Promise<string[]> {
    const count = await this.db.knowledgeTable.countRows();
    if (count === 0) return [];

    const results = await this.db.knowledgeTable
      .search(vector)
      .limit(5)
      .toArray();

    return results.map((r: any) => r.text as string);
  }
}
