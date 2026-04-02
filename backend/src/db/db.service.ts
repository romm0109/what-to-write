import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as lancedb from '@lancedb/lancedb';
import { Schema, Field, Utf8, Float32, FixedSizeList, Int32 } from 'apache-arrow';

@Injectable()
export class DbService implements OnModuleInit {
  private readonly logger = new Logger(DbService.name);
  private db: lancedb.Connection;

  public knowledgeTable: lancedb.Table;
  public feedbackTable: lancedb.Table;

  async onModuleInit() {
    this.db = await lancedb.connect('./lancedb');
    this.knowledgeTable = await this.openOrCreate('knowledge', this.knowledgeSchema());
    this.feedbackTable = await this.openOrCreate('feedback', this.feedbackSchema());
    this.logger.log('LanceDB connected — knowledge and feedback tables ready');
  }

  private async openOrCreate(name: string, schema: Schema): Promise<lancedb.Table> {
    const existing = await this.db.tableNames();
    if (existing.includes(name)) {
      return this.db.openTable(name);
    }
    return this.db.createEmptyTable(name, schema);
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
