const { spawn } = require('child_process');
const path = require('path');
const { startVllm, stopVllm } = require('./localAi');

const RESTART_DELAY_MS = 3000;

let botProcess = null;
let restartTimer = null;
let isShuttingDown = false;

const shouldStartVllm = process.argv.includes('--with-vllm') || process.env.VLLM_AUTOSTART === 'true';

function scheduleRestart(reason) {
    if (isShuttingDown || restartTimer) return;
    console.log(`[Wrapper] ${reason}`);
    console.log(`[Wrapper] Restarting stack in ${RESTART_DELAY_MS / 1000} seconds...`);
    stopProcesses().finally(() => {
        restartTimer = setTimeout(() => {
            restartTimer = null;
            startStack();
        }, RESTART_DELAY_MS);
    });
}

async function stopProcesses() {
    if (botProcess && !botProcess.killed) {
        botProcess.kill();
    }
    await stopVllm();
    botProcess = null;
}

function startBot() {
    console.log('[Wrapper] Starting bot...');

    botProcess = spawn('node', ['index.js'], {
        cwd: __dirname,
        stdio: 'inherit'
    });

    botProcess.on('exit', (code, signal) => {
        if (isShuttingDown) return;
        if (signal) {
            scheduleRestart(`Bot was killed with signal: ${signal}`);
        } else {
            scheduleRestart(`Bot exited with code: ${code}`);
        }
    });

    botProcess.on('error', (err) => {
        if (isShuttingDown) return;
        scheduleRestart(`Failed to start bot: ${err.message}`);
    });
}


async function startStack() {
    try {
        if (shouldStartVllm) {
            await startVllm();
        }
        startBot();
    } catch (err) {
        scheduleRestart(err.message);
    }
}
process.on('SIGINT', () => {
    console.log('[Wrapper] Received SIGINT, shutting down...');
    isShuttingDown = true;
    stopProcesses().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
    console.log('[Wrapper] Received SIGTERM, shutting down...');
    isShuttingDown = true;
    stopProcesses().finally(() => process.exit(0));
});

startStack();
