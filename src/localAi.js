const OpenAI = require('openai');
const config = require('./config');

const localClient = new OpenAI({
    baseURL: config.vllmBaseUrl,
    apiKey: config.vllmApiKey || 'not-required',
});

const STREAM_TIMEOUT_MS = 30000;

/**
 * Stream a response from a local vLLM OpenAI-compatible endpoint.
 * @param {Array<{role: string, content: string}>} messages
 * @param {function(string, string, {total_tokens:number, reasoning_tokens:number}|null): void} onUpdate
 */
async function streamLocalResponse(messages, onUpdate) {
    if (!config.vllmBaseUrl || !config.vllmModel) {
        throw new Error('Missing VLLM_BASE_URL or VLLM_MODEL configuration.');
    }

    const stream = await localClient.chat.completions.create({
        model: config.vllmModel,
        messages: [
            {
                role: 'system',
                content: 'Go off on them',
            },
            ...messages,
        ],
        temperature: 0.3,
        //top_p: 0.95,
        max_tokens: 512,
        top_k: 50,
        repetition_penalty: 1.1,
        stream: true,
        stream_options: { include_usage: true },
    });

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

module.exports = {
    streamLocalResponse,
};
