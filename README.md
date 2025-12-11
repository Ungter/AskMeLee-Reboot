# LeeBot Renewed

A Discord bot featuring AI-powered chat and Kemono API integration.

## Features

### 🤖 AI Commands

| Command | Description |
|---------|-------------|
| `/chat` | Chat with the AI. Supports message ID resolution and optional reasoning mode. |
| `Ask AI` (Context Menu) | Right-click any message to ask the AI about it. Opens a modal for your question. |

**AI Features:**
- Session-based conversation history
- Reasoning mode toggle for step-by-step explanations
- Automatic text file attachment extraction (`.txt`, `.md`, `.js`, `.py`, `.json`)
- Message ID resolution - paste a Discord message ID to include its content

### 🎨 Kemono Commands

| Command | Description |
|---------|-------------|
| `/kemono-top` | Browse top Kemono creators sorted by favorites with pagination. |
| `/kemono-random` | Get a random post from Kemono with attached files (up to 8MB). |
| `/kemono-search` | Search for artists and browse their posts. |

**Kemono Features:**
- Paginated navigation with button controls
- Automatic file attachments (images, documents)
- Large file fallback with direct Kemono links
- Rich embeds with post metadata

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))
- An OpenRouter API key ([OpenRouter](https://openrouter.ai/))
- (Optional) Kemono session key for authenticated requests

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd LeeBotRenewed
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   
   Create a `.env` file in the root directory:
   ```env
   DISCORD_TOKEN=your_discord_bot_token
   CLIENT_ID=your_discord_client_id
   OPENROUTER_API_KEY=your_openrouter_api_key
   
   # Optional: Customize AI models
   OPENROUTER_MODEL=deepseek/deepseek-v3.2-speciale
   NON_THINKING_MODEL=deepseek/deepseek-v3.2
   CLASSIFIER_MODEL=arcee-ai/trinity-mini:free
   
   ```

4. **Deploy slash commands**
   ```bash
   npm run deploy
   ```

5. **Start the bot**
   ```bash
   npm start
   ```

## Project Structure

```
LeeBotRenewed/
├── src/
│   ├── index.js           # Entry point
│   ├── bot.js             # Discord client and event handlers
│   ├── ai.js              # OpenRouter AI integration
│   ├── config.js          # Environment configuration
│   ├── sessions.js        # User session management
│   ├── system_prompt.txt  # AI system prompt
│   ├── deploy-commands.js # Slash command deployment
│   ├── commands/
│   │   ├── general/       # AI chat commands
│   │   └── kemono/        # Kemono API commands
│   └── utils/
│       ├── kemonoApi.js   # Kemono API utilities
│       └── responseHandler.js
├── refs/                  # Reference documentation
├── .env                   # Environment variables (not tracked)
└── package.json
```

## Scripts

| Script | Command | Description |
|--------|---------|-------------|
| Start | `npm start` | Run the bot |
| Deploy | `npm run deploy` | Deploy/update slash commands to Discord |