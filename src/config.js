const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

let systemPrompt;
try {
    systemPrompt = fs.readFileSync(path.join(__dirname, 'system_prompt.txt'), 'utf-8');
    console.log("Using .txt system prompt");
} catch (err) {
    console.warn('Failed to read system_prompt.txt, using fallback.');
    systemPrompt = process.env.SYSTEM_PROMPT || 'You are a helpful AI assistant.';
}

module.exports = {
    discordToken: process.env.DISCORD_TOKEN,
    openRouterApiKey: process.env.OPENROUTER_API_KEY,
    openRouterModel: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-r1:free',
    nonThinkingModel: process.env.NON_THINKING_MODEL || 'deepseek/deepseek-chat',
    classifierModel: process.env.CLASSIFIER_MODEL || 'arcee-ai/trinity-mini:free',
    systemPrompt: systemPrompt,
    clientId: process.env.CLIENT_ID,
    kemonoSessionKey: process.env.KEMONO_SESSION_KEY,
    // Voice-related configuration
    openaiApiKey: process.env.OPENAI_API,
    voxtralModel: process.env.VOXTRAL_MODEL || 'mistralai/voxtral-small-24b-2507',
    ttsModel: process.env.TTS_MODEL || 'gpt-4o-mini-tts',
    ttsVoice: process.env.TTS_VOICE || 'onyx',
    wakeWord: 'hey lee',
};
