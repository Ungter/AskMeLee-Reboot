const config = require('../config');

const BASE_URL = 'https://kemono.cr/api';
const DATA_BASE_URL = 'https://kemono.cr/data';

// Default headers - text/css required per API docs
const DEFAULT_HEADERS = {
    'Accept': 'text/css'
};

/**
 * Fetches all creators and returns them sorted by favorited count
 * @returns {Promise<Array>} Array of creators sorted by favorites
 */
async function fetchTopCreators() {
    const response = await fetch(`${BASE_URL}/v1/creators`, { headers: DEFAULT_HEADERS });
    if (!response.ok) {
        throw new Error(`Failed to fetch creators: ${response.status}`);
    }
    const creators = await response.json();
    // Sort by favorited count descending
    return creators.sort((a, b) => (b.favorited || 0) - (a.favorited || 0));
}


/**
 * Gets a random post reference
 * @returns {Promise<{service: string, artist_id: string, post_id: string}>}
 */
async function fetchRandomPost() {
    const response = await fetch(`${BASE_URL}/v1/posts/random`, { headers: DEFAULT_HEADERS });
    if (!response.ok) {
        throw new Error(`Failed to fetch random post: ${response.status}`);
    }
    return await response.json();
}

/**
 * Fetches full post content by service, creator ID, and post ID
 * @param {string} service - The service (e.g., 'fanbox', 'patreon')
 * @param {string} creatorId - The creator's ID
 * @param {string} postId - The post ID
 * @returns {Promise<Object>} Full post data
 */
async function fetchPostContent(service, creatorId, postId) {
    const response = await fetch(`${BASE_URL}/v1/${service}/user/${creatorId}/post/${postId}`, { headers: DEFAULT_HEADERS });
    if (!response.ok) {
        throw new Error(`Failed to fetch post: ${response.status}`);
    }
    return await response.json();
}

/**
 * Fetches posts from a creator
 * @param {string} service - The service
 * @param {string} creatorId - The creator's ID
 * @param {number} offset - Offset for pagination (multiples of 50)
 * @returns {Promise<Array>} Array of posts
 */
async function fetchCreatorPosts(service, creatorId, offset = 0) {
    const response = await fetch(`${BASE_URL}/v1/${service}/user/${creatorId}/posts`, { headers: DEFAULT_HEADERS });
    if (!response.ok) {
        throw new Error(`Failed to fetch creator posts: ${response.status}`);
    }
    return await response.json();
}

/**
 * Searches creators by name (client-side filter)
 * @param {string} name - Name to search for
 * @returns {Promise<Array>} Matching creators
 */
async function searchCreatorsByName(name) {
    const response = await fetch(`${BASE_URL}/v1/creators`, { headers: DEFAULT_HEADERS });
    if (!response.ok) {
        throw new Error(`Failed to fetch creators: ${response.status}`);
    }
    const creators = await response.json();
    const lowerName = name.toLowerCase();
    return creators.filter(c => c.name && c.name.toLowerCase().includes(lowerName));
}

/**
 * Gets the full URL for a file path
 * @param {string} path - The file path from the API
 * @returns {string} Full URL to the file
 */
function getFileUrl(path) {
    if (!path) return null;
    return `${DATA_BASE_URL}${path}`;
}

/**
 * Extracts all files from a post (main file + attachments)
 * @param {Object} post - The post object
 * @returns {Array<{name: string, url: string, path: string}>} Array of file info
 */
function getPostFiles(post) {
    const files = [];

    // Main file
    if (post.file && post.file.path) {
        files.push({
            name: post.file.name || 'file',
            url: getFileUrl(post.file.path),
            path: post.file.path
        });
    }

    // Attachments
    if (post.attachments && Array.isArray(post.attachments)) {
        for (const att of post.attachments) {
            if (att.path) {
                files.push({
                    name: att.name || 'attachment',
                    url: getFileUrl(att.path),
                    path: att.path
                });
            }
        }
    }

    return files;
}

/**
 * Determines if a file is an image based on extension
 * @param {string} path - File path
 * @returns {boolean}
 */
function isImageFile(path) {
    if (!path) return false;
    const ext = path.toLowerCase().split('.').pop();
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext);
}

/**
 * Determines if a file is an audio file based on extension
 * @param {string} path - File path
 * @returns {boolean}
 */
function isAudioFile(path) {
    if (!path) return false;
    const ext = path.toLowerCase().split('.').pop();
    return ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'].includes(ext);
}

/**
 * Determines if a file is a video file based on extension
 * @param {string} path - File path
 * @returns {boolean}
 */
function isVideoFile(path) {
    if (!path) return false;
    const ext = path.toLowerCase().split('.').pop();
    return ['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext);
}

/**
 * Strips HTML tags from content
 * @param {string} html - HTML content
 * @returns {string} Plain text
 */
function stripHtml(html) {
    if (!html) return '';
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .trim();
}

/**
 * Gets the Kemono page URL for a post
 * @param {string} service - The service
 * @param {string} creatorId - Creator ID
 * @param {string} postId - Post ID
 * @returns {string} URL to the post on Kemono
 */
function getPostPageUrl(service, creatorId, postId) {
    return `https://kemono.su/${service}/user/${creatorId}/post/${postId}`;
}

/**
 * Gets the Kemono page URL for a creator
 * @param {string} service - The service
 * @param {string} creatorId - Creator ID
 * @returns {string} URL to the creator on Kemono
 */
function getCreatorPageUrl(service, creatorId) {
    return `https://kemono.su/${service}/user/${creatorId}`;
}

module.exports = {
    fetchTopCreators,
    fetchRandomPost,
    fetchPostContent,
    fetchCreatorPosts,
    searchCreatorsByName,
    getFileUrl,
    getPostFiles,
    isImageFile,
    isAudioFile,
    isVideoFile,
    stripHtml,
    getPostPageUrl,
    getCreatorPageUrl,
    BASE_URL,
    DATA_BASE_URL
};
