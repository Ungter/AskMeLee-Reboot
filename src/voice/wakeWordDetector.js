const config = require('../config');

/**
 * Check if text contains the wake word
 * @param {string} text - Transcribed text
 * @returns {boolean}
 */
function containsWakeWord(text) {
    if (!text) return false;

    const normalizedText = normalizeText(text);
    const normalizedWakeWord = normalizeText(config.wakeWord);

    return normalizedText.includes(normalizedWakeWord);
}

/**
 * Extract the command portion after the wake word
 * @param {string} text - Transcribed text
 * @returns {string|null} - Command text or null if no wake word found
 */
function extractCommand(text) {
    if (!text) return null;

    const normalizedText = normalizeText(text);
    const normalizedWakeWord = normalizeText(config.wakeWord);

    const wakeWordIndex = normalizedText.indexOf(normalizedWakeWord);

    if (wakeWordIndex === -1) {
        return null;
    }

    // Get text after the wake word
    const afterWakeWord = text.substring(wakeWordIndex + config.wakeWord.length);

    // Clean up the command (remove leading punctuation, whitespace)
    let command = afterWakeWord.replace(/^[,.\s!?]+/, '').trim();

    return command || null;
}

/**
 * Normalize text for comparison
 * @param {string} text 
 * @returns {string}
 */
function normalizeText(text) {
    return text
        .toLowerCase()
        .replace(/[,.'!?]/g, '') // Remove punctuation
        .replace(/\s+/g, ' ')     // Normalize whitespace
        .trim();
}

module.exports = {
    containsWakeWord,
    extractCommand,
    normalizeText,
};
