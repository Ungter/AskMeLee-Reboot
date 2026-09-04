# LeeBot Renewed

Lee is back! Featuring AI-powered chat with web searching, in-VC chat, and other features.

## Features

### AI Commands

| Command | Description |
|---------|-------------|
| `/chat` | Chat with the AI (cloud model via crof.ai). |
| `/chatwiththegroup` | Chat with your local vLLM model. |
| `Ask AI` (Context Menu) | Right-click any message to ask the AI about it. Opens a modal for your question. |

**AI Features:**
- Session-based conversation history (per user per channel, 10-minute inactivity auto-reset)
- Max effort reasoning toggle for hard questions
- Vision support — attach an image to `/chat` or a bot mention and it's sent to a vision-capable model
- Separate history for the cloud AI vs. the local vLLM model
- Automatic text file attachment extraction (`.txt`, `.md`, `.js`, `.py`, `.json`)
- Message ID resolution - paste a Discord message ID to include its content

### Voice Commands

| Command | Description |
|---------|-------------|
| `/join-vc` | Join your current voice channel to listen for "Hey Lee" commands |
| `/leave-vc` | Leave the current voice channel |

**Voice Features:**
- **Wake Word Activation**: Say "Hey Lee" followed by your question
- **Speech-to-Text**: Powered by Gemini 2.5 flash
- **Text-to-Speech**: Minimax TTS with customizable voice
- **Live Listening**: Continuous audio processing while in voice channel

### Other Commands

| Command | Description |
|---------|-------------|
| `/jxrconvert` | Convert a `.jxr` image file to PNG format. Attach a JXR file and get back a PNG. |

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))
- A crof.ai API key (for the cloud AI model)
- Minimax API key ([Minimax](http://minimax.io/))
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
   DISCORD_TOKEN=
   CLIENT_ID=
   CROF_KEY=
   THINKING_MODEL=
   NON_THINKING_MODEL=
   NON_THINKING_MODEL_VISION=
   SST_MODEL=google/gemini-2.5-flash-lite-preview-09-2025
   TTS_MODEL=speech-2.8-hd

   # Local vLLM (optional, for /chatwiththegroup)
   VLLM_BASE_URL=http://127.0.0.1:8000/v1
   VLLM_MODEL=
   VLLM_SERVED_MODEL_NAME=
   VLLM_API_KEY=
   VLLM_GGUF_FILE=tunedModel-q6_k.gguf
   ```

4. **Deploy slash commands**
   ```bash
   npm run deploy
   ```

5. **Start the bot**
   ```bash
   npm run start:auto
   ```

   To also serve your local vLLM model:
   ```bash
   npm run serve:local   # start vLLM serving locally
   npm run start:local   # start the bot with vLLM enabled
   ```

## Project Structure

```
LeeBotRenewed/
├── src/
│   ├── index.js              # Entry point
│   ├── bot.js                # Discord client and event handlers
│   ├── ai.js                 # Cloud AI integration (crof.ai)
│   ├── localAi.js            # Local vLLM integration + serving
│   ├── config.js             # Environment configuration
│   ├── sessions.js           # User session management (cloud + local)
│   ├── system_prompt.txt     # AI system prompt
│   ├── langExts.json         # File extension mappings
│   ├── deploy-commands.js    # Slash command deployment
│   ├── start.js              # Auto-restart wrapper
│   │
│   ├── commands/
│   │   ├── general/          # General commands
│   │   │   ├── chat.js       # /chat command
│   │   │   ├── chatWithTheGroup.js # /chatwiththegroup (local model)
│   │   │   ├── analyze.js    # Ask AI context menu
│   │   │   └── jxrConvert.js # /jxrconvert command
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
│       └── responseHandler.js # Discord response handling
│
├── tunedModel/               # Local model weights / GGUF files
├── vllm_patches/             # vLLM patch scripts
├── .env                      # Environment variables
├── .gitignore
└── package.json

```
