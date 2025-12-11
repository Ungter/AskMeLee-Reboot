const OpenAI = require('openai');
const config = require('./config');

const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: config.openRouterApiKey,
});

/**
 * Check if a query needs online/web search using a lightweight classifier model.
 * Uses structured outputs for reliable parsing.
 * @param {string} query - The user's query
 * @returns {Promise<boolean>} - True if online search is needed
 */
async function needsOnlineSearch(query) {
    try {
        const response = await openai.chat.completions.create({
            model: config.classifierModel,
            messages: [
                {
                    role: 'system',
                    content: `You are a classifier that determines if a user query requires real-time or up-to-date information from the internet.

                            Answer YES if the query asks about:
                            - Current events, news, or recent happenings
                            - Live data (weather, stock prices, cryptocurrency prices, sports scores)
                            - Information that changes frequently and needs to be current
                            - Specific current dates, times, or schedules
                            - Recent releases, updates, or announcements

                            Answer NO if the query asks about:
                            - General knowledge, facts, or concepts
                            - Historical information
                            - Math problems or calculations
                            - Creative writing or brainstorming
                            - Code help or programming questions
                            - Personal advice or opinions
                            - Explanations of how things work`
                },
                {
                    role: 'user',
                    content: query
                }
            ],
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: 'online_check',
                    strict: true,
                    schema: {
                        type: 'object',
                        properties: {
                            needs_online: {
                                type: 'boolean',
                                description: 'Whether the query requires real-time internet data'
                            },
                            reason: {
                                type: 'string',
                                description: 'Brief reason for the decision'
                            }
                        },
                        required: ['needs_online', 'reason'],
                        additionalProperties: false
                    }
                }
            }
        });

        const content = response.choices[0]?.message?.content;
        if (content) {
            const parsed = JSON.parse(content);
            console.log(`[Classifier] Query: "${query.slice(0, 50)}..." => needs_online: ${parsed.needs_online} (${parsed.reason})`);
            return parsed.needs_online;
        }
        return false;
    } catch (error) {
        console.error('Error in online search classifier:', error);
        return false; // Default to no online search on error
    }
}

/**
 * Check if a query needs conversation history context.
 * Uses structured outputs for reliable parsing.
 * @param {string} query - The user's query
 * @returns {Promise<boolean>} - True if context is needed
 */
async function needsContext(query) {
    try {
        const response = await openai.chat.completions.create({
            model: config.classifierModel,
            messages: [
                {
                    role: 'system',
                    content: `You are a classifier that determines if a user query requires previous conversation context to answer properly.

                            Answer YES if the query:
                            - References something mentioned earlier (e.g., "what about that?", "can you explain more?", "the previous one")
                            - Uses pronouns that refer to previous context (e.g., "it", "that", "this", "those")
                            - Is a follow-up question or continuation of a topic
                            - Asks to modify, expand, or clarify a previous response
                            - Would be ambiguous or meaningless without context

                            Answer NO if the query:
                            - Is a completely new, standalone question
                            - Contains all necessary information to answer
                            - Is a greeting or simple statement
                            - Is self-contained and doesn't reference anything prior`
                },
                {
                    role: 'user',
                    content: query
                }
            ],
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: 'context_check',
                    strict: true,
                    schema: {
                        type: 'object',
                        properties: {
                            needs_context: {
                                type: 'boolean',
                                description: 'Whether the query requires previous conversation history'
                            },
                            reason: {
                                type: 'string',
                                description: 'Brief reason for the decision'
                            }
                        },
                        required: ['needs_context', 'reason'],
                        additionalProperties: false
                    }
                }
            }
        });

        const content = response.choices[0]?.message?.content;
        if (content) {
            const parsed = JSON.parse(content);
            console.log(`[Classifier] Query: "${query.slice(0, 50)}..." => needs_context: ${parsed.needs_context} (${parsed.reason})`);
            return parsed.needs_context;
        }
        return true; // Default to including context on parsing failure
    } catch (error) {
        console.error('Error in context classifier:', error);
        return true; // Default to including context on error
    }
}

/**
 * Stream a response from the AI model.
 * @param {Array<{role: string, content: string}>} messages
 * @param {function(string, string): void} onUpdate - Callback with (content, reasoning)
 * @returns {Promise<void>}
 */
async function streamResponse(messages, onUpdate, reasoningEnabled = true) {
    try {
        // Prepend system prompt with current date and time
        const currentDateTime = new Date().toLocaleString();
        const systemPromptWithTime = `${config.systemPrompt}\n\nCurrent Date and Time: ${currentDateTime}\n\n`;

        // Get the latest user message for classification
        const lastUserMessage = messages.filter(m => m.role === 'user').pop();

        // Run both classifiers in parallel for efficiency
        let messagesToSend = messages;
        let selectedModel = reasoningEnabled ? config.openRouterModel : config.nonThinkingModel;

        if (lastUserMessage) {
            console.log(`[Classifiers] Running context and online classifiers in parallel...`);

            // Run both classifiers simultaneously
            const [requiresContext, needsOnline] = await Promise.all([
                messages.length > 1 ? needsContext(lastUserMessage.content) : Promise.resolve(true),
                needsOnlineSearch(lastUserMessage.content)
            ]);

            console.log(`[Classifiers] Both classifiers complete. Context: ${requiresContext}, Online: ${needsOnline}`);

            // Handle context decision
            if (messages.length > 1 && !requiresContext) {
                messagesToSend = [lastUserMessage];
                console.log(`[Context] Skipping history, sending only current message`);
            } else if (messages.length > 1) {
                console.log(`[Context] Including full conversation history`);
            }

            // Handle online search decision
            if (needsOnline) {
                selectedModel = `${selectedModel}:online`;
                console.log(`[Model] Using online-enabled model: ${selectedModel}`);
            }
        }

        const apiMessages = [
            { role: 'system', content: systemPromptWithTime },
            ...messagesToSend
        ];

        const requestOptions = {
            model: selectedModel,
            messages: apiMessages,
            stream: true,
            stream_options: { include_usage: true },
            provider: {
                sort: 'throughput',
                quantizations: ['fp8'],
            }
        };

        // Only add reasoning parameter if enabled and using the reasoning model
        if (reasoningEnabled) {
            requestOptions.reasoning = {
                effort: 'medium',
                enabled: true,
                exclude: false
            };
        }

        const stream = await openai.chat.completions.create(requestOptions);

        let fullContent = '';
        let fullReasoning = '';
        let usage = null;

        for await (const chunk of stream) {
            // console.log(JSON.stringify(chunk, null, 2));
            const delta = chunk.choices[0]?.delta || {};
            const contentDelta = delta.content || '';
            const reasoningDelta = delta.reasoning || '';

            if (chunk.usage) {
                usage = {
                    total_tokens: chunk.usage.total_tokens,
                    reasoning_tokens: chunk.usage.completion_tokens_details?.reasoning_tokens || 0
                };
            }

            fullContent += contentDelta;
            fullReasoning += reasoningDelta;

            onUpdate(fullContent, fullReasoning, usage);
        }

        onUpdate(fullContent, fullReasoning, usage);

    } catch (error) {
        console.error('Error streaming response:', error);
        throw error;
    }
}

module.exports = {
    streamResponse,
    needsOnlineSearch,
};

