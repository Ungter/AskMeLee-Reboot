const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ApplicationIntegrationType, InteractionContextType } = require('discord.js');
const { fetchTopCreators, getCreatorPageUrl } = require('../../utils/kemonoApi');

// Cache for pagination state
const paginationCache = new Map();

// Items per page
const ITEMS_PER_PAGE = 10;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kemono-top')
        .setDescription('Get the top Kemono creators by favorites')
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
        await interaction.deferReply();

        try {
            const creators = await fetchTopCreators();

            if (!creators || creators.length === 0) {
                await interaction.editReply('❌ No creators found.');
                return;
            }

            // Store in cache for pagination
            const cacheKey = `kemono_top_${interaction.user.id}_${Date.now()}`;
            paginationCache.set(cacheKey, {
                creators,
                page: 0,
                userId: interaction.user.id
            });

            // Clean old cache entries (older than 10 minutes)
            const now = Date.now();
            for (const [key, value] of paginationCache.entries()) {
                const timestamp = parseInt(key.split('_').pop());
                if (now - timestamp > 10 * 60 * 1000) {
                    paginationCache.delete(key);
                }
            }

            const embed = buildEmbed(creators, 0);
            const row = buildButtons(cacheKey, 0, Math.ceil(creators.length / ITEMS_PER_PAGE));

            await interaction.editReply({ embeds: [embed], components: [row] });
        } catch (error) {
            console.error('[kemono-top] Error:', error);
            await interaction.editReply(`❌ Failed to fetch top creators: ${error.message}`);
        }
    },

    // Export for button handler in bot.js
    paginationCache,
    ITEMS_PER_PAGE,
    buildEmbed,
    buildButtons
};

function buildEmbed(creators, page) {
    const start = page * ITEMS_PER_PAGE;
    const end = Math.min(start + ITEMS_PER_PAGE, creators.length);
    const pageCreators = creators.slice(start, end);
    const totalPages = Math.ceil(creators.length / ITEMS_PER_PAGE);

    const embed = new EmbedBuilder()
        .setTitle('🏆 Top Kemono Creators')
        .setColor(0xFF6B6B)
        .setFooter({ text: `Page ${page + 1}/${totalPages} • ${creators.length} total creators` })
        .setTimestamp();

    let description = '';
    pageCreators.forEach((creator, index) => {
        const rank = start + index + 1;
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `**#${rank}**`;
        const url = getCreatorPageUrl(creator.service, creator.id);
        description += `${medal} [${creator.name}](${url})\n`;
        description += `   └ 📦 ${creator.service} • ❤️ ${creator.favorited || 0} favorites\n`;
    });

    embed.setDescription(description || 'No creators to display');

    return embed;
}

function buildButtons(cacheKey, currentPage, totalPages) {
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`kemono_top_prev_${cacheKey}`)
                .setLabel('Previous')
                .setEmoji('⬅️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === 0),
            new ButtonBuilder()
                .setCustomId(`kemono_top_next_${cacheKey}`)
                .setLabel('Next')
                .setEmoji('➡️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage >= totalPages - 1)
        );

    return row;
}
