const OpenAI = require('openai');
const config = require('../config');

// OpenRouter client for Voxtral STT
const openrouter = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: config.openRouterApiKey,
});

/**
 * Convert PCM buffer to base64 encoded WAV for API
 * @param {Buffer} pcmBuffer - 16kHz mono 16-bit PCM
 * @returns {string} - Base64 encoded WAV
 */
function pcmToBase64Wav(pcmBuffer) {
    // Create WAV header
    const sampleRate = 16000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = pcmBuffer.length;
    const fileSize = 36 + dataSize;

    const header = Buffer.alloc(44);

    // RIFF header
    header.write('RIFF', 0);
    header.writeUInt32LE(fileSize, 4);
    header.write('WAVE', 8);

    // fmt chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // fmt chunk size
    header.writeUInt16LE(1, 20); // PCM format
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);

    // data chunk
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    const wavBuffer = Buffer.concat([header, pcmBuffer]);
    return wavBuffer.toString('base64');
}

/**
 * Transcribe audio using Voxtral via OpenRouter
 * @param {Buffer} pcmBuffer - 16kHz mono PCM audio buffer
 * @returns {Promise<string|null>} - Transcribed text or null on failure
 */
async function transcribeAudio(pcmBuffer) {
    try {
        // Convert PCM to base64 WAV
        const audioBase64 = pcmToBase64Wav(pcmBuffer);

        console.log(`[STT] Sending ${pcmBuffer.length} bytes to Voxtral for transcription`);

        const response = await openrouter.chat.completions.create({
            model: config.voxtralModel,
            messages: [{
                role: 'user',
                content: [
                    {
                        type: 'input_audio',
                        input_audio: {
                            data: audioBase64,
                            format: 'wav',
                        },
                    },
                    {
                        type: 'text',
                        text: 'Transcribe this audio exactly. Output only the transcription, nothing else.',
                    },
                ],
            }],
            max_tokens: 1000,
        });

        const transcription = response.choices[0]?.message?.content?.trim();

        if (transcription) {
            console.log(`[STT] Transcription: "${transcription}"`);
            return transcription;
        }

        return null;
    } catch (error) {
        console.error('[STT] Transcription error:', error);
        return null;
    }
}

module.exports = {
    transcribeAudio,
    pcmToBase64Wav,
};
