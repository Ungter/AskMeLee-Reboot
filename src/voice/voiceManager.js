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

    console.log(`[Voice] Attempting to join ${channel.name} in ${channel.guild.name}...`);

    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guildId,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: false, // Need to hear audio
        selfMute: false,
    });

    try {
        // Wait for connection to be ready (increased timeout to 60s)
        await entersState(connection, VoiceConnectionStatus.Ready, 60_000);
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
                connection.destroy();
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
        connection.destroy();
        throw error;
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
