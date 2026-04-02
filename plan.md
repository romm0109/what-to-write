# What To Write — Plan

A personal web app that reads a girl's dating profile and suggests the best opening messages.

---

## Stack

- **Frontend:** React (Vite)
- **Backend:** NestJS (Node.js / TypeScript)
- **AI:** z.ai GLM via OpenAI-compatible SDK (`openai` npm package)
- **RAG:** Manual implementation (no LlamaIndex — avoids ESM/CJS issues, simpler)
- **Embeddings:** z.ai `embedding-3` model via OpenAI SDK (API call)
- **Storage:** Local files only (no database)

---

## Project Structure

```
what-to-write/
├── frontend/                   # React app (Vite)
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ProfileInput.tsx
│   │   │   └── MessageCard.tsx  # shows suggestion + thumbs up/down
│   │   └── api.ts              # calls to NestJS backend
│   └── vite.config.ts
│
├── backend/                    # NestJS app
│   ├── src/
│   │   ├── app.module.ts
│   │   ├── generate/
│   │   │   ├── generate.module.ts
│   │   │   ├── generate.controller.ts  # POST /generate
│   │   │   └── generate.service.ts     # builds prompt, calls GLM
│   │   ├── rag/
│   │   │   ├── rag.module.ts
│   │   │   └── rag.service.ts          # LlamaIndex setup + retrieval
│   │   └── feedback/
│   │       ├── feedback.module.ts
│   │       ├── feedback.controller.ts  # POST /feedback
│   │       └── feedback.service.ts     # read/write feedback.json
│   └── .env                            # API key (never commit)
│
├── pdfs/                       # Drop your PDFs here
├── index/                      # Vector index (auto-generated, gitignore this)
└── data/
    └── feedback.json           # Saved feedback (auto-created)
```

---

## How RAG Works Here

1. **First run:** LlamaIndex.TS reads all PDFs in `pdfs/`, chunks them, creates embeddings using a local model, stores the vector index in `index/`
2. **Every run after:** Index is loaded from disk instantly (no re-processing)
3. **On each request:** Her profile text is the query → top 5 most relevant chunks are retrieved
4. **Those chunks** are injected into the GLM prompt

> To add a new PDF: drop it in `pdfs/` and delete the `index/` folder — it rebuilds on next start.

---

## The Prompt Strategy

```
System:
  You are an expert dating coach helping craft opening messages.

  Relevant advice from your knowledge base:
  [top 5 chunks retrieved from PDFs via RAG]

  Past messages that worked well for this user:
  [top 3 positive feedback examples from feedback.json]

User:
  Here is her profile:
  [pasted profile text]

  Give me 2-3 distinct opening message options.
  Detect the language from her profile and reply in that language.
  Be specific to her profile — no generic lines.
```

---

## API Endpoints (NestJS)

| Method | Path | Description |
|---|---|---|
| `POST` | `/generate` | Takes profile text, returns 2-3 message suggestions |
| `POST` | `/feedback` | Saves thumbs up/down for a suggestion |

---

## Phases

### Phase 1 — RAG + Core
- [ ] NestJS project setup
- [ ] RAG service: load PDFs, build local vector index
- [ ] Generate service: retrieve chunks + call GLM
- [ ] React frontend: profile input + show suggestions
- [ ] Hebrew/English auto-detection

### Phase 2 — Feedback
- [ ] Thumbs up/down on each suggestion in React
- [ ] Feedback endpoint + save to `feedback.json`
- [ ] Include past successes in the prompt

### Phase 3 — Polish (optional)
- [ ] Better UI styling
- [ ] Copy-to-clipboard on each message
- [ ] Index rebuild button in the UI

---

## Setup Steps (once built)

```bash
# Backend
cd backend
npm install
cp .env.example .env   # add your z.ai API key + model name
npm run start:dev

# Frontend
cd frontend
npm install
npm run dev
```

Drop your PDFs into `pdfs/` before starting — index builds on first run.

---

## What We're NOT Building

- No user accounts
- No database
- No image/screenshot input (no vision model available)
- No deployment (localhost only for now)
- No fine-tuning
