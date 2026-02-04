const { spawn } = require('child_process');
const path = require('path');

const RESTART_DELAY_MS = 3000;

function startBot() {
    console.log('[Wrapper] Starting bot...');

    const bot = spawn('node', ['index.js'], {
        cwd: __dirname,
        stdio: 'inherit'
    });

    bot.on('exit', (code, signal) => {
        if (signal) {
            console.log(`[Wrapper] Bot was killed with signal: ${signal}`);
        } else {
            console.log(`[Wrapper] Bot exited with code: ${code}`);
        }

        console.log(`[Wrapper] Restarting in ${RESTART_DELAY_MS / 1000} seconds...`);
        setTimeout(startBot, RESTART_DELAY_MS);
    });

    bot.on('error', (err) => {
        console.error('[Wrapper] Failed to start bot:', err);
        console.log(`[Wrapper] Retrying in ${RESTART_DELAY_MS / 1000} seconds...`);
        setTimeout(startBot, RESTART_DELAY_MS);
    });
}


process.on('SIGINT', () => {
    console.log('[Wrapper] Received SIGINT, shutting down...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('[Wrapper] Received SIGTERM, shutting down...');
    process.exit(0);
});

startBot();
