// Separate session pools so cloud AI and local vLLM keep independent histories.
const sessions = new Map();      // cloud AI
const localSessions = new Map(); // local vLLM (/chatwiththegroup)

// Sessions are reset after this much inactivity (10 minutes)
const SESSION_EXPIRY_MS = 10 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

const defaultSession = {
    history: [],
    reasoningEnabled: false, // Default preference
    lastActivity: 0,
};

function pickPool(kind) {
    return kind === 'local' ? localSessions : sessions;
}

/**
 * Get or create a session for a user in a specific channel.
 * Expired sessions (10min inactivity) have their history cleared automatically.
 * @param {string} userId
 * @param {string} channelId
 * @param {string} [kind] - 'cloud' (default) or 'local' for the local vLLM model
 * @returns {Object}
 */
function getSession(userId, channelId, kind = 'cloud') {
    const pool = pickPool(kind);
    const key = `${userId}-${channelId}`;
    const now = Date.now();

    if (!pool.has(key)) {
        const session = JSON.parse(JSON.stringify(defaultSession));
        session.lastActivity = now;
        pool.set(key, session);
        return session;
    }

    const session = pool.get(key);

    if (now - session.lastActivity > SESSION_EXPIRY_MS) {
        // Expired from inactivity: clear history but keep reasoning preference
        session.history = [];
        console.log(`[Sessions] ${kind} session ${key} expired after inactivity, history cleared`);
    }

    session.lastActivity = now;
    return session;
}

/**
 * Reset a user's session history in a specific channel.
 * @param {string} userId
 * @param {string} channelId
 * @param {string} [kind] - 'cloud' (default) or 'local' for the local vLLM model
 */
function resetSession(userId, channelId, kind = 'cloud') {
    const pool = pickPool(kind);
    const key = `${userId}-${channelId}`;
    const session = JSON.parse(JSON.stringify(defaultSession));
    session.lastActivity = Date.now();
    pool.set(key, session);
}

/**
 * Periodically remove fully-expired sessions so abandoned
 * conversations don't leak memory.
 */
setInterval(() => {
    const now = Date.now();
    const sweep = (pool) => {
        for (const [key, session] of pool) {
            if (now - session.lastActivity > SESSION_EXPIRY_MS) {
                pool.delete(key);
            }
        }
    };
    sweep(sessions);
    sweep(localSessions);
}, SWEEP_INTERVAL_MS).unref();

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
