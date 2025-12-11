const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { searchCreatorsByName, fetchCreatorPosts, fetchPostContent, getPostFiles, stripHtml, getPostPageUrl, getCreatorPageUrl, isImageFile } = require('../../utils/kemonoApi');

// Discord file size limit
const MAX_FILE_SIZE = 8 * 1024 * 1024;

// Items per page
const ITEMS_PER_PAGE = 5;

// Cache for search results and post browsing
const searchCache = new Map();
const postsCache = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kemono-search')
        .setDescription('Search for a Kemono artist and their posts')
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
            option.setName('artist')
                .setDescription('The artist name to search for')
                .setRequired(true)),

    // Export for button handlers
    searchCache,
    postsCache,
    ITEMS_PER_PAGE,
    handleCreatorSelection,
    handlePostFetch,
    buildCreatorsEmbed,
    buildPostsEmbed,

    async execute(interaction) {
        await interaction.deferReply();

        try {
            const artistName = interaction.options.getString('artist');

            // Search for creators
            const creators = await searchCreatorsByName(artistName);

            if (!creators || creators.length === 0) {
                await interaction.editReply(`❌ No artists found matching "${artistName}".`);
                return;
            }

            // Store in cache for button handler
            const cacheKey = `kemono_creators_${interaction.user.id}_${Date.now()}`;
            searchCache.set(cacheKey, {
                creators,
                page: 0,
                userId: interaction.user.id,
                artistName
            });

            // Clean old cache entries
            cleanCache(searchCache);
            cleanCache(postsCache);

            const { embed, components } = buildCreatorsEmbed(creators, 0, artistName, cacheKey);
            await interaction.editReply({ embeds: [embed], components });

        } catch (error) {
            console.error('[kemono-search] Error:', error);
            await interaction.editReply(`❌ Search failed: ${error.message}`);
        }
    }
};

function cleanCache(cache) {
    const now = Date.now();
    for (const [key] of cache.entries()) {
        const parts = key.split('_');
        const timestamp = parseInt(parts[parts.length - 1]);
        if (now - timestamp > 10 * 60 * 1000) {
            cache.delete(key);
        }
    }
}

function buildCreatorsEmbed(creators, page, artistName, cacheKey) {
    const totalPages = Math.ceil(creators.length / ITEMS_PER_PAGE);
    const start = page * ITEMS_PER_PAGE;
    const end = Math.min(start + ITEMS_PER_PAGE, creators.length);
    const pageCreators = creators.slice(start, end);

    const embed = new EmbedBuilder()
        .setTitle(`🔍 Search Results for "${artistName}"`)
        .setColor(0xFF6B6B)
        .addFields(
            { name: 'Total Results', value: `${creators.length}`, inline: true },
            { name: 'Page', value: `${page + 1}/${totalPages}`, inline: true }
        )
        .setTimestamp();

    let description = '';
    pageCreators.forEach((creator, index) => {
        const creatorUrl = getCreatorPageUrl(creator.service, creator.id);
        description += `**${index + 1}.** [${creator.name}](${creatorUrl}) (${creator.service})\n`;
    });

    description += `\n💡 Click a number button to view posts.`;
    embed.setDescription(description);
    embed.setFooter({ text: `Showing results ${start + 1}-${end} of ${creators.length}` });

    // Build navigation buttons row
    const navRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`kemono_creators_prev_${cacheKey}`)
                .setLabel('Previous')
                .setEmoji('⬅️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`kemono_creators_next_${cacheKey}`)
                .setLabel('Next')
                .setEmoji('➡️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages - 1)
        );

    // Build creator selection buttons row
    const selectRow = new ActionRowBuilder();
    pageCreators.forEach((creator, index) => {
        selectRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`kemono_creator_select_${index}_${cacheKey}`)
                .setLabel(`${index + 1}`)
                .setStyle(ButtonStyle.Primary)
        );
    });

    return { embed, components: [navRow, selectRow] };
}

async function handleCreatorSelection(interaction, creator, page = 0) {
    try {
        const posts = await fetchCreatorPosts(creator.service, creator.id);

        if (!posts || posts.length === 0) {
            await interaction.editReply({ content: `📭 No posts found for ${creator.name}.`, embeds: [], components: [] });
            return;
        }

        // Store in posts cache
        const cacheKey = `kemono_posts_${interaction.user.id}_${Date.now()}`;
        postsCache.set(cacheKey, {
            creator,
            posts,
            page,
            userId: interaction.user.id
        });

        const { embed, components } = buildPostsEmbed(creator, posts, page, cacheKey);
        await interaction.editReply({ embeds: [embed], components });

    } catch (error) {
        console.error('[kemono-search] Creator selection error:', error);
        await interaction.editReply({ content: `❌ Failed to fetch posts: ${error.message}`, embeds: [], components: [] });
    }
}

function buildPostsEmbed(creator, posts, page, cacheKey) {
    const totalPages = Math.ceil(posts.length / ITEMS_PER_PAGE);
    const start = page * ITEMS_PER_PAGE;
    const end = Math.min(start + ITEMS_PER_PAGE, posts.length);
    const pagePosts = posts.slice(start, end);

    const creatorUrl = getCreatorPageUrl(creator.service, creator.id);

    const embed = new EmbedBuilder()
        .setTitle(`📂 Posts by ${creator.name}`)
        .setURL(creatorUrl)
        .setColor(0xFF6B6B)
        .addFields(
            { name: 'Service', value: creator.service, inline: true },
            { name: 'Total Posts', value: `${posts.length}`, inline: true },
            { name: 'Page', value: `${page + 1}/${totalPages}`, inline: true }
        )
        .setTimestamp();

    let description = '';
    pagePosts.forEach((post, index) => {
        const postUrl = getPostPageUrl(creator.service, creator.id, post.id);
        const title = post.title || 'Untitled';
        const truncatedTitle = title.length > 60 ? title.substring(0, 57) + '...' : title;
        description += `**${index + 1}.** [${truncatedTitle}](${postUrl})\n`;
    });

    description += `\n💡 Click a number button to view post content.`;
    embed.setDescription(description);
    embed.setFooter({ text: `Showing posts ${start + 1}-${end} of ${posts.length}` });

    // Build navigation buttons row
    const navRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`kemono_posts_prev_${cacheKey}`)
                .setLabel('Previous')
                .setEmoji('⬅️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`kemono_posts_next_${cacheKey}`)
                .setLabel('Next')
                .setEmoji('➡️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages - 1)
        );

    // Build post selection buttons row
    const postRow = new ActionRowBuilder();
    pagePosts.forEach((post, index) => {
        postRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`kemono_post_view_${index}_${cacheKey}`)
                .setLabel(`${index + 1}`)
                .setStyle(ButtonStyle.Primary)
        );
    });

    return { embed, components: [navRow, postRow] };
}

async function handlePostFetch(interaction, creator, post) {
    try {
        const postData = await fetchPostContent(creator.service, creator.id, post.id);

        if (!postData || !postData.post) {
            await interaction.followUp({ content: `❌ Post not found.`, ephemeral: true });
            return;
        }

        const postDetails = postData.post;
        const postUrl = getPostPageUrl(creator.service, creator.id, post.id);
        const files = getPostFiles(postDetails);
        const textContent = stripHtml(postDetails.content);

        // Build the embed
        const embed = new EmbedBuilder()
            .setTitle(postDetails.title || 'Untitled Post')
            .setURL(postUrl)
            .setColor(0xFF6B6B)
            .addFields(
                { name: 'Artist', value: creator.name, inline: true },
                { name: 'Service', value: creator.service, inline: true },
                { name: 'Post ID', value: post.id, inline: true }
            )
            .setTimestamp(postDetails.published ? new Date(postDetails.published) : new Date());

        // If there are files, try to send them as attachments
        if (files.length > 0) {
            const attachments = [];
            let filesTooLarge = false;

            // Try to fetch and attach files (limit to first 5)
            const filesToAttach = files.slice(0, 5);

            for (const file of filesToAttach) {
                try {
                    // Check file size with a HEAD request
                    const headResponse = await fetch(file.url, { method: 'HEAD' });
                    const contentLength = headResponse.headers.get('content-length');

                    if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) {
                        filesTooLarge = true;
                        continue;
                    }

                    // Fetch the file
                    const fileResponse = await fetch(file.url);
                    if (!fileResponse.ok) continue;

                    const buffer = await fileResponse.arrayBuffer();

                    if (buffer.byteLength > MAX_FILE_SIZE) {
                        filesTooLarge = true;
                        continue;
                    }

                    attachments.push(new AttachmentBuilder(Buffer.from(buffer), { name: file.name }));

                    // Set image in embed if it's an image file
                    if (attachments.length === 1 && isImageFile(file.path)) {
                        embed.setImage(`attachment://${file.name}`);
                    }
                } catch (err) {
                    console.error(`[kemono-search] Failed to fetch file ${file.url}:`, err.message);
                }
            }

            // Add file info to embed
            let fileInfo = `📎 ${files.length} file(s)`;
            if (filesTooLarge) {
                fileInfo += `\n⚠️ Some files were too large. [View on Kemono](${postUrl})`;
            }
            if (files.length > 5) {
                fileInfo += `\n📦 Showing first 5 of ${files.length} files`;
            }
            embed.addFields({ name: 'Files', value: fileInfo });

            if (attachments.length > 0) {
                await interaction.followUp({ embeds: [embed], files: attachments });
            } else {
                embed.setDescription(`⚠️ Files are too large to attach. [View on Kemono](${postUrl})`);
                await interaction.followUp({ embeds: [embed] });
            }
        } else if (textContent) {
            // Text-only post
            const maxLength = 4000;
            const truncatedContent = textContent.length > maxLength
                ? textContent.substring(0, maxLength) + '...'
                : textContent;
            embed.setDescription(truncatedContent);
            await interaction.followUp({ embeds: [embed] });
        } else {
            // Empty post
            embed.setDescription('This post has no content. [View on Kemono](' + postUrl + ')');
            await interaction.followUp({ embeds: [embed] });
        }

    } catch (error) {
        console.error('[kemono-search] Post fetch error:', error);
        await interaction.followUp({ content: `❌ Failed to fetch post: ${error.message}`, ephemeral: true });
    }
}
