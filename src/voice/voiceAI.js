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
 * Two-step process: 1) Generate response, 2) Add tone modifiers
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

    const currentDateTime = new Date().toLocaleString();

    try {
        console.log(`[VoiceAI] Getting response for: "${prompt}"`);

        // STEP 1: Generate the response content
        const contentSystemPrompt = `
        You are Leila (Lee), a young female.

Current Date and Time: ${currentDateTime}

IMPORTANT: You are responding via voice. Keep your responses:
- Concise
- Natural and conversational
- Avoid markdown, code blocks, any formatting, any tone modifiers like (giggles).
- Avoid lists unless specifically asked
- Speak as if having a conversation`;

        const contentResponse = await openrouter.chat.completions.create({
            //model: config.nonThinkingModel,
            model: "mistralai/mistral-small-creative",
            messages: [
                { role: 'system', content: contentSystemPrompt },
                ...session.history,
            ],
            max_tokens: 1000,
        });

        const rawContent = contentResponse.choices[0]?.message?.content || 'Sorry, I could not generate a response.';
        console.log(`[VoiceAI] Raw response: "${rawContent}"`);

        /*
        1. EMOTIONS - Wrap phrases with {emotion}...{/emotion}. Options: happy, sad, angry, fearful, disgusted, surprised, neutral, fluent
       Example: {happy}Yay! I won a lottery today!{/happy}
        */

        const toneSystemPrompt = `You are a tone modifier assistant. Your job is to take a response and add appropriate tone modifiers for text-to-speech synthesis, along with making sure the response is natural, conversational has no markdown or code blocks, and has no lists.

Available tone modifiers:

2. SOUND TAGS - Add natural vocal sounds in parentheses, ONLY options: (laughs), (chuckle), (coughs), (clear-throat), (groans), (breath), (pant), (inhale), (exhale), (gasps), (sniffs), (sighs), (snorts), (burps), (lip-smacking), (humming), (hissing), (emm), (sneezes)
   Example: (laughs) That's so funny!
   NOTE: do NOT write (pause) or (pauses) or (pauses slightly)

3. PAUSES - Add natural pauses with <#seconds#>. Options: 0.25, 0.5, 0.75, 1
   Example: Well <#0.5#> let me think about that.
   NOTE: do NOT write (pause) or (pauses) or (pauses slightly)

Rules:
- Keep the original meaning intact
- Do not combine tone modifiers with each other; ONE WORD ONLY, for example, do not use use (signs happily)
- Add modifiers naturally and sparingly - don't overdo it
- Match the emotional tone of the content
- Only output the modified text, nothing else`;

        const toneResponse = await openrouter.chat.completions.create({
            model: "openai/gpt-oss-20b",
            messages: [
                { role: 'system', content: toneSystemPrompt },
                { role: 'user', content: `${rawContent}` },
            ],
            reasoning: {
                effort: 'low',
                enabled: true,
                exclude: false
            },
            max_tokens: 1000,
        });

        const modifiedContent = toneResponse.choices[0]?.message?.content || rawContent;
        console.log(`[VoiceAI] Modified response: "${modifiedContent}"`);

        // Add assistant response to history (store the raw content, not the modified one)
        session.history.push({ role: 'assistant', content: rawContent });

        // Clean any accidental markdown from the modified response
        const cleanedContent = modifiedContent
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
