const { createAudioPlayer, AudioPlayerStatus, NoSubscriberBehavior } = require('@discordjs/voice');
const { transcribeAudio } = require('./speechToText');
const { containsWakeWord, extractCommand } = require('./wakeWordDetector');
const { getVoiceResponse } = require('./voiceAI');
const { generateSpeechResource } = require('./textToSpeech');

// Track if bot is currently speaking (to avoid processing its own audio)
const speakingState = new Map();

/**
 * Handle voice input from a user
 * @param {Buffer} pcmBuffer - Processed audio buffer
 * @param {string} userId - User who spoke
 * @param {string} guildId - Guild ID
 * @param {Object} session - Voice session object
 */
async function handleVoiceInput(pcmBuffer, userId, guildId, session) {
    // Skip if bot is currently speaking
    if (speakingState.get(guildId)) {
        console.log(`[Voice] Skipping input while bot is speaking`);
        return;
    }

    try {
        // Step 1: Transcribe audio
        const transcription = await transcribeAudio(pcmBuffer);

        if (!transcription) {
            console.log(`[Voice] No transcription received`);
            return;
        }

        console.log(`[Voice] User ${userId} said: "${transcription}"`);

        // Step 2: Check for wake word
        if (!containsWakeWord(transcription)) {
            console.log(`[Voice] No wake word detected, ignoring`);
            return;
        }

        // Step 3: Extract command after wake word
        const command = extractCommand(transcription);

        if (!command) {
            console.log(`[Voice] Wake word detected but no command`);
            // Could optionally respond with "Yes?" or "How can I help?"
            await respondWithAudio(guildId, session, "Yes? How can I help you?");
            return;
        }

        console.log(`[Voice] Command extracted: "${command}"`);

        // Step 4: Get AI response
        const aiResponse = await getVoiceResponse(userId, guildId, command);

        // Step 5: Convert to speech and play
        await respondWithAudio(guildId, session, aiResponse);

    } catch (error) {
        console.error('[Voice] Error handling voice input:', error);
    }
}

/**
 * Respond with audio in the voice channel
 * @param {string} guildId 
 * @param {Object} session 
 * @param {string} text 
 */
async function respondWithAudio(guildId, session, text) {
    try {
        // Mark as speaking
        speakingState.set(guildId, true);

        // Generate speech resource (streaming - starts playing before full audio is ready)
        const resource = await generateSpeechResource(text);

        if (!resource) {
            console.error('[Voice] Failed to generate speech');
            speakingState.set(guildId, false);
            return;
        }

        // Create and configure audio player
        const player = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Play,
            },
        });

        // Subscribe connection to player
        session.connection.subscribe(player);

        // Play the audio
        player.play(resource);
        console.log(`[Voice] Playing audio response in guild ${guildId}`);

        // Wait for playback to finish
        await new Promise((resolve, reject) => {
            player.on(AudioPlayerStatus.Idle, () => {
                console.log(`[Voice] Finished playing audio`);
                resolve();
            });

            player.on('error', (error) => {
                console.error('[Voice] Audio player error:', error);
                reject(error);
            });

            // Timeout after 60 seconds
            setTimeout(() => {
                player.stop();
                resolve();
            }, 60000);
        });

    } catch (error) {
        console.error('[Voice] Error responding with audio:', error);
    } finally {
        speakingState.set(guildId, false);
    }
}

module.exports = {
    handleVoiceInput,
    respondWithAudio,
};
