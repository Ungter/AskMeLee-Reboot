const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { joinVC, isConnected } = require('../../voice/voiceManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('join-vc')
        .setDescription('Join your current voice channel to listen for "Hey Lee" commands'),

    async execute(interaction) {
        // Check if user is in a voice channel
        const member = interaction.member;
        const voiceChannel = member.voice?.channel;

        if (!voiceChannel) {
            await interaction.reply({
                content: '❌ You need to be in a voice channel first!',
                ephemeral: true,
            });
            return;
        }

        // Check if it's a valid voice channel type
        if (voiceChannel.type !== ChannelType.GuildVoice && voiceChannel.type !== ChannelType.GuildStageVoice) {
            await interaction.reply({
                content: '❌ Invalid channel type.',
                ephemeral: true,
            });
            return;
        }

        // Check if already connected
        if (isConnected(interaction.guildId)) {
            await interaction.reply({
                content: '🎤 I\'m already in a voice channel! Use `/leave-vc` first if you want me to move.',
                ephemeral: true,
            });
            return;
        }

        await interaction.deferReply();

        try {
            // Join the voice channel
            await joinVC(voiceChannel, interaction.channel);

            await interaction.editReply({
                content: `🎤 **Joined ${voiceChannel.name}!**\n\nI'm now listening. Say **"Hey Lee"** followed by your question or command to interact with me.\n\nExamples:\n• "Hey Lee, what's the weather like?"\n• "Hey Lee, tell me a joke"\n• "Hey Lee, what time is it?"`,
            });
        } catch (error) {
            console.error('[JoinVC] Error:', error);
            let errorMsg = '❌ Failed to join the voice channel.';

            if (error.code === 'ABORT_ERR') {
                errorMsg += '\n\n**Possible causes:**\n• Bot may lack "Connect" permission in that channel\n• Network connectivity issues\n• Try again in a few seconds';
            }

            await interaction.editReply({ content: errorMsg });
        }
    },
};
