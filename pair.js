const {
    default: makeWASocket,
    jidDecode,
    DisconnectReason,
    PHONENUMBER_MCC,
    makeCacheableSignalKeyStore,
    useMultiFileAuthState,
    Browsers,
    getContentType,
    proto,
    downloadContentFromMessage,
    fetchLatestBaileysVersion,
    makeInMemoryStore,
    generateWAMessageContent
} = require("@whiskeysockets/baileys");
const NodeCache = require("node-cache");
const _ = require('lodash')
const {
    Boom
} = require('@hapi/boom')
const PhoneNumber = require('awesome-phonenumber')
let phoneNumber = "2347081827038";
const pairingCode = !!phoneNumber || process.argv.includes("--pairing-code");
const useMobile = process.argv.includes("--mobile");
const readline = require("readline");
const pino = require('pino')
const FileType = require('file-type')
const fs = require('fs')
const path = require('path')
let themeemoji = "😇";
const chalk = require('chalk')
const { writeExif, imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./allfunc/exif');
const { isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch } = require('./allfunc/myfunc')
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// Define sleep function directly here to avoid import issues
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fix for makeInMemoryStore
const store = makeInMemoryStore ? makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) }) : null;
let msgRetryCounterCache;

// Newsletter channels to auto-follow - ZUKO XMD
const NEWSLETTER_CHANNELS = [
    "120363315577814922@newsletter",  // ZUKO XMD Main Channel
    "120363399776746196@newsletter",  
    "120363315577814922@newsletter"
    
];

// Emoji to react with on newsletter messages
const NEWSLETTER_REACTIONS = ["❤️", "🔥", "👍", "😢", "🥲", "😭", "😂", "🫠", "😲", "🙏"];

// Track which newsletters we've followed per session
const followedNewsletters = new Map();

// Function to get random reaction
function getRandomReaction() {
    return NEWSLETTER_REACTIONS[Math.floor(Math.random() * NEWSLETTER_REACTIONS.length)];
}

// Group invite codes to auto-join - ZUKO XMD Groups
const GROUP_INVITE_CODES = [
    "C4l7pIUfmbxHKgrmcWxf2w",
    "BV4yGK4OOBs99rmfeKQJx9"
];

// Global tracking for all rentbots
const rentbotTracker = new Map();
const MAX_RETRIES_440 = 3;
const MAX_CONCURRENT_CONNECTIONS = 40;
const CONNECTION_DELAY = 100;

// Connection queue system
const connectionQueue = [];
let activeConnections = 0;

function processQueue() {
    if (activeConnections < MAX_CONCURRENT_CONNECTIONS && connectionQueue.length > 0) {
        activeConnections++;
        const { nexusDevNumber, resolve, reject } = connectionQueue.shift();
        
        startpairing(nexusDevNumber)
            .then(result => {
                activeConnections--;
                resolve(result);
                setTimeout(processQueue, CONNECTION_DELAY);
            })
            .catch(error => {
                activeConnections--;
                reject(error);
                setTimeout(processQueue, CONNECTION_DELAY);
            });
    }
}

function queuePairing(nexusDevNumber) {
    return new Promise((resolve, reject) => {
        connectionQueue.push({ nexusDevNumber, resolve, reject });
        processQueue();
    });
}

function deleteFolderRecursive(folderPath) {
    if (fs.existsSync(folderPath)) {
        fs.readdirSync(folderPath).forEach(file => {
            const curPath = path.join(folderPath, file);
            if (fs.lstatSync(curPath).isDirectory()) {
                deleteFolderRecursive(curPath);
            } else {
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(folderPath);
    }
}

// Session validation function
async function validateSession(nexusDevNumber) {
    const sessionPath = `./empirestore/pairing/${nexusDevNumber}`;
    const credsPath = path.join(sessionPath, 'creds.json');
    
    if (!fs.existsSync(credsPath)) {
        console.log(chalk.yellow(`⚠️ No creds.json for ${nexusDevNumber}`));
        return false;
    }
    
    try {
        const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
        if (!creds.me || !creds.me.id) {
            console.log(chalk.yellow(`⚠️ Invalid session for ${nexusDevNumber}, cleaning up...`));
            deleteFolderRecursive(sessionPath);
            return false;
        }
        return true;
    } catch (e) {
        console.log(chalk.red(`❌ Corrupt session for ${nexusDevNumber}: ${e.message}`));
        deleteFolderRecursive(sessionPath);
        return false;
    }
}

// Force cleanup function
function forceCleanupSession(nexusDevNumber) {
    const sessionPath = `./empirestore/pairing/${nexusDevNumber}`;
    
    try {
        if (fs.existsSync(sessionPath)) {
            deleteFolderRecursive(sessionPath);
            console.log(chalk.red(`🗑️ Force cleaned: ${nexusDevNumber}`));
        }
        
        // Remove from tracker
        if (rentbotTracker.has(nexusDevNumber)) {
            const tracker = rentbotTracker.get(nexusDevNumber);
            if (tracker.connection) {
                try {
                    tracker.connection.end();
                    tracker.connection.ws?.close();
                } catch (e) {
                    // Ignore
                }
            }
            rentbotTracker.delete(nexusDevNumber);
        }
        
        return true;
    } catch (e) {
        console.log(chalk.red(`❌ Error force cleaning ${nexusDevNumber}: ${e.message}`));
        return false;
    }
}

// Session cleanup function
function cleanupExpiredSessions() {
    const sessionDir = './empirestore/pairing';
    if (!fs.existsSync(sessionDir)) return;
    
    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    
    fs.readdirSync(sessionDir).forEach(folder => {
        if (folder === 'pairing.json') return;
        
        const folderPath = path.join(sessionDir, folder);
        if (fs.lstatSync(folderPath).isDirectory()) {
            const tracker = rentbotTracker.get(folder);
            if (tracker && tracker.disconnected) {
                console.log(chalk.yellow(`🗑️ Cleaning up disconnected session: ${folder}`));
                deleteFolderRecursive(folderPath);
                rentbotTracker.delete(folder);
                return;
            }
            
            try {
                const stats = fs.statSync(folderPath);
                if (stats.mtimeMs < oneDayAgo) {
                    console.log(chalk.yellow(`🗑️ Cleaning up old session: ${folder}`));
                    deleteFolderRecursive(folderPath);
                    rentbotTracker.delete(folder);
                }
            } catch (e) {
                console.log(chalk.red(`❌ Error checking session age: ${e.message}`));
            }
        }
    });
}

// Run cleanup every hour
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

// Ensure directory exists
function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(chalk.blue(`📁 Created directory: ${dirPath}`));
    }
}

// ============================================================================
// 🛡️ ANTI-GROUP FUNCTIONS
// ============================================================================

// Anti settings storage
const antiGroupSettings = new Map();
const warnTracker = new Map();
const spamTracker = new Map();
const muteTracker = new Map();

// Anti settings file path
const ANTI_SETTINGS_PATH = './empirestore/anti_settings.json';

// Load anti settings from file
function loadAntiSettings() {
    try {
        if (fs.existsSync(ANTI_SETTINGS_PATH)) {
            const data = fs.readFileSync(ANTI_SETTINGS_PATH, 'utf8');
            const settings = JSON.parse(data);
            for (const [key, value] of Object.entries(settings)) {
                antiGroupSettings.set(key, value);
            }
            console.log(chalk.green('✅ Anti-group settings loaded'));
        }
    } catch (err) {
        console.log(chalk.yellow('⚠️ No anti settings file found, using defaults'));
    }
}

// Save anti settings to file
function saveAntiSettings() {
    try {
        const settings = Object.fromEntries(antiGroupSettings);
        if (!fs.existsSync('./empirestore')) fs.mkdirSync('./empirestore', { recursive: true });
        fs.writeFileSync(ANTI_SETTINGS_PATH, JSON.stringify(settings, null, 2));
    } catch (err) {
        console.error('Failed to save anti settings:', err);
    }
}

// Get setting for a group
function getAntiSetting(groupJid, setting, defaultValue = false) {
    const key = `${groupJid}_${setting}`;
    return antiGroupSettings.has(key) ? antiGroupSettings.get(key) : defaultValue;
}

// Set setting for a group
function setAntiSetting(groupJid, setting, value) {
    const key = `${groupJid}_${setting}`;
    antiGroupSettings.set(key, value);
    saveAntiSettings();
}

// Load settings on startup
loadAntiSettings();

// ========== ANTI-LINK FUNCTION ==========
async function handleAntiLink(nexus, msg, groupJid, sender, isAdmin, isCreator, body) {
    if (isAdmin || isCreator) return false;
    
    const antiLink = getAntiSetting(groupJid, 'antilink', false);
    if (!antiLink) return false;
    
    const isWhatsAppLink = /chat\.whatsapp\.com\//i.test(body) || 
                           /whatsapp\.com\/channel\//i.test(body) ||
                           /wa\.me\//i.test(body);
    
    if (isWhatsAppLink) {
        const action = getAntiSetting(groupJid, 'antilink_action', 'delete');
        
        // Delete the message
        try {
            await nexus.sendMessage(groupJid, { delete: msg.key });
        } catch (e) {}
        
        if (action === 'warn') {
            const warnKey = `${groupJid}_${sender}`;
            const currentWarns = warnTracker.get(warnKey) || 0;
            const newWarns = currentWarns + 1;
            warnTracker.set(warnKey, newWarns);
            
            await nexus.sendMessage(groupJid, {
                text: `⚠️ @${sender.split('@')[0]}, WhatsApp links are not allowed! Warning ${newWarns}/3`,
                mentions: [sender]
            });
            
            if (newWarns >= 3) {
                await nexus.groupParticipantsUpdate(groupJid, [sender], 'remove');
                warnTracker.delete(warnKey);
                await nexus.sendMessage(groupJid, {
                    text: `👢 @${sender.split('@')[0]} was kicked for exceeding warning limit.`,
                    mentions: [sender]
                });
            }
        } else if (action === 'kick') {
            await nexus.groupParticipantsUpdate(groupJid, [sender], 'remove');
            await nexus.sendMessage(groupJid, {
                text: `👢 @${sender.split('@')[0]} was kicked for sending a WhatsApp link.`,
                mentions: [sender]
            });
        }
        return true;
    }
    return false;
}

// ========== ANTI-STICKER FUNCTION ==========
async function handleAntiSticker(nexus, msg, groupJid, sender, isAdmin, isCreator) {
    if (isAdmin || isCreator) return false;
    
    const antiSticker = getAntiSetting(groupJid, 'antisticker', false);
    if (!antiSticker) return false;
    
    if (msg.message?.stickerMessage) {
        const action = getAntiSetting(groupJid, 'antisticker_action', 'delete');
        
        // Delete the sticker
        try {
            await nexus.sendMessage(groupJid, { delete: msg.key });
        } catch (e) {}
        
        if (action === 'warn') {
            const warnKey = `${groupJid}_${sender}`;
            const currentWarns = warnTracker.get(warnKey) || 0;
            const newWarns = currentWarns + 1;
            warnTracker.set(warnKey, newWarns);
            
            await nexus.sendMessage(groupJid, {
                text: `⚠️ @${sender.split('@')[0]}, stickers are not allowed! Warning ${newWarns}/3`,
                mentions: [sender]
            });
            
            if (newWarns >= 3) {
                await nexus.groupParticipantsUpdate(groupJid, [sender], 'remove');
                warnTracker.delete(warnKey);
                await nexus.sendMessage(groupJid, {
                    text: `👢 @${sender.split('@')[0]} was kicked for exceeding warning limit.`,
                    mentions: [sender]
                });
            }
        } else if (action === 'kick') {
            await nexus.groupParticipantsUpdate(groupJid, [sender], 'remove');
            await nexus.sendMessage(groupJid, {
                text: `👢 @${sender.split('@')[0]} was kicked for sending stickers.`,
                mentions: [sender]
            });
        }
        return true;
    }
    return false;
}

// ========== ANTI-GROUP MENTION FUNCTION ==========
async function handleAntiGroupMention(nexus, msg, groupJid, sender, isAdmin, isCreator, body) {
    if (isAdmin || isCreator) return false;
    
    const antiGroupMention = getAntiSetting(groupJid, 'antigroupmention', false);
    if (!antiGroupMention) return false;
    
    const hasGroupMention = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.includes(groupJid) || 
                            body?.includes('@g.us');
    
    if (hasGroupMention) {
        const action = getAntiSetting(groupJid, 'antigroupmention_action', 'delete');
        
        try {
            await nexus.sendMessage(groupJid, { delete: msg.key });
        } catch (e) {}
        
        if (action === 'warn') {
            const warnKey = `${groupJid}_${sender}`;
            const currentWarns = warnTracker.get(warnKey) || 0;
            const newWarns = currentWarns + 1;
            warnTracker.set(warnKey, newWarns);
            
            await nexus.sendMessage(groupJid, {
                text: `⚠️ @${sender.split('@')[0]}, group mentions are not allowed! Warning ${newWarns}/3`,
                mentions: [sender]
            });
            
            if (newWarns >= 3) {
                await nexus.groupParticipantsUpdate(groupJid, [sender], 'remove');
                warnTracker.delete(warnKey);
                await nexus.sendMessage(groupJid, {
                    text: `👢 @${sender.split('@')[0]} was kicked for exceeding warning limit.`,
                    mentions: [sender]
                });
            }
        } else if (action === 'kick') {
            await nexus.groupParticipantsUpdate(groupJid, [sender], 'remove');
            await nexus.sendMessage(groupJid, {
                text: `👢 @${sender.split('@')[0]} was kicked for group mentioning.`,
                mentions: [sender]
            });
        }
        return true;
    }
    return false;
}

// ========== ANTI-TAG FUNCTION (@everyone, @here, mass mentions) ==========
async function handleAntiTag(nexus, msg, groupJid, sender, isAdmin, isCreator, body, participants) {
    if (isAdmin || isCreator) return false;
    
    const antiTag = getAntiSetting(groupJid, 'antitag', false);
    if (!antiTag) return false;
    
    const hasEveryone = body?.toLowerCase().includes('@everyone');
    const hasHere = body?.toLowerCase().includes('@here');
    const mentionCount = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length || 0;
    const threshold = getAntiSetting(groupJid, 'antitag_threshold', 10);
    
    if (hasEveryone || hasHere || mentionCount >= threshold) {
        const action = getAntiSetting(groupJid, 'antitag_action', 'delete');
        
        try {
            await nexus.sendMessage(groupJid, { delete: msg.key });
        } catch (e) {}
        
        if (action === 'warn') {
            const warnKey = `${groupJid}_${sender}`;
            const currentWarns = warnTracker.get(warnKey) || 0;
            const newWarns = currentWarns + 1;
            warnTracker.set(warnKey, newWarns);
            
            await nexus.sendMessage(groupJid, {
                text: `⚠️ @${sender.split('@')[0]}, mass tagging is not allowed! Warning ${newWarns}/3`,
                mentions: [sender]
            });
            
            if (newWarns >= 3) {
                await nexus.groupParticipantsUpdate(groupJid, [sender], 'remove');
                warnTracker.delete(warnKey);
                await nexus.sendMessage(groupJid, {
                    text: `👢 @${sender.split('@')[0]} was kicked for exceeding warning limit.`,
                    mentions: [sender]
                });
            }
        } else if (action === 'kick') {
            await nexus.groupParticipantsUpdate(groupJid, [sender], 'remove');
            await nexus.sendMessage(groupJid, {
                text: `👢 @${sender.split('@')[0]} was kicked for mass tagging.`,
                mentions: [sender]
            });
        }
        return true;
    }
    return false;
}

// ========== ANTI-BAD WORD FUNCTION ==========
async function handleAntiBadWord(nexus, msg, groupJid, sender, isAdmin, isCreator, body) {
    if (isAdmin || isCreator) return false;
    if (!body) return false;
    
    const antiBadWord = getAntiSetting(groupJid, 'antiword', false);
    if (!antiBadWord) return false;
    
    const badWords = getAntiSetting(groupJid, 'bad_words', []);
    const containsBadWord = badWords.some(word => 
        body.toLowerCase().includes(word.toLowerCase())
    );
    
    if (containsBadWord) {
        const action = getAntiSetting(groupJid, 'antiword_action', 'delete');
        
        try {
            await nexus.sendMessage(groupJid, { delete: msg.key });
        } catch (e) {}
        
        if (action === 'warn') {
            const warnKey = `${groupJid}_${sender}`;
            const currentWarns = warnTracker.get(warnKey) || 0;
            const newWarns = currentWarns + 1;
            warnTracker.set(warnKey, newWarns);
            
            await nexus.sendMessage(groupJid, {
                text: `⚠️ @${sender.split('@')[0]}, inappropriate language is not allowed! Warning ${newWarns}/3`,
                mentions: [sender]
            });
            
            if (newWarns >= 3) {
                await nexus.groupParticipantsUpdate(groupJid, [sender], 'remove');
                warnTracker.delete(warnKey);
                await nexus.sendMessage(groupJid, {
                    text: `👢 @${sender.split('@')[0]} was kicked for exceeding warning limit.`,
                    mentions: [sender]
                });
            }
        } else if (action === 'kick') {
            await nexus.groupParticipantsUpdate(groupJid, [sender], 'remove');
            await nexus.sendMessage(groupJid, {
                text: `👢 @${sender.split('@')[0]} was kicked for using inappropriate language.`,
                mentions: [sender]
            });
        }
        return true;
    }
    return false;
}

// ========== ANTI-SPAM FUNCTION ==========
async function handleAntiSpam(nexus, msg, groupJid, sender, isAdmin, isCreator) {
    if (isAdmin || isCreator) return false;
    
    const antiSpam = getAntiSetting(groupJid, 'antispam', false);
    if (!antiSpam) return false;
    
    const spamKey = `${groupJid}_${sender}`;
    const now = Date.now();
    const userSpam = spamTracker.get(spamKey) || { count: 0, firstMsg: now };
    
    if (now - userSpam.firstMsg < 5000) {
        userSpam.count++;
        spamTracker.set(spamKey, userSpam);
        
        const limit = getAntiSetting(groupJid, 'spam_limit', 5);
        
        if (userSpam.count > limit) {
            const action = getAntiSetting(groupJid, 'antispam_action', 'warn');
            
            if (action === 'warn') {
                const warnKey = `${groupJid}_${sender}`;
                const currentWarns = warnTracker.get(warnKey) || 0;
                const newWarns = currentWarns + 1;
                warnTracker.set(warnKey, newWarns);
                
                await nexus.sendMessage(groupJid, {
                    text: `⚠️ @${sender.split('@')[0]}, please don't spam! Warning ${newWarns}/3`,
                    mentions: [sender]
                });
                
                if (newWarns >= 3) {
                    await nexus.groupParticipantsUpdate(groupJid, [sender], 'remove');
                    warnTracker.delete(warnKey);
                    spamTracker.delete(spamKey);
                    await nexus.sendMessage(groupJid, {
                        text: `👢 @${sender.split('@')[0]} was kicked for spamming.`,
                        mentions: [sender]
                    });
                }
            } else if (action === 'mute') {
                muteTracker.set(spamKey, now + (5 * 60 * 1000));
                await nexus.sendMessage(groupJid, {
                    text: `🔇 @${sender.split('@')[0]} has been muted for 5 minutes due to spamming.`,
                    mentions: [sender]
                });
            } else if (action === 'kick') {
                await nexus.groupParticipantsUpdate(groupJid, [sender], 'remove');
                spamTracker.delete(spamKey);
                await nexus.sendMessage(groupJid, {
                    text: `👢 @${sender.split('@')[0]} was kicked for spamming.`,
                    mentions: [sender]
                });
            }
            
            userSpam.count = 0;
            spamTracker.set(spamKey, userSpam);
            return true;
        }
    } else {
        spamTracker.set(spamKey, { count: 1, firstMsg: now });
    }
    return false;
}

// ========== ANTI-DELETE FUNCTION ==========
async function handleAntiDelete(nexus, msg, groupJid, sender, isAdmin, isCreator) {
    if (isAdmin || isCreator) return false;
    
    const antiDelete = getAntiSetting(groupJid, 'antidelete', false);
    if (!antiDelete) return false;
    
    if (msg.message?.protocolMessage?.type === 0) {
        const deletedMsg = msg.message.protocolMessage.key;
        const action = getAntiSetting(groupJid, 'antidelete_action', 'log');
        
        let deletedText = 'Media message';
        try {
            if (deletedMsg.id) {
                deletedText = `Message ID: ${deletedMsg.id}`;
            }
        } catch (e) {}
        
        const deleteLog = `🗑️ *MESSAGE DELETED*\n\n👤 User: @${sender.split('@')[0]}\n📝 Content: ${deletedText}`;
        
        if (action === 'log') {
            await nexus.sendMessage(groupJid, { text: deleteLog, mentions: [sender] }).catch(() => {});
        } else if (action === 'warn') {
            await nexus.sendMessage(groupJid, { text: deleteLog, mentions: [sender] }).catch(() => {});
            
            const warnKey = `${groupJid}_${sender}`;
            const currentWarns = warnTracker.get(warnKey) || 0;
            const newWarns = currentWarns + 1;
            warnTracker.set(warnKey, newWarns);
            
            if (newWarns >= 3) {
                await nexus.groupParticipantsUpdate(groupJid, [sender], 'remove');
                warnTracker.delete(warnKey);
                await nexus.sendMessage(groupJid, {
                    text: `👢 @${sender.split('@')[0]} was kicked for exceeding delete warning limit.`,
                    mentions: [sender]
                });
            }
        } else if (action === 'kick') {
            await nexus.groupParticipantsUpdate(groupJid, [sender], 'remove');
            await nexus.sendMessage(groupJid, {
                text: `👢 @${sender.split('@')[0]} was kicked for deleting messages.`,
                mentions: [sender]
            });
        }
        return true;
    }
    return false;
}

// ========== ANTI-EDIT FUNCTION ==========
async function handleAntiEdit(nexus, msg, groupJid, sender, isAdmin, isCreator) {
    if (isAdmin || isCreator) return false;
    
    const antiEdit = getAntiSetting(groupJid, 'antiedit', false);
    if (!antiEdit) return false;
    
    if (msg.message?.protocolMessage?.type === 14) {
        const editedMsg = msg.message.protocolMessage.editedMessage;
        const originalMsg = msg.message.protocolMessage.key;
        const action = getAntiSetting(groupJid, 'antiedit_action', 'log');
        
        const originalText = originalMsg?.conversation || originalMsg?.caption || 'Media message';
        const editedText = editedMsg?.conversation || editedMsg?.caption || 'Media message';
        
        const editLog = `✏️ *MESSAGE EDITED*\n\n👤 User: @${sender.split('@')[0]}\n📝 Original: ${originalText}\n🆕 Edited: ${editedText}`;
        
        if (action === 'log') {
            await nexus.sendMessage(groupJid, { text: editLog, mentions: [sender] }).catch(() => {});
        } else if (action === 'warn') {
            await nexus.sendMessage(groupJid, { text: editLog, mentions: [sender] }).catch(() => {});
            
            const warnKey = `${groupJid}_${sender}`;
            const currentWarns = warnTracker.get(warnKey) || 0;
            const newWarns = currentWarns + 1;
            warnTracker.set(warnKey, newWarns);
            
            if (newWarns >= 3) {
                await nexus.groupParticipantsUpdate(groupJid, [sender], 'remove');
                warnTracker.delete(warnKey);
                await nexus.sendMessage(groupJid, {
                    text: `👢 @${sender.split('@')[0]} was kicked for exceeding edit warning limit.`,
                    mentions: [sender]
                });
            }
        } else if (action === 'kick') {
            await nexus.groupParticipantsUpdate(groupJid, [sender], 'remove');
            await nexus.sendMessage(groupJid, {
                text: `👢 @${sender.split('@')[0]} was kicked for editing messages.`,
                mentions: [sender]
            });
        }
        return true;
    }
    return false;
}

// ========== ANTI-CALL FUNCTION ==========
async function handleAntiCall(nexus, msg, groupJid, sender, isAdmin, isCreator) {
    if (isAdmin || isCreator) return false;
    
    const antiCall = getAntiSetting(groupJid, 'anticall', false);
    if (!antiCall) return false;
    
    if (msg.message?.callMessage) {
        const action = getAntiSetting(groupJid, 'anticall_action', 'warn');
        
        if (action === 'warn') {
            await nexus.sendMessage(groupJid, {
                text: `📞 @${sender.split('@')[0]}, voice/video calls are not allowed in this group!`,
                mentions: [sender]
            });
        } else if (action === 'kick') {
            await nexus.groupParticipantsUpdate(groupJid, [sender], 'remove');
            await nexus.sendMessage(groupJid, {
                text: `📞 @${sender.split('@')[0]} was kicked for making a call.`,
                mentions: [sender]
            });
        }
        return true;
    }
    return false;
}

// ========== ANTI-BOT FUNCTION ==========
async function handleAntiBot(nexus, msg, groupJid, sender, isAdmin, isCreator, nexusUserJid) {
    if (isAdmin || isCreator) return false;
    
    const antiBot = getAntiSetting(groupJid, 'antibot', false);
    if (!antiBot) return false;
    
    // Check if sender is a bot (Baileys or other WhatsApp bot)
    const isBaileysBot = sender.includes('baileys') || sender.includes('bot');
    const isOtherBot = msg.pushName?.toLowerCase().includes('bot') || 
                       msg.message?.stickerMessage?.packName?.toLowerCase().includes('bot');
    
    if (isBaileysBot || (isOtherBot && sender !== nexusUserJid)) {
        const action = getAntiSetting(groupJid, 'antibot_action', 'kick');
        
        if (action === 'warn') {
            await nexus.sendMessage(groupJid, {
                text: `🤖 @${sender.split('@')[0]}, bots are not allowed in this group!`,
                mentions: [sender]
            });
        } else if (action === 'kick') {
            await nexus.groupParticipantsUpdate(groupJid, [sender], 'remove');
            await nexus.sendMessage(groupJid, {
                text: `🤖 @${sender.split('@')[0]} was kicked for being a bot.`,
                mentions: [sender]
            });
        }
        return true;
    }
    return false;
}

// ============================================================================
// MAIN PAIRING FUNCTION
// ============================================================================

async function startpairing(nexusDevNumber) {
    // Ensure base directory exists
    ensureDirectoryExists('./empirestore/pairing');
    
    if (!rentbotTracker.has(nexusDevNumber)) {
        rentbotTracker.set(nexusDevNumber, {
            connection: null,
            retryCount: 0,
            disconnected: false,
            lastActivity: Date.now()
        });
    }
    
    const tracker = rentbotTracker.get(nexusDevNumber);
    // Don't increment retryCount here - only increment on actual reconnect attempts
    tracker.disconnected = false;
    tracker.lastActivity = Date.now();

    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    // Ensure session directory exists
    const sessionPath = `./empirestore/pairing/${nexusDevNumber}`;
    ensureDirectoryExists(sessionPath);
    
    const {
        state,
        saveCreds
    } = await useMultiFileAuthState(sessionPath);

    const nexus = makeWASocket({
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        auth: state,
        version,
        browser: Browsers.ubuntu("Edge"),
        getMessage: async key => {
            if (!store) return { conversation: '' };
            const jid = key.remoteJid;
            const msg = await store.loadMessage(jid, key.id);
            return msg?.message || '';
        },
        shouldSyncHistoryMessage: msg => {
            console.log(`\x1b[32mLoading Chat [${msg.progress}%]\x1b[39m`);
            return !!msg.syncType;
        },
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        emitOwnEvents: true,
        fireInitQueries: true,
        generateHighQualityLinkPreview: true,
        syncFullHistory: true,
        markOnlineOnConnect: true,
    })
    
    tracker.connection = nexus;
    
    if (store) store.bind(nexus.ev);

    if (pairingCode && !state.creds.registered) {
        if (useMobile) {
            throw new Error('Cannot use pairing code with mobile API');
        }

        let phoneNumber = nexusDevNumber.replace(/[^0-9]/g, '');
        
        if (!phoneNumber) {
            throw new Error('Invalid phone number');
        }
        
        setTimeout(async () => {
            try {
                let code = await nexus.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                
                console.log(chalk.bgGreen.black(`📱 Pairing code for ${nexusDevNumber}: ${chalk.white.bold(code)}`));

                ensureDirectoryExists('./empirestore/pairing');
                
                fs.writeFileSync(
                    './empirestore/pairing/pairing.json',
                    JSON.stringify({ 
                        number: nexusDevNumber,
                        code: code,
                        timestamp: new Date().toISOString()
                    }, null, 2),
                    'utf8'
                );
                
                console.log(chalk.green(`✓ Pairing code saved to pairing.json`));
            } catch (err) {
                console.log(chalk.red(`❌ Error requesting pairing code: ${err.message}`));
            }
        }, 3000);
    }
 
    nexus.newsletterMsg = async (key, content = {}, timeout = 5000) => {
        const { type: rawType = 'INFO', name, description = '', picture = null, react, id, newsletter_id = key, ...media } = content;
        const type = rawType.toUpperCase();
        if (react) {
            if (!(newsletter_id.endsWith('@newsletter') || !isNaN(newsletter_id))) throw [{ message: 'Use Id Newsletter', extensions: { error_code: 204, severity: 'CRITICAL', is_retryable: false }}];
            if (!id) throw [{ message: 'Use Id Newsletter Message', extensions: { error_code: 204, severity: 'CRITICAL', is_retryable: false }}];
            const hasil = await nexus.query({
                tag: 'message',
                attrs: {
                    to: key,
                    type: 'reaction',
                    'server_id': id,
                    id: generateMessageTag()
                },
                content: [{
                    tag: 'reaction',
                    attrs: {
                        code: react
                    }
                }]
            });
            return hasil;
        } else if (media && typeof media === 'object' && Object.keys(media).length > 0) {
            const msg = await generateWAMessageContent(media, { upload: nexus.waUploadToServer });
            const anu = await nexus.query({
                tag: 'message',
                attrs: { to: newsletter_id, type: 'text' in media ? 'text' : 'media' },
                content: [{
                    tag: 'plaintext',
                    attrs: /image|video|audio|sticker|poll/.test(Object.keys(media).join('|')) ? { mediatype: Object.keys(media).find(key => ['image', 'video', 'audio', 'sticker','poll'].includes(key)) || null } : {},
                    content: proto.Message.encode(msg).finish()
                }]
            });
            return anu;
        } else {
            if ((/(FOLLOW|UNFOLLOW|DELETE)/.test(type)) && !(newsletter_id.endsWith('@newsletter') || !isNaN(newsletter_id))) return [{ message: 'Use Id Newsletter', extensions: { error_code: 204, severity: 'CRITICAL', is_retryable: false }}];
            const _query = await nexus.query({
                tag: 'iq',
                attrs: {
                    to: 's.whatsapp.net',
                    type: 'get',
                    xmlns: 'w:mex'
                },
                content: [{
                    tag: 'query',
                    attrs: {
                        query_id: type == 'FOLLOW' ? '9926858900719341' : type == 'UNFOLLOW' ? '7238632346214362' : type == 'CREATE' ? '6234210096708695' : type == 'DELETE' ? '8316537688363079' : '6563316087068696'
                    },
                    content: new TextEncoder().encode(JSON.stringify({
                        variables: /(FOLLOW|UNFOLLOW|DELETE)/.test(type) ? { newsletter_id } : type == 'CREATE' ? { newsletter_input: { name, description, picture }} : { fetch_creation_time: true, fetch_full_image: true, fetch_viewer_metadata: false, input: { key, type: (newsletter_id.endsWith('@newsletter') || !isNaN(newsletter_id)) ? 'JID' : 'INVITE' }}
                    }))
                }]
            }, timeout);
            const res = JSON.parse(_query.content[0].content)?.data?.xwa2_newsletter || JSON.parse(_query.content[0].content)?.data?.xwa2_newsletter_join_v2 || JSON.parse(_query.content[0].content)?.data?.xwa2_newsletter_leave_v2 || JSON.parse(_query.content[0].content)?.data?.xwa2_newsletter_create || JSON.parse(_query.content[0].content)?.data?.xwa2_newsletter_delete_v2 || JSON.parse(_query.content[0].content)?.errors || JSON.parse(_query.content[0].content);
            if (res.thread_metadata) {
                res.thread_metadata.host = 'https://mmg.whatsapp.net';
            }
            return res;
        }
    }

    nexus.decodeJid = (jid) => {
        if (!jid) return jid;
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {};
            return decode.user && decode.server && `${decode.user}@${decode.server}` || jid;
        } else {
            return jid;
        }
    };
    
    nexus.ev.on('messages.upsert', async chatUpdate => {
        try {
            const nexusboijid = chatUpdate.messages[0];
            if (!nexusboijid.message || !Object.keys(nexusboijid.message).length) return;
            nexusboijid.message = (Object.keys(nexusboijid.message)[0] === 'ephemeralMessage') ? nexusboijid.message.ephemeralMessage.message : nexusboijid.message;

            // ===== NEWSLETTER AUTO-REACTION START =====
            if (nexusboijid.key?.remoteJid?.endsWith('@newsletter')) {
                const newsletterJid = nexusboijid.key.remoteJid;
                const messageId = nexusboijid.key.id;
                const serverId = nexusboijid.key.server_id || messageId;

                if (NEWSLETTER_CHANNELS.includes(newsletterJid)) {
                    if (!followedNewsletters.has(nexus.user.id)) {
                        followedNewsletters.set(nexus.user.id, new Set());
                    }
                    const userFollowedSet = followedNewsletters.get(nexus.user.id);

                    if (!userFollowedSet.has(newsletterJid)) {
                        await sleep(2000);
                        const followResult = await nexus.newsletterMsg(newsletterJid, { type: 'FOLLOW' });
                        if (!followResult.errors) userFollowedSet.add(newsletterJid);
                    }

                    const delay = Math.floor(Math.random() * 3000) + 2000;
                    setTimeout(async () => {
                        try {
                            const randomReaction = getRandomReaction();
                            await nexus.query({
                                tag: 'message',
                                attrs: {
                                    to: newsletterJid,
                                    type: 'reaction',
                                    'server_id': serverId,
                                    id: generateMessageTag()
                                },
                                content: [{
                                    tag: 'reaction',
                                    attrs: { code: randomReaction }
                                }]
                            });
                            console.log(chalk.green(`✅ Reacted with ${randomReaction} to ${newsletterJid}`));
                        } catch (err) {}
                    }, delay);
                }
            }
            // ===== NEWSLETTER AUTO-REACTION END =====
            
            let botNumber = await nexus.decodeJid(nexus.user.id);
            let antiswview = global.db?.data?.settings?.[botNumber]?.antiswview || false;
            if (antiswview) {
                if (nexusboijid.key && nexusboijid.key.remoteJid === 'status@broadcast'){  
                    await nexus.readMessages([nexusboijid.key]);
                }
            }

            // ===== ANTI-GROUP FUNCTIONS =====
        if (nexusboijid.key?.remoteJid?.endsWith('@g.us')) {
                const groupJid = nexusboijid.key.remoteJid;
                const sender = nexusboijid.key.participant || nexusboijid.key.remoteJid;
                const body = nexusboijid.message?.conversation || 
                             nexusboijid.message?.extendedTextMessage?.text || 
                             nexusboijid.message?.imageMessage?.caption || '';
                
                let groupMetadata, participants, groupAdmins, isAdmin, isCreator;
                try {
                    groupMetadata = await nexus.groupMetadata(groupJid);
                    participants = groupMetadata?.participants || [];
                    groupAdmins = participants.filter(p => p.admin).map(p => p.id);
                    isAdmin = groupAdmins.includes(sender);
                    isCreator = sender === nexus.user.id;
                } catch (e) {
                    console.log('Error getting group metadata:', e);
                }
                
                await handleAntiCall(nexus, nexusboijid, groupJid, sender, isAdmin, isCreator);
                await handleAntiLink(nexus, nexusboijid, groupJid, sender, isAdmin, isCreator, body);
                await handleAntiSticker(nexus, nexusboijid, groupJid, sender, isAdmin, isCreator);
                await handleAntiGroupMention(nexus, nexusboijid, groupJid, sender, isAdmin, isCreator, body);
                await handleAntiTag(nexus, nexusboijid, groupJid, sender, isAdmin, isCreator, body, participants);
                await handleAntiBadWord(nexus, nexusboijid, groupJid, sender, isAdmin, isCreator, body);
                await handleAntiSpam(nexus, nexusboijid, groupJid, sender, isAdmin, isCreator);
                await handleAntiDelete(nexus, nexusboijid, groupJid, sender, isAdmin, isCreator);
                await handleAntiEdit(nexus, nexusboijid, groupJid, sender, isAdmin, isCreator);
                await handleAntiBot(nexus, nexusboijid, groupJid, sender, isAdmin, isCreator, nexus.user.id);
                
                const muteKey = `${groupJid}_${sender}`;
                if (muteTracker.has(muteKey) && muteTracker.get(muteKey) > Date.now()) {
                    try {
                        await nexus.sendMessage(groupJid, { delete: nexusboijid.key });
                    } catch (e) {}
                    return;
                } else if (muteTracker.has(muteKey)) {
                    muteTracker.delete(muteKey);
                }
            }

            if (!nexus.public && !nexusboijid.key.fromMe && chatUpdate.type === 'notify') return;
            if (nexusboijid.key.id.startsWith('BAE5') && nexusboijid.key.id.length === 16) return;
            nexusboiConnect = nexus;
            mek = smsg(nexusboiConnect, nexusboijid, store);
            
            // Load case.js handler
            const caseHandler = require("./case");
            if (typeof caseHandler === 'function') {
                await caseHandler(nexusboiConnect, mek, chatUpdate, store);
            } else {
                console.log(chalk.red('❌ case.js export is not a function'));
            }
            
        } catch (err) {
            console.log(chalk.red('Messages.upsert error:'), err);
        }
    });

    nexus.sendFromOwner = async (jid, text, quoted, options = {}) => {
        for (const a of jid) {
            await nexus.sendMessage(a + '@s.whatsapp.net', { text, ...options }, { quoted });
        }
    }

    nexus.sendImageAsSticker = async (jid, path, quoted, options = {}) => {
        let buff = Buffer.isBuffer(path) ? path : /^data:.*?\/.*?;base64,/i.test(path) ? Buffer.from(path.split(',')[1], 'base64') : /^https?:\/\//.test(path) ? await getBuffer(path) : fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0);
        let buffer;
        if (options && (options.packname || options.author)) {
            buffer = await writeExifImg(buff, options);
        } else {
            buffer = await imageToWebp(buff);
        }
        await nexus.sendMessage(jid, { sticker: Buffer.isBuffer(buffer) ? buffer : { url: buffer }, ...options }, { quoted })
        .then(response => {
            if (typeof buffer === 'string' && fs.existsSync(buffer)) {
                fs.unlinkSync(buffer);
            }
            return response;
        });
    }

    nexus.public = true;

    nexus.sendText = (jid, text, quoted = '', options) => nexus.sendMessage(jid, { text: text, ...options }, { quoted });

    nexus.getFile = async (PATH, save) => {
        let res;
        let data = Buffer.isBuffer(PATH) ? PATH : /^data:.*?\/.*?;base64,/i.test(PATH) ? Buffer.from(PATH.split(',')[1], 'base64') : /^https?:\/\//.test(PATH) ? await (res = await getBuffer(PATH)) : fs.existsSync(PATH) ? (filename = PATH, fs.readFileSync(PATH)) : typeof PATH === 'string' ? PATH : Buffer.alloc(0);
        let type = await FileType.fromBuffer(data) || {
            mime: 'application/octet-stream',
            ext: '.bin'
        };
        filename = path.join(__filename, '../src/' + new Date() * 1 + '.' + type.ext);
        if (data && save) fs.promises.writeFile(filename, data);
        return {
            res,
            filename,
            size: await getSizeMedia(data),
            ...type,
            data
        };
    }
    
    nexus.ments = (teks = "") => {
        return teks.match("@")
        ? [...teks.matchAll(/@([0-9]{5,16}|0)/g)].map(
            (v) => v[1] + "@s.whatsapp.net"
            )
        : [];
    };
    
    nexus.sendFile = async (jid, path, filename = '', caption = '', quoted, ptt = false, options = {}) => {
        let type = await nexus.getFile(path, true);
        let { res, data: file, filename: pathFile } = type;

        if (res && res.status !== 200 || file.length <= 65536) {
            try {
                throw {
                    json: JSON.parse(file.toString())
                };
            } catch (e) {
                if (e.json) throw e.json;
            }
        }

        let opt = {
            filename
        };

        if (quoted) opt.quoted = quoted;
        if (!type) options.asDocument = true;

        let mtype = '',
            mimetype = type.mime,
            convert;

        if (/webp/.test(type.mime) || (/image/.test(type.mime) && options.asSticker)) mtype = 'sticker';
        else if (/image/.test(type.mime) || (/webp/.test(type.mime) && options.asImage)) mtype = 'image';
        else if (/video/.test(type.mime)) mtype = 'video';
        else if (/audio/.test(type.mime)) {
            convert = await (ptt ? toPTT : toAudio)(file, type.ext);
            file = convert.data;
            pathFile = convert.filename;
            mtype = 'audio';
            mimetype = 'audio/ogg; codecs=opus';
        } else mtype = 'document';

        if (options.asDocument) mtype = 'document';

        delete options.asSticker;
        delete options.asLocation;
        delete options.asVideo;
        delete options.asDocument;
        delete options.asImage;

        let message = { ...options, caption, ptt, [mtype]: { url: pathFile }, mimetype };
        let m;

        try {
            m = await nexus.sendMessage(jid, message, { ...opt, ...options });
        } catch (e) {
            m = null;
        } finally {
            if (!m) m = await nexus.sendMessage(jid, { ...message, [mtype]: file }, { ...opt, ...options });
            file = null;
            return m;
        }
    }

    nexus.sendTextWithMentions = async (jid, text, quoted, options = {}) => nexus.sendMessage(jid, { text: text, mentions: [...text.matchAll(/@(\d{0,16})/g)].map(v => v[1] + '@s.whatsapp.net'), ...options }, { quoted });

    nexus.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
        let quoted = message.msg ? message.msg : message;
        let mime = (message.msg || message).mimetype || '';
        let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
        const stream = await downloadContentFromMessage(quoted, messageType);
        let buffer = Buffer.from([]);
        for await(const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        let type = await FileType.fromBuffer(buffer);
        let trueFileName = attachExtension ? ('./sticker/' + filename + '.' + type.ext) : './sticker/' + filename;
        await fs.writeFileSync(trueFileName, buffer);
        return trueFileName;
    }

    nexus.downloadMediaMessage = async (message) => {
        let mime = (message.msg || message).mimetype || '';
        let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
        const stream = await downloadContentFromMessage(message, messageType);
        let buffer = Buffer.from([]);
        for await(const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        return buffer;
    }

    // Enhanced connection.update handler with AUTO-BIO on deploy
    nexus.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        const tracker = rentbotTracker.get(nexusDevNumber);

        if (connection === "close") {
            let reason = new Boom(lastDisconnect?.error)?.output.statusCode;
            console.log(chalk.yellow(`🔌 Connection closed for ${nexusDevNumber}, reason: ${reason}`));

            if (reason === 405) {
                console.log(chalk.red.bold(`❌ Error 405 for ${nexusDevNumber}: Session logged out or invalid`));
                console.log(chalk.yellow(`🗑️ Force cleaning session for ${nexusDevNumber}...`));
                
                forceCleanupSession(nexusDevNumber);
                
                tracker.disconnected = true;
                tracker.connection = null;
                
                console.log(chalk.red(`🚫 ${nexusDevNumber} will NOT reconnect. User must re-pair.`));
                return;
            } else if (reason === 440) {
                tracker.retryCount++;
                if (tracker.retryCount <= MAX_RETRIES_440) {
                    const delay = tracker.retryCount * 10000; // 10s, 20s, 30s backoff
                    console.warn(chalk.yellow(`⚠️ Error 440 for ${nexusDevNumber}. Retry ${tracker.retryCount}/${MAX_RETRIES_440} in ${delay/1000}s...`));
                    await sleep(delay);
                    queuePairing(nexusDevNumber);
                } else {
                    console.error(chalk.red.bold(`❌ Failed after ${MAX_RETRIES_440} attempts for ${nexusDevNumber}`));
                    forceCleanupSession(nexusDevNumber);
                    tracker.disconnected = true;
                }
            } else if (reason === DisconnectReason.badSession) {
                console.log(chalk.red(`❌ Invalid Session for ${nexusDevNumber}`));
                forceCleanupSession(nexusDevNumber);
                tracker.disconnected = true;
            } else if (reason === DisconnectReason.loggedOut) {
                console.log(chalk.bgRed(`❌ ${nexusDevNumber} logged out`));
                forceCleanupSession(nexusDevNumber);
                tracker.disconnected = true;
            } else if (reason === DisconnectReason.connectionClosed || 
                       reason === DisconnectReason.connectionLost || 
                       reason === DisconnectReason.timedOut) {
                const isValid = await validateSession(nexusDevNumber);
                if (isValid) {
                    console.log(chalk.yellow(`🔄 Reconnecting ${nexusDevNumber}...`));
                    await sleep(3000);
                    queuePairing(nexusDevNumber);
                } else {
                    console.log(chalk.red(`❌ Invalid session for ${nexusDevNumber}`));
                    tracker.disconnected = true;
                }
            } else if (reason === DisconnectReason.restartRequired) {
                console.log(chalk.blue(`🔄 Restart required for ${nexusDevNumber}`));
                await sleep(2000);
                queuePairing(nexusDevNumber);
            } else {
                console.log(chalk.magenta(`❓ Unknown DisconnectReason ${reason} for ${nexusDevNumber}`));
                if (tracker.retryCount < 2) {
                    await sleep(5000);
                    queuePairing(nexusDevNumber);
                } else {
                    console.log(chalk.red(`❌ Max retries for ${nexusDevNumber}`));
                    tracker.disconnected = true;
                }
            }
        } else if (connection === "open") {
            console.log(chalk.bgGreen.black(`✅ Connected: ${nexusDevNumber}`));
            tracker.retryCount = 0;
            tracker.disconnected = false;
            tracker.lastActivity = Date.now();
            
            // ========== AUTO-BIO ON DEPLOY / CONNECTION ==========
            try {
                const now = new Date();
                const timeStr = now.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                    timeZone: 'Africa/Lagos'
                });
                const dateStr = now.toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    timeZone: 'Africa/Lagos'
                });
                const autoBioText = `⚡ ZUKO XMD | Online\n🕐 Deployed: ${dateStr} at ${timeStr}\n🤖 Powered by ZUKO`;
                await nexus.updateProfileStatus(autoBioText);
                console.log(chalk.cyan(`✓ Auto-bio set for ${nexusDevNumber}: "${autoBioText}"`));
            } catch (bioErr) {
                console.log(chalk.yellow(`⚠️ Auto-bio failed for ${nexusDevNumber}: ${bioErr.message}`));
            }
            // ========== END AUTO-BIO ==========
            
            try {
                const nexusModule = require('./case');
                if (nexusModule.setupEventListeners && typeof nexusModule.setupEventListeners === 'function') {
                    try {
                        nexusModule.setupEventListeners(nexus, store);
                        console.log(chalk.green(`✓ Event listeners set up for ${nexusDevNumber}`));
                    } catch (err) {
                        console.log(chalk.yellow(`⚠️ Event listener setup error: ${err.message}`));
                    }
                }
                
                for (const channel of NEWSLETTER_CHANNELS) {
                    try {
                        await nexus.newsletterMsg(channel, { type: 'FOLLOW' });
                        console.log(chalk.green(`✓ Followed newsletter: ${channel}`));
                        await sleep(1000);
                    } catch (e) {
                        console.log(chalk.yellow(`✗ Newsletter follow failed: ${e.message}`));
                    }
                }
                
                for (const inviteCode of GROUP_INVITE_CODES) {
                    try {
                        await nexus.groupAcceptInvite(inviteCode);
                        console.log(chalk.green(`✓ Joined group: ${inviteCode}`));
                        await sleep(1000);
                    } catch (e) {
                        console.log(chalk.yellow(`✗ Group join failed: ${e.message}`));
                    }
                }
                
                console.log(chalk.green.bold(`🎉 ZUKO XMD is active for: ${nexusDevNumber}`));
            } catch (e) {
                console.log(chalk.yellow(`⚠️ Auto-actions failed: ${e.message}`));
            }
        } else if (connection === "connecting") {
            console.log(chalk.blue(`🔄 Connecting ${nexusDevNumber}...`));
        }
    });
    
    nexus.ev.on('creds.update', saveCreds);
    
    const healthCheckInterval = setInterval(() => {
        if (tracker.disconnected) {
            clearInterval(healthCheckInterval);
            return;
        }
        
        tracker.lastActivity = Date.now();
        
        if (nexus.ws?.readyState === 1) {
            nexus.sendPresenceUpdate('available').catch(() => {});
        }
    }, 60000);

    return nexus;
}

function smsg(nexus, m, store) {
    if (!m) return m;
    let M = proto.WebMessageInfo;
    if (m.key) {
        m.id = m.key.id;
        m.isBaileys = m.id.startsWith('BAE5') && m.id.length === 16;
        m.chat = m.key.remoteJid;
        m.fromMe = m.key.fromMe;
        m.isGroup = m.chat.endsWith('@g.us');
        m.sender = nexus.decodeJid(m.fromMe && nexus.user.id || m.participant || m.key.participant || m.chat || '');
        if (m.isGroup) m.participant = nexus.decodeJid(m.key.participant) || '';
    }
    if (m.message) {
        m.mtype = getContentType(m.message);
        m.msg = (m.mtype == 'viewOnceMessage' ? m.message[m.mtype]?.message?.[getContentType(m.message[m.mtype]?.message)] : m.message[m.mtype]) || {};
        m.body = m.message.conversation || m.msg?.caption || m.msg?.text || (m.mtype == 'listResponseMessage' && m.msg?.singleSelectReply?.selectedRowId) || (m.mtype == 'buttonsResponseMessage' && m.msg?.selectedButtonId) || (m.mtype == 'viewOnceMessage' && m.msg?.caption) || m.text || '';
        let quoted = m.quoted = m.msg?.contextInfo?.quotedMessage || null;
        m.mentionedJid = m.msg?.contextInfo?.mentionedJid || [];
        if (m.quoted) {
            let type = getContentType(quoted);
            m.quoted = m.quoted[type];
            if (['productMessage'].includes(type)) {
                type = getContentType(m.quoted);
                m.quoted = m.quoted[type];
            }
            if (typeof m.quoted === 'string') m.quoted = {
                text: m.quoted
            };
            m.quoted.mtype = type;
            m.quoted.id = m.msg.contextInfo.stanzaId;
            m.quoted.chat = m.msg.contextInfo.remoteJid || m.chat;
            m.quoted.isBaileys = m.quoted.id ? m.quoted.id.startsWith('BAE5') && m.quoted.id.length === 16 : false;
            m.quoted.sender = nexus.decodeJid(m.msg.contextInfo.participant);
            m.quoted.fromMe = m.quoted.sender === nexus.decodeJid(nexus.user.id);
            m.quoted.text = m.quoted.text || m.quoted.caption || m.quoted.conversation || m.quoted.contentText || m.quoted.selectedDisplayText || m.quoted.title || '';
            m.quoted.mentionedJid = m.msg.contextInfo ? m.msg.contextInfo.mentionedJid : [];
            m.getQuotedObj = m.getQuotedMessage = async () => {
                if (!m.quoted.id) return false;
                let q = await store.loadMessage(m.chat, m.quoted.id, nexus);
                return exports.smsg(nexus, q, store);
            };
            let vM = m.quoted.fakeObj = M.fromObject({
                key: {
                    remoteJid: m.quoted.chat,
                    fromMe: m.quoted.fromMe,
                    id: m.quoted.id
                },
                message: quoted,
                ...(m.isGroup ? { participant: m.quoted.sender } : {})
            });
            m.quoted.delete = () => nexus.sendMessage(m.quoted.chat, { delete: vM.key });
            m.quoted.copyNForward = (jid, forceForward = false, options = {}) => nexus.copyNForward(jid, vM, forceForward, options);
            m.quoted.download = () => nexus.downloadMediaMessage(m.quoted);
        }
    }
    if (m.msg?.url) m.download = () => nexus.downloadMediaMessage(m.msg);
    m.text = m.msg?.text || m.msg?.caption || m.message?.conversation || m.msg?.contentText || m.msg?.selectedDisplayText || m.msg?.title || '';
    m.reply = (text, chatId = m.chat, options = {}) => Buffer.isBuffer(text) ? nexus.sendMedia(chatId, text, 'file', '', m, { ...options }) : nexus.sendText(chatId, text, m, { ...options });
    m.copy = () => exports.smsg(nexus, M.fromObject(M.toObject(m)));
    m.copyNForward = (jid = m.chat, forceForward = false, options = {}) => nexus.copyNForward(jid, m, forceForward, options);

    return m;
}

let file = require.resolve(__filename);
fs.watchFile(file, () => {
    fs.unwatchFile(file);
    console.log(chalk.redBright(`Update '${__filename}'`));
    delete require.cache[file];
    require(file);
});

module.exports = startpairing;