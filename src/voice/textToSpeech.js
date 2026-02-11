const { createAudioResource, StreamType } = require('@discordjs/voice');
const { Readable, PassThrough } = require('stream');
const config = require('../config');

// MiniMax T2A API endpoint (US region for reduced TTFA)
const MINIMAX_API_URL = 'https://api-uw.minimax.io/v1/t2a_v2';

/**
 * Generate speech audio from text using MiniMax T2A API with streaming
 * Returns a readable stream that can be played while still generating
 * @param {string} text - Text to convert to speech
 * @returns {Promise<Readable|null>} - Audio stream or null on failure
 */
async function generateSpeechStream(text) {
    try {
        // Truncate text if too long (MiniMax limit is 10,000 chars, but 3000+ recommended for streaming)
        const maxLength = 4096;
        const truncatedText = text.length > maxLength
            ? text.substring(0, maxLength - 3) + '...'
            : text;


        const requestBody = {
            model: config.sstModel,
            text: truncatedText,
            stream: true,
            stream_options: {
                exclude_aggregated_audio: true, // Prevent final chunk from containing complete audio
            },
            language_boost: 'English',
            voice_setting: {
                voice_id: config.voiceId,
                speed: 1.11,
                vol: 1,
                pitch: 0,
            },
            audio_setting: {
                sample_rate: 32000,
                bitrate: 128000,
                format: 'mp3',
                channel: 1,
            },
        };

        const response = await fetch(MINIMAX_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.minimaxApiKey}`,
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[TTS] MiniMax API error: ${response.status} - ${errorText}`);
            return null;
        }

        console.log(`[TTS] Streaming audio response started`);

        // Create a PassThrough stream to pipe audio data
        const audioStream = new PassThrough();
        let totalBytesWritten = 0;
        let chunkCount = 0;

        // Process the streaming response
        (async () => {
            try {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        console.log(`[TTS] Stream reader done`);
                        break;
                    }

                    buffer += decoder.decode(value, { stream: true });
                    //console.log(`[TTS] Received chunk, buffer length: ${buffer.length}`);
                    //console.log(`[TTS] Raw buffer content: ${buffer.substring(0, 500)}`);

                    const lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // Keep incomplete line in buffer

                    for (const line of lines) {
                        let trimmedLine = line.trim();
                        if (!trimmedLine) continue;

                        // Handle SSE format (data: prefix)
                        if (trimmedLine.startsWith('data:')) {
                            trimmedLine = trimmedLine.substring(5).trim();
                        }

                        // Skip SSE keep-alive or empty data
                        if (!trimmedLine || trimmedLine === '[DONE]') continue;

                        try {
                            const data = JSON.parse(trimmedLine);

                            // Check for errors
                            if (data.base_resp && data.base_resp.status_code !== 0) {
                                console.error(`[TTS] MiniMax streaming error: ${data.base_resp.status_msg}`);
                                continue;
                            }

                            // Extract and decode hex audio data
                            if (data.data && data.data.audio) {
                                const audioBuffer = Buffer.from(data.data.audio, 'hex');
                                audioStream.write(audioBuffer);
                                totalBytesWritten += audioBuffer.length;
                                chunkCount++;
                                console.log(`[TTS] Wrote audio chunk ${chunkCount}: ${audioBuffer.length} bytes (total: ${totalBytesWritten})`);
                            }
                        } catch (parseError) {
                            // Log first 200 chars to debug format
                            console.warn(`[TTS] Failed to parse chunk: ${trimmedLine.substring(0, 200)}`);
                        }
                    }
                }

                // Process any remaining data in buffer
                if (buffer.trim()) {
                    let trimmedBuffer = buffer.trim();
                    if (trimmedBuffer.startsWith('data:')) {
                        trimmedBuffer = trimmedBuffer.substring(5).trim();
                    }
                    if (trimmedBuffer && trimmedBuffer !== '[DONE]') {
                        try {
                            const data = JSON.parse(trimmedBuffer);
                            if (data.data && data.data.audio) {
                                const audioBuffer = Buffer.from(data.data.audio, 'hex');
                                audioStream.write(audioBuffer);
                                totalBytesWritten += audioBuffer.length;
                                chunkCount++;
                                console.log(`[TTS] Wrote final chunk ${chunkCount}: ${audioBuffer.length} bytes`);
                            }
                        } catch (parseError) {
                            console.warn(`[TTS] Failed to parse final buffer: ${trimmedBuffer.substring(0, 200)}`);
                        }
                    }
                }

                audioStream.end();
                console.log(`[TTS] Streaming completed - ${chunkCount} chunks, ${totalBytesWritten} total bytes`);
            } catch (streamError) {
                console.error('[TTS] Stream processing error:', streamError);
                audioStream.destroy(streamError);
            }
        })();

        return audioStream;
    } catch (error) {
        console.error('[TTS] Speech generation error:', error);
        return null;
    }
}

/**
 * Create a Discord audio resource from a streaming audio response
 * @param {Readable} audioStream - Audio stream (MP3)
 * @returns {import('@discordjs/voice').AudioResource}
 */
function createAudioResourceFromStream(audioStream) {
    // MiniMax outputs MP3, so we use Arbitrary input type
    return createAudioResource(audioStream, {
        inputType: StreamType.Arbitrary,
    });
}

/**
 * Generate speech and create an audio resource in one step (streaming)
 * @param {string} text - Text to convert to speech
 * @returns {Promise<import('@discordjs/voice').AudioResource|null>}
 */
async function generateSpeechResource(text) {
    const stream = await generateSpeechStream(text);
    if (!stream) return null;
    return createAudioResourceFromStream(stream);
}

module.exports = {
    generateSpeechStream,
    createAudioResourceFromStream,
    generateSpeechResource,
};
