const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const config = require('./config');

const localClient = new OpenAI({
    baseURL: config.vllmBaseUrl,
    apiKey: config.vllmApiKey || 'not-required',
});

const STREAM_TIMEOUT_MS = 30000;
const VLLM_POLL_INTERVAL_MS = 2000;
const VLLM_READY_TIMEOUT_MS_NATIVE = 180000;
const VLLM_READY_TIMEOUT_MS_DOCKER = 1800000;

let activeVllmProcess = null;
let activeVllmRuntime = null;
let activeDockerContainerName = null;
let isStopping = false;

function getVllmConfig() {
    const host = process.env.VLLM_HOST || '127.0.0.1';
    const port = process.env.VLLM_PORT || '8000';
    const modelPath = process.env.VLLM_MODEL_PATH || path.resolve(__dirname, '../tunedModel');
    const servedModelName = process.env.VLLM_MODEL || process.env.VLLM_SERVED_MODEL_NAME || 'local-group-model';
    const ggufFile = process.env.VLLM_GGUF_FILE || config.vllmGgufFile || 'tunedModel-q6_k.gguf';
    const tokenizerPath = process.env.VLLM_TOKENIZER_PATH;
    const pythonBin = process.env.VLLM_PYTHON_BIN || 'python';
    const trustRemoteCode = process.env.VLLM_TRUST_REMOTE_CODE !== 'false';
    const apiKey = process.env.VLLM_API_KEY || '';
    const gpuMemoryUtilization = process.env.VLLM_GPU_MEMORY_UTILIZATION || 0.2;
    const maxModelLen = process.env.VLLM_MAX_MODEL_LEN || 8192;
    const enforceEager = process.env.VLLM_ENFORCE_EAGER !== 'false';
    const runtime = process.env.VLLM_RUNTIME || (process.platform === 'win32' ? 'docker' : 'native');
    const dockerImage = process.env.VLLM_DOCKER_IMAGE || 'vllm/vllm-openai:latest';
    const dockerUseGpu = (process.env.VLLM_DOCKER_USE_GPU || 'true') === 'true';
    const dockerContainerName = process.env.VLLM_DOCKER_CONTAINER_NAME || 'leebot-vllm';

    return {
        host,
        port,
        modelPath,
        servedModelName,
        ggufFile,
        tokenizerPath,
        pythonBin,
        trustRemoteCode,
        apiKey,
        gpuMemoryUtilization,
        maxModelLen,
        enforceEager,
        runtime,
        dockerImage,
        dockerUseGpu,
        dockerContainerName,
        baseUrl: `http://${host}:${port}/v1`,
        healthUrl: `http://${host}:${port}/v1/models`,
    };
}

function tryReadJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
        return null;
    }
}

/**
 * Resolve model path, detecting GGUF quantized models, LoRA adapters, or base directories.
 * @param {string} inputPath
 * @param {string} [requestedGgufFile]
 */
function resolveModelInfo(inputPath, requestedGgufFile) {
    if (!fs.existsSync(inputPath)) {
        throw new Error(`VLLM model path does not exist: ${inputPath}`);
    }

    const stat = fs.statSync(inputPath);

    if (stat.isFile()) {
        if (inputPath.toLowerCase().endsWith('.gguf')) {
            return {
                isGguf: true,
                isLoraAdapter: false,
                modelFilePath: inputPath,
                modelDir: path.dirname(inputPath),
                ggufFileName: path.basename(inputPath),
                resolvedModelPath: inputPath,
            };
        }
        return {
            isGguf: false,
            isLoraAdapter: false,
            modelFilePath: inputPath,
            modelDir: path.dirname(inputPath),
            ggufFileName: null,
            resolvedModelPath: inputPath,
        };
    }

    if (stat.isDirectory()) {
        const entries = fs.readdirSync(inputPath, { withFileTypes: true });

        // 1. Look for GGUF files in directory
        const ggufEntries = entries
            .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.gguf'))
            .map(e => e.name);

        let selectedGguf = null;
        if (requestedGgufFile && ggufEntries.includes(requestedGgufFile)) {
            selectedGguf = requestedGgufFile;
        } else if (requestedGgufFile && ggufEntries.some(f => f.toLowerCase() === requestedGgufFile.toLowerCase())) {
            selectedGguf = ggufEntries.find(f => f.toLowerCase() === requestedGgufFile.toLowerCase());
        } else if (ggufEntries.length > 0) {
            // Prioritize Q6 quantization if present
            const q6 = ggufEntries.find(f => f.toLowerCase().includes('q6'));
            selectedGguf = q6 || ggufEntries[0];
        }

        if (selectedGguf) {
            return {
                isGguf: true,
                isLoraAdapter: false,
                modelFilePath: path.join(inputPath, selectedGguf),
                modelDir: inputPath,
                ggufFileName: selectedGguf,
                resolvedModelPath: path.join(inputPath, selectedGguf),
            };
        }

        // 2. Check for adapter_config.json (LoRA)
        const adapterConfigPath = path.join(inputPath, 'adapter_config.json');
        if (fs.existsSync(adapterConfigPath)) {
            return {
                isGguf: false,
                isLoraAdapter: true,
                modelFilePath: inputPath,
                modelDir: inputPath,
                ggufFileName: null,
                resolvedModelPath: inputPath,
            };
        }

        // 3. Subdirectories for adapters
        const subDirs = entries
            .filter(e => e.isDirectory())
            .map(e => path.join(inputPath, e.name));
        const adapterDirs = subDirs.filter(d => fs.existsSync(path.join(d, 'adapter_config.json')));
        if (adapterDirs.length > 0) {
            adapterDirs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
            return {
                isGguf: false,
                isLoraAdapter: true,
                modelFilePath: adapterDirs[0],
                modelDir: adapterDirs[0],
                ggufFileName: null,
                resolvedModelPath: adapterDirs[0],
            };
        }

        // 4. Default directory weights (safetensors, etc.)
        return {
            isGguf: false,
            isLoraAdapter: false,
            modelFilePath: inputPath,
            modelDir: inputPath,
            ggufFileName: null,
            resolvedModelPath: inputPath,
        };
    }

    throw new Error(`Unsupported model path type: ${inputPath}`);
}

function resolveTokenizerTarget({
    explicitTokenizerPath,
    modelDir,
    useLocalTokenizer,
    fallbackTokenizer,
    isGguf,
}) {
    if (explicitTokenizerPath) {
        return { tokenizer: explicitTokenizerPath, reason: 'explicit' };
    }

    const tokenizerConfigPath = path.join(modelDir, 'tokenizer_config.json');
    const tokenizerConfig = tryReadJson(tokenizerConfigPath);
    const tokenizerClass = tokenizerConfig?.tokenizer_class;
    const hasLocalTokenizer = fs.existsSync(path.join(modelDir, 'tokenizer.json'));
    const unsupportedTokenizerClass = tokenizerClass === 'TokenizersBackend';

    if (unsupportedTokenizerClass && fallbackTokenizer) {
        return { tokenizer: fallbackTokenizer, reason: 'fallback' };
    }

    if ((isGguf || useLocalTokenizer) && hasLocalTokenizer) {
        return { tokenizer: modelDir, reason: 'local' };
    }

    return { tokenizer: null, reason: 'default' };
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

async function stopVllmDockerContainer(containerName) {
    if (!containerName) return;
    console.log(`[localAi] Stopping Docker container ${containerName}...`);
    await runDockerCommand(['stop', containerName]);
    await runDockerCommand(['rm', '-f', containerName]);
}

async function stopVllm() {
    isStopping = true;
    if (activeVllmProcess && !activeVllmProcess.killed) {
        activeVllmProcess.kill();
    }
    if (activeDockerContainerName) {
        await stopVllmDockerContainer(activeDockerContainerName);
    }
    activeVllmProcess = null;
    activeDockerContainerName = null;
    activeVllmRuntime = null;
    isStopping = false;
}

function buildVllmDockerArgs(vllm, modelInfo) {
    const {
        isLoraAdapter,
        isGguf,
        ggufFileName,
        baseModel,
        loraName,
        modelDir,
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

    if (isGguf) {
        // Mount model directory
        dockerArgs.push('-v', `${modelDir.replace(/\\/g, '/')}:/model:ro`);

        // Mount upstream bugfix patches for LFM2 GGUF if available
        const patchesDir = path.resolve(__dirname, '../vllm_patches');
        const lfm2Patch = path.join(patchesDir, 'lfm2.py');
        const shortConvPatch = path.join(patchesDir, 'short_conv.py');
        if (fs.existsSync(lfm2Patch)) {
            dockerArgs.push('-v', `${lfm2Patch.replace(/\\/g, '/')}:/usr/local/lib/python3.12/dist-packages/vllm/model_executor/models/lfm2.py:ro`);
        }
        if (fs.existsSync(shortConvPatch)) {
            dockerArgs.push('-v', `${shortConvPatch.replace(/\\/g, '/')}:/usr/local/lib/python3.12/dist-packages/vllm/model_executor/layers/mamba/short_conv.py:ro`);
        }

        // Run via shell to ensure gguf>=0.19.0 (container default 0.17.1 does not support LFM2 architecture)
        dockerArgs.push('--entrypoint', '/bin/sh');
        dockerArgs.push(vllm.dockerImage);
        dockerArgs.push('-c');

        const vllmCmd = [
            'exec vllm serve',
            `/model/${ggufFileName}`,
            '--tokenizer /model',
            '--hf-config-path /model',
            '--served-model-name', vllm.servedModelName,
            '--dtype bfloat16',
            '--host 0.0.0.0',
            '--port 8000',
        ];

        const chatTemplatePath = path.join(modelDir, 'chat_template.jinja');
        if (fs.existsSync(chatTemplatePath)) {
            vllmCmd.push('--chat-template /model/chat_template.jinja');
        }

        if (vllm.enforceEager) {
            vllmCmd.push('--enforce-eager');
        }

        if (vllm.gpuMemoryUtilization) {
            vllmCmd.push(`--gpu-memory-utilization ${vllm.gpuMemoryUtilization}`);
        }

        if (vllm.maxModelLen) {
            vllmCmd.push(`--max-model-len ${vllm.maxModelLen}`);
        }

        if (vllm.trustRemoteCode) {
            vllmCmd.push('--trust-remote-code');
        }

        const shCmd = `pip install -q --no-cache-dir gguf==0.19.0 && ${vllmCmd.join(' ')}`;
        dockerArgs.push(shCmd);
        return dockerArgs;
    } else if (isLoraAdapter) {
        dockerArgs.push('-v', `${modelDir}:/adapter:ro`);
        if (effectiveTokenizerPath && effectiveTokenizerPath !== modelDir) {
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
            const dockerTokenizerPath = effectiveTokenizerPath === modelDir ? '/adapter' : '/tokenizer';
            dockerArgs.push('--tokenizer', dockerTokenizerPath);
        }
    } else {
        dockerArgs.push('-v', `${modelDir}:/model:ro`);
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

    if (vllm.enforceEager) {
        dockerArgs.push('--enforce-eager');
    }

    if (vllm.maxModelLen) {
        dockerArgs.push('--max-model-len', String(vllm.maxModelLen));
    }

    return dockerArgs;
}

function buildVllmNativeArgs(vllm, modelInfo) {
    const {
        isLoraAdapter,
        isGguf,
        modelFilePath,
        baseModel,
        loraName,
        modelDir,
        effectiveTokenizerPath,
    } = modelInfo;

    const args = [
        '-m',
        'vllm.entrypoints.openai.api_server',
        '--host',
        vllm.host,
        '--port',
        String(vllm.port),
    ];

    if (isGguf) {
        args.push(
            '--model',
            modelFilePath,
            '--hf-config-path',
            modelDir,
            '--served-model-name',
            vllm.servedModelName,
            '--dtype',
            'bfloat16'
        );
        if (effectiveTokenizerPath) {
            args.push('--tokenizer', effectiveTokenizerPath);
        }
        const chatTemplatePath = path.join(modelDir, 'chat_template.jinja');
        if (fs.existsSync(chatTemplatePath)) {
            args.push('--chat-template', chatTemplatePath);
        }
    } else if (isLoraAdapter) {
        args.push(
            '--model',
            baseModel,
            '--served-model-name',
            `${loraName}-base`,
            '--enable-lora',
            '--lora-modules',
            `${loraName}=${modelDir}`
        );
        if (effectiveTokenizerPath) {
            args.push('--tokenizer', effectiveTokenizerPath);
        }
    } else {
        args.push(
            '--model',
            modelDir,
            '--served-model-name',
            vllm.servedModelName
        );
        if (effectiveTokenizerPath) {
            args.push('--tokenizer', effectiveTokenizerPath);
        }
    }

    if (vllm.trustRemoteCode) {
        args.push('--trust-remote-code');
    }

    if (vllm.gpuMemoryUtilization) {
        args.push('--gpu-memory-utilization', String(vllm.gpuMemoryUtilization));
    }

    if (vllm.enforceEager) {
        args.push('--enforce-eager');
    }

    if (vllm.maxModelLen) {
        args.push('--max-model-len', String(vllm.maxModelLen));
    }

    return args;
}

async function waitForVllmReady(healthUrl, runtime, timeoutMs) {
    const effectiveTimeout = timeoutMs || (runtime === 'docker' ? VLLM_READY_TIMEOUT_MS_DOCKER : VLLM_READY_TIMEOUT_MS_NATIVE);
    let start = Date.now();

    while (true) {
        if (isStopping) return false;

        try {
            const response = await fetch(healthUrl);
            if (response.ok) {
                console.log('[localAi] vLLM server is ready.');
                return true;
            }
        } catch (_) {
        }

        if (Date.now() - start >= effectiveTimeout) {
            if (runtime === 'docker' && activeVllmProcess && activeVllmProcess.exitCode === null) {
                console.log(`[localAi] vLLM not ready after ${Math.floor(effectiveTimeout / 1000)}s, still waiting (Docker may still be initializing)...`);
                start = Date.now();
            } else {
                throw new Error(`Timed out waiting for vLLM readiness at ${healthUrl}`);
            }
        }

        await new Promise(resolve => setTimeout(resolve, VLLM_POLL_INTERVAL_MS));
    }
}

async function isVllmReady(healthUrl) {
    try {
        const url = healthUrl || getVllmConfig().healthUrl;
        const res = await fetch(url);
        return res.ok;
    } catch {
        return false;
    }
}

/**
 * Start vLLM serving the configured model (GGUF, LoRA, or full weights).
 * @param {Object} [customConfig]
 */
async function startVllm(customConfig = {}) {
    const vllm = { ...getVllmConfig(), ...customConfig };
    activeVllmRuntime = vllm.runtime;
    activeDockerContainerName = vllm.runtime === 'docker' ? vllm.dockerContainerName : null;

    const modelInfo = resolveModelInfo(vllm.modelPath, vllm.ggufFile);
    const adapterConfigPath = path.join(modelInfo.modelDir, 'adapter_config.json');
    const adapterConfig = fs.existsSync(adapterConfigPath) ? tryReadJson(adapterConfigPath) : null;
    const isLoraAdapter = modelInfo.isLoraAdapter || Boolean(adapterConfig?.base_model_name_or_path);

    const loraName = process.env.VLLM_LORA_NAME || vllm.servedModelName;
    const baseModel = process.env.VLLM_BASE_MODEL || adapterConfig?.base_model_name_or_path;
    const defaultTokenizerFallback = process.env.VLLM_TOKENIZER_FALLBACK || baseModel || 'LiquidAI/LFM2.5-1.2B-Instruct';
    const useAdapterTokenizer = process.env.VLLM_USE_ADAPTER_TOKENIZER === 'true';

    const { tokenizer: effectiveTokenizerPath, reason: tokenizerReason } = resolveTokenizerTarget({
        explicitTokenizerPath: vllm.tokenizerPath,
        modelDir: modelInfo.modelDir,
        useLocalTokenizer: useAdapterTokenizer,
        fallbackTokenizer: defaultTokenizerFallback,
        isGguf: modelInfo.isGguf,
    });

    if (isLoraAdapter && !baseModel) {
        throw new Error('Detected LoRA adapter but no base model was found. Set VLLM_BASE_MODEL.');
    }

    if (isLoraAdapter) {
        process.env.VLLM_MODEL = loraName;
        if (!effectiveTokenizerPath) {
            console.log('[localAi] Using base model tokenizer for LoRA adapter.');
        }
    } else {
        process.env.VLLM_MODEL = vllm.servedModelName;
    }

    if (tokenizerReason === 'fallback') {
        console.log(`[localAi] Local tokenizer fallback: ${effectiveTokenizerPath}`);
    }

    console.log(`[localAi] Serving mode: ${modelInfo.isGguf ? 'GGUF Quantized (' + modelInfo.ggufFileName + ')' : (isLoraAdapter ? 'LoRA Adapter' : 'Standard')}`);
    console.log(`[localAi] Runtime: ${vllm.runtime}`);
    console.log(`[localAi] Model path: ${modelInfo.modelFilePath}`);
    console.log(`[localAi] Served model name: ${process.env.VLLM_MODEL}`);

    if (vllm.runtime === 'docker') {
        await stopVllmDockerContainer(vllm.dockerContainerName);

        const dockerArgs = buildVllmDockerArgs(vllm, {
            ...modelInfo,
            isLoraAdapter,
            baseModel,
            loraName,
            effectiveTokenizerPath,
        });

        console.log(`[localAi] Starting vLLM with Docker image ${vllm.dockerImage}`);

        activeVllmProcess = spawn('docker', dockerArgs, {
            cwd: path.resolve(__dirname, '..'),
            stdio: 'inherit',
            env: {
                ...process.env,
                VLLM_API_KEY: vllm.apiKey,
            },
        });

        activeVllmProcess.on('exit', (code, signal) => {
            if (isStopping) return;
            console.error(`[localAi] Docker vLLM exited (code: ${code}, signal: ${signal})`);
        });

        activeVllmProcess.on('error', (err) => {
            if (isStopping) return;
            console.error(`[localAi] Failed to start Docker vLLM: ${err.message}`);
        });

        await waitForVllmReady(vllm.healthUrl, vllm.runtime);
        return activeVllmProcess;
    }

    const nativeArgs = buildVllmNativeArgs(vllm, {
        ...modelInfo,
        isLoraAdapter,
        baseModel,
        loraName,
        effectiveTokenizerPath,
    });

    console.log(`[localAi] Starting native vLLM process...`);
    activeVllmProcess = spawn(vllm.pythonBin, nativeArgs, {
        cwd: path.resolve(__dirname, '..'),
        stdio: 'inherit',
        env: {
            ...process.env,
            VLLM_API_KEY: vllm.apiKey,
        },
    });

    activeVllmProcess.on('exit', (code, signal) => {
        if (isStopping) return;
        console.error(`[localAi] Native vLLM exited (code: ${code}, signal: ${signal})`);
    });

    activeVllmProcess.on('error', (err) => {
        if (isStopping) return;
        console.error(`[localAi] Failed to start native vLLM: ${err.message}`);
    });

    await waitForVllmReady(vllm.healthUrl, vllm.runtime);
    return activeVllmProcess;
}

/**
 * Stream a response from a local vLLM OpenAI-compatible endpoint.
 * @param {Array<{role: string, content: string}>} messages
 * @param {function(string, string, {total_tokens:number, reasoning_tokens:number}|null): void} onUpdate
 */
async function streamLocalResponse(messages, onUpdate) {
    const modelToUse = config.vllmModel || process.env.VLLM_MODEL || 'local-group-model';
    if (!config.vllmBaseUrl) {
        throw new Error('Missing VLLM_BASE_URL configuration.');
    }

    let stream;
    try {
        stream = await localClient.chat.completions.create({
            model: modelToUse,
            messages: [
                ...messages,
            ],
            temperature: 0.1,
            //top_p: 0.95,
            max_tokens: 200,
            repetition_penalty: 1.16,
            //frequency_penalty: 0.13,
            stream: true,
            stream_options: { include_usage: true },
        });
    } catch (err) {
        if (err.name === 'APIConnectionError' || err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED' || err.message?.includes('Connection') || err.message?.includes('fetch failed')) {
            throw new Error(`Cannot reach vLLM server at ${config.vllmBaseUrl}. Ensure vLLM is running (e.g. npm run serve:local or npm run start:local).`);
        }
        throw err;
    }

    let fullContent = '';
    let usage = null;
    let lastChunkTime = Date.now();

    for await (const chunk of stream) {
        const now = Date.now();
        if (now - lastChunkTime > STREAM_TIMEOUT_MS) {
            console.error(`[vLLM] Stream timed out after ${STREAM_TIMEOUT_MS}ms between chunks`);
            break;
        }
        lastChunkTime = now;

        const delta = chunk.choices?.[0]?.delta || {};
        const contentDelta = delta.content || '';

        if (chunk.usage) {
            usage = {
                total_tokens: chunk.usage.total_tokens,
                reasoning_tokens: 0,
            };
        }

        fullContent += contentDelta;
        onUpdate(fullContent, '', usage);
    }
}

// Standalone CLI execution: "node src/localAi.js"
if (require.main === module) {
    console.log('[localAi] Starting vLLM to serve local model...');

    const shutdown = async (signal) => {
        console.log(`\n[localAi] Received ${signal}, stopping vLLM server...`);
        await stopVllm();
        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    startVllm().then(() => {
        const vllm = getVllmConfig();
        console.log(`[localAi] Model is actively being served on ${vllm.baseUrl}`);
        console.log(`[localAi] Press Ctrl+C to stop.`);
    }).catch(async (err) => {
        console.error(`[localAi] Failed to serve model on vLLM: ${err.message}`);
        await stopVllm();
        process.exit(1);
    });
}

module.exports = {
    streamLocalResponse,
    getVllmConfig,
    resolveModelInfo,
    resolveTokenizerTarget,
    buildVllmDockerArgs,
    buildVllmNativeArgs,
    startVllm,
    stopVllm,
    isVllmReady,
    waitForVllmReady,
};

