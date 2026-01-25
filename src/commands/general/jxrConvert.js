const { SlashCommandBuilder, ApplicationIntegrationType, InteractionContextType, AttachmentBuilder } = require('discord.js');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('jxrconvert')
        .setDescription('Convert a .jxr image file to PNG format.')
        .setIntegrationTypes([
            ApplicationIntegrationType.GuildInstall,
            ApplicationIntegrationType.UserInstall
        ])
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ])
        .addAttachmentOption(option =>
            option.setName('jxr_file')
                .setDescription('The .jxr file to convert')
                .setRequired(true)),

    async execute(interaction) {
        const attachment = interaction.options.getAttachment('jxr_file');

        if (!attachment.name.toLowerCase().endsWith('.jxr')) {
            return interaction.reply({
                content: '❌ Please provide a valid `.jxr` file.',
                ephemeral: true
            });
        }

        await interaction.deferReply();

        const helperExePath = path.join(__dirname, '..', '..', 'helperExe');
        const exePath = path.join(helperExePath, 'jxr_to_png.exe');
        const tempDir = os.tmpdir();
        const tempInputPath = path.join(tempDir, `jxr_temp_${Date.now()}.jxr`);
        const tempOutputPath = path.join(tempDir, `jxr_output_${Date.now()}.png`);

        try {
            await downloadFile(attachment.url, tempInputPath);
            console.log(`[JXR Convert] Downloaded file to: ${tempInputPath}`);

            await new Promise((resolve, reject) => {
                const command = `"${exePath}" "${tempInputPath}" "${tempOutputPath}"`;
                console.log(`[JXR Convert] Running: ${command}`);

                exec(command, { cwd: helperExePath }, (error, stdout, stderr) => {
                    if (error) {
                        console.error(`[JXR Convert] Error: ${error.message}`);
                        console.error(`[JXR Convert] stderr: ${stderr}`);
                        reject(new Error(`Conversion failed: ${error.message}`));
                        return;
                    }
                    if (stdout) console.log(`[JXR Convert] stdout: ${stdout}`);
                    if (stderr) console.log(`[JXR Convert] stderr: ${stderr}`);
                    resolve();
                });
            });

            if (!fs.existsSync(tempOutputPath)) {
                throw new Error('Conversion completed but output file was not created.');
            }
            const outputAttachment = new AttachmentBuilder(tempOutputPath, {
                name: attachment.name.replace(/\.jxr$/i, '.png')
            });

            await interaction.editReply({
                content: `✅ Successfully converted \`${attachment.name}\` to PNG!`,
                files: [outputAttachment]
            });

        } catch (error) {
            console.error(`[JXR Convert] Failed:`, error);
            await interaction.editReply({
                content: `❌ Failed to convert the file: ${error.message}`
            });
        } finally {
            try {
                if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
                if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
            } catch (cleanupError) {
                console.error(`[JXR Convert] Cleanup error:`, cleanupError);
            }
        }
    }
};


//Download a file from a URL to a local path
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(destPath);

        protocol.get(url, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                file.close();
                fs.unlinkSync(destPath);
                return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
            }

            if (response.statusCode !== 200) {
                file.close();
                fs.unlinkSync(destPath);
                reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
                return;
            }

            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (error) => {
            file.close();
            if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
            reject(error);
        });
    });
}
