import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');

interface Chunk {
  text: string;
  embedding: number[];
  source: string;
}

@Injectable()
export class RagService implements OnModuleInit {
  private readonly logger = new Logger(RagService.name);
  private chunks: Chunk[] = [];
  private embedder: any = null;

  private readonly pdfsDir = path.join(process.cwd(), 'pdfs');
  private readonly indexDir = path.join(process.cwd(), 'index');
  private readonly indexFile = path.join(process.cwd(), 'index', 'vectors.json');

  async onModuleInit() {
    this.ensureDirs();
    await this.loadOrBuildIndex();
  }

  private ensureDirs() {
    if (!fs.existsSync(this.pdfsDir)) fs.mkdirSync(this.pdfsDir, { recursive: true });
    if (!fs.existsSync(this.indexDir)) fs.mkdirSync(this.indexDir, { recursive: true });
  }

  private async loadOrBuildIndex() {
    if (fs.existsSync(this.indexFile)) {
      this.chunks = JSON.parse(fs.readFileSync(this.indexFile, 'utf-8'));
      this.logger.log(`Loaded ${this.chunks.length} chunks from existing index`);
      return;
    }

    const pdfFiles = fs.readdirSync(this.pdfsDir).filter(f => f.endsWith('.pdf'));

    if (pdfFiles.length === 0) {
      this.logger.warn('No PDFs found in pdfs/ — drop your PDFs there and restart to build the index');
      return;
    }

    this.logger.log(`Building index from ${pdfFiles.length} PDFs...`);
    await this.buildIndex(pdfFiles);
    this.logger.log(`Done — index has ${this.chunks.length} chunks`);
  }

  private async buildIndex(pdfFiles: string[]) {
    for (const file of pdfFiles) {
      this.logger.log(`Processing ${file}...`);
      const buffer = fs.readFileSync(path.join(this.pdfsDir, file));
      const data = await pdfParse(buffer);
      const chunks = this.chunkText(data.text);

      for (let i = 0; i < chunks.length; i++) {
        const embedding = await this.embed(chunks[i]);
        this.chunks.push({ text: chunks[i], embedding, source: file });

        if ((i + 1) % 20 === 0) {
          this.logger.log(`  ${file}: ${i + 1}/${chunks.length} chunks done`);
        }
      }
    }

    fs.writeFileSync(this.indexFile, JSON.stringify(this.chunks));
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

  private async embed(text: string): Promise<number[]> {
    const embedder = await this.getEmbedder();
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data) as number[];
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  async retrieve(query: string, topK = 5): Promise<string> {
    if (this.chunks.length === 0) return '';

    const queryEmbedding = await this.embed(query);

    const scored = this.chunks
      .map(chunk => ({ text: chunk.text, score: this.cosineSimilarity(queryEmbedding, chunk.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored.map(s => s.text).join('\n\n---\n\n');
  }
}
