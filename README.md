# LeeBot Renewed

Lee is back! Featuring AI-powered chat with web searching, in-VC chat, and other features.

## Features

### AI Commands

| Command | Description |
|---------|-------------|
| `/chat` | Chat with the AI. Supports message ID resolution and optional reasoning mode. |
| `Ask AI` (Context Menu) | Right-click any message to ask the AI about it. Opens a modal for your question. |

**AI Features:**
- Session-based conversation history
- Reasoning mode toggle for step-by-step explanations
- Automatic text file attachment extraction (`.txt`, `.md`, `.js`, `.py`, `.json`)
- Message ID resolution - paste a Discord message ID to include its content
- DM & server support with user-installable commands

### Voice Commands

| Command | Description |
|---------|-------------|
| `/join-vc` | Join your current voice channel to listen for "Hey Lee" commands |
| `/leave-vc` | Leave the current voice channel |

**Voice Features:**
- **Wake Word Activation**: Say "Hey Lee" followed by your question
- **Speech-to-Text**: Powered by Mistral Voxtral via OpenRouter
- **Text-to-Speech**: OpenAI TTS with customizable voice
- **Live Listening**: Continuous audio processing while in voice channel

### Kemono Commands

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

### Other Commands

| Command | Description |
|---------|-------------|
| `/jxrconvert` | Convert a `.jxr` image file to PNG format. Attach a JXR file and get back a PNG. |

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))
- An OpenRouter API key ([OpenRouter](https://openrouter.ai/))
- OpenAI API key for TTS
- Visual C++ Redistributable (Optional if you plan on using the JXR converter)

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
   # Required
   DISCORD_TOKEN=
   CLIENT_ID=
   OPENROUTER_API_KEY=
   OPENROUTER_MODEL=deepseek/deepseek-v3.2-speciale
   NON_THINKING_MODEL=deepseek/deepseek-v3.2
   OPENAI_API=
   TTS_API=
   KEMONO_SESSION_KEY= (Optional)
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
│   ├── index.js              # Entry point
│   ├── bot.js                # Discord client and event handlers
│   ├── ai.js                 # OpenRouter AI integration
│   ├── config.js             # Environment configuration
│   ├── sessions.js           # User session management
│   ├── system_prompt.txt     # AI system prompt
│   ├── langExts.json         # File extension mappings
│   ├── deploy-commands.js    # Slash command deployment
│   ├── start.js              # Auto-restart wrapper
│   │
│   ├── commands/
│   │   ├── general/          # General commands
│   │   │   ├── chat.js       # /chat command
│   │   │   ├── analyze.js    # Ask AI context menu
│   │   │   └── jxrConvert.js # /jxrconvert command
│   │   ├── kemono/           # Kemono API commands
│   │   │   ├── kemonoTop.js
│   │   │   ├── kemonoRandom.js
│   │   │   └── kemonoSearch.js
│   │   └── voice/            # Voice channel commands
│   │       ├── joinVc.js     # /join-vc command
│   │       └── leaveVc.js    # /leave-vc command
│   │
│   ├── voice/                # Voice processing modules
│   │   ├── voiceManager.js   # Voice connection management
│   │   ├── voiceHandler.js   # Voice event handling
│   │   ├── audioProcessor.js # Audio stream processing
│   │   ├── speechToText.js   # STT via Voxtral
│   │   ├── textToSpeech.js   # TTS via OpenAI
│   │   ├── voiceAI.js        # Voice-specific AI integration
│   │   └── wakeWordDetector.js # "Hey Lee" detection
│   │
│   └── utils/
│       ├── kemonoApi.js      # Kemono API utilities
│       └── responseHandler.js # Discord response handling
│
├── .env                      # Environment variables
├── .gitignore
└── package.json
```

## Scripts

| Script | Command | Description |
|--------|---------|-------------|
| Start | `npm run start:auto` | Run the bot with auto-restart |
| Deploy | `npm run deploy` | Deploy/update slash commands to Discord |
