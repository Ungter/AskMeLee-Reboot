const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType, AttachmentBuilder } = require('discord.js');
const { fetchRandomPost, fetchPostContent, getPostFiles, stripHtml, getPostPageUrl, isImageFile } = require('../../utils/kemonoApi');

// Discord file size limit (8MB for free servers, we'll use a conservative limit)
const MAX_FILE_SIZE = 8 * 1024 * 1024;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kemono-random')
        .setDescription('Get a random post from Kemono')
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
            // Get random post reference
            const randomRef = await fetchRandomPost();

            if (!randomRef || !randomRef.service || !randomRef.artist_id || !randomRef.post_id) {
                await interaction.editReply('❌ Failed to get a random post. Please try again.');
                return;
            }

            // Fetch full post content
            const postData = await fetchPostContent(randomRef.service, randomRef.artist_id, randomRef.post_id);

            if (!postData || !postData.post) {
                await interaction.editReply('❌ Failed to fetch post content. Please try again.');
                return;
            }

            const post = postData.post;
            const postUrl = getPostPageUrl(randomRef.service, randomRef.artist_id, randomRef.post_id);
            const files = getPostFiles(post);
            const textContent = stripHtml(post.content);

            // Build the embed
            const embed = new EmbedBuilder()
                .setTitle(post.title || 'Untitled Post')
                .setURL(postUrl)
                .setColor(0xFF6B6B)
                .addFields(
                    { name: 'Service', value: randomRef.service, inline: true },
                    { name: 'Artist ID', value: randomRef.artist_id, inline: true },
                    { name: 'Post ID', value: randomRef.post_id, inline: true }
                )
                .setTimestamp(post.published ? new Date(post.published) : new Date());

            // If there are files, try to send them as attachments
            if (files.length > 0) {
                const attachments = [];
                let filesTooLarge = false;

                // Try to fetch and attach files (limit to first 5 to avoid spam)
                const filesToAttach = files.slice(0, 5);

                for (const file of filesToAttach) {
                    try {
                        // Check file size with a HEAD request first
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
                        console.error(`[kemono-random] Failed to fetch file ${file.url}:`, err.message);
                    }
                }

                // Add file info to embed
                let fileInfo = `📎 ${files.length} file(s) attached`;
                if (filesTooLarge) {
                    fileInfo += `\n⚠️ Some files were too large. [View on Kemono](${postUrl})`;
                }
                if (files.length > 5) {
                    fileInfo += `\n📦 Showing first 5 of ${files.length} files`;
                }
                embed.addFields({ name: 'Files', value: fileInfo });

                if (attachments.length > 0) {
                    await interaction.editReply({ embeds: [embed], files: attachments });
                } else {
                    // All files too large, just provide link
                    embed.setDescription(`⚠️ Files are too large to attach. [View on Kemono](${postUrl})`);
                    await interaction.editReply({ embeds: [embed] });
                }
            } else if (textContent) {
                // Text-only post
                const maxLength = 4000;
                const truncatedContent = textContent.length > maxLength
                    ? textContent.substring(0, maxLength) + '...'
                    : textContent;
                embed.setDescription(truncatedContent);
                await interaction.editReply({ embeds: [embed] });
            } else {
                // Empty post
                embed.setDescription('This post has no content. [View on Kemono](' + postUrl + ')');
                await interaction.editReply({ embeds: [embed] });
            }

        } catch (error) {
            console.error('[kemono-random] Error:', error);
            await interaction.editReply(`❌ Failed to fetch random post: ${error.message}`);
        }
    }
};
