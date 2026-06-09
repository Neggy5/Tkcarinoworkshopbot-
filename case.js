require('./setting/config')
const { 
  default: baileys, proto, jidNormalizedUser, generateWAMessage, 
  generateWAMessageFromContent, getContentType, prepareWAMessageMedia 
} = require("@whiskeysockets/baileys");

const fs = require('fs')
const util = require('util')
const chalk = require('chalk')
const axios = require('axios')
const moment = require('moment-timezone')

const { smsg, getGroupAdmins, sleep, isUrl, getBuffer, runtime, fetchJson } = require('./allfunc/storage')
const { getSetting, setSetting } = require("./setting/Settings.js")
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid, addExif } = require('./allfunc/exif.js')

// Database
const dbPath = './database.json'
let db;

try {
    const dbContent = fs.readFileSync(dbPath, 'utf8');
    db = JSON.parse(dbContent);
    console.log('✅ Database loaded successfully');
} catch (err) {
    console.error('❌ Database error:', err.message);
    console.log('🔄 Creating new database...');
    db = {
        users: {}, groups: {}, warns: {}, muted: {}, paired: {},
        activity: {}, scheduled: {}, notes: {}, audit: {}, jail: {},
        silence: {}, lockmedia: {}, shadowban: {}
    };
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    console.log('✅ New database created');
}

let _saveDBTimer = null;
function saveDB() {
    if (_saveDBTimer) clearTimeout(_saveDBTimer);
    _saveDBTimer = setTimeout(() => {
        try {
            fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
        } catch (err) {
            console.error('❌ Failed to save database:', err.message);
        }
    }, 2000);
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ========== AUTO STATUS REACT & VIEW SYSTEM ==========
const processedStatuses = new Set();
let autoStatusReact = true;
let autoStatusView = true;
let statusReactions = ["❤️","🔥","👍","😢","🥲","😭","😂","🫠","😲","🙏","💯","✨","🌟","🎉","💪","👏","🙌","🤝","💝","🎯"];

function getRandomStatusReaction() {
    return statusReactions[Math.floor(Math.random() * statusReactions.length)];
}

async function handleStatusMessage(empire, msg) {
    try {
        const isStatus = msg.key?.remoteJid === 'status@broadcast';
        if (!isStatus) return false;
        const statusId = msg.key?.id;
        if (processedStatuses.has(statusId)) return false;
        processedStatuses.add(statusId);
        console.log(chalk.yellow(`📱 Status detected from: ${msg.pushName || 'Unknown'}`));
        if (autoStatusView) {
            try {
                await empire.readMessages([msg.key]);
                console.log(chalk.green(`✅ Viewed status from ${msg.pushName || 'Unknown'}`));
            } catch (err) {
                console.log(chalk.yellow(`⚠️ Failed to view status: ${err.message}`));
            }
        }
        if (autoStatusReact) {
            try {
                await sleep(2000);
                const reaction = getRandomStatusReaction();
                await empire.sendMessage('status@broadcast', { react: { text: reaction, key: msg.key } });
                console.log(chalk.green(`✅ Reacted to status with ${reaction}`));
            } catch (err) {
                console.log(chalk.yellow(`⚠️ Failed to react to status: ${err.message}`));
            }
        }
        if (processedStatuses.size > 100) {
            const toDelete = [...processedStatuses].slice(0, 50);
            toDelete.forEach(id => processedStatuses.delete(id));
        }
        return true;
    } catch (err) {
        console.error('Status handler error:', err);
        return false;
    }
}

function setAutoStatusReact(enabled) { autoStatusReact = enabled; }
function setAutoStatusView(enabled) { autoStatusView = enabled; }
function getAutoStatusSettings() { return { autoReact: autoStatusReact, autoView: autoStatusView, reactions: statusReactions }; }
function addStatusReaction(reaction) {
    if (reaction && !statusReactions.includes(reaction)) statusReactions.push(reaction);
}

// ========== MAIN BOT FUNCTION ==========
module.exports = empire = async (empire, m, chatUpdate, store) => {
    const { from } = m
    
    try {
        const body = m.message?.conversation || 
                     m.message?.extendedTextMessage?.text || 
                     m.message?.imageMessage?.caption || "";
        
        const prefix = /^[°zZ#$@+,.?=''():√%!¢£¥€π¤ΠΦ&><™©®Δ^βα¦|/\\©^]/.test(body) 
            ? body.match(/^[°zZ#$@+,.?=''():√%¢£¥€π¤ΠΦ&><!™©®Δ^βα¦|/\\©^]/gi)[0] 
            : '/';
        
        const isCmd = body.startsWith(prefix);
        const args = body.slice(prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        const text = args.join(" ");
        
        const botNumber = await empire.decodeJid(empire.user.id)
        const owner = JSON.parse(fs.readFileSync('./allfunc/owner.json'))
        const isCreator = [botNumber, ...owner].map(v => v.replace(/[^0-9]/g, '') + '@s.whatsapp.net').includes(m.sender)
        const isGroup = m.isGroup
        const pushname = m.pushName || "User"
        
        if (!global.groupMetadataCache) global.groupMetadataCache = {}
        const GROUP_CACHE_TTL = 5 * 60 * 1000
        let groupMetadata, participants, groupAdmins, isBotAdmins, isAdmins, groupName
        if (isGroup) {
            const cached = global.groupMetadataCache[m.chat]
            const now = Date.now()
            if (cached && (now - cached.time) < GROUP_CACHE_TTL) {
                groupMetadata = cached.data
            } else {
                groupMetadata = await empire.groupMetadata(m.chat).catch(() => null)
                if (groupMetadata) global.groupMetadataCache[m.chat] = { data: groupMetadata, time: now }
            }
            participants = groupMetadata?.participants || []
            groupAdmins = participants.filter(p => p.admin).map(p => p.id)
            isBotAdmins = groupAdmins.includes(botNumber)
            isAdmins = groupAdmins.includes(m.sender)
            groupName = groupMetadata?.subject || ""
        }
        
        const reply = (teks) => {
            empire.sendMessage(m.chat, { text: teks }, { quoted: m })
        }

        // ========== AUTO PROTECTION LAYERS ==========

        if (m.isGroup && !isCreator && !isAdmins) {
            // ANTI-STICKER
            if (m.message?.stickerMessage) {
                const antisticker = getSetting(m.chat, 'antisticker', false);
                if (antisticker) {
                    const action = getSetting(m.chat, 'antisticker_action', 'delete');
                    await empire.sendMessage(m.chat, { delete: m.key }).catch(() => {});
                    if (action === 'warn') {
                        await empire.sendMessage(m.chat, { text: `⚠️ @${m.sender.split('@')[0]}, stickers are not allowed! Warning issued.`, mentions: [m.sender] });
                        if (!db.warns) db.warns = {};
                        if (!db.warns[m.sender]) db.warns[m.sender] = 0;
                        db.warns[m.sender]++;
                        saveDB();
                        if (db.warns[m.sender] >= 3) {
                            await empire.groupParticipantsUpdate(m.chat, [m.sender], 'remove');
                            delete db.warns[m.sender]; saveDB();
                            await empire.sendMessage(m.chat, { text: `👢 @${m.sender.split('@')[0]} was kicked for exceeding warning limit.`, mentions: [m.sender] });
                        }
                    } else if (action === 'kick') {
                        await empire.groupParticipantsUpdate(m.chat, [m.sender], 'remove');
                        await empire.sendMessage(m.chat, { text: `👢 @${m.sender.split('@')[0]} was kicked for sending stickers.`, mentions: [m.sender] });
                    }
                    return;
                }
            }
            // ANTI-LINK
            const antilink = getSetting(m.chat, 'antilink', false);
            if (antilink && m.text) {
                const body2 = m.text || '';
                const isLink = /chat\.whatsapp\.com\//i.test(body2) || /whatsapp\.com\/channel\//i.test(body2) || /wa\.me\//i.test(body2);
                if (isLink) {
                    const allowedDomains = getSetting(m.chat, 'allowedDomains', []);
                    const isAllowed = allowedDomains.some(domain => body2.toLowerCase().includes(domain));
                    if (!isAllowed) {
                        const action = getSetting(m.chat, 'antilink_action', 'delete');
                        await empire.sendMessage(m.chat, { delete: m.key }).catch(() => {});
                        if (action === 'warn') {
                            await empire.sendMessage(m.chat, { text: `⚠️ @${m.sender.split('@')[0]}, WhatsApp links are not allowed!`, mentions: [m.sender] });
                            if (!db.warns) db.warns = {};
                            if (!db.warns[m.sender]) db.warns[m.sender] = 0;
                            db.warns[m.sender]++;
                            saveDB();
                            if (db.warns[m.sender] >= 3) {
                                await empire.groupParticipantsUpdate(m.chat, [m.sender], 'remove');
                                delete db.warns[m.sender]; saveDB();
                                await empire.sendMessage(m.chat, { text: `👢 @${m.sender.split('@')[0]} was kicked for exceeding warning limit.`, mentions: [m.sender] });
                            }
                        } else if (action === 'kick') {
                            await empire.groupParticipantsUpdate(m.chat, [m.sender], 'remove');
                            await empire.sendMessage(m.chat, { text: `👢 @${m.sender.split('@')[0]} was kicked for sending a WhatsApp link.`, mentions: [m.sender] });
                        }
                        return;
                    }
                }
            }
            // ANTI-BAD WORD
            const antiword = getSetting(m.chat, 'antiword', false);
            if (antiword && m.text) {
                const badWords = getSetting(m.chat, 'badWords', []);
                if (badWords.some(word => m.text.toLowerCase().includes(word.toLowerCase()))) {
                    const action = getSetting(m.chat, 'antiword_action', 'delete');
                    await empire.sendMessage(m.chat, { delete: m.key }).catch(() => {});
                    if (action === 'warn') {
                        await empire.sendMessage(m.chat, { text: `⚠️ @${m.sender.split('@')[0]}, inappropriate language is not allowed! Warning issued.`, mentions: [m.sender] });
                        if (!db.warns) db.warns = {};
                        if (!db.warns[m.sender]) db.warns[m.sender] = 0;
                        db.warns[m.sender]++;
                        saveDB();
                        if (db.warns[m.sender] >= 3) {
                            await empire.groupParticipantsUpdate(m.chat, [m.sender], 'remove');
                            delete db.warns[m.sender]; saveDB();
                            await empire.sendMessage(m.chat, { text: `👢 @${m.sender.split('@')[0]} was kicked for exceeding warning limit.`, mentions: [m.sender] });
                        }
                    } else if (action === 'kick') {
                        await empire.groupParticipantsUpdate(m.chat, [m.sender], 'remove');
                        await empire.sendMessage(m.chat, { text: `👢 @${m.sender.split('@')[0]} was kicked for inappropriate language.`, mentions: [m.sender] });
                    }
                    return;
                }
            }
            // ANTI-SPAM
            const antispam = getSetting(m.chat, 'antispam', false);
            if (antispam && m.text) {
                if (!global.spamTracker) global.spamTracker = {};
                if (!global.spamTracker[m.sender]) global.spamTracker[m.sender] = { count: 0, timestamp: Date.now() };
                const tracker = global.spamTracker[m.sender];
                const timeDiff = Date.now() - tracker.timestamp;
                if (timeDiff < 5000) { tracker.count++; } else { tracker.count = 1; tracker.timestamp = Date.now(); }
                const limit = getSetting(m.chat, 'antispam_limit', 5);
                if (tracker.count > limit) {
                    const action = getSetting(m.chat, 'antispam_action', 'warn');
                    if (action === 'warn') {
                        await empire.sendMessage(m.chat, { text: `⚠️ @${m.sender.split('@')[0]}, please don't spam! Warning issued.`, mentions: [m.sender] });
                        if (!db.warns) db.warns = {};
                        if (!db.warns[m.sender]) db.warns[m.sender] = 0;
                        db.warns[m.sender]++;
                        saveDB();
                        if (db.warns[m.sender] >= 3) {
                            await empire.groupParticipantsUpdate(m.chat, [m.sender], 'remove');
                            delete db.warns[m.sender]; delete global.spamTracker[m.sender]; saveDB();
                            await empire.sendMessage(m.chat, { text: `👢 @${m.sender.split('@')[0]} was kicked for spamming.`, mentions: [m.sender] });
                        }
                    } else if (action === 'kick') {
                        await empire.groupParticipantsUpdate(m.chat, [m.sender], 'remove');
                        delete global.spamTracker[m.sender];
                        await empire.sendMessage(m.chat, { text: `👢 @${m.sender.split('@')[0]} was kicked for spamming.`, mentions: [m.sender] });
                    }
                    tracker.count = 0;
                    return;
                }
            }
        }

        // ANTI-DELETE
        if (m.message?.protocolMessage?.type === 0 && m.isGroup) {
            const antidelete = getSetting(m.chat, 'antidelete', false);
            if (antidelete) {
                const deletedMsg = m.message.protocolMessage.deletedMessage;
                if (deletedMsg) {
                    const action = getSetting(m.chat, 'antidelete_action', 'log');
                    const deletedText = deletedMsg.conversation || deletedMsg.caption || 'Media message';
                    const deleteLog = `🗑️ *Message Deleted*\n\n👤 User: @${m.sender.split('@')[0]}\n📝 Content: ${deletedText}`;
                    if (action === 'log') {
                        await empire.sendMessage(m.chat, { text: deleteLog, mentions: [m.sender] }).catch(() => {});
                    } else if (action === 'warn') {
                        await empire.sendMessage(m.chat, { text: deleteLog, mentions: [m.sender] }).catch(() => {});
                        if (!db.warns) db.warns = {};
                        if (!db.warns[m.sender]) db.warns[m.sender] = 0;
                        db.warns[m.sender]++;
                        saveDB();
                        if (db.warns[m.sender] >= 3) {
                            await empire.groupParticipantsUpdate(m.chat, [m.sender], 'remove');
                            delete db.warns[m.sender]; saveDB();
                            await empire.sendMessage(m.chat, { text: `👢 @${m.sender.split('@')[0]} was kicked for exceeding delete warning limit.`, mentions: [m.sender] });
                        }
                    } else if (action === 'kick') {
                        await empire.groupParticipantsUpdate(m.chat, [m.sender], 'remove');
                        await empire.sendMessage(m.chat, { text: `👢 @${m.sender.split('@')[0]} was kicked for deleting messages.`, mentions: [m.sender] });
                    }
                }
            }
        }
        
        if (!isCmd) return
        
        // ========== COMMANDS ==========
        switch(command) {

// ========== MENU ==========
case 'menu':
case 'help': {
    const usedMemory = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
    const menu = `
┌───[ 🌻✨ TK CARIÑO WORKSHOP ¤BOT ]
│
├  ⏱️ ${runtime(process.uptime())}
├  💾 ${usedMemory} MB RAM
│
├───[ ⚙️ GROUP MANAGEMENT ]
│  ├ ${prefix}add <number>
│  ├ ${prefix}kick @user
│  ├ ${prefix}kickall
│  ├ ${prefix}promote @user
│  ├ ${prefix}demote @user
│  ├ ${prefix}mute / ${prefix}unmute
│  ├ ${prefix}open / ${prefix}close
│  ├ ${prefix}link
│  ├ ${prefix}tagall
│  ├ ${prefix}tagadmins
│  ├ ${prefix}hidetag
│  ├ ${prefix}warn @user
│  ├ ${prefix}unwarn @user
│  ├ ${prefix}warns @user
│  ├ ${prefix}warnclean @user
│  ├ ${prefix}muteuser @user
│  ├ ${prefix}unmuteuser @user
│  ├ ${prefix}setgrouppp
│  ├ ${prefix}groupname <name>
│  ├ ${prefix}groupdesc <desc>
│  ├ ${prefix}groupinfo
│  ├ ${prefix}listadmins
│  ├ ${prefix}listmembers
│  ├ ${prefix}groupstatus
│  ├ ${prefix}groupstats
│  ├ ${prefix}groupcheck
│  ├ ${prefix}groupcard
│  ├ ${prefix}groupsettings
│  ├ ${prefix}backupgroup
│  ├ ${prefix}restoregroup
│  ├ ${prefix}setrules <rules>
│  ├ ${prefix}rules
│  ├ ${prefix}announce <msg>
│  ├ ${prefix}poll <question>
│  ├ ${prefix}welcome on/off
│  ├ ${prefix}goodbye on/off
│  ├ ${prefix}votekick @user
│  ├ ${prefix}checkadmin
│  └ ${prefix}vcfadmin
│
├───[ 🛡️ ANTI & PROTECTION ]
│  ├ ${prefix}antilink on/off
│  ├ ${prefix}antilink action <kick/warn/delete>
│  ├ ${prefix}antilink allow <domain>
│  ├ ${prefix}antiword on/off
│  ├ ${prefix}antiword add <word>
│  ├ ${prefix}antiword remove <word>
│  ├ ${prefix}antispam on/off
│  ├ ${prefix}antispam set <number>
│  ├ ${prefix}antisticker on/off
│  ├ ${prefix}antisticker action <kick/warn/delete>
│  ├ ${prefix}antidelete on/off
│  ├ ${prefix}lockmedia on/off
│  ├ ${prefix}antigroupmention on/off
│  └ ${prefix}stickerban / ${prefix}sban
│
├───[ 📢 CHANNEL ]
│  └ ${prefix}creact <link> <count> <emoji1> [emoji2...]
│
└───[ 🌻✨ TK Cariño Workshop ¤bot ]`.trim();

    await empire.sendMessage(m.chat, {
        text: menu,
        contextInfo: {
            mentionedJid: [m.sender],
            externalAdReply: {
                title: `🌻✨ TK Cariño Workshop ¤bot`,
                body: `Group Manager • ${runtime(process.uptime())}`,
                mediaType: 1,
                renderLargerThumbnail: true
            }
        }
    }, { quoted: m });
}
break;

// ========== CHANNEL REACTION COMMAND ==========
case 'creact':
case 'channelreact':
case 'reactchannel': {
    if (!isCreator && !isAdmins) return reply(`❌ Only admins or bot owner can use this!`);

    // ── HELP ──────────────────────────────────────────────────────────────
    if (!text) return reply(
        `╔════════════════════════╗\n` +
        `║  📢 *CHANNEL REACTION*  ║\n` +
        `╚════════════════════════╝\n\n` +
        `*Two ways to use:*\n\n` +
        `① *By post link:*\n` +
        `  ${prefix}creact <post_link> <count> <emoji...>\n\n` +
        `② *By channel ID + message ID:*\n` +
        `  ${prefix}creact <channelID> <msgID> <count> <emoji...>\n\n` +
        `📌 *Examples:*\n` +
        `  ${prefix}creact https://whatsapp.com/channel/0029Va.../100 1000 👍 ❤️ 🔥\n` +
        `  ${prefix}creact 120363315577814922 50 1000 👍 🔥\n\n` +
        `⚙️ *Notes:*\n` +
        `• Max reactions per emoji: *1000*\n` +
        `• Multiple emojis multiply the total count\n` +
        `• Rate-limited automatically (5/burst, 3s gap)\n` +
        `• Runs in background — you'll get a done report\n\n` +
        `🌻✨ TK Cariño Workshop ¤bot`
    );

    // ── PARSE ARGUMENTS ───────────────────────────────────────────────────
    const parts = text.trim().split(/\s+/);
    let channelId, messageId, countRaw, emojis;

    const firstArg = parts[0];
    const isLink = firstArg.includes('whatsapp.com/channel/');
    // A bare channel ID is all digits (no slashes, no http)
    const isBareId = /^\d{15,}$/.test(firstArg);

    if (isLink) {
        // ── Mode A: post link ──
        // .creact <link> <count> <emoji...>
        try {
            const urlPath = firstArg.split('whatsapp.com/channel/')[1];
            const urlParts = urlPath.replace(/\/$/, '').split('/');
            channelId = urlParts[0];
            messageId = urlParts[1] || null;
        } catch {
            return reply(`❌ Could not parse the channel link.\n\n*Example:* ${prefix}creact https://whatsapp.com/channel/0029Va.../100 50 👍`);
        }
        countRaw = parseInt(parts[1]);
        emojis   = parts.slice(2);

    } else if (isBareId) {
        // ── Mode B: channelID [msgID] count emoji... ──
        // .creact <channelId> <msgId> <count> <emoji...>
        // .creact <channelId> <count> <emoji...>   ← no msgId
        channelId = firstArg;
        // If parts[1] is a long numeric string treat it as msgId
        if (/^\d{10,}$/.test(parts[1]) && parts.length >= 4) {
            messageId = parts[1];
            countRaw  = parseInt(parts[2]);
            emojis    = parts.slice(3);
        } else {
            messageId = null;
            countRaw  = parseInt(parts[1]);
            emojis    = parts.slice(2);
        }

    } else {
        return reply(
            `❌ *Invalid first argument.*\n\n` +
            `Provide either:\n` +
            `• A WhatsApp channel post link\n` +
            `• A numeric channel ID (e.g. 120363315577814922)\n\n` +
            `Type *${prefix}creact* (no args) to see full usage.`
        );
    }

    // ── VALIDATE count ────────────────────────────────────────────────────
    if (isNaN(countRaw) || countRaw < 1) {
        return reply(`❌ Reaction count must be a number ≥ 1.\n\nType *${prefix}creact* for usage.`);
    }
    const reactionCount = Math.min(countRaw, 1000); // hard cap at 1000

    // ── VALIDATE emojis ───────────────────────────────────────────────────
    if (!emojis || emojis.length === 0) {
        return reply(`❌ Provide at least one emoji.\n\nExample: ${prefix}creact ... 100 👍 ❤️ 🔥`);
    }
    if (!channelId) {
        return reply(`❌ Could not extract a channel ID. Check your input.`);
    }

    // ── CONFIRM START ─────────────────────────────────────────────────────
    const newsletterJid = channelId.endsWith('@newsletter')
        ? channelId
        : `${channelId}@newsletter`;
    const totalReactions = reactionCount * emojis.length;

    await reply(
        `⏳ *Starting channel reactions...*\n\n` +
        `📢 Channel: \`${channelId}\`\n` +
        `${messageId ? `📌 Post ID: \`${messageId}\`\n` : `📌 Post ID: *(latest)*\n`}` +
        `😀 Emojis: ${emojis.join('  ')}\n` +
        `🔢 Per emoji: ${reactionCount}\n` +
        `📊 Total: ${totalReactions}\n` +
        `⚙️ Rate: 5 reactions / 3 s burst\n\n` +
        `_Running in background — report sent when done._`
    );

    // ── RATE-LIMITED REACTION LOOP (background) ───────────────────────────
    const BURST_SIZE  = 5;    // reactions per burst
    const BURST_DELAY = 3000; // ms between bursts

    ;(async () => {
        let totalSent = 0;
        let totalErrors = 0;

        for (const emoji of emojis) {
            let sent = 0;
            while (sent < reactionCount) {
                const burst = Math.min(BURST_SIZE, reactionCount - sent);
                const jobs = [];

                for (let i = 0; i < burst; i++) {
                    jobs.push(
                        empire.query({
                            tag: 'message',
                            attrs: {
                                to: newsletterJid,
                                type: 'reaction',
                                ...(messageId ? { 'server_id': messageId } : {}),
                                id: Math.random().toString(36).slice(2).toUpperCase()
                            },
                            content: [{ tag: 'reaction', attrs: { code: emoji } }]
                        }).catch(err => {
                            totalErrors++;
                            console.error(chalk.red(`creact error [${emoji}]: ${err.message}`));
                        })
                    );
                }

                await Promise.allSettled(jobs);
                sent      += burst;
                totalSent += burst;

                console.log(chalk.cyan(
                    `creact [${emoji}] ${sent}/${reactionCount} | total: ${totalSent}/${totalReactions}`
                ));

                if (sent < reactionCount) await delay(BURST_DELAY);
            }

            // Brief gap between different emojis
            if (emojis.indexOf(emoji) < emojis.length - 1) await delay(BURST_DELAY);
        }

        // ── DONE REPORT ───────────────────────────────────────────────────
        const successCount = totalSent - totalErrors;
        await empire.sendMessage(m.chat, {
            text:
                `✅ *Channel Reactions Done!*\n\n` +
                `📢 Channel: \`${channelId}\`\n` +
                `${messageId ? `📌 Post ID: \`${messageId}\`\n` : ''}` +
                `😀 Emojis: ${emojis.join('  ')}\n` +
                `🔢 Per emoji: ${reactionCount}\n` +
                `📊 Total sent: ${successCount} / ${totalReactions}\n` +
                `${totalErrors > 0 ? `⚠️ Errors: ${totalErrors}\n` : ''}` +
                `\n🌻✨ TK Cariño Workshop ¤bot`
        }, { quoted: m });

    })().catch(err => {
        console.error(chalk.red('creact fatal:'), err.message);
        empire.sendMessage(m.chat, {
            text: `❌ *Reaction job crashed!*\n\nError: ${err.message}\n\nMake sure the bot follows the channel.`
        }, { quoted: m });
    });
}
break;

// ========== GROUP MEMBER MANAGEMENT ==========
case 'setgrouppp':
case 'setgcicon': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    if (!m.quoted || !/image/.test(m.quoted.mimetype)) return reply(`🖼️ *Usage:* Reply to an image with ${prefix}setgrouppp`);
    const media = await m.quoted.download();
    await empire.updateProfilePicture(m.chat, media);
    reply(`✅ *GROUP ICON UPDATED*`);
}
break;

case 'add': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    if (!text) return reply(`➕ *Usage:* ${prefix}add <phone number>\nExample: ${prefix}add 628123456789`);
    const number = text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    try {
        await empire.groupParticipantsUpdate(m.chat, [number], 'add');
        reply(`✅ *MEMBER ADDED*\n\n@${number.split('@')[0]} has been added!`, { mentions: [number] });
    } catch {
        reply(`❌ Failed to add member. Make sure the number is registered on WhatsApp.`);
    }
}
break;

case 'kick':
case 'remove': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    let target = m.mentionedJid?.[0];
    if (!target && m.quoted) target = m.quoted.sender;
    if (!target && text) target = text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    if (!target) return reply(`👢 *Usage:* ${prefix}kick @user or reply to a message`);
    if (target === botNumber) return reply("❌ I cannot kick myself!");
    await empire.groupParticipantsUpdate(m.chat, [target], 'remove');
    reply(`✅ *MEMBER REMOVED*\n\n@${target.split('@')[0]} has been kicked!`, { mentions: [target] });
}
break;

case 'kickall': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator) return reply("❌ Only bot owner can use this!");
    await reply("⚠️ *KICKING ALL NON-ADMIN MEMBERS...*");
    const nonAdmins = participants.filter(p => !p.admin && p.id !== botNumber);
    let kicked = 0;
    for (const member of nonAdmins) {
        try {
            await empire.groupParticipantsUpdate(m.chat, [member.id], 'remove');
            kicked++;
            await delay(1000);
        } catch (e) { console.log(`Failed to kick ${member.id}`); }
    }
    reply(`✅ *KICK ALL COMPLETE*\n\nRemoved ${kicked} non-admin members.`);
}
break;

case 'promote': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    let target = m.mentionedJid?.[0];
    if (!target && m.quoted) target = m.quoted.sender;
    if (!target) return reply(`👑 *Usage:* ${prefix}promote @user`);
    if (participants.find(p => p.id === target)?.admin) return reply("❌ User is already an admin!");
    await empire.groupParticipantsUpdate(m.chat, [target], 'promote');
    reply(`👑 *ADMIN PROMOTED*\n\n@${target.split('@')[0]} is now an admin!`, { mentions: [target] });
}
break;

case 'demote': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    let target = m.mentionedJid?.[0];
    if (!target && m.quoted) target = m.quoted.sender;
    if (!target) return reply(`📉 *Usage:* ${prefix}demote @user`);
    if (!participants.find(p => p.id === target)?.admin) return reply("❌ User is not an admin!");
    await empire.groupParticipantsUpdate(m.chat, [target], 'demote');
    reply(`📉 *ADMIN DEMOTED*\n\n@${target.split('@')[0]} is no longer an admin.`, { mentions: [target] });
}
break;

case 'lock':
case 'close':
case 'mute': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    await empire.groupSettingUpdate(m.chat, 'announcement');
    reply(`🔒 *GROUP LOCKED*\n\nOnly admins can send messages now.`);
}
break;

case 'unlock':
case 'open':
case 'unmute': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    await empire.groupSettingUpdate(m.chat, 'not_announcement');
    reply(`🔓 *GROUP UNLOCKED*\n\nAll members can send messages now.`);
}
break;

case 'lockmedia': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    const option = args[0]?.toLowerCase();
    if (option === 'on') {
        setSetting(m.chat, 'lockmedia', true);
        reply(`📵 *MEDIA LOCK ENABLED*\n\nMembers cannot send images, videos, or stickers!`);
    } else if (option === 'off') {
        setSetting(m.chat, 'lockmedia', false);
        reply(`✅ *MEDIA LOCK DISABLED*`);
    } else {
        reply(`📵 *MEDIA LOCK*\n\nUsage:\n${prefix}lockmedia on\n${prefix}lockmedia off`);
    }
}
break;

case 'link':
case 'grouplink':
case 'invite': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    const code = await empire.groupInviteCode(m.chat);
    reply(`🔗 *GROUP INVITE LINK*\n\nhttps://chat.whatsapp.com/${code}\n\nShare this link to invite new members!`);
}
break;

// ========== GROUP INFO ==========
case 'groupinfo': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    const metadata = await empire.groupMetadata(m.chat);
    const admins = metadata.participants.filter(p => p.admin);
    const members = metadata.participants;
    reply(
        `👥 *GROUP INFO*\n\n` +
        `📛 Name: ${metadata.subject}\n` +
        `🆔 ID: ${m.chat}\n` +
        `📝 Description: ${metadata.desc || 'No description'}\n` +
        `👤 Members: ${members.length}\n` +
        `👑 Admins: ${admins.length}\n` +
        `📅 Created: ${new Date(metadata.creation * 1000).toLocaleDateString()}\n` +
        `🔒 Restrict: ${metadata.restrict ? 'Yes' : 'No'}`
    );
}
break;

case 'listadmins':
case 'admins': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    const admins = participants.filter(p => p.admin);
    let text2 = `👑 *GROUP ADMINS (${admins.length})*\n\n`;
    admins.forEach((admin, i) => {
        text2 += `${i+1}. @${admin.id.split('@')[0]}\n`;
    });
    await empire.sendMessage(m.chat, { text: text2, mentions: admins.map(a => a.id) }, { quoted: m });
}
break;

case 'listmembers':
case 'members': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    let text2 = `👥 *GROUP MEMBERS (${participants.length})*\n\n`;
    participants.forEach((p, i) => {
        const role = p.admin === 'superadmin' ? '👑' : p.admin ? '⭐' : '👤';
        text2 += `${i+1}. ${role} @${p.id.split('@')[0]}\n`;
    });
    await empire.sendMessage(m.chat, { text: text2, mentions: participants.map(p => p.id) }, { quoted: m });
}
break;

case 'tagall':
case 'everyone': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    const message = text || "📢 Attention everyone!";
    let mention = `📢 *${message}*\n\n`;
    for (const p of participants) mention += `@${p.id.split('@')[0]}\n`;
    await empire.sendMessage(m.chat, { text: mention, mentions: participants.map(p => p.id) }, { quoted: m });
}
break;

case 'tagadmins': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    const admins2 = participants.filter(p => p.admin);
    const message2 = text || "📢 Attention admins!";
    let mention2 = `👑 *${message2}*\n\n`;
    for (const a of admins2) mention2 += `@${a.id.split('@')[0]}\n`;
    await empire.sendMessage(m.chat, { text: mention2, mentions: admins2.map(a => a.id) }, { quoted: m });
}
break;

case 'hidetag': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    const message3 = text || m.quoted?.text || "📢 Notice";
    await empire.sendMessage(m.chat, { text: message3, mentions: participants.map(p => p.id) }, { quoted: m });
}
break;

// ========== WARN SYSTEM ==========
case 'warn': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can warn members!");
    let target = m.mentionedJid?.[0];
    if (!target && m.quoted) target = m.quoted.sender;
    if (!target) return reply(`⚠️ *Usage:* ${prefix}warn @user`);
    if (!db.warns) db.warns = {};
    if (!db.warns[target]) db.warns[target] = 0;
    db.warns[target]++;
    saveDB();
    const warnCount = db.warns[target];
    if (warnCount >= 3) {
        await empire.groupParticipantsUpdate(m.chat, [target], 'remove');
        delete db.warns[target]; saveDB();
        reply(`👢 @${target.split('@')[0]} has been kicked after ${warnCount} warnings!`, { mentions: [target] });
    } else {
        reply(`⚠️ *WARNING ISSUED*\n\n@${target.split('@')[0]} has been warned!\n\n⚠️ Warnings: ${warnCount}/3\n\n3 warnings = automatic kick`, { mentions: [target] });
    }
}
break;

case 'unwarn':
case 'resetwarn': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    let target = m.mentionedJid?.[0];
    if (!target && m.quoted) target = m.quoted.sender;
    if (!target) return reply(`✅ *Usage:* ${prefix}unwarn @user`);
    if (!db.warns) db.warns = {};
    db.warns[target] = 0; saveDB();
    reply(`✅ *WARNINGS CLEARED*\n\n@${target.split('@')[0]}'s warnings have been reset.`, { mentions: [target] });
}
break;

case 'warns':
case 'checkwarns': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    let target = m.mentionedJid?.[0];
    if (!target && m.quoted) target = m.quoted.sender;
    if (!target) target = m.sender;
    const warnCount = db.warns?.[target] || 0;
    reply(`⚠️ *WARN STATUS*\n\n👤 @${target.split('@')[0]}\n⚠️ Warnings: ${warnCount}/3`, { mentions: [target] });
}
break;

case 'warnclean':
case 'clearwarns': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator) return reply("❌ Only bot owner can use this!");
    db.warns = {}; saveDB();
    reply(`✅ *ALL WARNINGS CLEARED*\n\nWarning database has been reset.`);
}
break;

// ========== MUTE USER ==========
case 'muteuser': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can mute members!");
    let target = m.mentionedJid?.[0];
    if (!target && m.quoted) target = m.quoted.sender;
    if (!target) return reply(`🔇 *Usage:* ${prefix}muteuser @user`);
    const duration = parseInt(args[1]) || 60;
    if (!db.muted) db.muted = {};
    db.muted[target] = Date.now() + (duration * 60 * 1000); saveDB();
    reply(`🔇 *USER MUTED*\n\n@${target.split('@')[0]} has been muted for ${duration} minute(s).`, { mentions: [target] });
}
break;

case 'unmuteuser': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    let target = m.mentionedJid?.[0];
    if (!target && m.quoted) target = m.quoted.sender;
    if (!target) return reply(`🔊 *Usage:* ${prefix}unmuteuser @user`);
    if (!db.muted) db.muted = {};
    delete db.muted[target]; saveDB();
    reply(`🔊 *USER UNMUTED*\n\n@${target.split('@')[0]} can now send messages.`, { mentions: [target] });
}
break;

// ========== GROUP STATUS ==========
case 'groupstatus': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    const antilinkStatus = getSetting(m.chat, 'antilink', false);
    const antistickerStatus = getSetting(m.chat, 'antisticker', false);
    const antispamStatus = getSetting(m.chat, 'antispam', false);
    const antiwordStatus = getSetting(m.chat, 'antiword', false);
    const antideleteStatus = getSetting(m.chat, 'antidelete', false);
    const lockmediaStatus = getSetting(m.chat, 'lockmedia', false);
    const welcomeStatus = getSetting(m.chat, 'welcome', false);
    reply(
        `📊 *GROUP STATUS*\n\n` +
        `🔗 Anti-Link: ${antilinkStatus ? '🟢 ON' : '🔴 OFF'}\n` +
        `🎭 Anti-Sticker: ${antistickerStatus ? '🟢 ON' : '🔴 OFF'}\n` +
        `🔁 Anti-Spam: ${antispamStatus ? '🟢 ON' : '🔴 OFF'}\n` +
        `🤬 Anti-Word: ${antiwordStatus ? '🟢 ON' : '🔴 OFF'}\n` +
        `🗑️ Anti-Delete: ${antideleteStatus ? '🟢 ON' : '🔴 OFF'}\n` +
        `📵 Lock Media: ${lockmediaStatus ? '🟢 ON' : '🔴 OFF'}\n` +
        `👋 Welcome: ${welcomeStatus ? '🟢 ON' : '🔴 OFF'}\n\n` +
        `🌻✨ TK Cariño Workshop ¤bot`
    );
}
break;

// ========== GROUP NAME / DESC ==========
case 'groupname':
case 'setgroupname':
case 'setname': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    if (!text) return reply(`✏️ *Usage:* ${prefix}groupname <new name>`);
    await empire.groupUpdateSubject(m.chat, text);
    reply(`✅ *GROUP NAME UPDATED*\n\nNew name: ${text}`);
}
break;

case 'groupdesc':
case 'setgroupdesc':
case 'setdesc': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    if (!text) return reply(`📝 *Usage:* ${prefix}groupdesc <new description>`);
    await empire.groupUpdateDescription(m.chat, text);
    reply(`✅ *GROUP DESCRIPTION UPDATED*`);
}
break;

// ========== VOTE KICK ==========
case 'votekick': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    let target = m.mentionedJid?.[0];
    if (!target && m.quoted) target = m.quoted.sender;
    if (!target) return reply(`🗳️ *Usage:* ${prefix}votekick @user\n\nStart a vote to kick a member.`);
    if (target === botNumber) return reply("❌ You cannot vote to kick the bot!");
    if (!global.voteKick) global.voteKick = {};
    const vKey = `${m.chat}_${target}`;
    if (!global.voteKick[vKey]) global.voteKick[vKey] = { votes: new Set(), target, initiator: m.sender };
    global.voteKick[vKey].votes.add(m.sender);
    const needed = Math.ceil(participants.length / 2);
    const current = global.voteKick[vKey].votes.size;
    if (current >= needed) {
        await empire.groupParticipantsUpdate(m.chat, [target], 'remove');
        delete global.voteKick[vKey];
        reply(`✅ *VOTE KICK PASSED!*\n\n@${target.split('@')[0]} has been removed! (${current}/${needed} votes)`, { mentions: [target] });
    } else {
        await empire.sendMessage(m.chat, {
            text: `🗳️ *VOTE KICK*\n\nTarget: @${target.split('@')[0]}\nVotes: ${current}/${needed}\n\nType ${prefix}votekick @${target.split('@')[0]} to vote!`,
            mentions: [target]
        }, { quoted: m });
    }
}
break;

// ========== GROUP CHECK ==========
case 'groupcheck': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    const metadata2 = await empire.groupMetadata(m.chat);
    const allParticipants = metadata2.participants;
    const bots = allParticipants.filter(p => {
        const num = p.id.split('@')[0];
        return num.length < 7 || num.startsWith('0') || num.includes('bot') || num.includes('123456');
    });
    reply(
        `🔍 *GROUP CHECK*\n\n` +
        `👥 Total: ${allParticipants.length}\n` +
        `👑 Admins: ${allParticipants.filter(p => p.admin).length}\n` +
        `👤 Members: ${allParticipants.filter(p => !p.admin).length}\n` +
        `🤖 Possible bots: ${bots.length}\n\n` +
        `🌻✨ TK Cariño Workshop ¤bot`
    );
}
break;

// ========== WELCOME / GOODBYE ==========
case 'welcome':
case 'welcome on':
case 'welcome off': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    const opt = args[0]?.toLowerCase();
    if (opt === 'on') {
        setSetting(m.chat, 'welcome', true);
        reply(`👋 *WELCOME MESSAGE ENABLED*\n\nNew members will receive a welcome message.`);
    } else if (opt === 'off') {
        setSetting(m.chat, 'welcome', false);
        reply(`👋 *WELCOME MESSAGE DISABLED*`);
    } else {
        reply(`👋 *WELCOME*\n\nUsage:\n${prefix}welcome on\n${prefix}welcome off`);
    }
}
break;

case 'goodbye':
case 'goodbye on':
case 'goodbye off': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    const opt2 = args[0]?.toLowerCase();
    if (opt2 === 'on') {
        setSetting(m.chat, 'goodbye', true);
        reply(`👋 *GOODBYE MESSAGE ENABLED*\n\nMembers leaving will receive a farewell message.`);
    } else if (opt2 === 'off') {
        setSetting(m.chat, 'goodbye', false);
        reply(`👋 *GOODBYE MESSAGE DISABLED*`);
    } else {
        reply(`👋 *GOODBYE*\n\nUsage:\n${prefix}goodbye on\n${prefix}goodbye off`);
    }
}
break;

// ========== GROUP STATS ==========
case 'groupstats': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    const groupData = db.groups?.[m.chat] || {};
    const totalMessages = groupData.messages || 0;
    const topUsers = Object.entries(groupData.memberMessages || {})
        .sort((a, b) => b[1] - a[1]).slice(0, 5);
    let statsText = `📊 *GROUP STATS*\n\n📨 Total Messages: ${totalMessages}\n\n👥 *Top 5 Active Members:*\n`;
    if (topUsers.length === 0) statsText += 'No data yet';
    else topUsers.forEach(([jid, count], i) => {
        statsText += `${i+1}. @${jid.split('@')[0]} — ${count} msgs\n`;
    });
    statsText += `\n🌻✨ TK Cariño Workshop ¤bot`;
    await empire.sendMessage(m.chat, { text: statsText, mentions: topUsers.map(u => u[0]) }, { quoted: m });
}
break;

// ========== CHECK ADMIN ==========
case 'checkadmin':
case 'isadmin': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    let target = m.mentionedJid?.[0] || m.quoted?.sender || m.sender;
    const isTargetAdmin = groupAdmins.includes(target);
    const isBotAdmin = groupAdmins.includes(botNumber);
    reply(
        `🛡️ *ADMIN CHECK*\n\n` +
        `👤 User: @${target.split('@')[0]}\n` +
        `⭐ Is Admin: ${isTargetAdmin ? 'Yes ✅' : 'No ❌'}\n` +
        `🤖 Bot is Admin: ${isBotAdmin ? 'Yes ✅' : 'No ❌'}`
    , { mentions: [target] });
}
break;

// ========== ANTI-LINK ==========
case 'antilink': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    const option = args[0]?.toLowerCase();
    if (option === 'on') {
        setSetting(m.chat, 'antilink', true);
        reply(`🔗 *ANTI-LINK ENABLED*\n\nWhatsApp links will be automatically deleted.`);
    } else if (option === 'off') {
        setSetting(m.chat, 'antilink', false);
        reply(`✅ *ANTI-LINK DISABLED*`);
    } else {
        const current = getSetting(m.chat, 'antilink', false);
        reply(`🔗 *ANTI-LINK*\n\nStatus: ${current ? '🟢 ON' : '🔴 OFF'}\n\nUsage:\n${prefix}antilink on\n${prefix}antilink off\n${prefix}antilink action <kick/warn/delete>\n${prefix}antilink allow <domain>`);
    }
}
break;

case 'antilink action': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    const action = args[0]?.toLowerCase();
    if (!['kick','warn','delete'].includes(action)) return reply(`❌ Valid actions: kick, warn, delete`);
    setSetting(m.chat, 'antilink_action', action);
    reply(`✅ *ANTI-LINK ACTION SET*\n\nAction: ${action}`);
}
break;

case 'antilink except':
case 'antilink allow': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    const domain = args[0];
    if (!domain) return reply(`🔗 *Usage:* ${prefix}antilink allow <domain>`);
    const allowed = getSetting(m.chat, 'allowedDomains', []);
    if (!allowed.includes(domain)) {
        allowed.push(domain);
        setSetting(m.chat, 'allowedDomains', allowed);
    }
    reply(`✅ *DOMAIN ALLOWED*\n\n${domain} is now whitelisted.`);
}
break;

// ========== ANTI-WORD ==========
case 'antiword': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    const option = args[0]?.toLowerCase();
    if (option === 'on') {
        setSetting(m.chat, 'antiword', true);
        reply(`🤬 *ANTI-WORD ENABLED*`);
    } else if (option === 'off') {
        setSetting(m.chat, 'antiword', false);
        reply(`✅ *ANTI-WORD DISABLED*`);
    } else if (option === 'add') {
        const word = args[1];
        if (!word) return reply(`📝 Usage: ${prefix}antiword add <word>`);
        const words = getSetting(m.chat, 'badWords', []);
        if (!words.includes(word.toLowerCase())) {
            words.push(word.toLowerCase());
            setSetting(m.chat, 'badWords', words);
        }
        reply(`✅ *WORD ADDED*\n\n"${word}" added to bad words list.`);
    } else if (option === 'remove') {
        const word = args[1];
        if (!word) return reply(`📝 Usage: ${prefix}antiword remove <word>`);
        const words = getSetting(m.chat, 'badWords', []);
        const idx = words.indexOf(word.toLowerCase());
        if (idx !== -1) { words.splice(idx, 1); setSetting(m.chat, 'badWords', words); }
        reply(`✅ *WORD REMOVED*\n\n"${word}" removed from bad words list.`);
    } else {
        const current = getSetting(m.chat, 'antiword', false);
        const words = getSetting(m.chat, 'badWords', []);
        reply(`🤬 *ANTI-WORD*\n\nStatus: ${current ? '🟢 ON' : '🔴 OFF'}\nWords: ${words.length > 0 ? words.join(', ') : 'None'}`);
    }
}
break;

// ========== ANTI-SPAM ==========
case 'antispam': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    const option = args[0]?.toLowerCase();
    if (option === 'on') {
        setSetting(m.chat, 'antispam', true);
        reply(`🔁 *ANTI-SPAM ENABLED*`);
    } else if (option === 'off') {
        setSetting(m.chat, 'antispam', false);
        reply(`✅ *ANTI-SPAM DISABLED*`);
    } else if (option === 'set') {
        const limit = parseInt(args[1]);
        if (isNaN(limit) || limit < 1) return reply(`❌ Usage: ${prefix}antispam set <number>`);
        setSetting(m.chat, 'antispam_limit', limit);
        reply(`✅ *ANTI-SPAM LIMIT SET*\n\nMax ${limit} messages per 5 seconds.`);
    } else {
        const current = getSetting(m.chat, 'antispam', false);
        const limit = getSetting(m.chat, 'antispam_limit', 5);
        reply(`🔁 *ANTI-SPAM*\n\nStatus: ${current ? '🟢 ON' : '🔴 OFF'}\nLimit: ${limit} msgs/5s`);
    }
}
break;

// ========== ANTI-STICKER ==========
case 'antisticker': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    const option = args[0]?.toLowerCase();
    if (option === 'on') {
        setSetting(m.chat, 'antisticker', true);
        reply(`🎭 *ANTI-STICKER ENABLED*`);
    } else if (option === 'off') {
        setSetting(m.chat, 'antisticker', false);
        reply(`✅ *ANTI-STICKER DISABLED*`);
    } else if (option === 'action') {
        const action = args[1]?.toLowerCase();
        if (!['kick','warn','delete'].includes(action)) return reply(`❌ Valid actions: kick, warn, delete`);
        setSetting(m.chat, 'antisticker_action', action);
        reply(`✅ *ANTI-STICKER ACTION*\n\nAction set to: ${action}`);
    } else {
        const current = getSetting(m.chat, 'antisticker', false);
        reply(`🎭 *ANTI-STICKER*\n\nStatus: ${current ? '🟢 ON' : '🔴 OFF'}`);
    }
}
break;

// ========== ANTI-DELETE ==========
case 'antidelete': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    const option = args[0]?.toLowerCase();
    if (option === 'on') {
        setSetting(m.chat, 'antidelete', true);
        reply(`🗑️ *ANTI-DELETE ENABLED*\n\nDeleted messages will be logged.`);
    } else if (option === 'off') {
        setSetting(m.chat, 'antidelete', false);
        reply(`✅ *ANTI-DELETE DISABLED*`);
    } else if (option === 'action') {
        const action = args[1]?.toLowerCase();
        if (!['log','warn','kick'].includes(action)) return reply(`❌ Valid actions: log, warn, kick`);
        setSetting(m.chat, 'antidelete_action', action);
        reply(`✅ *ANTI-DELETE ACTION SET*\n\nAction: ${action}`);
    } else {
        const current = getSetting(m.chat, 'antidelete', false);
        reply(`🗑️ *ANTI-DELETE*\n\nStatus: ${current ? '🟢 ON' : '🔴 OFF'}`);
    }
}
break;

// ========== ANTI-GROUP MENTION ==========
case 'antigroupmention': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    const option = args[0]?.toLowerCase();
    if (option === 'on') {
        setSetting(m.chat, 'antigroupmention', true);
        reply(`🚫 *ANTI-GROUP MENTION ENABLED*`);
    } else if (option === 'off') {
        setSetting(m.chat, 'antigroupmention', false);
        reply(`✅ *ANTI-GROUP MENTION DISABLED*`);
    } else {
        const current = getSetting(m.chat, 'antigroupmention', false);
        reply(`🚫 *ANTI-GROUP MENTION*\n\nStatus: ${current ? '🟢 ON' : '🔴 OFF'}`);
    }
}
break;

// ========== STICKER BAN ==========
case 'stickerban':
case 'sban': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    let target = m.mentionedJid?.[0];
    if (!target && m.quoted) target = m.quoted.sender;
    if (!target) return reply(`🎭 *Usage:* ${prefix}sban @user\n\nBan a user from sending stickers.`);
    if (!db.stickerbanned) db.stickerbanned = {};
    if (!db.stickerbanned[m.chat]) db.stickerbanned[m.chat] = [];
    if (!db.stickerbanned[m.chat].includes(target)) {
        db.stickerbanned[m.chat].push(target); saveDB();
    }
    reply(`✅ *STICKER BANNED*\n\n@${target.split('@')[0]} can no longer send stickers.`, { mentions: [target] });
}
break;

// ========== BACKUP / RESTORE GROUP ==========
case 'backupgroup': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator) return reply("❌ Only bot owner can use this!");
    const metadata3 = await empire.groupMetadata(m.chat);
    const backup = {
        subject: metadata3.subject,
        desc: metadata3.desc,
        participants: metadata3.participants.map(p => ({ id: p.id, admin: p.admin })),
        backedUpAt: new Date().toISOString()
    };
    if (!db.groupBackups) db.groupBackups = {};
    db.groupBackups[m.chat] = backup; saveDB();
    reply(`✅ *GROUP BACKED UP*\n\n📛 Name: ${backup.subject}\n👥 Members: ${backup.participants.length}\n📅 At: ${backup.backedUpAt}`);
}
break;

case 'restoregroup': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator) return reply("❌ Only bot owner can use this!");
    const backup2 = db.groupBackups?.[m.chat];
    if (!backup2) return reply(`❌ No backup found for this group!`);
    reply(`📦 *GROUP BACKUP INFO*\n\n📛 Name: ${backup2.subject}\n👥 Members: ${backup2.participants.length}\n📅 Backed up: ${backup2.backedUpAt}\n\n⚠️ Auto-restore of members is not available. You can use this data to manually re-add members.`);
}
break;

// ========== RULES ==========
case 'setrules': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    if (!text) return reply(`📜 *Usage:* ${prefix}setrules <rules text>`);
    if (!db.rules) db.rules = {};
    db.rules[m.chat] = text; saveDB();
    reply(`✅ *GROUP RULES SET*\n\nType ${prefix}rules to view them.`);
}
break;

case 'rules':
case 'grouprules': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    const rules = db.rules?.[m.chat];
    if (!rules) return reply(`❌ No rules set for this group!\n\nAdmins can set rules with: ${prefix}setrules <rules>`);
    reply(`📜 *GROUP RULES*\n\n${rules}\n\n🌻✨ TK Cariño Workshop ¤bot`);
}
break;

// ========== ANNOUNCE ==========
case 'announce':
case 'announcement': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    if (!text) return reply(`📢 *Usage:* ${prefix}announce <message>`);
    const announcementText = `📢 *ANNOUNCEMENT*\n\n${text}\n\n— 🌻✨ TK Cariño Workshop ¤bot`;
    await empire.sendMessage(m.chat, { text: announcementText, mentions: participants.map(p => p.id) }, { quoted: m });
}
break;

// ========== POLL ==========
case 'poll':
case 'poll2': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    if (!text) return reply(`📊 *Usage:* ${prefix}poll <question> | option1 | option2 | ...\nExample: ${prefix}poll Best color? | Red | Blue | Green`);
    const pollParts = text.split('|').map(p => p.trim());
    const pollQuestion = pollParts[0];
    const pollOptions = pollParts.slice(1);
    if (pollOptions.length < 2) return reply(`❌ Provide at least 2 options separated by |`);
    try {
        await empire.sendMessage(m.chat, {
            poll: {
                name: pollQuestion,
                values: pollOptions,
                selectableCount: 1
            }
        }, { quoted: m });
    } catch {
        let pollText = `📊 *POLL*\n\n❓ ${pollQuestion}\n\n`;
        pollOptions.forEach((opt, i) => { pollText += `${i+1}. ${opt}\n`; });
        pollText += `\nReply with the number of your choice!`;
        reply(pollText);
    }
}
break;

// ========== GROUP CARD ==========
case 'groupcard': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    const metadata4 = await empire.groupMetadata(m.chat);
    const admins3 = metadata4.participants.filter(p => p.admin);
    const totalWarms = Object.values(db.warns || {}).reduce((a, b) => a + b, 0);
    reply(
        `📋 *GROUP CARD*\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `📛 Name: ${metadata4.subject}\n` +
        `🆔 ID: ${m.chat.split('@')[0]}\n` +
        `👥 Members: ${metadata4.participants.length}\n` +
        `👑 Admins: ${admins3.length}\n` +
        `📅 Created: ${new Date(metadata4.creation * 1000).toLocaleDateString()}\n` +
        `📝 Desc: ${metadata4.desc ? metadata4.desc.substring(0, 60) + '...' : 'None'}\n` +
        `⚠️ Active Warns: ${totalWarms}\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `🌻✨ TK Cariño Workshop ¤bot`
    );
}
break;

// ========== GROUP SETTINGS ==========
case 'groupsettings': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    const s = (key, def) => getSetting(m.chat, key, def);
    reply(
        `⚙️ *GROUP SETTINGS*\n\n` +
        `🔗 Anti-Link: ${s('antilink', false) ? '🟢' : '🔴'} | Action: ${s('antilink_action', 'delete')}\n` +
        `🎭 Anti-Sticker: ${s('antisticker', false) ? '🟢' : '🔴'} | Action: ${s('antisticker_action', 'delete')}\n` +
        `🔁 Anti-Spam: ${s('antispam', false) ? '🟢' : '🔴'} | Limit: ${s('antispam_limit', 5)}\n` +
        `🤬 Anti-Word: ${s('antiword', false) ? '🟢' : '🔴'}\n` +
        `🗑️ Anti-Delete: ${s('antidelete', false) ? '🟢' : '🔴'} | Action: ${s('antidelete_action', 'log')}\n` +
        `📵 Lock Media: ${s('lockmedia', false) ? '🟢' : '🔴'}\n` +
        `👋 Welcome: ${s('welcome', false) ? '🟢' : '🔴'}\n` +
        `👋 Goodbye: ${s('goodbye', false) ? '🟢' : '🔴'}\n` +
        `🚫 Anti-Group Mention: ${s('antigroupmention', false) ? '🟢' : '🔴'}\n\n` +
        `🌻✨ TK Cariño Workshop ¤bot`
    );
}
break;

// ========== VCF ADMIN EXPORT ==========
case 'vcfadmin':
case 'exportadmins': {
    if (!isGroup) return reply("👥 This command only works in groups!");
    if (!isCreator && !isAdmins) return reply("❌ Only admins can use this!");
    const admins4 = participants.filter(p => p.admin);
    let vcfContent = '';
    admins4.forEach(admin => {
        const num = admin.id.split('@')[0];
        vcfContent += `BEGIN:VCARD\nVERSION:3.0\nFN:Admin ${num}\nTEL;type=CELL;waid=${num}:+${num}\nEND:VCARD\n`;
    });
    const vcfBuffer = Buffer.from(vcfContent, 'utf-8');
    await empire.sendMessage(m.chat, {
        document: vcfBuffer,
        fileName: `${groupName}_admins.vcf`,
        mimetype: 'text/vcard',
        caption: `👑 *GROUP ADMINS VCF*\n\n${admins4.length} admins exported.\n\n🌻✨ TK Cariño Workshop ¤bot`
    }, { quoted: m });
}
break;

// ========== AUTO STATUS REACT SETTINGS ==========
case 'autoreact':
case 'statusreact': {
    if (!isCreator) return reply("❌ Only bot owner can use this command!");
    const option = args[0]?.toLowerCase();
    if (option === 'on') {
        setAutoStatusReact(true);
        reply(`✅ *Auto Status React ENABLED*`);
    } else if (option === 'off') {
        setAutoStatusReact(false);
        reply(`❌ *Auto Status React DISABLED*`);
    } else {
        const current = getAutoStatusSettings().autoReact;
        reply(`❤️ *Auto Status React*\n\nCurrent: ${current ? '🟢 ON' : '🔴 OFF'}\n\n${prefix}autoreact on/off`);
    }
}
break;

case 'autoview': {
    if (!isCreator) return reply("❌ Only bot owner can use this command!");
    const option = args[0]?.toLowerCase();
    if (option === 'on') {
        setAutoStatusView(true);
        reply(`✅ *Auto Status View ENABLED*`);
    } else if (option === 'off') {
        setAutoStatusView(false);
        reply(`❌ *Auto Status View DISABLED*`);
    } else {
        const current = getAutoStatusSettings().autoView;
        reply(`👁️ *Auto Status View*\n\nCurrent: ${current ? '🟢 ON' : '🔴 OFF'}\n\n${prefix}autoview on/off`);
    }
}
break;

            default:
            break;
        } // end switch

    } catch (err) {
        console.error('Command error:', err);
        if (m && m.chat) {
            empire.sendMessage(m.chat, { text: `❌ Error: ${err.message}` }).catch(() => {});
        }
    }
} // end main function

// File watcher
let file = require.resolve(__filename);
require('fs').watchFile(file, () => {
    require('fs').unwatchFile(file);
    console.log('\x1b[0;32m' + __filename + ' updated!\x1b[0m');
    delete require.cache[file];
    require(file);
});
