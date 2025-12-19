const { SlashCommandBuilder } = require('discord.js');
const { leaveVC, isConnected } = require('../../voice/voiceManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leave-vc')
        .setDescription('Leave the current voice channel'),

    async execute(interaction) {
        // Check if connected
        if (!isConnected(interaction.guildId)) {
            await interaction.reply({
                content: '❌ I\'m not in a voice channel!',
                ephemeral: true,
            });
            return;
        }

        try {
            leaveVC(interaction.guildId);

            await interaction.reply({
                content: '👋 **Left the voice channel!**\n\nI\'m no longer listening. Use `/join-vc` to have me join again.',
            });
        } catch (error) {
            console.error('[LeaveVC] Error:', error);
            await interaction.reply({
                content: '❌ Failed to leave the voice channel.',
                ephemeral: true,
            });
        }
    },
};
