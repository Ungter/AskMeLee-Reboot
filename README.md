# LeeBot Renewed

A Discord bot featuring AI-powered chat with voice support and Kemono API integration.

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
- DM & server support with user-installable commands

### �️ Voice Commands

| Command | Description |
|---------|-------------|
| `/join-vc` | Join your current voice channel to listen for "Hey Lee" commands |
| `/leave-vc` | Leave the current voice channel |

**Voice Features:**
- **Wake Word Activation**: Say "Hey Lee" followed by your question
- **Speech-to-Text**: Powered by Mistral Voxtral via OpenRouter
- **Text-to-Speech**: OpenAI TTS with customizable voice
- **Live Listening**: Continuous audio processing while in voice channel

### �🎨 Kemono Commands

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
- (Optional) OpenAI API key for TTS
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
   # Required
   DISCORD_TOKEN=your_discord_bot_token
   CLIENT_ID=your_discord_client_id
   OPENROUTER_API_KEY=your_openrouter_api_key
   
   # Optional: AI Models
   OPENROUTER_MODEL=deepseek/deepseek-r1:free
   NON_THINKING_MODEL=deepseek/deepseek-chat
   CLASSIFIER_MODEL=arcee-ai/trinity-mini:free
   
   # Optional: Voice Features
   OPENAI_API=your_openai_api_key
   VOXTRAL_MODEL=mistralai/voxtral-small-24b-2507
   TTS_MODEL=gpt-4o-mini-tts
   TTS_VOICE=onyx
   
   # Optional: Kemono
   KEMONO_SESSION_KEY=your_kemono_session_key
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
│   │
│   ├── commands/
│   │   ├── general/          # AI chat commands
│   │   │   ├── chat.js       # /chat command
│   │   │   └── analyze.js    # Ask AI context menu
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
├── refs/                     # Reference documentation
├── .env                      # Environment variables (not tracked)
├── .gitignore
└── package.json
```
## Technical Architecture

graph TD
    User[User Voice] -->|UDP/Opus| DiscordGW[Discord Gateway]
    DiscordGW -->|PCM Stream| ffmpeg[FFmpeg/Prism]
    ffmpeg -->|Audio Buffer| WakeWord[Wake Word Detector]
    WakeWord -->|Trigger| STT[Mistral Voxtral]
    STT -->|Text| LLM[DeepSeek R1]
    LLM -->|Response| TTS[OpenAI TTS]
    TTS -->|Audio Stream| DiscordGW
    
## Scripts

| Script | Command | Description |
|--------|---------|-------------|
| Start | `npm start` | Run the bot |
| Deploy | `npm run deploy` | Deploy/update slash commands to Discord |

## Dependencies

| Package | Purpose |
|---------|---------|
| `discord.js` | Discord API client |
| `@discordjs/voice` | Voice channel support |
| `@discordjs/opus` | Audio encoding |
| `openai` | OpenAI TTS integration |
| `prism-media` | Audio stream processing |
| `ffmpeg-static` | Audio format conversion |
| `sodium-native` | Voice encryption |
| `dotenv` | Environment variable loading |
