# Sentinel

An AI-powered eCommerce analytics agent that answers natural-language questions by generating SQL, executing it against a real dataset, and synthesizing insights — all in real-time with a multi-agent architecture.

Built as a self-contained local version of [GameRamp Sentinel](https://gameramp.com), stripped of BigQuery, auth, and multi-tenancy in favor of DuckDB + local parquet files.

![Next.js](https://img.shields.io/badge/Next.js-16-black)
![DuckDB](https://img.shields.io/badge/DuckDB-1.4-yellow)
![Gemini](https://img.shields.io/badge/Google_Gemini-2.0_Flash-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)

---

## How It Works

```
User asks a question
        │
        ▼
┌─────────────────┐
│  /api/classify   │  ─── Gemini classifies: "analytics" or "direct"
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
analytics   direct
    │         │
    ▼         ▼
/api/analyze  /api/chat  ─── Simple streaming chat response
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│  SQL Generator (Gemini)                                  │
│  Quick mode: 1 query │ Deep mode: 17 queries × 6 agents │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│  DuckDB Executor (parallel, read-only, auto-retry)       │
│  36.6M eCommerce events · 2GB parquet dataset            │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│  Deep Mode Only:                                         │
│  • Per-agent summaries (Gemini)                          │
│  • Critique Agent — validates claims, scores 6-8.5/10    │
│  • Research Report — 1500-2500 word markdown document     │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
           Streamed to frontend in real-time
```

### The 6 Specialized Agents (Deep Mode)

| Agent                    | Focus Area                        | Queries |
| ------------------------ | --------------------------------- | ------- |
| **Data Quality**         | NULL rates, volume anomalies      | 2       |
| **Daily Metrics**        | DAU trends, sessions, revenue/AOV | 3       |
| **Cohort Retention**     | Repeat buyers, purchase frequency | 3       |
| **Revenue Optimization** | Funnel analysis, category revenue | 3       |
| **User Segmentation**    | Engagement tiers, spending tiers  | 3       |
| **Geographic**           | Category performance, brand share | 3       |

Plus a 7th **Critique Agent** that validates all findings for accuracy.

---

## Tech Stack

| Layer           | Technology                                 |
| --------------- | ------------------------------------------ |
| Framework       | Next.js 16 (App Router, Turbopack)         |
| Language        | TypeScript 5                               |
| Database        | DuckDB (in-process via `@duckdb/node-api`) |
| AI Model        | Google Gemini 2.0 Flash (`@google/genai`)  |
| UI              | Radix UI + shadcn/ui + Tailwind CSS v4     |
| Package Manager | pnpm                                       |

---

## Prerequisites

- **Node.js** ≥ 18
- **pnpm** (`npm install -g pnpm`)
- **Google Gemini API key** — [Get one here](https://aistudio.google.com/apikey)
- **~2.5GB free disk space** for the parquet dataset

---

## Installation

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd sentinel
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Set up environment variables

Create a `.env.local` file in the project root:

```bash
GEMINI_API_KEY=your_gemini_api_key_here
```

Optional:

```bash
GEMINI_MODEL=gemini-3-flash-preview   # Override the default model
```

### 4. Set up the dataset

> **Important:** The data files (~2GB) are **not included** in the repository.

1. Download the **Nov 2019** file from the [eCommerce behavior dataset on Kaggle](https://www.kaggle.com/datasets/mkechinov/ecommerce-behavior-data-from-multi-category-store)
2. Place the files in one of these directories:
   - **CSV** (direct from Kaggle): `data/csv/*.csv`
   - **Parquet** (if you have them): `data/parquet/*.parquet`
3. Run the setup script:

```bash
npx tsx scripts/setup-data.ts
```

The script auto-detects CSV or parquet files and creates `data/ecommerce.duckdb` with:

- An `events` view over all data files
- 5 pre-materialized summary tables for fast queries
- Verifies the dataset (~36.6M events)

### 5. Start the development server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Usage

### Quick Mode vs Deep Research

Toggle **Deep Research** in the chat input to switch between:

| Mode      | Agents       | Queries        | Output                          |
| --------- | ------------ | -------------- | ------------------------------- |
| **Quick** | 1            | 1 SQL query    | Concise answer (<300 words)     |
| **Deep**  | 6 + Critique | 17 SQL queries | Full analysis + Research Report |

### Example Questions

- "What is the purchase conversion rate?"
- "Show me top 10 brands by revenue"
- "Analyze the shopping funnel"
- "Which categories have the highest cart abandonment?"
- "Compare weekday vs weekend purchases"
- "What are the peak shopping hours?"

### Pre-loaded Conversations

The sidebar includes 6 demo conversations with pre-computed responses that work without API calls — useful for showcasing the UI.

---

## Project Structure

```
sentinel/
├── data/
│   ├── parquet/              # 10 parquet files (~2GB, gitignored)
│   └── ecommerce.duckdb      # Generated DuckDB database (gitignored)
├── scripts/
│   └── setup-data.ts         # One-time DB + summary table setup
├── src/
│   ├── app/
│   │   ├── page.tsx           # Main chat page (client component, orchestration)
│   │   ├── layout.tsx         # Root layout
│   │   ├── globals.css        # Global styles
│   │   └── api/
│   │       ├── classify/      # Query classifier (analytics vs direct)
│   │       ├── analyze/       # Core agent pipeline (SSE stream)
│   │       ├── chat/          # Direct LLM conversation
│   │       └── health/        # DB readiness check
│   ├── components/
│   │   ├── chat/
│   │   │   ├── agent-card.tsx       # Inline sub-agent status grid
│   │   │   ├── chat-input.tsx       # Input bar + Deep Research toggle
│   │   │   ├── chat-thread.tsx      # Message renderer
│   │   │   ├── chat-welcome.tsx     # Welcome screen with prompts
│   │   │   ├── research-report.tsx  # Report side panel
│   │   │   ├── resizable-panel.tsx  # Draggable panel wrapper
│   │   │   └── task-panel.tsx       # Agent detail side panel
│   │   ├── question/                # Alternative question UI components
│   │   ├── sidebar.tsx              # Conversation list
│   │   ├── topbar.tsx               # App header
│   │   └── ui/                      # shadcn/ui primitives
│   └── lib/
│       ├── db.ts              # DuckDB connection singleton
│       ├── schema.ts          # Database schema + system prompt context
│       ├── sql-generator.ts   # Text-to-SQL via Gemini (quick + deep)
│       ├── sql-executor.ts    # Query execution + validation
│       ├── sql-highlight.tsx  # SQL syntax highlighting
│       ├── markdown.tsx       # Markdown renderer
│       ├── types.ts           # Core type definitions
│       └── utils.ts           # Utility functions
├── .reference/                # Production Sentinel UI screenshots
├── .env.local                 # Environment variables (gitignored)
├── package.json
└── tsconfig.json
```

---

## Current State

### What's Working

- ✅ Full chat UI with conversation switching and sidebar
- ✅ Query classification (analytics vs casual)
- ✅ Quick mode — single SQL query + concise response
- ✅ Deep Research mode — 6 parallel agents, 17 queries, per-agent summaries, critique, research report
- ✅ Real-time streaming of all pipeline stages to the frontend
- ✅ DuckDB integration with 36.6M event dataset
- ✅ Auto-retry on failed SQL queries
- ✅ Task panel showing agent status, SQL queries, and results
- ✅ Research Report side panel with full markdown report
- ✅ Pre-loaded demo conversations
- ✅ DB health check with offline banner

### Known Limitations

- ⚠️ No conversation persistence — refreshing loses chat history
- ⚠️ No authentication or multi-user support
- ⚠️ Dataset is static (Nov 1-16, 2019 only)
- ⚠️ All orchestration lives in a single 918-line `page.tsx`
- ⚠️ No tests
- ⚠️ Parquet files not included in repo (must be sourced separately)

---

## API Reference

| Endpoint        | Method | Description                                       |
| --------------- | ------ | ------------------------------------------------- |
| `/api/health`   | GET    | Returns `{ dbReady: boolean }`                    |
| `/api/classify` | POST   | Classifies query as `analytics` or `direct`       |
| `/api/chat`     | POST   | Streams a direct LLM response                     |
| `/api/analyze`  | POST   | Runs the full agent pipeline, streams JSON events |

### `/api/analyze` Request

```json
{
  "query": "What's the conversion funnel?",
  "mode": "deep" // or "quick"
}
```

### `/api/analyze` Event Stream

Response is newline-delimited JSON with event types: `phase`, `sql`, `query_result`, `summary`, `report`, `text`, `done`, `error`.

---

## License

Private — not for redistribution.
