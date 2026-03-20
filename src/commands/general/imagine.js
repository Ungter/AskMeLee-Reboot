const { SlashCommandBuilder, ApplicationIntegrationType, InteractionContextType } = require('discord.js');
const OpenAI = require('openai');
const config = require('../../config');

const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: config.openRouterApiKey,
});

const IMAGE_RESPONSE_FIELDS = new Set(['image_url', 'url', 'b64_json', 'base64', 'data']);

function looksLikeBase64(value) {
    return typeof value === 'string'
        && value.length > 100
        && /^[A-Za-z0-9+/=\r\n]+$/.test(value);
}

function extractImageCandidates(value, results = []) {
    if (!value) {
        return results;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();

        if (
            trimmed.startsWith('data:image/')
            || trimmed.startsWith('http://')
            || trimmed.startsWith('https://')
            || looksLikeBase64(trimmed)
        ) {
            results.push(trimmed);
        }

        return results;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            extractImageCandidates(item, results);
        }
        return results;
    }

    if (typeof value === 'object') {
        for (const [key, nestedValue] of Object.entries(value)) {
            if (IMAGE_RESPONSE_FIELDS.has(key)) {
                extractImageCandidates(nestedValue, results);
                continue;
            }

            if (nestedValue && typeof nestedValue === 'object') {
                extractImageCandidates(nestedValue, results);
            }
        }
    }

    return results;
}

function toDiscordAttachment(imageData) {
    if (!imageData) {
        return null;
    }

    if (imageData.startsWith('data:')) {
        const base64Data = imageData.split(',')[1];
        return Buffer.from(base64Data, 'base64');
    }

    if (imageData.startsWith('http://') || imageData.startsWith('https://')) {
        return imageData;
    }

    return Buffer.from(imageData, 'base64');
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

            const response = await openai.chat.completions.create({
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
            });

            console.log(`[Imagine] Using aspect ratio: ${finalAspectRatio} (original: ${aspectRatio}, orientation: ${orientation})`);

            const imageCandidates = extractImageCandidates(response);
            const imageData = imageCandidates.at(-1) || null;

            if (!imageData) {
                throw new Error('No image data returned from API');
            }

            const finalImageAttachment = toDiscordAttachment(imageData);

            console.log(`[Imagine] Successfully generated image${typeof imageData === 'string' && imageData.startsWith('http') ? ' (using URL)' : ' (using encoded image data)'}`);

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
