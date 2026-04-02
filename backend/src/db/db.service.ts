import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as lancedb from '@lancedb/lancedb';
import * as fs from 'fs';
import * as path from 'path';
import { Schema, Field, Utf8, Float32, FixedSizeList, Int32 } from 'apache-arrow';

@Injectable()
export class DbService implements OnModuleInit {
  private readonly logger = new Logger(DbService.name);
  private db: lancedb.Connection;
  private initPromise: Promise<void> | null = null;

  public knowledgeTable: lancedb.Table;
  public feedbackTable: lancedb.Table;

  async onModuleInit() {
    await this.ensureReady();
  }

  async ensureReady(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initialize().catch(error => {
        this.initPromise = null;
        throw error;
      });
    }

    await this.initPromise;
  }

  private async initialize(): Promise<void> {
    this.db = await lancedb.connect('./lancedb');
    this.knowledgeTable = await this.openOrCreate('knowledge', this.knowledgeSchema());
    this.feedbackTable = await this.openOrCreate('feedback', this.feedbackSchema());
    this.logger.log('LanceDB connected — knowledge and feedback tables ready');
  }

  private async openOrCreate(name: string, schema: Schema): Promise<lancedb.Table> {
    const existing = await this.db.tableNames();
    if (existing.includes(name)) {
      try {
        const table = await this.db.openTable(name);
        await table.countRows();
        return table;
      } catch (error) {
        if (!this.isMissingTableError(error)) {
          throw error;
        }

        const tablePath = path.join(process.cwd(), 'lancedb', `${name}.lance`);
        this.logger.warn(`Found stale LanceDB table metadata for "${name}". Rebuilding ${tablePath}`);
        await this.db.dropTable(name).catch(() => undefined);
        fs.rmSync(tablePath, { recursive: true, force: true });
      }
    }

    return this.db.createEmptyTable(name, schema);
  }

  private isMissingTableError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    return (
      error.message.includes('was not found') ||
      error.message.includes('Dataset at path') ||
      error.message.includes('Not found:')
    );
  }

  private knowledgeSchema(): Schema {
    return new Schema([
      new Field('id', new Utf8(), false),
      new Field('text', new Utf8(), false),
      new Field('vector', new FixedSizeList(384, new Field('item', new Float32(), true)), false),
      new Field('source', new Utf8(), false),
    ]);
  }

  private feedbackSchema(): Schema {
    return new Schema([
      new Field('id', new Utf8(), false),
      new Field('profile', new Utf8(), false),
      new Field('message', new Utf8(), false),
      new Field('positive', new Int32(), false),
      new Field('reason', new Utf8(), false),
      new Field('vector', new FixedSizeList(384, new Field('item', new Float32(), true)), false),
      new Field('timestamp', new Utf8(), false),
    ]);
  }
}
