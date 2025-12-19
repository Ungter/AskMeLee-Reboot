const OpenAI = require('openai');
const config = require('../config');

// OpenRouter client for AI responses
const openrouter = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: config.openRouterApiKey,
});

// Store voice conversation sessions
const voiceSessions = new Map();

/**
 * Get or create a voice session for a user
 * @param {string} userId 
 * @param {string} guildId 
 * @returns {Object}
 */
function getVoiceSession(userId, guildId) {
    const key = `${userId}-${guildId}`;
    if (!voiceSessions.has(key)) {
        voiceSessions.set(key, {
            history: [],
        });
    }
    return voiceSessions.get(key);
}

/**
 * Get AI response for voice input (uses non-reasoning model)
 * @param {string} userId 
 * @param {string} guildId 
 * @param {string} prompt 
 * @returns {Promise<string>}
 */
async function getVoiceResponse(userId, guildId, prompt) {
    const session = getVoiceSession(userId, guildId);

    // Add user message to history
    session.history.push({ role: 'user', content: prompt });

    // Keep history manageable
    const MAX_HISTORY = 10;
    if (session.history.length > MAX_HISTORY) {
        session.history = session.history.slice(-MAX_HISTORY);
    }

    // Prepare system prompt for voice context
    const currentDateTime = new Date().toLocaleString();
    const voiceSystemPrompt = `${config.systemPrompt}

Current Date and Time: ${currentDateTime}

IMPORTANT: You are responding via voice in a Discord voice channel. Keep your responses:
- Concise (1-3 sentences when possible)
- Natural and conversational
- Avoid markdown, code blocks, or formatting
- Avoid lists unless specifically asked
- Speak as if having a conversation`;

    try {
        console.log(`[VoiceAI] Getting response for: "${prompt}"`);

        const response = await openrouter.chat.completions.create({
            model: config.nonThinkingModel, // Always use non-reasoning for voice
            messages: [
                { role: 'system', content: voiceSystemPrompt },
                ...session.history,
            ],
            max_tokens: 1000, // Keep responses short for voice
        });

        const content = response.choices[0]?.message?.content || 'Sorry, I could not generate a response.';

        // Add assistant response to history
        session.history.push({ role: 'assistant', content });

        console.log(`[VoiceAI] Response: "${content}"`);

        // Clean response for TTS (remove any accidental markdown)
        const cleanedContent = content
            .replace(/```[\s\S]*?```/g, 'code block omitted')
            .replace(/\*\*(.*?)\*\*/g, '$1')
            .replace(/\*(.*?)\*/g, '$1')
            .replace(/`(.*?)`/g, '$1')
            .replace(/#{1,6}\s/g, '');

        return cleanedContent;
    } catch (error) {
        console.error('[VoiceAI] Error getting response:', error);
        return 'Sorry, I encountered an error processing your request.';
    }
}

/**
 * Clear voice session for a user
 * @param {string} userId 
 * @param {string} guildId 
 */
function clearVoiceSession(userId, guildId) {
    const key = `${userId}-${guildId}`;
    voiceSessions.delete(key);
}

module.exports = {
    getVoiceResponse,
    getVoiceSession,
    clearVoiceSession,
};
