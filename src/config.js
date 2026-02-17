const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

let systemPrompt;
try {
    systemPrompt = fs.readFileSync(path.join(__dirname, 'system_prompt.txt'), 'utf-8');
    console.log("Using .txt system prompt");
} catch (err) {
    console.warn('Failed to read system_prompt.txt, using fallback.');
    systemPrompt = process.env.SYSTEM_PROMPT;
}

module.exports = {
    discordToken: process.env.DISCORD_TOKEN,
    openRouterApiKey: process.env.OPENROUTER_API_KEY,
    thinkingModel: process.env.THINKING_MODEL,
    nonThinkingModel: process.env.NON_THINKING_MODEL,
    classifierModel: process.env.CLASSIFIER_MODEL,
    systemPrompt: systemPrompt,
    clientId: process.env.CLIENT_ID,

    openaiApiKey: process.env.OPENAI_API,
    sstModel: process.env.SST_MODEL,
    ttsModel: process.env.TTS_MODEL,
    minimaxApiKey: process.env.MINIMAX_API_KEY,
    voiceId: process.env.VOICE_ID,
    wakeWord: 'hey lee',
    imageGenModel: process.env.IMAGE_GEN_MODEL,
};
