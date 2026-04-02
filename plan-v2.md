# What To Write — v2 Plan

Refactor plan: LanceDB vector storage, semantic feedback retrieval, Gemini API, improved RAG querying, and better prompt quality.

---

## Stack Changes

| Layer | Before | After |
|-------|--------|-------|
| AI model | `gemini` CLI subprocess | Gemini API (`@google/generative-ai`, `gemini-2.0-flash`) |
| Vector storage | `index/vectors.json` (flat file) | LanceDB (`@lancedb/lancedb`, embedded, no server) |
| Feedback storage | `data/feedback.json` (flat file) | LanceDB `feedback` table with embeddings |
| RAG query | Raw profile text | Personality summary extracted by LLM first |
| Feedback retrieval | Last N entries (global) | Top-K semantically similar to current profile |

---

## LanceDB Schema

### `knowledge` table

Stores chunked + embedded PDF content.

```ts
{
  id: string;        // `${filename}-${chunkIndex}`
  text: string;      // raw chunk text (~200 words)
  vector: number[];  // 384-dim embedding (all-MiniLM-L6-v2)
  source: string;    // original PDF filename
}
```

Rebuilt by deleting the `lancedb/knowledge` table and restarting. On startup, if the table is empty and PDFs exist, the index builds automatically.

### `feedback` table

Stores feedback entries, each embedded by profile text.

```ts
{
  id: string;        // uuid
  profile: string;   // full profile text submitted
  message: string;   // generated message that received feedback
  positive: number;  // 1 = thumbs up, 0 = thumbs down
  reason: string;    // why it failed (empty string if positive or no reason given)
  vector: number[];  // 384-dim embedding of the profile text
  timestamp: string; // ISO string
}
```

---

## New Generate Flow

Each `POST /generate` request runs these steps in order:

```
1. summarizeProfile(profile)
      ↓ fast Gemini call (~300ms)
      → personality summary: "witty, intellectual, dry humor, outdoorsy"

2. embed(summary) → summaryVector
   embed(profile) → profileVector
      ↓ local model, instant

3. ragService.retrieve(summaryVector)
      ↓ LanceDB cosine search on knowledge table
      → top-5 relevant research chunks

4. feedbackService.getPositiveExamples(profileVector)
   feedbackService.getNegativeExamples(profileVector)
      ↓ LanceDB cosine search on feedback table
      → top-3 similar wins, top-3 similar failures

5. buildPrompt(profile, name, chunks, wins, failures)
      ↓
6. callGemini(systemInstruction, userPrompt)
      → { suggestions: string[] }
```

Steps 3 and 4 run in parallel (`Promise.all`).

---

## Why Personality Summary for RAG Query

The research PDFs contain advice about messaging strategy and tone — not about hobbies or profile keywords. Querying with raw profile text (e.g. "loves hiking, 28, looking for something real") matches on surface content, not on strategy relevance.

Extracting a personality vibe first (`"adventurous, grounded, dry humor"`) and using that as the query retrieves chunks about *how to approach that type of person* — which is what the RAG is for.

**Summary extraction prompt:**
```
In 6–8 words, describe this person's vibe and personality based on their dating profile.
Focus on traits relevant to tone and conversation style.
Examples: "witty, intellectual, dry humor, bookish" / "adventurous, spiritual, warm, direct"
Profile: [profile text]
```

---

## Why Semantic Feedback Retrieval

Current approach: pass the last 3 positive entries globally. Problems:
- Stale or irrelevant — a message that worked for a bubbly party girl is noise when writing to a quiet intellectual
- Grows into a dump as feedback accumulates
- No learning from *similar* situations

New approach: embed the incoming profile, find the closest past profiles by cosine similarity, surface only those examples. The model sees messages that worked (or failed) for profiles *like this one*.

---

## Prompt Architecture

### System instruction (static)

```
You are helping a guy write his first message to a girl on a dating app.

Write messages that feel like they came from a real, confident person —
not a coach, not a marketer, not someone trying too hard.

Rules:
- Never compliment her looks
- No puns or forced wordplay
- No exclamation marks
- No questions like "what do you do?" or "how was your weekend?"
- Don't open with "Hey" or "Hi [name]"
- 1–3 sentences max per message
- Match her energy — if she's dry and witty, be dry and witty; if she's warm, be warm
- One message per option, no follow-up lines
```

### User message (dynamic)

```
Principles to follow for this type of person (from research):
— [chunk 1]
— [chunk 2]
— [chunk 3]
— [chunk 4]
— [chunk 5]

Messages that worked for similar profiles:
Profile like: "[first 120 chars]..." → Worked: "[message]"
Profile like: "[first 120 chars]..." → Worked: "[message]"

Messages that failed for similar profiles and why:
"[message]" — Why it failed: "[reason]"
"[message]" — Why it failed: "[reason]"

Her profile:
[full profile text]
Her name: [name]  ← only if provided

Write exactly 3 opening message options, each with a different angle
(e.g. one observational, one playful, one direct).
Detect the language from her profile and write all messages in that language.

Format:
Option 1: [message]
Option 2: [message]
Option 3: [message]
```

---

## File Structure Changes

```
what-to-write/
├── backend/
│   ├── src/
│   │   ├── app.module.ts         (add DbModule import)
│   │   ├── db/
│   │   │   ├── db.module.ts      NEW — global module
│   │   │   └── db.service.ts     NEW — opens LanceDB, creates tables, exports them
│   │   ├── rag/
│   │   │   └── rag.service.ts    CHANGED — LanceDB instead of vectors.json
│   │   ├── feedback/
│   │   │   └── feedback.service.ts  CHANGED — LanceDB, semantic retrieval, accepts vector
│   │   └── generate/
│   │       └── generate.service.ts  CHANGED — Gemini API, new flow, new prompt
│   └── .env                      ADD: GEMINI_API_KEY, GEMINI_MODEL
│
├── lancedb/                      NEW — auto-generated, gitignore
├── pdfs/                         unchanged
│
# DELETED:
# index/vectors.json
# data/feedback.json
```

---

## New Dependencies

```bash
npm install @lancedb/lancedb @google/generative-ai apache-arrow uuid
npm install --save-dev @types/uuid
```

- `@lancedb/lancedb` — embedded vector DB
- `@google/generative-ai` — Gemini API SDK
- `apache-arrow` — required peer dependency of LanceDB
- `uuid` — for generating feedback entry IDs

---

## Implementation Phases

### Phase A — DbModule

**`db/db.service.ts`**
- Opens LanceDB connection to `./lancedb` on module init
- Creates `knowledge` table if it doesn't exist (with schema)
- Creates `feedback` table if it doesn't exist (with schema)
- Exposes `knowledgeTable` and `feedbackTable` as public properties

**`db/db.module.ts`**
- `@Global()` module
- Provides and exports `DbService`

**`app.module.ts`**
- Add `DbModule` to imports

---

### Phase B — Migrate RagService

**Changes to `rag/rag.service.ts`:**
- Remove: `indexDir`, `indexFile`, `ensureDirs()`, `fs.writeFileSync`, in-memory `this.chunks`, in-memory `cosineSimilarity()`
- Inject `DbService`
- `onModuleInit`: check `knowledge` table row count via `table.countRows()`; if 0 and PDFs exist in `pdfs/`, call `buildIndex()`
- `buildIndex()`: insert chunks into LanceDB via `table.add(rows)`
- `retrieve(vector: number[])`: query LanceDB with pre-computed vector
  ```ts
  const results = await this.db.knowledgeTable
    .search(vector)
    .limit(5)
    .execute();
  return results.map(r => r.text).join('\n\n---\n\n');
  ```
- Signature change: `retrieve(vector: number[]): Promise<string>` — accepts pre-computed vector, no re-embedding inside

---

### Phase C — Migrate FeedbackService

**Changes to `feedback/feedback.service.ts`:**
- Remove: `dataDir`, `feedbackFile`, all `fs.*` calls
- Inject `DbService`
- `save(profile, message, positive, reason)`:
  - Embed profile text
  - Insert to `feedback` table with `v4()` uuid
- `getPositiveExamples(profileVector: number[], limit = 3): Promise<string>`:
  - Query `feedback` table by vector similarity
  - Filter: `positive = 1`
  - Format: `Profile like: "..." → Worked: "..."`
- `getNegativeExamples(profileVector: number[], limit = 3): Promise<string>`:
  - Query `feedback` table by vector similarity
  - Filter: `positive = 0` AND `reason != ""`
  - Format: `"..." — Why it failed: "..."`

> LanceDB does not support pre-filter on metadata before vector search natively in all versions — use post-filter: fetch top-20, filter by positive/reason in JS, take top-3.

---

### Phase D — Gemini API in GenerateService

**Changes to `generate/generate.service.ts`:**
- Remove: `execFile`, `promisify`, `fs`, `os`, `path`, tmp file logic
- Add: `GoogleGenerativeAI` from `@google/generative-ai`
- Initialize on construction:
  ```ts
  private readonly genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  private readonly model = this.genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL ?? 'gemini-2.0-flash',
    systemInstruction: SYSTEM_INSTRUCTION,  // static string constant
  });
  ```
- `summarizeProfile(profile: string): Promise<string>`:
  - Uses a separate model instance without system instruction
  - Returns the 6–8 word vibe summary
- `callGemini(userPrompt: string): Promise<string>`:
  - `const result = await this.model.generateContent(userPrompt)`
  - Returns `result.response.text()`

---

### Phase E — Wire the new generate flow

**`generate.service.ts` — `generate()` method:**

```ts
async generate(profile: string, name?: string) {
  // 1. Extract personality summary for RAG query
  const summary = await this.summarizeProfile(profile);

  // 2. Embed both (local, instant)
  const [summaryVector, profileVector] = await Promise.all([
    this.ragService.embed(summary),
    this.ragService.embed(profile),
  ]);

  // 3. Parallel retrieval
  const [relevantChunks, pastWins, pastMistakes] = await Promise.all([
    this.ragService.retrieve(summaryVector),
    this.feedbackService.getPositiveExamples(profileVector),
    this.feedbackService.getNegativeExamples(profileVector),
  ]);

  // 4. Build prompt and call Gemini
  const userPrompt = this.buildPrompt(profile, name, relevantChunks, pastWins, pastMistakes);
  const raw = await this.callGemini(userPrompt);
  return { suggestions: this.parseSuggestions(raw) };
}
```

**`rag.service.ts`** — expose `embed()` as public method so `GenerateService` can call it directly.

---

### Phase F — Prompt rewrite

- Replace `buildPrompt()` with the new system + user split defined above
- `SYSTEM_INSTRUCTION` as a module-level constant (not rebuilt on every call)
- RAG chunks formatted as `— [text]` bullet list
- Feedback examples formatted with profile context
- Remove old "expert dating coach" framing

---

## .env

```env
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.0-flash
```

---

## Setup After Refactor

```bash
cd backend
npm install
# fill in .env
npm run start:dev
```

On first start: LanceDB tables are created, PDFs are indexed. Delete `lancedb/` to force a full rebuild.

---

## What's NOT Changing

- Frontend (React) — zero changes needed
- HTTP API contract — same endpoints, same request/response shape
- PDF parsing logic (`pdf-parse`, chunking algorithm)
- Local embedding model (`@xenova/transformers`, `all-MiniLM-L6-v2`)
- NestJS module structure (same modules, same DI wiring)
