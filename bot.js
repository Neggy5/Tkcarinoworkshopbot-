// ╔══════════════════════════════════════════════════╗
// ║     TK Cariño 🌻✨ workshop ¤  —  bot.js         ║
// ║     Telegram Pairing Bot · Beautiful Edition     ║
// ╚══════════════════════════════════════════════════╝

require('dotenv').config();
require('./setting/config');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const chalk = require('chalk');
const os = require('os');
const axios = require('axios');
const { BOT_TOKEN } = require('./empirestore/token');
const { autoLoadPairs } = require('./autoload');

// pair.js exports startpairing directly (module.exports = startpairing)
const startpairing = require('./pair');

// ════════════════════════════════════════════
//  INITIALIZATION
// ════════════════════════════════════════════
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ════════════════════════════════════════════
//  FILE PATHS
// ════════════════════════════════════════════
const DATA_DIR              = path.join(__dirname, 'empirestore');
const adminFilePath         = path.join(DATA_DIR, 'admin.json');
const userFilePath          = path.join(DATA_DIR, 'users.json');
const userStatsPath         = path.join(DATA_DIR, 'user_stats.json');
const welcomeSettingsPath   = path.join(DATA_DIR, 'welcome_settings.json');
const goodbyeSettingsPath   = path.join(DATA_DIR, 'goodbye_settings.json');

// ════════════════════════════════════════════
//  DATA STORAGE
// ════════════════════════════════════════════
let adminIDs        = [];
let userIDs         = new Set();
let userStats       = {};
let welcomeSettings = {};
let goodbyeSettings = {};

// Command cooldowns
const cooldowns = new Map();

// ════════════════════════════════════════════
//  TK CARIÑO  —  SUNFLOWER DESIGN SYSTEM  🌻✨
// ════════════════════════════════════════════
const TK = {
    name:    'TK Cariño 🌻✨ workshop ¤',
    short:   'TK CARIÑO',
    tagline: '🌻 Where Creativity Blooms ✨',
    // Box drawing
    top:     '╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮',
    mid:     '┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫',
    bot:     '╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯',
    row:     '┃',
    // Decorative
    sun:     '🌻',
    spark:   '✨',
    arrow:   '❯',
    dot:     '◈',
    star:    '⭐',
    // Footer
    footer:  '🌻 TK Cariño ✨ workshop ¤ · Bloom & Connect',
    divider: '· · ─────────── 🌻 ─────────── · ·',
};

// ════════════════════════════════════════════
//  SOCIAL LINKS  ← update these to your own
// ════════════════════════════════════════════
const SOCIAL_LINKS = {
    wa_channel1: 'https://whatsapp.com/channel/0029Vaj7qdm60eBWYF20IK1h',
    wa_channel2: 'https://whatsapp.com/channel/0029Vb5gqQbDp2Q1zKNErP0R',
    wa_channel3: 'https://whatsapp.com/channel/0029VbBRSagFMqrQwYlFjl0Y',
    channel:     'https://t.me/bledits37',
    group:       'https://t.me/+SSS8hQ1M2J43NGU0',
    developer:   'https://t.me/zukomd_support',
};

// ════════════════════════════════════════════
//  BANNER / LOGO
// ════════════════════════════════════════════
const BANNER_URL = 'https://files.catbox.moe/qcpngc.png';
const LOGO_URL   = BANNER_URL;

// ════════════════════════════════════════════
//  ACCESS CONTROL  — 1 GROUP + 1 CHANNEL
// ════════════════════════════════════════════
const REQUIRE_MEMBERSHIP = true;

const REQUIRED_GROUP   = '@https://t.me/+SSS8hQ1M2J43NGU0';         // ← your Telegram group username
const REQUIRED_CHANNEL = '@https://t.me/bledits37';      // ← your Telegram channel username

const REQUIRED_CHANNELS = [
    { link: REQUIRED_CHANNEL, name: `${TK.sun} TK Cariño Workshop Channel` },
];

// ════════════════════════════════════════════
//  HELPER FUNCTIONS
// ════════════════════════════════════════════
const exists = async (filePath) => {
    try { await fs.access(filePath); return true; }
    catch { return false; }
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const ensureDirectoryExists = async (dirPath) => {
    try { await fs.mkdir(dirPath, { recursive: true }); }
    catch (err) { if (err.code !== 'EEXIST') throw err; }
};

function runtime(seconds) {
    seconds = Number(seconds);
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0 || parts.length === 0) parts.push(`${s}s`);
    return parts.join(' ');
}

const formatNumber = (num) => {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
    if (num >= 1_000)     return (num / 1_000).toFixed(1) + 'K';
    return num.toString();
};

// ════════════════════════════════════════════
//  DATA LOAD / SAVE
// ════════════════════════════════════════════
const loadAdminIDs = async () => {
    const ownerID       = '8361355527';
    const defaultAdmins = [ownerID];
    await ensureDirectoryExists(DATA_DIR);
    if (!(await exists(adminFilePath))) {
        await fs.writeFile(adminFilePath, JSON.stringify(defaultAdmins, null, 2));
        adminIDs = defaultAdmins;
        console.log(chalk.green('✓ Created admin.json'));
    } else {
        try {
            const raw = await fs.readFile(adminFilePath, 'utf8');
            adminIDs = JSON.parse(raw);
            if (!Array.isArray(adminIDs)) adminIDs = defaultAdmins;
        } catch {
            adminIDs = defaultAdmins;
        }
    }
    console.log(chalk.cyan(`📥 Loaded ${adminIDs.length} admin(s)`));
};

const loadUserIDs = async () => {
    if (await exists(userFilePath)) {
        try {
            const raw  = await fs.readFile(userFilePath, 'utf8');
            const list = JSON.parse(raw);
            userIDs = new Set(Array.isArray(list) ? list : []);
            console.log(chalk.cyan(`📥 Loaded ${userIDs.size} user(s)`));
        } catch { userIDs = new Set(); }
    }
};

const saveUserIDs = async () => {
    try { await fs.writeFile(userFilePath, JSON.stringify([...userIDs], null, 2)); }
    catch (err) { console.error(chalk.red('✗ Error saving users.json:'), err); }
};

const loadUserStats = async () => {
    if (await exists(userStatsPath)) {
        try {
            const raw = await fs.readFile(userStatsPath, 'utf8');
            userStats = JSON.parse(raw);
        } catch { userStats = {}; }
    }
};

const saveUserStats = async () => {
    try { await fs.writeFile(userStatsPath, JSON.stringify(userStats, null, 2)); }
    catch (err) { console.error(chalk.red('Error saving user stats:'), err); }
};

const loadWelcomeSettings = async () => {
    if (await exists(welcomeSettingsPath)) {
        try {
            const raw = await fs.readFile(welcomeSettingsPath, 'utf8');
            welcomeSettings = JSON.parse(raw);
        } catch { welcomeSettings = {}; }
    }
};

const saveWelcomeSettings = async () => {
    try { await fs.writeFile(welcomeSettingsPath, JSON.stringify(welcomeSettings, null, 2)); }
    catch (err) { console.error(chalk.red('Error saving welcome settings:'), err); }
};

const loadGoodbyeSettings = async () => {
    if (await exists(goodbyeSettingsPath)) {
        try {
            const raw = await fs.readFile(goodbyeSettingsPath, 'utf8');
            goodbyeSettings = JSON.parse(raw);
        } catch { goodbyeSettings = {}; }
    }
};

const saveGoodbyeSettings = async () => {
    try { await fs.writeFile(goodbyeSettingsPath, JSON.stringify(goodbyeSettings, null, 2)); }
    catch (err) { console.error(chalk.red('Error saving goodbye settings:'), err); }
};

// ════════════════════════════════════════════
//  USER TRACKING
// ════════════════════════════════════════════
const trackUser = async (userId) => {
    const id = userId.toString();
    if (!userIDs.has(id)) {
        userIDs.add(id);
        await saveUserIDs();
        console.log(chalk.green(`${TK.sun} New user: ${id}`));
    }
};

const updateUserStats = async (userId, command) => {
    const id = userId.toString();
    if (!userStats[id]) {
        userStats[id] = { totalCommands: 0, lastSeen: Date.now(), commands: {} };
    }
    userStats[id].totalCommands++;
    userStats[id].lastSeen = Date.now();
    userStats[id].commands[command] = (userStats[id].commands[command] || 0) + 1;
    await saveUserStats();
};

// ════════════════════════════════════════════
//  MEMBERSHIP CHECK  (1 group + 1 channel)
// ════════════════════════════════════════════
const checkMembership = async (userId) => {
    if (!REQUIRE_MEMBERSHIP) {
        return { hasJoinedGroup: true, hasJoinedAllChannels: true, hasJoinedAll: true };
    }
    try {
        const valid = ['member', 'administrator', 'creator'];
        const groupMember   = await bot.getChatMember(REQUIRED_GROUP,   userId).catch(() => null);
        const channelMember = await bot.getChatMember(REQUIRED_CHANNEL, userId).catch(() => null);

        const hasJoinedGroup   = groupMember   && valid.includes(groupMember.status);
        const hasJoinedChannel = channelMember && valid.includes(channelMember.status);

        return {
            hasJoinedGroup,
            hasJoinedAllChannels: hasJoinedChannel,
            hasJoinedAll: hasJoinedGroup && hasJoinedChannel,
        };
    } catch (error) {
        console.error(chalk.red('Membership check error:'), error.message);
        return { hasJoinedGroup: false, hasJoinedAllChannels: false, hasJoinedAll: false };
    }
};

// ════════════════════════════════════════════
//  UI BUILDER  —  beautiful framed messages
// ════════════════════════════════════════════
/**
 * Build a styled caption with the TK Cariño frame.
 * @param {string} title  — section heading (will be UPPER‑CASED)
 * @param {string} body   — already‑formatted body lines (use ┃  prefix per line)
 */
const buildCaption = (title, body) =>
`${TK.top}
${TK.row}  ${TK.sun} *${title.toUpperCase()}*
${TK.row}  ${TK.tagline}
${TK.mid}
${body}
${TK.mid}
${TK.row}  ${TK.footer}
${TK.bot}`;

/**
 * Send a photo message with the TK Cariño frame.
 */
const sendStyled = async (chatId, title, body, buttons = null) => {
    const caption = buildCaption(title, body);
    const opts = { caption, parse_mode: 'Markdown' };
    if (buttons) opts.reply_markup = { inline_keyboard: buttons };
    return bot.sendPhoto(chatId, BANNER_URL, opts);
};

/**
 * Edit an existing photo message in‑place.
 */
const editStyled = async (chatId, messageId, title, body, buttons = null) => {
    const caption = buildCaption(title, body);
    const mediaPayload = { type: 'photo', media: BANNER_URL, caption, parse_mode: 'Markdown' };
    const editOpts = { chat_id: chatId, message_id: messageId };
    if (buttons) editOpts.reply_markup = { inline_keyboard: buttons };
    return bot.editMessageMedia(mediaPayload, editOpts);
};

// ════════════════════════════════════════════
//  JOIN REQUIREMENT MESSAGE
// ════════════════════════════════════════════
const sendJoinRequirement = async (chatId) => {
    const body =
`┃  🔒 *MEMBERS ONLY ACCESS*
┃
┃  To use this bot you must follow all links:
┃
┃  🌻 *WHATSAPP CHANNELS*
┃  ${TK.arrow} TK Cariño WA Channel 1
┃  ${TK.arrow} TK Cariño WA Channel 2
┃  ${TK.arrow} TK Cariño WA Channel 3
┃
┃  👥 *TELEGRAM GROUP*
┃  ${TK.arrow} TK Cariño Community Group
┃
┃  After joining, tap *✅ VERIFY ACCESS* below.`;

    const keyboard = [
        [{ text: '🌻 WA Channel 1', url: SOCIAL_LINKS.wa_channel1 }],
        [{ text: '🌻 WA Channel 2', url: SOCIAL_LINKS.wa_channel2 }],
        [{ text: '🌻 WA Channel 3', url: SOCIAL_LINKS.wa_channel3 }],
        [{ text: '👥 Community Group', url: SOCIAL_LINKS.group }],
        [{ text: '✅ VERIFY ACCESS',   callback_data: 'check_membership' }],
    ];

    return sendStyled(chatId, 'Access Required', body, keyboard);
};

// ════════════════════════════════════════════
//  MIDDLEWARE
// ════════════════════════════════════════════
const withCooldown = (command, seconds = 3) => (handler) => async (msg, match) => {
    const key  = `${msg.from.id}_${command}`;
    const now  = Date.now();
    const last = cooldowns.get(key);
    if (last && now - last < seconds * 1000) {
        const wait = Math.ceil((seconds * 1000 - (now - last)) / 1000);
        return sendStyled(msg.chat.id, 'Slow Down 🌻',
            `┃  ⏳ Please wait *${wait}s* before using this again.`);
    }
    cooldowns.set(key, now);
    return handler(msg, match);
};

const requireMembership = (handler) => async (msg, match) => {
    const chatId  = msg.chat.id;
    const userId  = msg.from.id;
    const command = msg.text?.split(' ')[0]?.replace('/', '') || 'unknown';

    await trackUser(userId);
    await updateUserStats(userId, command);

    if (!REQUIRE_MEMBERSHIP) return handler(msg, match);
    if (adminIDs.includes(userId.toString())) return handler(msg, match);

    const mem = await checkMembership(userId);
    if (!mem.hasJoinedAll) return sendJoinRequirement(chatId);

    return handler(msg, match);
};

// ════════════════════════════════════════════
//  /start
// ════════════════════════════════════════════
bot.onText(/\/start/, requireMembership(async (msg) => {
    const chatId    = msg.chat.id;
    const firstName = msg.from.first_name;

    const body =
`┃  ${TK.sun} *Hello, ${firstName}!* Welcome to
┃  *TK Cariño 🌻✨ workshop ¤*
┃
┃  📲 *PAIRING*
┃  ${TK.arrow} /pair \`number\`      — Connect WhatsApp
┃  ${TK.arrow} /delpair \`number\`   — Remove a device
┃  ${TK.arrow} /listpair confirm   — View linked devices
┃
┃  📊 *UTILITIES*
┃  ${TK.arrow} /ping        — Check latency
┃  ${TK.arrow} /runtime     — Bot uptime
┃  ${TK.arrow} /profile     — Your stats
┃  ${TK.arrow} /leaderboard — Top users
┃
┃  ⚙️ *GROUP TOOLS*
┃  ${TK.arrow} /welcome     — Welcome messages
┃  ${TK.arrow} /goodbye     — Goodbye messages
┃  ${TK.arrow} /report \`msg\` — Send a report`;

    const keyboard = [
        [{ text: `${TK.sun} Channel`,  url: SOCIAL_LINKS.channel },
         { text: '👥 Group',           url: SOCIAL_LINKS.group   }],
        [{ text: '❓ Help',             callback_data: 'help_msg' }],
    ];

    await sendStyled(chatId, `Welcome, ${firstName}`, body, keyboard);
}));

// ════════════════════════════════════════════
//  /help
// ════════════════════════════════════════════
bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;

    const body =
`┃  📲 *PAIRING COMMANDS*
┃  ${TK.arrow} /pair \`number\`     — Pair WhatsApp
┃  ${TK.arrow} /delpair \`number\`  — Remove device
┃  ${TK.arrow} /listpair confirm  — List devices
┃
┃  📊 *STATS & INFO*
┃  ${TK.arrow} /ping        — Latency check
┃  ${TK.arrow} /runtime     — Uptime
┃  ${TK.arrow} /profile     — Your profile
┃  ${TK.arrow} /leaderboard — Top users
┃
┃  ⚙️ *GROUP TOOLS*
┃  ${TK.arrow} /welcome     — Welcome messages
┃  ${TK.arrow} /goodbye     — Goodbye messages
┃  ${TK.arrow} /report \`msg\` — Report an issue`;

    const keyboard = [
        [{ text: `${TK.sun} Channel`, url: SOCIAL_LINKS.channel },
         { text: '👥 Group',          url: SOCIAL_LINKS.group   }],
        [{ text: '🚀 Start',          callback_data: 'start_bot' }],
    ];

    await sendStyled(chatId, 'Command Guide', body, keyboard);
});

// ════════════════════════════════════════════
//  /ping
// ════════════════════════════════════════════
bot.onText(/\/ping/, requireMembership(withCooldown('ping', 5)(async (msg) => {
    const chatId = msg.chat.id;
    const start  = Date.now();

    const sent = await bot.sendPhoto(chatId, BANNER_URL, {
        caption: `${TK.sun} *Pinging...*`,
        parse_mode: 'Markdown',
    });

    const latency = Date.now() - start;
    const apiLat  = sent.date - msg.date;

    const emoji  = latency < 100 ? '🟢' : latency < 200 ? '🟡' : latency < 500 ? '🟠' : '🔴';
    const bar    = latency < 100 ? '█████' : latency < 200 ? '████░' : latency < 500 ? '███░░' : '██░░░';
    const status = latency < 100 ? 'Excellent' : latency < 200 ? 'Good' : latency < 500 ? 'Slow' : 'Very Slow';

    const body =
`┃  🏓 *PONG!*
┃
┃  ${emoji} *Response*   ${latency}ms  \`${bar}\`
┃  📡 *API Delay*  ${apiLat}ms
┃  🎯 *Quality*    ${status}`;

    await editStyled(chatId, sent.message_id, 'Ping Result 🌻', body);
})));

// ════════════════════════════════════════════
//  /runtime
// ════════════════════════════════════════════
bot.onText(/\/runtime/, requireMembership(async (msg) => {
    const uptime = runtime(process.uptime());
    const memory = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

    const body =
`┃  🟢 *Status*   Online & Blooming ${TK.sun}
┃
┃  ⏱  *Uptime*   ${uptime}
┃  💾 *Memory*   ${memory} MB
┃  👥 *Users*    ${formatNumber(userIDs.size)} registered`;

    await sendStyled(msg.chat.id, 'System Status', body);
}));

// ════════════════════════════════════════════
//  /profile
// ════════════════════════════════════════════
bot.onText(/\/profile/, requireMembership(async (msg) => {
    const chatId   = msg.chat.id;
    const userId   = msg.from.id;
    const name     = msg.from.first_name;
    const username = msg.from.username ? `@${msg.from.username}` : 'No username';

    const stat       = userStats[userId] || { totalCommands: 0, lastSeen: Date.now(), commands: {} };
    const lastSeen   = new Date(stat.lastSeen).toLocaleString();
    const uniqueCmds = Object.keys(stat.commands || {}).length;
    const mostUsed   = Object.entries(stat.commands || {}).sort((a,b) => b[1]-a[1])[0];

    const body =
`┃  ${TK.sun} *${name}*
┃  ${TK.dot} ID:       \`${userId}\`
┃  ${TK.dot} Username: ${username}
┃
┃  📊 *ACTIVITY*
┃  ${TK.dot} Total commands   ${stat.totalCommands}
┃  ${TK.dot} Unique commands  ${uniqueCmds}
┃  ${TK.dot} Most used        ${mostUsed ? '/' + mostUsed[0] : '—'}
┃  ${TK.dot} Last active      ${lastSeen}`;

    await sendStyled(chatId, 'Your Profile', body);
}));

// ════════════════════════════════════════════
//  /leaderboard
// ════════════════════════════════════════════
bot.onText(/\/leaderboard/, requireMembership(async (msg) => {
    const chatId = msg.chat.id;
    const top    = Object.entries(userStats)
        .sort((a, b) => b[1].totalCommands - a[1].totalCommands)
        .slice(0, 10);

    if (!top.length) {
        return sendStyled(chatId, 'Leaderboard 🏆', '┃  📊 *No data yet. Be the first!*');
    }

    const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
    let rows = '';
    for (let i = 0; i < top.length; i++) {
        const [uid, s] = top[i];
        rows += `┃  ${medals[i]}  \`${uid.slice(-6)}\`  —  *${s.totalCommands}* cmds\n`;
    }

    await sendStyled(chatId, 'Top Users 🏆', rows.trimEnd());
}));

// ════════════════════════════════════════════
//  /stats  (admin only)
// ════════════════════════════════════════════
bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    if (!adminIDs.includes(msg.from.id.toString())) {
        return sendStyled(chatId, 'Restricted', '┃  🔒 *Admin access only*');
    }

    const totalCmds = Object.values(userStats).reduce((s, u) => s + (u.totalCommands || 0), 0);
    const body =
`┃  👥 *Users*      ${formatNumber(userIDs.size)}
┃  🎯 *Commands*   ${formatNumber(totalCmds)}
┃  ⏱  *Uptime*     ${runtime(process.uptime())}
┃  💾 *Memory*     ${(process.memoryUsage().heapUsed/1024/1024).toFixed(2)} MB
┃  👑 *Admins*     ${adminIDs.length}`;

    await sendStyled(chatId, 'Bot Statistics', body);
});

// ════════════════════════════════════════════
//  /welcome  (admin)
// ════════════════════════════════════════════
bot.onText(/\/welcome$/, requireMembership(async (msg) => {
    const chatId = msg.chat.id;
    if (!adminIDs.includes(msg.from.id.toString())) {
        return sendStyled(chatId, 'Restricted', '┃  🔒 *Admin access only*');
    }

    const body =
`┃  ⚙️ *WELCOME CONFIGURATION*
┃
┃  ${TK.arrow} /welcome on          — Enable
┃  ${TK.arrow} /welcome off         — Disable
┃  ${TK.arrow} /welcome set \`msg\`  — Custom message
┃
┃  🔤 *VARIABLES*
┃  ${TK.dot} {name}  — Member name
┃  ${TK.dot} {group} — Group name
┃  ${TK.dot} {count} — Member count`;

    await sendStyled(chatId, 'Welcome Settings', body);
}));

bot.onText(/\/welcome (on|off|set .+)/, requireMembership(async (msg, match) => {
    const chatId = msg.chat.id;
    if (!adminIDs.includes(msg.from.id.toString())) {
        return sendStyled(chatId, 'Restricted', '┃  🔒 *Admin access only*');
    }

    await loadWelcomeSettings();
    if (!welcomeSettings[chatId]) welcomeSettings[chatId] = { enabled: false, message: '' };

    const action = match[1];
    if (action === 'on') {
        welcomeSettings[chatId].enabled = true;
        await saveWelcomeSettings();
        await sendStyled(chatId, 'Welcome', `┃  ✅ *Welcome messages ENABLED* ${TK.sun}`);
    } else if (action === 'off') {
        welcomeSettings[chatId].enabled = false;
        await saveWelcomeSettings();
        await sendStyled(chatId, 'Welcome', '┃  ❌ *Welcome messages DISABLED*');
    } else if (action.startsWith('set ')) {
        const custom = action.slice(4);
        welcomeSettings[chatId].message = custom;
        welcomeSettings[chatId].enabled = true;
        await saveWelcomeSettings();
        await sendStyled(chatId, 'Welcome', `┃  ✅ *Custom welcome saved!*\n┃\n┃  "${custom}"`);
    }
}));

// ════════════════════════════════════════════
//  /goodbye  (admin)
// ════════════════════════════════════════════
bot.onText(/\/goodbye$/, requireMembership(async (msg) => {
    const chatId = msg.chat.id;
    if (!adminIDs.includes(msg.from.id.toString())) {
        return sendStyled(chatId, 'Restricted', '┃  🔒 *Admin access only*');
    }

    const body =
`┃  ⚙️ *GOODBYE CONFIGURATION*
┃
┃  ${TK.arrow} /goodbye on          — Enable
┃  ${TK.arrow} /goodbye off         — Disable
┃  ${TK.arrow} /goodbye set \`msg\`  — Custom message
┃
┃  🔤 *VARIABLES*
┃  ${TK.dot} {name}  — Member name
┃  ${TK.dot} {group} — Group name`;

    await sendStyled(chatId, 'Goodbye Settings', body);
}));

bot.onText(/\/goodbye (on|off|set .+)/, requireMembership(async (msg, match) => {
    const chatId = msg.chat.id;
    if (!adminIDs.includes(msg.from.id.toString())) {
        return sendStyled(chatId, 'Restricted', '┃  🔒 *Admin access only*');
    }

    await loadGoodbyeSettings();
    if (!goodbyeSettings[chatId]) goodbyeSettings[chatId] = { enabled: false, message: '' };

    const action = match[1];
    if (action === 'on') {
        goodbyeSettings[chatId].enabled = true;
        await saveGoodbyeSettings();
        await sendStyled(chatId, 'Goodbye', '┃  ✅ *Goodbye messages ENABLED*');
    } else if (action === 'off') {
        goodbyeSettings[chatId].enabled = false;
        await saveGoodbyeSettings();
        await sendStyled(chatId, 'Goodbye', '┃  ❌ *Goodbye messages DISABLED*');
    } else if (action.startsWith('set ')) {
        const custom = action.slice(4);
        goodbyeSettings[chatId].message = custom;
        goodbyeSettings[chatId].enabled = true;
        await saveGoodbyeSettings();
        await sendStyled(chatId, 'Goodbye', `┃  ✅ *Custom goodbye saved!*\n┃\n┃  "${custom}"`);
    }
}));

// ════════════════════════════════════════════
//  /pair
// ════════════════════════════════════════════
bot.onText(/\/pair (.+)/, requireMembership(withCooldown('pair', 10)(async (msg, match) => {
    const chatId = msg.chat.id;
    const number = match[1].trim();

    try {
        if (!number || /[a-z]/i.test(number) || !/^\d{7,15}$/.test(number) || number.startsWith('0')) {
            return sendStyled(chatId, 'Invalid Number',
                '┃  ⚠️ *Format:* /pair `234XXXXXXXXX`\n┃  Include country code, no leading 0.');
        }

        await sendStyled(chatId, 'Pairing 🌻',
            '┃  ⏳ *Generating your pairing code…*\n┃  Please wait a moment.');

        const jid = number.replace(/\D/g, '') + '@s.whatsapp.net';
        await startpairing(jid);
        await sleep(4000);

        const pairingFile = path.join(DATA_DIR, 'pairing', 'pairing.json');
        if (!(await exists(pairingFile))) {
            return sendStyled(chatId, 'Pairing Failed',
                '┃  ❌ *Could not generate code.*\n┃  Please try again in a moment.');
        }

        const raw    = await fs.readFile(pairingFile, 'utf-8');
        const cuObj  = JSON.parse(raw);
        const phone  = number.replace(/\D/g, '');

        await sendStyled(chatId, 'Pairing Success ✨',
`┃  ✅ *Device Linked!*
┃
┃  📱 *Number*   ${phone}
┃  🔐 *Code*     \`${cuObj.code}\`
┃
┃  _Open WhatsApp › Linked Devices › Link a Device_
┃  _Enter the code above to complete pairing._`);

    } catch (error) {
        console.error(chalk.red('Pair error:'), error);
        sendStyled(chatId, 'Pairing Failed',
            `┃  ❌ *Error*\n┃  ${error.message || 'Please try again.'}`);
    }
})));

// ════════════════════════════════════════════
//  /delpair
// ════════════════════════════════════════════
bot.onText(/\/delpair (.+)/, requireMembership(async (msg, match) => {
    const chatId = msg.chat.id;
    const number = match[1].trim();

    try {
        if (!number || /[a-z]/i.test(number) || !/^\d{7,15}$/.test(number)) {
            return sendStyled(chatId, 'Invalid Number', '┃  ⚠️ *Format:* /delpair `234XXXXXXXXX`');
        }

        const jidSuffix  = `${number}@s.whatsapp.net`;
        const pairingDir = path.join(DATA_DIR, 'pairing');

        if (!(await exists(pairingDir))) {
            return sendStyled(chatId, 'Not Found', '┃  ❌ *No sessions on record.*');
        }

        const entries = await fs.readdir(pairingDir, { withFileTypes: true });
        const match2  = entries.find(e => e.isDirectory() && e.name === jidSuffix);

        if (!match2) {
            return sendStyled(chatId, 'Not Found',
                `┃  ❌ *${number} is not paired.*`);
        }

        await fs.rm(path.join(pairingDir, match2.name), { recursive: true, force: true });

        await sendStyled(chatId, 'Device Removed ✅',
            `┃  ✅ *Unlinked successfully!*\n┃\n┃  📱 ${number} has been removed.`);

        console.log(chalk.green(`🗑️ Deleted: ${number}`));
    } catch (err) {
        console.error(chalk.red('Delpair error:'), err);
        sendStyled(chatId, 'Error', `┃  ❌ *${err.message}*`);
    }
}));

// ════════════════════════════════════════════
//  /listpair  (admin only)
// ════════════════════════════════════════════
bot.onText(/\/listpair confirm/, async (msg) => {
    const chatId = msg.chat.id;
    if (!adminIDs.includes(msg.from.id.toString())) {
        return sendStyled(chatId, 'Restricted', '┃  🔒 *Admin access only*');
    }

    try {
        const pairingDir = path.join(DATA_DIR, 'pairing');
        if (!(await exists(pairingDir))) {
            return sendStyled(chatId, 'Paired Devices', '┃  ❌ *No devices found.*');
        }

        const entries = await fs.readdir(pairingDir, { withFileTypes: true });
        const devices = entries
            .filter(e => e.isDirectory() && e.name.endsWith('@s.whatsapp.net'))
            .map(e => e.name);

        if (!devices.length) {
            return sendStyled(chatId, 'Paired Devices', '┃  ❌ *No devices linked yet.*');
        }

        let rows = `┃  📲 *${devices.length} device(s) linked*\n┃\n`;
        devices.forEach((d, i) => {
            rows += `┃  ${TK.dot} ${i + 1}. \`${d.split('@')[0]}\`\n`;
        });

        await sendStyled(chatId, 'Paired Devices', rows.trimEnd());
    } catch (err) {
        console.error(chalk.red('Listpair error:'), err);
        sendStyled(chatId, 'Error', '┃  ❌ *Failed to load devices*');
    }
});

// ════════════════════════════════════════════
//  /report
// ════════════════════════════════════════════
bot.onText(/\/report (.+)/, requireMembership(async (msg, match) => {
    const chatId   = msg.chat.id;
    const userId   = msg.from.id;
    const username = msg.from.username ? `@${msg.from.username}` : 'No username';
    const name     = msg.from.first_name || 'User';
    const text     = match[1].trim();

    const body =
`┃  👤 *${name}*
┃  ${TK.dot} ID:      \`${userId}\`
┃  ${TK.dot} Handle:  ${username}
┃
┃  💬 *MESSAGE*
┃  ${text}`;

    let sent = 0;
    for (const adminId of adminIDs) {
        try { await sendStyled(adminId, 'New Report 📩', body); sent++; }
        catch (e) { console.error(`Failed to send report to ${adminId}:`, e.message); }
    }

    await sendStyled(chatId, 'Report Sent ✅',
        `┃  ✅ *Delivered to ${sent} admin(s)*\n┃  We'll look into it soon! ${TK.sun}`);
}));

// ════════════════════════════════════════════
//  CALLBACK QUERY HANDLER
// ════════════════════════════════════════════
bot.on('callback_query', async (cbq) => {
    const msg    = cbq.message;
    const data   = cbq.data;
    const userId = cbq.from.id;
    const chatId = msg.chat.id;
    const msgId  = msg.message_id;
    const fname  = cbq.from.first_name;

    await trackUser(userId);

    // ── VERIFY ACCESS ──
    if (data === 'check_membership') {
        await bot.answerCallbackQuery(cbq.id, { text: '🔍 Checking your membership…' });
        const mem = await checkMembership(userId);

        if (mem.hasJoinedAll) {
            const body =
`┃  ${TK.sun} *Access Granted, ${fname}!*
┃  Welcome to *TK Cariño 🌻✨ workshop ¤*
┃
┃  📲 *PAIRING*
┃  ${TK.arrow} /pair \`num\`     — Connect WhatsApp
┃  ${TK.arrow} /delpair \`num\`  — Remove device
┃  ${TK.arrow} /listpair confirm — View devices
┃
┃  📊 /ping  /runtime  /profile  /leaderboard`;

            await editStyled(chatId, msgId, 'Welcome ✨', body, [
                [{ text: `${TK.sun} Channel`, url: SOCIAL_LINKS.channel },
                 { text: '👥 Group',          url: SOCIAL_LINKS.group   }],
                [{ text: '❓ Help',            callback_data: 'help_msg'  }],
            ]);
        } else {
            const denied =
`┃  🔒 *Access Denied*
┃
┃  You haven't joined all required links yet.
┃  Follow all WA channels & the group, then tap VERIFY again.`;

            await editStyled(chatId, msgId, 'Access Denied', denied, [
                [{ text: '🌻 WA Channel 1', url: SOCIAL_LINKS.wa_channel1 }],
                [{ text: '🌻 WA Channel 2', url: SOCIAL_LINKS.wa_channel2 }],
                [{ text: '🌻 WA Channel 3', url: SOCIAL_LINKS.wa_channel3 }],
                [{ text: '👥 Community Group', url: SOCIAL_LINKS.group }],
                [{ text: '🔄 VERIFY AGAIN',    callback_data: 'check_membership' }],
            ]);
        }

    // ── START BOT (callback) ──
    } else if (data === 'start_bot') {
        await bot.answerCallbackQuery(cbq.id);

        const body =
`┃  ${TK.sun} *Hey ${fname}!* Welcome back.
┃
┃  📲 /pair  /delpair  /listpair
┃  📊 /ping  /runtime  /profile
┃  🏆 /leaderboard
┃  ⚙️ /welcome  /goodbye  /report`;

        await sendStyled(chatId, 'Welcome Back 🌻', body, [
            [{ text: `${TK.sun} Channel`, url: SOCIAL_LINKS.channel },
             { text: '👥 Group',          url: SOCIAL_LINKS.group   }],
            [{ text: '❓ Help',            callback_data: 'help_msg'  }],
        ]);

    // ── HELP (callback) ──
    } else if (data === 'help_msg') {
        await bot.answerCallbackQuery(cbq.id);

        const body =
`┃  📲 *PAIRING*
┃  ${TK.arrow} /pair  /delpair  /listpair
┃
┃  📊 *INFO*
┃  ${TK.arrow} /ping  /runtime  /profile  /leaderboard
┃
┃  ⚙️ *GROUP*
┃  ${TK.arrow} /welcome  /goodbye  /report`;

        await sendStyled(chatId, 'Command Guide', body, [
            [{ text: '🚀 Start',          callback_data: 'start_bot' }],
            [{ text: `${TK.sun} Channel`, url: SOCIAL_LINKS.channel  },
             { text: '👥 Group',          url: SOCIAL_LINKS.group    }],
        ]);
    }
});

// ════════════════════════════════════════════
//  GROUP EVENT HANDLERS
// ════════════════════════════════════════════
bot.on('new_chat_members', async (msg) => {
    const chatId    = msg.chat.id;
    const newMember = msg.new_chat_members[0];
    await loadWelcomeSettings();
    if (welcomeSettings[chatId]?.enabled) {
        let text = welcomeSettings[chatId].message || `${TK.sun} Welcome *{name}* to *{group}*! Lovely to have you here ✨`;
        text = text
            .replace('{name}',  newMember.first_name)
            .replace('{group}', msg.chat.title || 'this group')
            .replace('{count}', msg.chat.members_count || '');
        await bot.sendPhoto(chatId, BANNER_URL, { caption: text, parse_mode: 'Markdown' }).catch(() => {});
    }
});

bot.on('left_chat_member', async (msg) => {
    const chatId     = msg.chat.id;
    const leftMember = msg.left_chat_member;
    await loadGoodbyeSettings();
    if (goodbyeSettings[chatId]?.enabled) {
        let text = goodbyeSettings[chatId].message || `${TK.sun} Goodbye *{name}*! We'll miss you 🌼`;
        text = text
            .replace('{name}',  leftMember.first_name)
            .replace('{group}', msg.chat.title || 'this group');
        await bot.sendPhoto(chatId, BANNER_URL, { caption: text, parse_mode: 'Markdown' }).catch(() => {});
    }
});

// ════════════════════════════════════════════
//  UNKNOWN COMMAND HANDLER
// ════════════════════════════════════════════
const VALID_COMMANDS = new Set([
    '/start','/pair','/delpair','/listpair','/ping','/runtime',
    '/help','/report','/welcome','/goodbye','/stats','/profile','/leaderboard',
]);

bot.on('message', async (msg) => {
    if (!msg.text?.startsWith('/')) return;
    const cmd    = msg.text.split(' ')[0];
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!VALID_COMMANDS.has(cmd)) {
        await trackUser(userId);
        if (!adminIDs.includes(userId.toString()) && REQUIRE_MEMBERSHIP) {
            const mem = await checkMembership(userId);
            if (!mem.hasJoinedAll) return sendJoinRequirement(chatId);
        }
        sendStyled(chatId, 'Unknown Command',
            `┃  ❓ *Command not found.*\n┃  Type /help to see all available commands.`);
    }
});

// ════════════════════════════════════════════
//  ERROR HANDLERS
// ════════════════════════════════════════════
bot.on('polling_error', (error) => console.error(chalk.red('Polling error:'), error.message));
bot.on('webhook_error',  (error) => console.error(chalk.red('Webhook error:'),  error.message));

// ════════════════════════════════════════════
//  BOOT
// ════════════════════════════════════════════
(async () => {
    console.log(chalk.hex('#FFD700')('\n╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮'));
    console.log(chalk.hex('#FFD700')('┃   🌻✨  TK Cariño Workshop  STARTING  ✨🌻  ┃'));
    console.log(chalk.hex('#FFD700')('╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n'));

    await ensureDirectoryExists(DATA_DIR);
    await ensureDirectoryExists(path.join(DATA_DIR, 'pairing'));

    await loadAdminIDs();
    await loadUserIDs();
    await loadUserStats();
    await loadWelcomeSettings();
    await loadGoodbyeSettings();

    console.log(chalk.hex('#FFD700')(
`╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
┃  🌻 TK Cariño 🌻✨ workshop ¤  ONLINE    ┃
┃  🟢 Status    Running                   ┃
┃  👥 Users     ${userIDs.size.toString().padEnd(6)}                         ┃
┃  👑 Admins    ${adminIDs.length.toString().padEnd(5)}                         ┃
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯`
    ));

    console.log(chalk.green(`✓ Membership check : ${REQUIRE_MEMBERSHIP ? 'ON (1 group + 1 channel)' : 'OFF'}`));
    console.log(chalk.green('✓ Welcome/Goodbye  : ENABLED'));
    console.log(chalk.green('✓ Report system    : ENABLED'));
    console.log(chalk.green('✓ All systems ready! 🌻\n'));

    setTimeout(async () => {
        try {
            console.log(chalk.cyan('📱 Auto-loading paired devices…'));
            const result = await autoLoadPairs({ batchSize: 1 });
            if (result.success) {
                console.log(chalk.green(`✓ Auto-load done: ${result.successful}/${result.total} connected`));
                if (result.failedUsers?.length) {
                    console.log(chalk.yellow(`⚠️ Failed: ${result.failedUsers.length}`));
                }
            } else {
                console.log(chalk.yellow(`⚠️ Auto-load skipped: ${result.message}`));
            }
        } catch (err) {
            console.error(chalk.red('✗ Auto-load failed:'), err.message);
        }
    }, 8000);
})();

// ════════════════════════════════════════════
//  GRACEFUL SHUTDOWN
// ════════════════════════════════════════════
const shutdown = async () => {
    console.log(chalk.yellow('\n🌻 Shutting down TK Cariño Workshop…'));
    await saveUserIDs();
    await saveUserStats();
    await saveWelcomeSettings();
    await saveGoodbyeSettings();
    bot.stopPolling();
    console.log(chalk.green('✓ Data saved. Goodbye! 🌻✨'));
    process.exit(0);
};

process.once('SIGINT',  shutdown);
process.once('SIGTERM', shutdown);
process.on('uncaughtException',  (err)    => console.error(chalk.red('Uncaught Exception:'),  err));
process.on('unhandledRejection', (reason) => console.error(chalk.red('Unhandled Rejection:'), reason));
