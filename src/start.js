const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const RESTART_DELAY_MS = 3000;
const VLLM_POLL_INTERVAL_MS = 2000;
const VLLM_READY_TIMEOUT_MS_NATIVE = 180000;
const VLLM_READY_TIMEOUT_MS_DOCKER = 1800000;

let botProcess = null;
let vllmProcess = null;
let restartTimer = null;
let isShuttingDown = false;
let activeVllmRuntime = null;
let activeDockerContainerName = null;

const shouldStartVllm = process.argv.includes('--with-vllm') || process.env.VLLM_AUTOSTART === 'true';

function getVllmConfig() {
    const host = process.env.VLLM_HOST || '127.0.0.1';
    const port = process.env.VLLM_PORT || '8000';
    const modelPath = process.env.VLLM_MODEL_PATH || path.resolve(__dirname, '../tunedModel');
    const servedModelName = process.env.VLLM_MODEL || process.env.VLLM_SERVED_MODEL_NAME || 'local-group-model';
    const tokenizerPath = process.env.VLLM_TOKENIZER_PATH;
    const pythonBin = process.env.VLLM_PYTHON_BIN || 'python';
    const trustRemoteCode = process.env.VLLM_TRUST_REMOTE_CODE !== 'false';
    const apiKey = process.env.VLLM_API_KEY || '';
    const gpuMemoryUtilization = process.env.VLLM_GPU_MEMORY_UTILIZATION || 0.25;
    const runtime = process.env.VLLM_RUNTIME || (process.platform === 'win32' ? 'docker' : 'native');
    const dockerImage = process.env.VLLM_DOCKER_IMAGE || 'vllm/vllm-openai:latest';
    const dockerUseGpu = (process.env.VLLM_DOCKER_USE_GPU || 'true') === 'true';
    const dockerContainerName = process.env.VLLM_DOCKER_CONTAINER_NAME || 'leebot-vllm';

    return {
        host,
        port,
        modelPath,
        servedModelName,
        tokenizerPath,
        pythonBin,
        trustRemoteCode,
        apiKey,
        gpuMemoryUtilization,
        runtime,
        dockerImage,
        dockerUseGpu,
        dockerContainerName,
        baseUrl: `http://${host}:${port}/v1`,
        healthUrl: `http://${host}:${port}/v1/models`,
    };
}

function getVllmReadyTimeoutMs(runtime) {
    const configured = Number(process.env.VLLM_READY_TIMEOUT_MS);
    if (Number.isFinite(configured) && configured > 0) {
        return configured;
    }
    return runtime === 'docker' ? VLLM_READY_TIMEOUT_MS_DOCKER : VLLM_READY_TIMEOUT_MS_NATIVE;
}

function tryReadJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
        return null;
    }
}

function resolveTokenizerTarget({
    explicitTokenizerPath,
    modelPath,
    useLocalTokenizer,
    fallbackTokenizer,
}) {
    if (explicitTokenizerPath) {
        return { tokenizer: explicitTokenizerPath, reason: 'explicit' };
    }

    const tokenizerConfigPath = path.join(modelPath, 'tokenizer_config.json');
    const tokenizerConfig = tryReadJson(tokenizerConfigPath);
    const tokenizerClass = tokenizerConfig?.tokenizer_class;
    const hasLocalTokenizer = fs.existsSync(path.join(modelPath, 'tokenizer.json'));
    const unsupportedTokenizerClass = tokenizerClass === 'TokenizersBackend';

    if (unsupportedTokenizerClass && fallbackTokenizer) {
        return { tokenizer: fallbackTokenizer, reason: 'fallback' };
    }

    if (useLocalTokenizer && hasLocalTokenizer) {
        return { tokenizer: modelPath, reason: 'local' };
    }

    return { tokenizer: null, reason: 'default' };
}

function resolveModelPath(inputPath) {
    if (!fs.existsSync(inputPath)) {
        throw new Error(`VLLM model path does not exist: ${inputPath}`);
    }

    const adapterConfigPath = path.join(inputPath, 'adapter_config.json');
    if (fs.existsSync(adapterConfigPath)) {
        return inputPath;
    }

    const entries = fs.readdirSync(inputPath, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(inputPath, entry.name));

    const adapterDirs = entries.filter(dir => fs.existsSync(path.join(dir, 'adapter_config.json')));
    if (adapterDirs.length > 0) {
        adapterDirs.sort((a, b) => {
            const aStat = fs.statSync(a).mtimeMs;
            const bStat = fs.statSync(b).mtimeMs;
            return bStat - aStat;
        });
        return adapterDirs[0];
    }

    return inputPath;
}

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

function runDockerCommand(args) {
    return new Promise((resolve) => {
        const dockerCommand = spawn('docker', args, {
            cwd: path.resolve(__dirname, '..'),
            stdio: 'ignore',
        });

        dockerCommand.on('error', () => resolve());
        dockerCommand.on('exit', () => resolve());
    });
}

async function stopVllmDockerContainer() {
    if (!activeDockerContainerName) return;

    const containerName = activeDockerContainerName;
    activeDockerContainerName = null;

    console.log(`[Wrapper] Stopping Docker container ${containerName}...`);
    await runDockerCommand(['stop', containerName]);
    await runDockerCommand(['rm', '-f', containerName]);
}

async function stopProcesses() {
    if (botProcess && !botProcess.killed) {
        botProcess.kill();
    }

    if (vllmProcess && !vllmProcess.killed) {
        vllmProcess.kill();
    }

    if (activeVllmRuntime === 'docker') {
        await stopVllmDockerContainer();
    }

    botProcess = null;
    vllmProcess = null;
    activeVllmRuntime = null;
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

function startVllm() {
    const vllm = getVllmConfig();
    activeVllmRuntime = vllm.runtime;
    activeDockerContainerName = vllm.runtime === 'docker' ? vllm.dockerContainerName : null;
    const resolvedModelPath = resolveModelPath(vllm.modelPath);

    if (!resolvedModelPath) {
        throw new Error('VLLM_MODEL_PATH is required to start local vLLM server.');
    }

    const adapterConfigPath = path.join(resolvedModelPath, 'adapter_config.json');
    const adapterConfig = fs.existsSync(adapterConfigPath) ? tryReadJson(adapterConfigPath) : null;
    const isLoraAdapter = Boolean(adapterConfig?.base_model_name_or_path);

    const loraName = process.env.VLLM_LORA_NAME || vllm.servedModelName;
    const baseModel = process.env.VLLM_BASE_MODEL || adapterConfig?.base_model_name_or_path;
    const defaultTokenizerFallback = process.env.VLLM_TOKENIZER_FALLBACK || baseModel || 'LiquidAI/LFM2.5-1.2B-Instruct';
    const useAdapterTokenizer = process.env.VLLM_USE_ADAPTER_TOKENIZER === 'true';

    const { tokenizer: effectiveTokenizerPath, reason: tokenizerReason } = resolveTokenizerTarget({
        explicitTokenizerPath: vllm.tokenizerPath,
        modelPath: resolvedModelPath,
        useLocalTokenizer: useAdapterTokenizer,
        fallbackTokenizer: defaultTokenizerFallback,
    });

    if (isLoraAdapter && !baseModel) {
        throw new Error('Detected LoRA adapter but no base model was found. Set VLLM_BASE_MODEL.');
    }

    const args = [];

    if (isLoraAdapter) {
        process.env.VLLM_MODEL = loraName;
        if (!effectiveTokenizerPath) {
            console.log('[Wrapper] Using base model tokenizer for LoRA adapter (set VLLM_USE_ADAPTER_TOKENIZER=true to force local adapter tokenizer).');
        }
    } else {
        process.env.VLLM_MODEL = vllm.servedModelName;
    }

    if (tokenizerReason === 'fallback') {
        console.log(`[Wrapper] Local tokenizer is unsupported by transformers; falling back tokenizer to: ${effectiveTokenizerPath}`);
    }

    if (vllm.runtime === 'docker') {
        return startVllmDocker(vllm, {
            isLoraAdapter,
            baseModel,
            loraName,
            resolvedModelPath,
            effectiveTokenizerPath,
        });
    }

    args.push(
        '-m',
        'vllm.entrypoints.openai.api_server',
        '--host',
        vllm.host,
        '--port',
        String(vllm.port)
    );

    if (isLoraAdapter) {
        args.push(
            '--model',
            baseModel,
            '--served-model-name',
            `${loraName}-base`,
            '--enable-lora',
            '--lora-modules',
            `${loraName}=${resolvedModelPath}`
        );
    } else {
        args.push(
            '--model',
            resolvedModelPath,
            '--served-model-name',
            vllm.servedModelName
        );
    }

    if (effectiveTokenizerPath) {
        args.push('--tokenizer', effectiveTokenizerPath);
    }

    if (vllm.trustRemoteCode) {
        args.push('--trust-remote-code');
    }

    if (vllm.gpuMemoryUtilization) {
        args.push('--gpu-memory-utilization', String(vllm.gpuMemoryUtilization));
    }

    console.log(`[Wrapper] Starting vLLM server on ${vllm.baseUrl}`);
    if (isLoraAdapter) {
        console.log(`[Wrapper] Base model: ${baseModel}`);
        console.log(`[Wrapper] LoRA adapter path: ${resolvedModelPath}`);
        console.log(`[Wrapper] Active OpenAI model name: ${process.env.VLLM_MODEL}`);
    } else {
        console.log(`[Wrapper] Model path: ${resolvedModelPath}`);
    }

    vllmProcess = spawn(vllm.pythonBin, args, {
        cwd: path.resolve(__dirname, '..'),
        stdio: 'inherit',
        env: {
            ...process.env,
            VLLM_API_KEY: vllm.apiKey,
        },
    });

    vllmProcess.on('exit', (code, signal) => {
        if (isShuttingDown) return;
        if (signal) {
            scheduleRestart(`vLLM server was killed with signal: ${signal}`);
        } else {
            scheduleRestart(`vLLM server exited with code: ${code}`);
        }
    });

    vllmProcess.on('error', (err) => {
        if (isShuttingDown) return;
        scheduleRestart(`Failed to start vLLM server: ${err.message}`);
    });

    return waitForVllmReady(vllm.healthUrl, vllm.runtime);
}

function startVllmDocker(vllm, modelInfo) {
    const {
        isLoraAdapter,
        baseModel,
        loraName,
        resolvedModelPath,
        effectiveTokenizerPath,
    } = modelInfo;

    const dockerArgs = [
        'run',
        '--rm',
        '--name',
        vllm.dockerContainerName,
        '-p',
        `${vllm.port}:8000`,
    ];

    if (vllm.dockerUseGpu) {
        dockerArgs.push('--gpus', 'all');
    }

    if (isLoraAdapter) {
        dockerArgs.push('-v', `${resolvedModelPath}:/adapter:ro`);
        if (effectiveTokenizerPath && effectiveTokenizerPath !== resolvedModelPath) {
            dockerArgs.push('-v', `${effectiveTokenizerPath}:/tokenizer:ro`);
        }

        dockerArgs.push(
            vllm.dockerImage,
            '--host',
            '0.0.0.0',
            '--port',
            '8000',
            '--model',
            baseModel,
            '--served-model-name',
            `${loraName}-base`,
            '--enable-lora',
            '--lora-modules',
            `${loraName}=/adapter`
        );

        if (effectiveTokenizerPath) {
            const dockerTokenizerPath = effectiveTokenizerPath === resolvedModelPath ? '/adapter' : '/tokenizer';
            dockerArgs.push('--tokenizer', dockerTokenizerPath);
        }
    } else {
        dockerArgs.push('-v', `${resolvedModelPath}:/model:ro`);
        dockerArgs.push(
            vllm.dockerImage,
            '--host',
            '0.0.0.0',
            '--port',
            '8000',
            '--model',
            '/model',
            '--served-model-name',
            vllm.servedModelName
        );

        if (effectiveTokenizerPath) {
            dockerArgs.push('--tokenizer', '/model');
        }
    }

    if (vllm.trustRemoteCode) {
        dockerArgs.push('--trust-remote-code');
    }

    if (vllm.gpuMemoryUtilization) {
        dockerArgs.push('--gpu-memory-utilization', String(vllm.gpuMemoryUtilization));
    }

    console.log(`[Wrapper] Starting vLLM with Docker image ${vllm.dockerImage}`);

    vllmProcess = spawn('docker', dockerArgs, {
        cwd: path.resolve(__dirname, '..'),
        stdio: 'inherit',
        env: {
            ...process.env,
            VLLM_API_KEY: vllm.apiKey,
        },
    });

    vllmProcess.on('exit', (code, signal) => {
        if (isShuttingDown) return;
        if (signal) {
            scheduleRestart(`vLLM docker process was killed with signal: ${signal}`);
        } else {
            scheduleRestart(`vLLM docker process exited with code: ${code}`);
        }
    });

    vllmProcess.on('error', (err) => {
        if (isShuttingDown) return;
        scheduleRestart(`Failed to start vLLM docker process: ${err.message}`);
    });

    return waitForVllmReady(vllm.healthUrl, vllm.runtime);
}

async function waitForVllmReady(healthUrl, runtime) {
    const timeoutMs = getVllmReadyTimeoutMs(runtime);
    let start = Date.now();

    while (true) {
        if (isShuttingDown) return;

        try {
            const response = await fetch(healthUrl);
            if (response.ok) {
                console.log('[Wrapper] vLLM server is ready.');
                return;
            }
        } catch (_) {
        }

        if (Date.now() - start >= timeoutMs) {
            if (runtime === 'docker' && vllmProcess && vllmProcess.exitCode === null) {
                console.log(`[Wrapper] vLLM not ready after ${Math.floor(timeoutMs / 1000)}s, still waiting (Docker may still be pulling image/layers)...`);
                start = Date.now();
            } else {
                throw new Error(`Timed out waiting for vLLM readiness at ${healthUrl}`);
            }
        }

        await new Promise(resolve => setTimeout(resolve, VLLM_POLL_INTERVAL_MS));
    }
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
