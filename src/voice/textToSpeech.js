const OpenAI = require('openai');
const { createAudioResource, StreamType } = require('@discordjs/voice');
const { Readable } = require('stream');
const config = require('../config');

// OpenAI client for TTS
const openai = new OpenAI({
    apiKey: config.openaiApiKey,
});

/**
 * Generate speech audio from text using OpenAI TTS with streaming
 * Returns a readable stream that can be played while still generating
 * @param {string} text - Text to convert to speech
 * @param {string} [instructions] - Optional voice instructions for gpt-4o-mini-tts
 * @returns {Promise<Readable|null>} - Audio stream or null on failure
 */
async function generateSpeechStream(text, instructions = null) {
    try {
        // Truncate text if too long (TTS has limits)
        const maxLength = 4096;
        const truncatedText = text.length > maxLength
            ? text.substring(0, maxLength - 3) + '...'
            : text;

        console.log(`[TTS] Generating streaming speech for ${truncatedText.length} characters`);

        const requestOptions = {
            model: config.ttsModel,
            voice: config.ttsVoice,
            input: truncatedText,
            response_format: 'opus', // Opus is efficient for Discord
        };

        // Add instructions if using gpt-4o-mini-tts
        if (config.ttsModel === 'gpt-4o-mini-tts') {
            requestOptions.instructions = instructions || 'Speak naturally and conversationally.';
        }

        const response = await openai.audio.speech.create(requestOptions);

        // Get the response body as a readable stream
        // The response.body is a ReadableStream (Web Streams API)
        // We need to convert it to a Node.js Readable stream
        const webStream = response.body;
        const nodeStream = Readable.fromWeb(webStream);

        console.log(`[TTS] Streaming audio response started`);

        return nodeStream;
    } catch (error) {
        console.error('[TTS] Speech generation error:', error);
        return null;
    }
}

/**
 * Create a Discord audio resource from a streaming audio response
 * This allows audio to play before the full file is generated
 * @param {Readable} audioStream - Audio stream (Opus/OGG)
 * @returns {import('@discordjs/voice').AudioResource}
 */
function createAudioResourceFromStream(audioStream) {
    return createAudioResource(audioStream, {
        inputType: StreamType.OggOpus,
    });
}

/**
 * Generate speech and create an audio resource in one step (streaming)
 * @param {string} text - Text to convert to speech
 * @param {string} [instructions] - Optional voice instructions
 * @returns {Promise<import('@discordjs/voice').AudioResource|null>}
 */
async function generateSpeechResource(text, instructions = null) {
    const stream = await generateSpeechStream(text, instructions);
    if (!stream) return null;
    return createAudioResourceFromStream(stream);
}

module.exports = {
    generateSpeechStream,
    createAudioResourceFromStream,
    generateSpeechResource,
};
