const {
    joinVoiceChannel,
    getVoiceConnection,
    VoiceConnectionStatus,
    entersState,
} = require('@discordjs/voice');
const { createAudioReceiver } = require('./audioProcessor');

// Store active voice sessions per guild
const voiceSessions = new Map();

/**
 * Join a voice channel and start listening
 * @param {import('discord.js').VoiceChannel} channel - The voice channel to join
 * @param {import('discord.js').TextChannel} textChannel - Text channel for feedback
 * @returns {Promise<import('@discordjs/voice').VoiceConnection>}
 */
async function joinVC(channel, textChannel) {
    const guildId = channel.guild.id;

    // Check if already connected
    const existingConnection = getVoiceConnection(guildId);
    if (existingConnection) {
        return existingConnection;
    }

    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        console.log(`[Voice] Attempting to join ${channel.name} in ${channel.guild.name} (attempt ${attempt}/${MAX_RETRIES})...`);

        // Clean up any lingering connection from a previous failed attempt
        const staleConnection = getVoiceConnection(guildId);
        if (staleConnection) {
            try { staleConnection.destroy(); } catch { }
        }

        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: guildId,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfDeaf: false, // Need to hear audio
            selfMute: false,
            debug: true,
        });

        // Log all state transitions for debugging
        connection.on('stateChange', (oldState, newState) => {
            console.log(`[Voice] Connection state: ${oldState.status} -> ${newState.status}`);
        });

        connection.on('debug', (message) => {
            console.log(`[Voice Debug] ${message}`);
        });

        connection.on('error', (error) => {
            console.error(`[Voice] Connection error:`, error);
        });

        try {
            // Wait for connection to be ready (15s per attempt)
            await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
            console.log(`[Voice] Connected to voice channel: ${channel.name} in ${channel.guild.name}`);

            // Set up audio receiver
            const receiver = connection.receiver;

            // Store session info
            voiceSessions.set(guildId, {
                connection,
                textChannel,
                channelId: channel.id,
                receiver,
                userBuffers: new Map(),
            });

            // Handle speaking events
            receiver.speaking.on('start', (userId) => {
                console.log(`[Voice] User ${userId} started speaking`);
                const session = voiceSessions.get(guildId);
                if (session) {
                    createAudioReceiver(receiver, userId, guildId, session);
                }
            });

            // Handle connection state changes
            connection.on(VoiceConnectionStatus.Disconnected, async () => {
                try {
                    await Promise.race([
                        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                    ]);
                    // Reconnecting successfully
                } catch (error) {
                    // Disconnected and not reconnecting
                    if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
                        connection.destroy();
                    }
                    voiceSessions.delete(guildId);
                    console.log(`[Voice] Disconnected from ${channel.guild.name}`);
                }
            });

            connection.on(VoiceConnectionStatus.Destroyed, () => {
                voiceSessions.delete(guildId);
                console.log(`[Voice] Connection destroyed for ${channel.guild.name}`);
            });

            return connection;
        } catch (error) {
            console.warn(`[Voice] Attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`);

            // Safely destroy - connection may already be destroyed by the library
            if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
                connection.destroy();
            }

            // If last attempt, throw the error
            if (attempt === MAX_RETRIES) {
                throw error;
            }

            // Wait a bit before retrying
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

/**
 * Leave a voice channel
 * @param {string} guildId - The guild ID
 * @returns {boolean} - True if successfully left
 */
function leaveVC(guildId) {
    const connection = getVoiceConnection(guildId);
    if (connection) {
        connection.destroy();
        voiceSessions.delete(guildId);
        console.log(`[Voice] Left voice channel in guild ${guildId}`);
        return true;
    }
    return false;
}

/**
 * Get voice session for a guild
 * @param {string} guildId 
 * @returns {Object|null}
 */
function getVoiceSession(guildId) {
    return voiceSessions.get(guildId) || null;
}

/**
 * Check if bot is connected to voice in a guild
 * @param {string} guildId 
 * @returns {boolean}
 */
function isConnected(guildId) {
    return getVoiceConnection(guildId) !== undefined;
}

module.exports = {
    joinVC,
    leaveVC,
    getVoiceSession,
    isConnected,
    voiceSessions,
};
