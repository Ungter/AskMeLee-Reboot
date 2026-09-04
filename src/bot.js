const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events, MessageFlags, Collection } = require('discord.js');
const config = require('./config');
const sessions = require('./sessions');
const ai = require('./ai');
const { handleAIResponse, reasoningCache, contentCache } = require('./utils/responseHandler');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Channel, Partials.Message],
});

client.commands = new Collection();
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        } else {
            console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}

client.once(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Only respond if the bot is mentioned or it's a DM
    const isMentioned = message.mentions.has(client.user);
    const isDM = !message.guild;

    if (!isMentioned && !isDM) return;

    // Clean up the content (remove the mention)
    let content = message.content;
    if (isMentioned) {
        content = content.replace(new RegExp(`^<@!?${client.user.id}>`), '').trim();
    }

    if (!content) return; // Ignore empty messages (just mentions)

    console.log(`[Message] User ${message.author.id} (${message.author.tag}) requested AI response in channel ${message.channel.id}`);

    const session = sessions.getSession(message.author.id, message.channel.id, 'cloud');

    // Pick up an image attachment if the user attached one to their message
    const imageAttachment = message.attachments.find(att => att.contentType?.startsWith('image/'));
    const imageUrl = imageAttachment?.url;

    // Use the shared handler
    await handleAIResponse(message, content, session, null, { imageUrl });
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand() || interaction.isContextMenuCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);

        if (!command) {
            console.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
            } else {
                await interaction.reply({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
            }
        }
        return;
    }

    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith('new_chat')) {

        const parts = interaction.customId.split('_');
        const ownerId = parts.length > 2 ? parts.slice(2).join('_') : null;

        if (ownerId && interaction.user.id !== ownerId) {
            await interaction.reply({ content: '❌ Only the user who started this conversation can reset it.', flags: MessageFlags.Ephemeral });
            return;
        }

        console.log(`[Button] User ${interaction.user.id} (${interaction.user.tag}) clicked new_chat in channel ${interaction.channelId}`);
        sessions.resetSession(interaction.user.id, interaction.channelId);
        await interaction.reply({ content: '✅ New chat started! Context cleared for this channel.', flags: MessageFlags.Ephemeral });
    } else if (interaction.customId === 'show_reasoning') {
        const reasoning = reasoningCache.get(interaction.message.id);
        if (reasoning) {
            // Send as ephemeral message (or a text file if too long)
            if (reasoning.length > 2000) {
                const buffer = Buffer.from(reasoning, 'utf-8');
                await interaction.reply({
                    content: 'Here is the full reasoning process:',
                    files: [{ attachment: buffer, name: 'reasoning.txt' }],
                    flags: MessageFlags.Ephemeral
                });
            } else {
                await interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('🧠 Full Reasoning')
                            .setDescription(reasoning)
                            .setColor(0xFFA500)
                    ],
                    flags: MessageFlags.Ephemeral
                });
            }
        } else {
            await interaction.reply({ content: '❌ Reasoning data not found (might have expired).', flags: MessageFlags.Ephemeral });
        }
    } else if (interaction.customId === 'toggle_collapse') {
        try {
            await interaction.deferUpdate();

            const messageId = interaction.message.id;
            const isCollapsing = interaction.component.label === 'Collapse';

            let newContent;
            let newLabel;
            let newEmoji;

            if (isCollapsing) {
                // Switching to "Closed" state (Collapse -> Expand)
                // 1. Get current (full) content
                const currentContent = interaction.message.embeds[0].description;
                // 2. Cache it
                contentCache.set(messageId, currentContent);

                // 3. Truncate logic
                let truncateIndex = currentContent.indexOf('\n');
                const periodIndex = currentContent.indexOf('.');

                if (periodIndex !== -1 && (truncateIndex === -1 || periodIndex < truncateIndex)) {
                    truncateIndex = periodIndex + 1;
                }

                if (truncateIndex !== -1) {
                    newContent = currentContent.slice(0, truncateIndex) + ' ...';
                } else if (currentContent.length > 100) {
                    newContent = currentContent.slice(0, 100) + ' ...';
                } else {
                    newContent = currentContent;
                }

                newLabel = 'Expand';
                newEmoji = '▶️';
            } else {
                // Switching to "Open" state (Expand -> Collapse)
                const fullContent = contentCache.get(messageId);

                if (!fullContent) {
                    await interaction.followUp({
                        content: '❌ Original content not found in cache.',
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                newContent = fullContent;
                newLabel = 'Collapse';
                newEmoji = '🔽';
            }

            // Update the Embed
            const newEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setDescription(newContent);

            // Update the Button in the Component Row
            const newComponents = interaction.message.components.map((row) => {
                const newRow = ActionRowBuilder.from(row);
                const buttonToUpdate = newRow.components.find(
                    c => c.data.custom_id === 'toggle_collapse'
                );

                if (buttonToUpdate) {
                    buttonToUpdate.setLabel(newLabel).setEmoji(newEmoji);
                }

                return newRow;
            });

            await interaction.editReply({
                embeds: [newEmbed],
                components: newComponents
            });
        } catch (error) {
            console.error('Error in toggle_collapse:', error);
            try {
                await interaction.followUp({ content: '❌ An error occurred while toggling content.', flags: MessageFlags.Ephemeral });
            } catch (e) {
                console.error('Failed to send error message:', e);
            }
        }
    }
});

module.exports = client;
