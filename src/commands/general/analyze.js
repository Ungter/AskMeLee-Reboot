const { ContextMenuCommandBuilder, ApplicationCommandType, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ApplicationIntegrationType, InteractionContextType } = require('discord.js');
const sessions = require('../../sessions');
const { handleAIResponse } = require('../../utils/responseHandler');

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Ask AI')
        .setType(ApplicationCommandType.Message)
        .setIntegrationTypes([
            ApplicationIntegrationType.GuildInstall,
            ApplicationIntegrationType.UserInstall
        ])
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    async execute(interaction) {
        const targetMessage = interaction.targetMessage;

        // Extract content
        let extractedContent = targetMessage.content;

        // Check for attachments (prioritize text)
        const textAttachment = targetMessage.attachments.find(att =>
            att.contentType?.startsWith('text/') ||
            att.name.endsWith('.txt') ||
            att.name.endsWith('.md') ||
            att.name.endsWith('.js') ||
            att.name.endsWith('.py') ||
            att.name.endsWith('.json')
        );

        if (textAttachment) {
            try {
                const response = await fetch(textAttachment.url);
                if (response.ok) {
                    const text = await response.text();
                    extractedContent += `\n\n[Attachment Content: ${textAttachment.name}]\n${text}`;
                }
            } catch (e) {
                console.error('Failed to fetch attachment for context menu:', e);
            }
        }

        // Show Modal
        const modalId = `ask_ai_modal_${Date.now()}`;
        const modal = new ModalBuilder()
            .setCustomId(modalId)
            .setTitle('Ask AI about this message');

        const questionInput = new TextInputBuilder()
            .setCustomId('question')
            .setLabel("What's your question?")
            .setPlaceholder("Explain this code, summarize this text, etc.")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        const reasoningInput = new TextInputBuilder()
            .setCustomId('reasoning')
            .setLabel("Enable Reasoning?")
            .setPlaceholder("Type 'yes' to enable reasoning.")
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        const firstActionRow = new ActionRowBuilder().addComponents(questionInput);
        const secondActionRow = new ActionRowBuilder().addComponents(reasoningInput);

        modal.addComponents(firstActionRow, secondActionRow);

        await interaction.showModal(modal);

        // Wait for submission
        const filter = (i) => i.customId === modalId;
        try {
            const submitted = await interaction.awaitModalSubmit({ filter, time: 600000 }); // 10 mins timeout

            const question = submitted.fields.getTextInputValue('question');
            const reasoningValue = submitted.fields.getTextInputValue('reasoning');
            const reasoningEnabled = reasoningValue?.toLowerCase().includes('yes') || reasoningValue?.toLowerCase().includes('true');

            const fullPrompt = `${question}\n\n---\n[Context from message by ${targetMessage.author.tag}]:\n${extractedContent}`;

            const session = sessions.getSession(submitted.user.id, submitted.channelId);
            await handleAIResponse(submitted, fullPrompt, session, reasoningEnabled);

        } catch (e) {
            // Ignore timeout, user just didn't submit
            console.log('Modal submit timeout or error:', e);
        }
    }
};
