# Sorc — Customer Service SaaS for WhatsApp

Multi-tenant WhatsApp customer service platform with RAG knowledge base, AI-powered replies, human handoff, and real-time dashboard.

## Architecture

```
WhatsApp ←→ whatsapp-web.js ←→ BotEngine ←→ 9router (AI endpoint)
                              ↕
                     SQLite (messages, KB, config, analytics)
                              ↕
              Express + Socket.IO ←→ Web Dashboard
```

## Features

### Core
- **AI-powered replies** — Uses 9router (OpenAI-compatible chat completions) to answer customer questions
- **RAG Knowledge Base** — Multi-entry SQLite store, injects context into AI system prompt
- **Strict hallucination guard** — AI must answer ONLY from context or trigger handoff
- **Per-number rate limiting** — Prevents spam (default: 20 msg/min per phone)

### Human Handoff
- Auto-handoff when AI can't answer from its knowledge base
- Manual per-conversation "Request Human" / "Resume Bot"
- Conversation timeout — auto-resets stale handoffs (default 24h)
- Dashboard notifications for pending handoffs

### Dashboard
- Real-time analytics (messages, AI replies, handoffs, 24h chart)
- Conversations view with full message history + reply from dashboard
- Knowledge Base CRUD with context preview
- WhatsApp status and 9router health monitoring
- Live logs with filter/search
- Dark/light theme
- Mobile responsive (sidebar → bottom tab bar)
- Optional password authentication

### Infrastructure
- SQLite (WAL mode) — zero-config database
- Session persistence — WhatsApp auth survives restarts
- Auto-prune — removes records older than 30 days
- Graceful shutdown — preserves browser session

## Quick Start

### Prerequisites
- Node.js 18+
- Chromium/Chrome (for whatsapp-web.js)
- A running 9router instance (or compatible OpenAI-compatible API)

### Setup

```bash
# Install dependencies
npm install

# Optional: set dashboard password (leave unset for open access)
export DASHBOARD_PASSWORD=your-secret-password

# Start the server
npm start
```

Open **http://localhost:3000** in your browser.

### First Connection
1. Open the dashboard
2. Scan the QR code with WhatsApp (Linked Devices → Link a Device)
3. Add knowledge entries from the Knowledge Base view
4. Messages from customers are automatically processed

## Configuration

All config is managed through the dashboard UI and persisted to SQLite.

| Setting | Default | Description |
|---|---|---|
| `botName` | Sorc | Display name |
| `active` | true | Global bot on/off |
| `keepSession` | true | Preserve WhatsApp auth across restarts |
| `rateLimit.maxPerMinute` | 20 | Max AI calls per phone per minute |
| `conversationTimeout.enabled` | true | Auto-reset stale handoffs |
| `conversationTimeout.hours` | 24 | Hours of inactivity before auto-reset |
| `aiSettings.endpoint` | http://localhost:20128/v1 | AI endpoint URL |
| `aiSettings.model` | auto | Model name for 9router routing |
| `aiSettings.systemPrompt` | — | Global system prompt override |
| `aiSettings.maxTokens` | 500 | Max tokens per reply |
| `aiSettings.temperature` | 0.7 | Response creativity |

Environment variables:
- `PORT` — HTTP server port (default: 3000)
- `DASHBOARD_PASSWORD` — Optional password for dashboard access

## API Endpoints

### Knowledge Base
| Method | Path | Description |
|---|---|---|
| GET | `/api/knowledge` | List all entries |
| POST | `/api/knowledge` | Create entry |
| PUT | `/api/knowledge/:id` | Update entry |
| DELETE | `/api/knowledge/:id` | Delete entry |
| DELETE | `/api/knowledge` | Clear all |
| GET | `/api/knowledge/stats` | Entry count |
| GET | `/api/knowledge/preview` | Built context preview |

### Conversations
| Method | Path | Description |
|---|---|---|
| GET | `/api/conversations` | List active conversations |
| GET | `/api/conversations/:phone/messages` | Message history |
| POST | `/api/send-message` | Send reply from dashboard |

### Handoffs
| Method | Path | Description |
|---|---|---|
| GET | `/api/handoffs` | List all conversation states |
| POST | `/api/handoffs/:phone/reset` | Resume bot for phone |
| POST | `/api/handoffs/:phone/disable` | Request human for phone |

### Auth & System
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/login` | Dashboard login |
| GET | `/api/router-health` | AI endpoint health check |
| POST | `/api/whatsapp/logout` | Force logout WhatsApp |
| GET | `/health` | Server health check |

## Project Structure

```
waha-bot/
├── server/
│   ├── index.js              Express + Socket.IO server, all API routes
│   ├── config.js             SQLite-backed config with in-memory fallback
│   ├── logger.js             Structured logger (logs table + live stream)
│   ├── analytics.js          Usage stats from the messages table
│   ├── whatsapp.js           WhatsApp client with auto-reconnect
│   ├── bot-engine.js         AI reply handler with RAG & rate limiting
│   ├── knowledge-base.js     Multi-entry knowledge store + buildContext()
│   ├── conversation-state.js Per-number bot mode / human handoff tracking
│   └── auth.js               Dashboard password auth middleware
├── public/
│   ├── index.html            Single-page dashboard (glassmorphism CSS)
│   └── js/                   Client-side controllers
├── data/                     SQLite DB + session storage (gitignored)
└── package.json
```

## Scripts

| Command | Description |
|---|---|
| `npm start` | Production start |
| `npm run dev` | Development with `nodemon` auto-restart |

## Tech Stack

- **Runtime**: Node.js 22
- **Framework**: Express 4 + Socket.IO 4
- **Database**: better-sqlite3 (WAL mode)
- **WhatsApp**: whatsapp-web.js 1.34
- **UI**: Vanilla JS, glassmorphism CSS, Chart.js
- **AI**: 9router (OpenAI-compatible chat completions)

## License

MIT
