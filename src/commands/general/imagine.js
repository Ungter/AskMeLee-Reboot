const { SlashCommandBuilder, ApplicationIntegrationType, InteractionContextType } = require('discord.js');
const OpenAI = require('openai');
const config = require('../../config');

const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: config.openRouterApiKey,
});

/**
 * Create a visual progress bar
 * @param {number} progress - Progress percentage (0-100)
 * @returns {string} Progress bar string
 */
function createProgressBar(progress) {
    const barLength = 20;
    const filledLength = Math.round((progress / 100) * barLength);
    const emptyLength = barLength - filledLength;
    const bar = '█'.repeat(filledLength) + '░'.repeat(emptyLength);
    return `[${bar}]`;
}


module.exports = {
    data: new SlashCommandBuilder()
        .setName('imagine')
        .setDescription('Generate an image from a text prompt using AI.')
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
            option.setName('prompt')
                .setDescription('The image description/prompt to generate.')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('aspect_ratio')
                .setDescription('Aspect ratio of the generated image (default: 1:1)')
                .setRequired(false)
                .addChoices(
                    { name: '1:1 (Square)', value: '1:1' },
                    { name: '2:3', value: '2:3' },
                    { name: '3:4', value: '3:4' },
                    { name: '4:5', value: '4:5' },
                    { name: '9:16', value: '9:16' }
                ))
        .addStringOption(option =>
            option.setName('orientation')
                .setDescription('Image orientation (default: horizontal)')
                .setRequired(false)
                .addChoices(
                    { name: 'Horizontal', value: 'horizontal' },
                    { name: 'Vertical', value: 'vertical' }
                )),
    async execute(interaction) {
        console.log(`[Command] User ${interaction.user.id} (${interaction.user.tag}) used /imagine in channel ${interaction.channelId}`);

        const prompt = interaction.options.getString('prompt');
        const aspectRatio = interaction.options.getString('aspect_ratio') || '1:1';
        const orientation = interaction.options.getString('orientation') || 'horizontal';

        // Compute final aspect ratio based on orientation
        let finalAspectRatio = aspectRatio;
        if (orientation === 'vertical' && aspectRatio !== '1:1') {
            // Flip the aspect ratio for vertical orientation
            const [width, height] = aspectRatio.split(':');
            finalAspectRatio = `${height}:${width}`;
        }

        if (!config.imageGenModel) {
            await interaction.reply({
                content: '❌ Image generation is not configured.',
                ephemeral: true
            });
            return;
        }

        // Defer the reply since image generation can take time
        await interaction.deferReply();

        try {
            console.log(`[Imagine] Generating image with prompt: "${prompt}"`);

            const stream = await openai.chat.completions.create({
                model: config.imageGenModel,
                messages: [
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
                modalities: ['image'],
                image_config: {
                    aspect_ratio: finalAspectRatio,
                },
                stream: true,
            });

            console.log(`[Imagine] Using aspect ratio: ${finalAspectRatio} (original: ${aspectRatio}, orientation: ${orientation})`);

            let finalImageData = '';
            let lastUpdateTime = Date.now();
            let lastDisplayedImage = null;

            // Process the stream
            for await (const chunk of stream) {
                const delta = chunk.choices?.[0]?.delta;
                const contentDelta = delta?.content || '';

                // Accumulate final image data from content
                finalImageData += contentDelta;

                // Check for progressive images in delta.images
                if (delta?.images && delta.images.length > 0) {
                    // Get the latest progressive image
                    const latestImage = delta.images[delta.images.length - 1];
                    const imageUrl = latestImage.image_url?.url;

                    if (imageUrl) {
                        // Update Discord message every 3 seconds with the progressive image
                        const now = Date.now();
                        if (now - lastUpdateTime >= 3000) {
                            lastUpdateTime = now;
                            lastDisplayedImage = imageUrl;

                            try {
                                // Convert base64 data URL to Buffer if needed
                                let imageAttachment;
                                if (imageUrl.startsWith('data:')) {
                                    // Extract base64 from data URL (data:image/png;base64,...)
                                    const base64Data = imageUrl.split(',')[1];
                                    imageAttachment = Buffer.from(base64Data, 'base64');
                                } else if (imageUrl.startsWith('http')) {
                                    // If it's a regular URL, use it directly
                                    imageAttachment = imageUrl;
                                } else {
                                    // Assume it's raw base64
                                    imageAttachment = Buffer.from(imageUrl, 'base64');
                                }

                                await interaction.editReply({
                                    content: `**Generating image...**\n${prompt}\n\n⏳ *Progressive preview:*`,
                                    files: [{
                                        attachment: imageAttachment,
                                        name: 'progressive_image.png'
                                    }]
                                });
                                console.log(`[Imagine] Updated with progressive image from stream`);
                            } catch (err) {
                                console.error(`[Imagine] Error updating progressive image:`, err.message);
                            }
                        }
                    }
                }
            }

            // Use finalImageData if available, otherwise fall back to last displayed progressive image
            let imageData = finalImageData || lastDisplayedImage;

            if (!imageData) {
                throw new Error('No image data returned from API');
            }

            // Convert final image data to Buffer if it's base64
            let finalImageAttachment;
            if (imageData.startsWith('data:')) {
                // Extract base64 from data URL
                const base64Data = imageData.split(',')[1];
                finalImageAttachment = Buffer.from(base64Data, 'base64');
            } else if (imageData.startsWith('http')) {
                // If it's a URL, use it directly
                finalImageAttachment = imageData;
            } else {
                // Assume it's raw base64
                finalImageAttachment = Buffer.from(imageData, 'base64');
            }

            console.log(`[Imagine] Successfully generated image${finalImageData ? ' (converted from base64)' : ' (using URL)'}`);

            // Display the final image
            await interaction.editReply({
                content: ` **Generated image for:** ${prompt}`,
                files: [{
                    attachment: finalImageAttachment,
                    name: 'generated_image.png'
                }]
            });

        } catch (error) {
            console.error('[Imagine] Error generating image:', error);

            let errorMessage = '❌ Failed to generate image. ';

            if (error.response) {
                errorMessage += `API Error: ${error.response.data?.error?.message || error.message}`;
            } else if (error.message) {
                errorMessage += error.message;
            } else {
                errorMessage += 'Unknown error occurred.';
            }

            await interaction.editReply({
                content: errorMessage
            });
        }
    },
};
