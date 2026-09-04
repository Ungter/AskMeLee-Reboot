const { SlashCommandBuilder, ApplicationIntegrationType, InteractionContextType } = require('discord.js');
const sessions = require('../../sessions');
const { handleAIResponse } = require('../../utils/responseHandler');
const { streamLocalResponse } = require('../../localAi');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('chatwiththegroup')
        .setDescription('Chat using your local vLLM model.')
        .setIntegrationTypes([
            ApplicationIntegrationType.GuildInstall,
            ApplicationIntegrationType.UserInstall
        ])
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ])
        .addStringOption(option =>
            option.setName('message')
                .setDescription('The message to send to your local model.')
                .setRequired(true)),
    async execute(interaction) {
        console.log(`[Command] User ${interaction.user.id} (${interaction.user.tag}) used /chatwiththegroup in channel ${interaction.channelId}`);

        const messageInput = interaction.options.getString('message');
        const session = sessions.getSession(interaction.user.id, interaction.channelId, 'local');

        await handleAIResponse(interaction, messageInput, session, false, {
            streamResponseFn: streamLocalResponse,
        });
    },
};
