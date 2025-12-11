const { SlashCommandBuilder, ApplicationIntegrationType, InteractionContextType } = require('discord.js');
const sessions = require('../../sessions');
const { handleAIResponse } = require('../../utils/responseHandler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('chat')
        .setDescription('Chat with the AI.')
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
                .setDescription('The message to send to the AI.')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('reasoning')
                .setDescription('Toggle reasoning for this message (overrides session default).')
                .setRequired(false)),
    async execute(interaction) {
        console.log(`[Command] User ${interaction.user.id} (${interaction.user.tag}) used /chat in channel ${interaction.channelId}`);
        let messageInput = interaction.options.getString('message');
        const reasoningOverride = interaction.options.getBoolean('reasoning');
        const session = sessions.getSession(interaction.user.id, interaction.channelId);

        // Check for Message IDs (Snowflakes) in the input
        const snowflakeRegex = /(\d{17,19})/g;
        const matches = [...messageInput.matchAll(snowflakeRegex)];

        if (matches.length > 0) {
            console.log(`[Command] Found ${matches.length} potential message IDs in prompt.`);

            // Use a map to store replacements to avoid re-fetching or issues with multiple same IDs
            const replacements = new Map();

            for (const match of matches) {
                const id = match[0];
                if (replacements.has(id)) continue;

                try {
                    const fetchedMessage = await interaction.channel.messages.fetch(id);
                    if (fetchedMessage) {
                        console.log(`[Command] Resolved message ID ${id} to message from ${fetchedMessage.author.tag}`);

                        let resolvedContent = '';

                        // Check for text attachments
                        const textAttachment = fetchedMessage.attachments.find(att =>
                            att.contentType?.startsWith('text/') ||
                            att.name.endsWith('.txt') ||
                            att.name.endsWith('.md') ||
                            att.name.endsWith('.js') ||
                            att.name.endsWith('.py') ||
                            att.name.endsWith('.json')
                        );

                        if (textAttachment) {
                            console.log(`[Command] Found text attachment: ${textAttachment.name}`);
                            const response = await fetch(textAttachment.url);
                            if (response.ok) {
                                resolvedContent = await response.text();
                                console.log(`[Command] Extracted ${resolvedContent.length} chars from attachment.`);
                            }
                        } else if (fetchedMessage.content) {
                            resolvedContent = fetchedMessage.content;
                            console.log(`[Command] Using message content: ${resolvedContent.length} chars.`);
                        }

                        if (resolvedContent) {
                            replacements.set(id, resolvedContent);
                        }
                    }
                } catch (error) {
                    console.log(`[Command] Failed to fetch message ${id}: ${error.message}`);
                }
            }

            // Perform replacements
            for (const [id, content] of replacements) {
                // Use split/join to replace all occurrences globally
                messageInput = messageInput.split(id).join(content);
            }
        }

        await handleAIResponse(interaction, messageInput, session, reasoningOverride);
    },
};
