const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const ai = require('../ai');
const langExts = require('../langExts.json');

// Simple cache for reasoning data (shared)
const reasoningCache = new Map();
// Simple cache for full message content (shared)
const contentCache = new Map();

/**
 * Handle AI response generation and message updates.
 * @param {import('discord.js').Message | import('discord.js').ChatInputCommandInteraction} target - The message or interaction to reply to.
 * @param {string} userPrompt - The user's input.
 * @param {Object} session - The user's session object.
 * @param {boolean|null} reasoningOverride - Override for reasoning setting (true/false/null).
 */
async function handleAIResponse(target, userPrompt, session, reasoningOverride = null) {
    // Check if it's an interaction (Command, ContextMenu, or ModalSubmit)
    const isInteraction = target.isCommand?.() || target.isModalSubmit?.() || target.isRepliable?.();

    // Determine reasoning state
    const reasoningEnabled = reasoningOverride !== null ? reasoningOverride : session.reasoningEnabled;

    // Add user message to history
    session.history.push({ role: 'user', content: userPrompt });

    // Initial feedback
    const initialEmbed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('Thinking...')
        .setDescription('Initializing request...');

    // Track all messages sent for this response
    const sentMessages = [];
    let activeMessage = null; // The current message we are streaming text into

    try {
        let firstMsg;
        if (isInteraction) {
            await target.deferReply();
            firstMsg = await target.editReply({ embeds: [initialEmbed] });
        } else {
            firstMsg = await target.reply({ embeds: [initialEmbed] });
        }
        sentMessages.push(firstMsg);
        activeMessage = firstMsg;
    } catch (e) {
        console.error('Failed to send initial reply:', e);
        return;
    }

    let lastContent = '';
    let lastReasoning = '';
    let isReasoningPhase = true;
    let lastUsage = null;
    let lastUpdate = Date.now();

    // State for code block parsing
    let lastProcessedIndex = 0;

    // Helper to send a new message (replying to the last one if possible)
    const sendNewMessage = async (payload) => {
        const lastMsg = sentMessages[sentMessages.length - 1];
        if (lastMsg) {
            // Reply to the last message to avoid "Max follow up messages"
            // Ensure we don't ping the user
            payload.allowedMentions = { repliedUser: false };
            return await lastMsg.reply(payload);
        } else {
            // Fallback (shouldn't happen if initial reply worked)
            return isInteraction ? await target.followUp(payload) : await target.channel.send(payload);
        }
    };

    // Function to update the messages (throttled)
    const updateMessage = async (content, reasoning, usage, final = false) => {
        const now = Date.now();
        // Increase throttle to 2000ms to buffer more data and reduce rate limits
        if (!final && now - lastUpdate < 2000) return;
        lastUpdate = now;

        // 1. Process Completed Code Blocks
        // We look at the content starting from what we've already finished processing
        let textBuffer = content.slice(lastProcessedIndex);

        // Regex to find the FIRST complete code block
        // ```(lang)?\n?(content)```
        const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/;

        // Process ONE code block per update to avoid flooding Discord
        const match = codeBlockRegex.exec(textBuffer);
        if (match) {
            const fullBlock = match[0];
            const lang = match[1] || 'txt';
            const codeContent = match[2];
            const textBefore = textBuffer.slice(0, match.index);

            // A. Handle Text Before Code Block
            if (textBefore) {
                // Split textBefore into chunks of 4096
                const chunks = [];
                for (let i = 0; i < textBefore.length; i += 4096) {
                    chunks.push(textBefore.slice(i, i + 4096));
                }

                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];
                    const payload = { content: '', embeds: [], components: [] };
                    const embed = new EmbedBuilder().setColor(0xF90F16).setDescription(chunk);

                    // If this is the very first message (and first chunk), add thinking embed if needed
                    if (sentMessages.length === 1 && reasoningEnabled && reasoning && isReasoningPhase && i === 0) {
                        // Truncate reasoning to avoid hitting embed limits (rolling window)
                        const MAX_REASONING_PREVIEW = 3000;
                        let reasoningPreview = reasoning;
                        if (reasoning.length > MAX_REASONING_PREVIEW) {
                            reasoningPreview = '... ' + reasoning.slice(-MAX_REASONING_PREVIEW);
                        }

                        const thinkingEmbed = new EmbedBuilder()
                            .setColor(0xFFA500)
                            .setTitle('🧠 Thinking Process')
                            .setDescription(reasoningPreview || 'Thinking...');
                        payload.embeds.push(thinkingEmbed);
                    }
                    payload.embeds.push(embed);

                    if (activeMessage) {
                        try {
                            if (isInteraction && sentMessages.length === 1) await target.editReply(payload);
                            else await activeMessage.edit(payload);
                        } catch (e) { console.error('Error editing text before code:', e); }
                        // Mark activeMessage as null so next chunk/code block creates a new message
                        activeMessage = null;
                    } else {
                        // Create new message for text before code
                        try {
                            const newMsg = await sendNewMessage(payload);
                            sentMessages.push(newMsg);
                        } catch (e) { console.error('Error creating text msg before code:', e); }
                    }
                }
            } else if (activeMessage && sentMessages.length === 1 && (!reasoningEnabled || !reasoning)) {
                if (!reasoningEnabled) {
                    try {
                        await activeMessage.delete();
                        sentMessages.pop(); // Remove from tracking
                        activeMessage = null;
                    } catch (e) { console.error('Error deleting empty initial msg:', e); }
                }
            }

            // We are done with the active message (it contained the text before).
            activeMessage = null;

            // B. Handle The Code Block
            // Add a small delay before sending the code block message to respect rate limits
            await new Promise(r => setTimeout(r, 1000));

            if (fullBlock.length < 1800) {
                // Small enough: Send as new message
                const payload = { content: fullBlock, embeds: [], components: [] };
                try {
                    const newMsg = await sendNewMessage(payload);
                    sentMessages.push(newMsg);
                } catch (e) { console.error('Error sending code block msg:', e); }
            } else {
                // Too big: Send as file
                const ext = langExts[lang] || lang || 'txt';
                const buffer = Buffer.from(codeContent, 'utf-8');
                const attachment = { attachment: buffer, name: `snippet.${ext}` };
                const payload = { content: `📄 **Code Snippet (${lang})**`, files: [attachment], embeds: [], components: [] };
                try {
                    const newMsg = await sendNewMessage(payload);
                    sentMessages.push(newMsg);
                } catch (e) { console.error('Error sending code file:', e); }
            }

            // Advance index
            lastProcessedIndex += match.index + fullBlock.length;

            // Return early to let the next throttle cycle handle subsequent blocks/text
            // This ensures we don't flood the API
            return;
        }

        // 2. Handle Remaining Buffer (Streaming Text)
        textBuffer = content.slice(lastProcessedIndex);

        // Check for partial code block
        const partialBlockIndex = textBuffer.indexOf('```');

        let safeText = textBuffer;
        if (partialBlockIndex !== -1 && !final) {
            // If we see a start tag and we are NOT final, we stop printing there.
            safeText = textBuffer.slice(0, partialBlockIndex);
        }

        // Handle splitting of long streaming text
        while (safeText.length > 4096) {
            const chunk = safeText.slice(0, 4096);
            const payload = { content: '', embeds: [], components: [] };
            const embed = new EmbedBuilder().setColor(0xF90F16).setDescription(chunk);

            // Handle Thinking Embed (First msg only) - rare case where first chunk is huge
            if (sentMessages.length === 1 && reasoningEnabled && reasoning && isReasoningPhase && !final) {
                const reasoningPreview = reasoning.slice(-4000);
                const thinkingEmbed = new EmbedBuilder()
                    .setColor(0xFFA500)
                    .setTitle('🧠 Thinking Process')
                    .setDescription(reasoningPreview || 'Thinking...');
                // Prepend thinking embed
                payload.embeds.unshift(thinkingEmbed);
            }
            payload.embeds.push(embed);

            if (activeMessage) {
                try {
                    if (isInteraction && sentMessages.length === 1) await target.editReply(payload);
                    else await activeMessage.edit(payload);
                } catch (e) { console.error('Error editing active msg (chunk):', e); }
                activeMessage = null; // Message full
            } else {
                try {
                    const newMsg = await sendNewMessage(payload);
                    sentMessages.push(newMsg);
                } catch (e) { console.error('Error creating new active msg (chunk):', e); }
            }

            lastProcessedIndex += 4096;
            safeText = safeText.slice(4096);
        }

        // If there is text to show (or if we need to update the active message with empty text to clear it?)
        // Only update if we have an active message OR if we have safe text to show
        if (activeMessage || safeText || final) {
            const payload = { content: '', embeds: [], components: [] };

            // If we have text, create embed
            if (safeText) {
                const embed = new EmbedBuilder().setColor(0xF90F16).setDescription(safeText);
                payload.embeds.push(embed);
            }

            // Handle Thinking Embed (First msg only)
            if (sentMessages.length === 1 && reasoningEnabled && reasoning && isReasoningPhase && !final) {
                const reasoningPreview = reasoning.slice(-4000);
                const thinkingEmbed = new EmbedBuilder()
                    .setColor(0xFFA500)
                    .setTitle('🧠 Thinking Process')
                    .setDescription(reasoningPreview || 'Thinking...');
                // Prepend thinking embed
                payload.embeds.unshift(thinkingEmbed);
            }

            // Add Footer if Final
            if (final && usage && payload.embeds.length > 0) {
                const lastEmbed = payload.embeds[payload.embeds.length - 1];
                // We need to clone it to modify it safely or just set it
                // EmbedBuilder is mutable
                lastEmbed.setFooter({
                    text: `Total Tokens: ${usage.total_tokens} | Reasoning Tokens: ${usage.reasoning_tokens}`
                });
            }

            // Add Buttons if Final
            if (final) {
                const row = new ActionRowBuilder();
                const ownerId = isInteraction ? target.user.id : target.author.id;

                if (reasoningEnabled && reasoning) {
                    row.addComponents(
                        new ButtonBuilder()
                            .setCustomId('show_reasoning')
                            .setLabel('Show Reasoning')
                            .setStyle(ButtonStyle.Secondary)
                            .setEmoji('🧠')
                    );
                }

                // Add Collapse Button
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId('toggle_collapse')
                        .setLabel('Collapse')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🔽')
                );

                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`new_chat_${ownerId}`)
                        .setLabel('Start New Chat')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🔄')
                );
                payload.components = [row];
            }

            // Send/Edit
            if (payload.embeds.length > 0 || payload.components.length > 0 || payload.files?.length > 0) {
                if (activeMessage) {
                    try {
                        if (isInteraction && sentMessages.length === 1) await target.editReply(payload);
                        else await activeMessage.edit(payload);
                    } catch (e) {
                        console.error('Error editing active msg:', e);
                        // Fallback: Create new message
                        activeMessage = null;
                        try {
                            const newMsg = await sendNewMessage(payload);
                            sentMessages.push(newMsg);
                            activeMessage = newMsg;
                        } catch (e2) { console.error('Error sending fallback msg:', e2); }
                    }
                } else {
                    // Create new active message
                    try {
                        const newMsg = await sendNewMessage(payload);
                        sentMessages.push(newMsg);
                        activeMessage = newMsg;
                    } catch (e) { console.error('Error creating new active msg:', e); }
                }
            }
        }
    };

    // Trim history to prevent exceeding context limits
    // Keep last 20 messages (10 exchanges) to stay well under token limits
    const MAX_HISTORY_LENGTH = 20;
    if (session.history.length > MAX_HISTORY_LENGTH) {
        session.history = session.history.slice(-MAX_HISTORY_LENGTH);
    }

    try {
        await ai.streamResponse(session.history, (content, reasoning, usage) => {
            // Detect phase switch
            if (isReasoningPhase && content && content.trim().length > 0) {
                isReasoningPhase = false;
            }

            lastContent = content;
            lastReasoning = reasoning;
            if (usage) lastUsage = usage;
            updateMessage(content, reasoning, lastUsage, false);
        }, reasoningEnabled);

        // Final update
        await updateMessage(lastContent, lastReasoning, lastUsage, true);

        if (lastUsage) {
            const user = isInteraction ? target.user : target.author;
            console.log(`[Usage] User ${user.id} (${user.tag}) used ${lastUsage.total_tokens} tokens (Reasoning: ${lastUsage.reasoning_tokens})`);
        }

        // Save assistant response to history
        session.history.push({ role: 'assistant', content: lastContent });

        // Store reasoning in cache (map to the LAST message ID where the button is)
        const lastMsg = sentMessages[sentMessages.length - 1];
        if (lastMsg && lastMsg.id) {
            reasoningCache.set(lastMsg.id, lastReasoning);
            if (lastMsg.embeds && lastMsg.embeds.length > 0) {
                contentCache.set(lastMsg.id, lastMsg.embeds[0].description);
            }
        }

    } catch (error) {
        console.error('Error generating response:', error);
        const errorPayload = { content: '', embeds: [new EmbedBuilder().setColor(0xFF0000).setDescription('Sorry, I encountered an error processing your request.')] };
        // Try to update the last message
        const lastMsg = sentMessages[sentMessages.length - 1];
        if (lastMsg) {
            try {
                if (isInteraction && sentMessages.length === 1) {
                    await target.editReply(errorPayload);
                } else {
                    await lastMsg.edit(errorPayload);
                }
            } catch (e) { console.error(e); }
        }
    }
}

module.exports = {
    handleAIResponse,
    reasoningCache,
    contentCache
};
