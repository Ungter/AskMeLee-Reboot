const prism = require('prism-media');
const { EndBehaviorType } = require('@discordjs/voice');
const { handleVoiceInput } = require('./voiceHandler');

// Buffer duration before processing (in ms)
const SILENCE_DURATION = 1500; // Wait 1.5s of silence before processing
const MAX_RECORDING_DURATION = 30000; // Max 30 seconds recording

// Store user audio buffers
const userAudioBuffers = new Map();

/**
 * Create an audio receiver for a user
 * @param {import('@discordjs/voice').VoiceReceiver} receiver 
 * @param {string} userId 
 * @param {string} guildId 
 * @param {Object} session 
 */
function createAudioReceiver(receiver, userId, guildId, session) {
    // Skip if already receiving from this user
    const bufferKey = `${guildId}-${userId}`;
    if (userAudioBuffers.has(bufferKey)) {
        return;
    }

    const opusStream = receiver.subscribe(userId, {
        end: {
            behavior: EndBehaviorType.AfterSilence,
            duration: SILENCE_DURATION,
        },
    });

    // Decode Opus to PCM
    const decoder = new prism.opus.Decoder({
        rate: 48000,
        channels: 2,
        frameSize: 960,
    });

    const chunks = [];
    let totalSize = 0;
    const startTime = Date.now();

    // Create buffer entry
    userAudioBuffers.set(bufferKey, {
        chunks,
        startTime,
        userId,
        guildId,
    });

    opusStream.pipe(decoder);

    decoder.on('data', (chunk) => {
        // Check max duration
        if (Date.now() - startTime > MAX_RECORDING_DURATION) {
            decoder.destroy();
            return;
        }

        chunks.push(chunk);
        totalSize += chunk.length;
    });

    decoder.on('end', async () => {
        userAudioBuffers.delete(bufferKey);

        if (chunks.length === 0) {
            console.log(`[Audio] No audio data received from user ${userId}`);
            return;
        }

        // Combine chunks into single buffer
        const audioBuffer = Buffer.concat(chunks);
        console.log(`[Audio] Received ${audioBuffer.length} bytes from user ${userId}`);

        // Convert to format suitable for transcription (16kHz mono PCM)
        const processedBuffer = convertTo16kHzMono(audioBuffer);

        // Handle the audio input
        await handleVoiceInput(processedBuffer, userId, guildId, session);
    });

    decoder.on('error', (error) => {
        console.error(`[Audio] Decoder error for user ${userId}:`, error);
        userAudioBuffers.delete(bufferKey);
    });

    opusStream.on('error', (error) => {
        console.error(`[Audio] Stream error for user ${userId}:`, error);
        userAudioBuffers.delete(bufferKey);
    });
}

/**
 * Convert 48kHz stereo PCM to 16kHz mono PCM for transcription
 * @param {Buffer} inputBuffer - 48kHz stereo 16-bit PCM
 * @returns {Buffer} - 16kHz mono 16-bit PCM
 */
function convertTo16kHzMono(inputBuffer) {
    // Input: 48kHz, stereo, 16-bit (4 bytes per sample pair)
    // Output: 16kHz, mono, 16-bit (2 bytes per sample)

    const inputSamples = inputBuffer.length / 4; // 2 channels * 2 bytes
    const outputSamples = Math.floor(inputSamples / 3); // Downsample 48k to 16k (ratio 3:1)
    const outputBuffer = Buffer.alloc(outputSamples * 2);

    for (let i = 0; i < outputSamples; i++) {
        const inputIndex = i * 3 * 4; // Every 3rd sample, 4 bytes per stereo sample

        // Read left and right channels
        const left = inputBuffer.readInt16LE(inputIndex);
        const right = inputBuffer.readInt16LE(inputIndex + 2);

        // Mix to mono (average)
        const mono = Math.floor((left + right) / 2);

        outputBuffer.writeInt16LE(mono, i * 2);
    }

    return outputBuffer;
}

module.exports = {
    createAudioReceiver,
    convertTo16kHzMono,
};

