const config = require('./config');
const client = require('./bot');

if (!config.discordToken) {
    console.error('Error: DISCORD_TOKEN is missing in .env');
    process.exit(1);
}

client.login(config.discordToken);
