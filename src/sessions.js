const sessions = new Map();

const defaultSession = {
    history: [],
    reasoningEnabled: false, // Default preference
};

/**
 * Get or create a session for a user in a specific channel.
 * @param {string} userId
 * @param {string} channelId
 * @returns {Object}
 */
function getSession(userId, channelId) {
    const key = `${userId}-${channelId}`;
    if (!sessions.has(key)) {
        sessions.set(key, JSON.parse(JSON.stringify(defaultSession)));
    }
    return sessions.get(key);
}

/**
 * Reset a user's session history in a specific channel.
 * @param {string} userId
 * @param {string} channelId
 */
function resetSession(userId, channelId) {
    const key = `${userId}-${channelId}`;
    sessions.set(key, JSON.parse(JSON.stringify(defaultSession)));
}

/**
 * Toggle reasoning for a user in a specific channel.
 * @param {string} userId
 * @param {string} channelId
 * @returns {boolean} New state
 */
function toggleReasoning(userId, channelId) {
    const session = getSession(userId, channelId);
    session.reasoningEnabled = !session.reasoningEnabled;
    return session.reasoningEnabled;
}

module.exports = {
    getSession,
    resetSession,
    toggleReasoning,
};
