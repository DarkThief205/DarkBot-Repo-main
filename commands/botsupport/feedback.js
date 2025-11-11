// commands/feedback.js
require('dotenv/config');
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');

// --- Config -----------------------------------------------------------------
const SUPPORT_GUILD_ID   = process.env.SUPPORT_GUILD_ID   || process.env.FEEDBACK_GUILD_ID;
const SUPPORT_CHANNEL_ID = process.env.SUPPORT_CHANNEL_ID || process.env.FEEDBACK_CHANNEL_ID;
const SUPPORT_INTAKE_CHANNEL_ID = process.env.SUPPORT_INTAKE_CHANNEL_ID; // #send-feedback
const SUPPORT_INVITE_URL = process.env.SUPPORT_INVITE_URL || (process.env.SUPPORT_INVITE_CODE ? `https://discord.gg/${process.env.SUPPORT_INVITE_CODE}` : null);
const COOLDOWN_SECONDS   = Number(process.env.FEEDBACK_COOLDOWN_SEC || 60);
const BLACKLIST_DAYS     = 7;

// Category routing map (preferred via JSON env)
let CATEGORY_CHANNELS = {};
try { if (process.env.SUPPORT_CATEGORY_MAP) CATEGORY_CHANNELS = JSON.parse(process.env.SUPPORT_CATEGORY_MAP); }
catch { CATEGORY_CHANNELS = {}; }

// Optional fallback envs
const FALLBACK_CATEGORY_ENV = {
  bug:   process.env.SUPPORT_CH_BUG,
  idea:  process.env.SUPPORT_CH_IDEA,
  other: process.env.SUPPORT_CH_OTHER,
};

// --- In-memory stores --------------------------------------------------------
// feedbackId -> {
//   userId, userTag, content, category, originGuildName, originGuildId,
//   supportMsgId, supportChannelId, supportGuildId,
//   messageUrl, resolved, moreShown, threadId,
//   dmMsgId, lastStaffReply, abandoned
// }
const feedbackIndex = new Map();
// userId -> timestamp (ms)
const cooldown = new Map();
// userId -> untilEpochMs
const blacklist = new Map();

// --- Utils -------------------------------------------------------------------
const nowMs = () => Date.now();
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function fmtRemaining(ms) {
  const s = Math.ceil(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function sanitize(text, max = 256) {
  const t = String(text || '').replace(/@everyone|@here/g, '@\u200beveryone');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function makeFeedbackId(sourceGuildId, userId) {
  return `${sourceGuildId || 'DM'}-${Date.now()}-${userId}`;
}

function checkBlacklist(userId) {
  const until = blacklist.get(userId);
  if (!until) return { blocked: false, remainingMs: 0 };
  const remaining = until - nowMs();
  if (remaining <= 0) { blacklist.delete(userId); return { blocked: false, remainingMs: 0 }; }
  return { blocked: true, remainingMs: remaining };
}

// case-insensitive, with aliases; default to "other"
function normalizeCategory(raw) {
  const c = (raw || '').trim().toLowerCase();
  const map = {
    bug:   ['bug', 'issue', 'error', 'problem', 'glitch', 'fix'],
    idea:  ['idea, suggestion, feature, request, improvement'.split(', ').join('|')],
    other: ['other', 'misc', 'general'],
  };
  for (const key of Object.keys(map)) {
    if (c === key) return key;
    if (map[key].some(x => c.includes(x))) return key;
  }
  return 'other';
}

// Replies can't be ephemeral in DMs. Helper:
async function replyCompat(
  interaction,
  data = {},
  { ephemeralDefault = true, autoDeleteInDM = false, deleteAfterMs = 2500 } = {}
) {
  const inGuild = typeof interaction.inGuild === 'function' ? interaction.inGuild() : !!interaction.guildId;
  const payload = { ...data };
  if (inGuild) {
    if (payload.ephemeral === undefined) payload.ephemeral = ephemeralDefault;
  } else {
    delete payload.ephemeral;
  }
  const sent = await interaction.reply(payload);
  if (!inGuild && autoDeleteInDM) {
    setTimeout(() => interaction.deleteReply().catch(() => {}), deleteAfterMs);
  }
  return sent;
}

async function resolveSupportChannel(client, category) {
  const key = normalizeCategory(category);
  let chanId = CATEGORY_CHANNELS[key];
  if (!chanId && FALLBACK_CATEGORY_ENV[key]) chanId = FALLBACK_CATEGORY_ENV[key];
  if (!chanId) chanId = SUPPORT_CHANNEL_ID;

  const guild = await client.guilds.fetch(SUPPORT_GUILD_ID);
  const channel = await guild.channels.fetch(chanId);
  if (!channel?.isTextBased()) throw new Error('Support channel not text-based or missing');
  return { channel, key };
}

// Ensure a discussion thread exists for a feedback entry; returns the thread channel
async function ensureDiscussionThread(client, entry, feedbackId) {
  if (entry.threadId) {
    try {
      const existing = await client.channels.fetch(entry.threadId);
      if (existing) return existing;
    } catch { /* recreate */ }
  }
  const channel = await client.channels.fetch(entry.supportChannelId);
  const msg = await channel.messages.fetch(entry.supportMsgId);
  if (!channel.isTextBased()) throw new Error('Channel is not text-based.');
  let thread;
  try {
    thread = await msg.startThread({
      name: `FB • ${sanitize(entry.category, 20)} • ${sanitize(entry.userTag, 16)}`,
      autoArchiveDuration: 1440,
      type: ChannelType.PrivateThread,
      reason: 'Discussion for this feedback',
    });
  } catch {
    thread = await msg.startThread({
      name: `FB • ${sanitize(entry.category, 20)} • ${sanitize(entry.userTag, 16)}`,
      autoArchiveDuration: 1440,
      reason: 'Discussion for this feedback',
    });
  }
  await thread.send('🧵 Discussion opened for this feedback.');
  entry.threadId = thread.id;
  feedbackIndex.set(feedbackId, entry);
  return thread;
}

// Collect a transcript (only User Comment + Staff DM Sent) sized for embed description.
async function collectConversationText(client, entry, feedbackId, maxItems = 100, maxChars = 3500) {
  try {
    if (!entry.threadId) return '';
    const thread = await client.channels.fetch(entry.threadId);
    const msgs = await thread.messages.fetch({ limit: 100 });
    const sorted = [...msgs.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const lines = [];
    for (const m of sorted) {
      if (!m.embeds?.length) continue;
      for (const e of m.embeds) {
        const title = (e.title || '').toLowerCase();
        const isUserItem  = title.includes('user comment');
        const isStaffItem = title.includes('staff dm sent to user');
        if (!isUserItem && !isStaffItem) continue;

        const who = isUserItem ? `@${entry.userTag}` : `@staff (${m.author?.tag || 'staff'})`;
        let text = (e.description || '').replace(/\s+/g, ' ').replace(/@/g, '@\u200b');
        if (text.length > 300) text = text.slice(0, 299) + '…';
        const ts = `<t:${Math.floor(m.createdTimestamp / 1000)}:t>`;
        const line = `${who}: ${text} — ${ts}`;
        if ((lines.join('\n').length + line.length + 1) > maxChars) break;
        lines.push(line);
        if (lines.length >= maxItems) break;
      }
      if (lines.length >= maxItems || lines.join('\n').length >= maxChars) break;
    }
    return lines.length ? lines.join('\n') : '';
  } catch {
    return '';
  }
}

// --- UI Builders -------------------------------------------------------------
function buildFeedbackModal() {
  const modal = new ModalBuilder().setCustomId('fb:modal').setTitle('Send Feedback');
  const category = new TextInputBuilder()
    .setCustomId('fb:category').setLabel('Category (Bug / Idea / Other)')
    .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(50)
    .setPlaceholder('Bug / Idea / Other (optional)');
  const content = new TextInputBuilder()
    .setCustomId('fb:content').setLabel('Your message')
    .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1500)
    .setPlaceholder('Explain clearly. Include steps, examples, or links.');
  modal.addComponents(
    new ActionRowBuilder().addComponents(category),
    new ActionRowBuilder().addComponents(content),
  );
  return modal;
}

// Panel embed shown in #send-feedback (ONE-for-everyone panel)
function buildGrantAccessPanelEmbed() {
  return new EmbedBuilder()
    .setTitle('🔑 Get Access to Your Conversation')
    .setDescription(
      'Already submitted feedback and received a **Feedback ID** in DM?\n' +
      'Click the button below and paste your **Feedback ID** to join your private conversation thread.'
    )
    .setColor(0x5865F2);
}
function buildGrantAccessPanelButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('fb:grant').setLabel('Grant access to convo').setStyle(ButtonStyle.Primary)
  );
}
// Modal to collect the Feedback ID
function buildGrantAccessModal() {
  const modal = new ModalBuilder().setCustomId('fb:grantModal').setTitle('Enter your Feedback ID');
  const idField = new TextInputBuilder()
    .setCustomId('fb:grantId')
    .setLabel('Feedback ID')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(128)
    .setPlaceholder('e.g., DM-1729261880000-123456789012345678');
  modal.addComponents(new ActionRowBuilder().addComponents(idField));
  return modal;
}

// Detect if a message is the panel (so we don't duplicate)
function isGrantAccessPanelMessage(msg) {
  if (!msg?.components?.length) return false;
  for (const row of msg.components) {
    for (const comp of row.components || []) {
      if (comp.customId === 'fb:grant') return true;
    }
  }
  return false;
}

// Auto-ensure a single intake panel exists (call this on ready)
async function ensureIntakePanel(client) {
  try {
    if (!SUPPORT_INTAKE_CHANNEL_ID || !SUPPORT_GUILD_ID) return;
    const guild = await client.guilds.fetch(SUPPORT_GUILD_ID);
    const ch = await guild.channels.fetch(SUPPORT_INTAKE_CHANNEL_ID);
    if (!ch?.isTextBased()) return;

    // look for existing panel in recent history
    const recent = await ch.messages.fetch({ limit: 50 }).catch(() => null);
    const existing = recent?.find(m => m.author?.id === client.user.id && isGrantAccessPanelMessage(m));

    if (existing) return; // already present

    const sent = await ch.send({
      embeds: [buildGrantAccessPanelEmbed()],
      components: [buildGrantAccessPanelButtons()],
      allowedMentions: { parse: [] },
    });

    // optional: pin it
    try { await sent.pin(); } catch {}
  } catch (e) {
    // swallow; we don't want startup to fail on this
  }
}

// Support channel embeds (staff side)
function buildCompactEmbed({ content, category, originGuildName, originGuildId, userId, userTag, sourceIconURL }) {
  const embed = new EmbedBuilder()
    .setColor(0x57F287).setTitle('🗳️ Feedback')
    .setDescription(content || '—')
    .addFields(
      { name: 'Sender', value: `<@${userId}> (\`${userId}\`)`, inline: true },
      { name: 'Category', value: sanitize(category || 'other', 64), inline: true },
    )
    .setTimestamp();
  if (sourceIconURL) {
    embed.setAuthor({ name: originGuildName || 'Direct Message', iconURL: sourceIconURL });
    embed.setThumbnail(sourceIconURL);
  } else {
    embed.setAuthor({ name: originGuildName || 'Direct Message' });
  }
  return embed;
}
function buildExpandedEmbed(base, feedbackId) {
  const embed = new EmbedBuilder(buildCompactEmbed(base).toJSON());
  embed.addFields(
    { name: 'Feedback ID', value: `\`${feedbackId}\`` },
    { name: 'Origin', value: base.originGuildName ? `${base.originGuildName} (\`${base.originGuildId}\`)` : 'Direct Message' },
  );
  return embed;
}

// USER DM case-card embed (single embed: original feedback + conversation)
function buildUserDmEmbed(entry, feedbackId, conversationText = '') {
  const header = entry.content || '—';
  const convo  = conversationText ? `\n\n__Conversation__\n${conversationText}` : '';

  let description = header + convo;
  if (description.length > 4096) description = description.slice(0, 4095) + '…';

  const fields = [
    { name: 'Feedback ID', value: `\`${feedbackId}\`` },
    { name: 'Status', value: entry.abandoned ? 'Abandoned' : (entry.resolved ? 'Closed' : 'Open'), inline: true },
  ];
  if (entry.lastStaffReply) {
    fields.push({ name: 'Last Support Reply', value: sanitize(entry.lastStaffReply, 1024) });
  }

  return new EmbedBuilder()
    .setTitle(entry.abandoned ? '⛔ Feedback (Abandoned)' : (entry.resolved ? '✅ Feedback (Closed)' : '🗳️ Feedback (Open)'))
    .setColor(entry.abandoned ? 0xED4245 : (entry.resolved ? 0x57F287 : 0x5865F2))
    .setDescription(description)
    .addFields(fields)
    .setTimestamp();
}

function buttonsUserDm(entry, feedbackId) {
  const row = new ActionRowBuilder();

  // Only show "Abandon" while OPEN and not abandoned
  if (!entry.resolved && !entry.abandoned) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`fb:userClose:${feedbackId}`)
        .setLabel('Abandon')
        .setStyle(ButtonStyle.Secondary),
    );
  }

  // Show "Further help" link ONLY when the case is open and not abandoned
  if (SUPPORT_INVITE_URL && !entry.resolved && !entry.abandoned) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel('Further help')
        .setStyle(ButtonStyle.Link)
        .setURL(SUPPORT_INVITE_URL),
    );
  }

  return row.components.length ? row : null;
}

// STAFF buttons (Page 1 & Page 2)
function buttonsStaffPage1(feedbackId, resolved = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`fb:reply:${feedbackId}`).setLabel('Reply via DM').setStyle(ButtonStyle.Primary).setDisabled(resolved),
    new ButtonBuilder().setCustomId(`fb:resolve:${feedbackId}`).setLabel('Mark Resolved').setStyle(ButtonStyle.Success).setDisabled(resolved),
    new ButtonBuilder().setCustomId(`fb:more:${feedbackId}`).setLabel('More').setStyle(ButtonStyle.Secondary).setDisabled(resolved),
  );
}
function buttonsStaffPage2(feedbackId, resolved = false, hasThread = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`fb:blacklist:${feedbackId}`).setLabel('Blacklist 1 week').setStyle(ButtonStyle.Danger).setDisabled(resolved),
    new ButtonBuilder().setCustomId(`fb:expand:${feedbackId}`).setLabel('Open Discussion').setStyle(ButtonStyle.Secondary).setDisabled(resolved || hasThread),
    new ButtonBuilder().setCustomId(`fb:less:${feedbackId}`).setLabel('Less').setStyle(ButtonStyle.Secondary).setDisabled(resolved),
  );
}
// STAFF: Only Blacklist after abandoned
function buttonsStaffAbandoned(feedbackId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`fb:blacklist:${feedbackId}`)
      .setLabel('Blacklist 1 week')
      .setStyle(ButtonStyle.Danger)
  );
}

// EDIT (or create) the single DM case-card message
async function upsertUserDmCard(client, entry, feedbackId) {
  try {
    const user = await client.users.fetch(entry.userId);
    const dm = user.dmChannel ?? await user.createDM();

    // build latest conversation snippet for the description
    const convo = await collectConversationText(client, entry, feedbackId, 100, 3500);

    if (entry.dmMsgId) {
      try {
        const msg = await dm.messages.fetch(entry.dmMsgId);
        if (msg) {
          const maybeRow = buttonsUserDm(entry, feedbackId);
          await msg.edit({
            embeds: [buildUserDmEmbed(entry, feedbackId, convo)],
            components: maybeRow ? [maybeRow] : [],
          });
          return;
        }
      } catch { /* resend below */ }
    }

    const maybeRow2 = buttonsUserDm(entry, feedbackId);
    const sent = await dm.send({
      embeds: [buildUserDmEmbed(entry, feedbackId, convo)],
      components: maybeRow2 ? [maybeRow2] : [],
    });
    entry.dmMsgId = sent.id;
    feedbackIndex.set(feedbackId, entry);
  } catch { /* user DMs closed */ }
}

function isSupportGuildContext(interaction) { return interaction.guildId === SUPPORT_GUILD_ID; }
function requireSupportStaff(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
      || interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)
      || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

// --- Slash command (single /feedback) ---------------------------------------
module.exports.data = new SlashCommandBuilder()
  .setName('feedback')
  .setDescription('Send feedback to the support team.');

// --- Execute: /feedback ------------------------------------------------------
module.exports.execute = async (interaction) => {
  if (!SUPPORT_GUILD_ID) {
    return interaction.reply({
      content: '⚠️ Support server is not configured. Ask an admin to set `SUPPORT_GUILD_ID`.',
      ephemeral: true,
    });
  }

  const status = checkBlacklist(interaction.user.id);
  if (status.blocked) {
    return interaction.reply({
      content: `🚫 You are blocked from using \`/feedback\` for **${fmtRemaining(status.remainingMs)}**.`,
      ephemeral: true,
    });
  }

  const last = cooldown.get(interaction.user.id) || 0;
  const diff = nowMs() - last;
  if (diff < COOLDOWN_SECONDS * 1000) {
    return interaction.reply({
      content: `⏳ Please wait **${fmtRemaining(COOLDOWN_SECONDS * 1000 - diff)}** before sending more feedback.`,
      ephemeral: true,
    });
  }

  await interaction.showModal(buildFeedbackModal());
};

// --- Modal submit (create feedback) -----------------------------------------
module.exports.handleModalSubmit = async (interaction) => {
  if (interaction.customId !== 'fb:modal') return false;

  const status = checkBlacklist(interaction.user.id);
  if (status.blocked) { await interaction.reply({ content: `🚫 You are blocked from using \`/feedback\` for **${fmtRemaining(status.remainingMs)}**.`, ephemeral: true }); return true; }

  const last = cooldown.get(interaction.user.id) || 0;
  const diff = nowMs() - last;
  if (diff < COOLDOWN_SECONDS * 1000) {
    await interaction.reply({ content: `⏳ Please wait **${fmtRemaining(COOLDOWN_SECONDS * 1000 - diff)}** before sending more feedback.`, ephemeral: true });
    return true;
  }

  const rawCategory = interaction.fields.getTextInputValue('fb:category')?.trim().slice(0, 50) || 'other';
  const content     = interaction.fields.getTextInputValue('fb:content')?.trim().slice(0, 1500);
  const categoryKey = normalizeCategory(rawCategory);

  // SINGLE EPHEMERAL MESSAGE: initial reply...
  await interaction.reply({ content: '✨ Thanks! Your feedback is being forwarded to the support server.', ephemeral: true });

  // Resolve support channel
  let supportChannel;
  try { supportChannel = (await resolveSupportChannel(interaction.client, categoryKey)).channel; }
  catch {
    await interaction.editReply({ content: '⚠️ Couldn’t reach the appropriate support channel. Please alert an admin.' });
    return true;
  }

  const sourceGuild = interaction.guild;
  const feedbackId  = makeFeedbackId(sourceGuild?.id, interaction.user.id);

  const base = {
    content,
    category: categoryKey,
    originGuildName: sourceGuild?.name || 'Direct Message',
    originGuildId: sourceGuild?.id || 'DM',
    userId: interaction.user.id,
    userTag: interaction.user.tag,
    sourceIconURL: sourceGuild?.iconURL() || null,
  };

  // Support message
  const supportMsg = await supportChannel.send({
    embeds: [buildCompactEmbed(base)],
    components: [buttonsStaffPage1(feedbackId, false)],
    allowedMentions: { parse: [] },
  });

  // Store
  feedbackIndex.set(feedbackId, {
    userId: interaction.user.id,
    userTag: interaction.user.tag,
    content,
    category: categoryKey,
    originGuildName: base.originGuildName,
    originGuildId: base.originGuildId,
    supportMsgId: supportMsg.id,
    supportChannelId: supportMsg.channelId,
    supportGuildId: supportMsg.guildId,
    messageUrl: supportMsg.url,
    resolved: false,
    moreShown: false,
    threadId: null,
    dmMsgId: null,
    lastStaffReply: null,
    abandoned: false,
  });
  cooldown.set(interaction.user.id, nowMs());

  // User DM single-card
  const entry = feedbackIndex.get(feedbackId);
  await upsertUserDmCard(interaction.client, entry, feedbackId);

  // ...then EDIT the same ephemeral message (no second message)
  await interaction.editReply({
    content: `✅ Thanks for the feedback — staff may contact you via DM.\n🧾 Feedback ID: \`${feedbackId}\``,
  });

  return true;
};

// --- Intake: Grant access modal --------------------------------------------
module.exports.handleGrantAccessModal = async (interaction) => {
  if (interaction.customId !== 'fb:grantModal') return false;

  const typed = interaction.fields.getTextInputValue('fb:grantId')?.trim();
  if (!typed) {
    await interaction.reply({ content: '✏️ Please provide a Feedback ID.', ephemeral: true });
    return true;
  }

  // Lookup exact match
  const entry = feedbackIndex.get(typed);
  if (!entry) {
    await interaction.reply({ content: '❌ Feedback ID not found. Double-check the ID from your DM.', ephemeral: true });
    return true;
  }

  // Ownership check: only the original reporter can unlock
  if (entry.userId !== interaction.user.id) {
    await interaction.reply({ content: '🔒 This Feedback ID does not belong to your account.', ephemeral: true });
    return true;
  }

  // Reject abandoned IDs
  if (entry.abandoned) {
    await interaction.reply({ content: '⛔ This Feedback ID was abandoned and cannot be redeemed. Please open a new /feedback.', ephemeral: true });
    return true;
  }

  // Ensure discussion thread exists on the staff message and add the member
  try {
    const thread = await ensureDiscussionThread(interaction.client, entry, typed);
    try { await thread.members.add(interaction.user.id); } catch {}
    await thread.send({ content: `🔓 <@${interaction.user.id}> was granted access via intake panel.`, allowedMentions: { users: [] } });

    // Nice UX: give them a direct jump link
    await interaction.reply({ content: `✅ Access granted. Jump in: ${thread.toString()}`, ephemeral: true });

    // Save thread id (in case it was just created)
    entry.threadId = thread.id;
    feedbackIndex.set(typed, entry);
  } catch (e) {
    await interaction.reply({ content: '⚠️ Could not open or access the conversation. Ask staff to check bot permissions.', ephemeral: true });
  }

  return true;
};

// --- Buttons (staff + user + intake panel) ----------------------------------
module.exports.handleButton = async (interaction) => {
  const id = interaction.customId || '';
  if (!id.startsWith('fb:')) return false;

  // Intake panel button: open modal to ask for Feedback ID
  if (id === 'fb:grant') {
    if (SUPPORT_INTAKE_CHANNEL_ID && interaction.channelId !== SUPPORT_INTAKE_CHANNEL_ID) {
      await interaction.reply({ content: '↪️ Please use this button in the designated intake channel.', ephemeral: true });
      return true;
    }
    await interaction.showModal(buildGrantAccessModal());
    return true;
  }

  // ---------- STAFF PAGE 1 ----------
  if (id.startsWith('fb:reply:')) {
    const feedbackId = id.split(':')[2];
    const entry = feedbackIndex.get(feedbackId);
    if (!entry) { await interaction.reply({ content: '❌ Feedback metadata not found.', ephemeral: true }); return true; }
    if (entry.resolved || entry.abandoned) { await interaction.reply({ content: 'ℹ️ This feedback is closed.', ephemeral: true }); return true; }
    const modal = new ModalBuilder().setCustomId(`fb:dmModal:${feedbackId}`).setTitle('Reply to Feedback (DM)');
    const replyField = new TextInputBuilder().setCustomId('fb:dmText').setLabel('Message to the user').setStyle(TextInputStyle.Paragraph).setMaxLength(1500).setRequired(true);
    await interaction.showModal(modal.addComponents(new ActionRowBuilder().addComponents(replyField)));
    return true;
  }

  if (id.startsWith('fb:resolve:')) {
    const feedbackId = id.split(':')[2];
    const entry = feedbackIndex.get(feedbackId);
    if (!entry) { await interaction.reply({ content: '❌ Feedback metadata not found.', ephemeral: true }); return true; }
    if (!isSupportGuildContext(interaction) || !requireSupportStaff(interaction)) { await interaction.reply({ content: '🔒 Staff only.', ephemeral: true }); return true; }
    if (entry.resolved || entry.abandoned) { await interaction.reply({ content: '✅ Already closed.', ephemeral: true }); return true; }

    try {
      const channel = await interaction.client.channels.fetch(entry.supportChannelId);
      const msg = await channel.messages.fetch(entry.supportMsgId);
      const base = {
        content: entry.content, category: entry.category, originGuildName: entry.originGuildName,
        originGuildId: entry.originGuildId, userId: entry.userId, userTag: entry.userTag, sourceIconURL: channel.guild?.iconURL() || null,
      };
      await msg.edit({ embeds: [buildCompactEmbed(base)], components: [buttonsStaffPage1(feedbackId, true)] });

      // delete thread
      if (entry.threadId) {
        try {
          const thread = await interaction.client.channels.fetch(entry.threadId);
          if (thread && (thread.type === ChannelType.PublicThread || thread.type === ChannelType.PrivateThread)) await thread.delete('Feedback resolved');
        } catch {}
        entry.threadId = null;
      }

      entry.resolved = true;
      feedbackIndex.set(feedbackId, entry);
      await upsertUserDmCard(interaction.client, entry, feedbackId);

      await interaction.reply({ content: '✅ Marked as resolved.', ephemeral: true });
    } catch { await interaction.reply({ content: '⚠️ Could not update.', ephemeral: true }); }
    return true;
  }

  if (id.startsWith('fb:more:')) {
    const feedbackId = id.split(':')[2];
    const entry = feedbackIndex.get(feedbackId);
    if (!entry) { await interaction.reply({ content: '❌ Feedback metadata not found.', ephemeral: true }); return true; }
    try {
      const channel = await interaction.client.channels.fetch(entry.supportChannelId);
      const msg = await channel.messages.fetch(entry.supportMsgId);
      const base = {
        content: entry.content, category: entry.category, originGuildName: entry.originGuildName,
        originGuildId: entry.originGuildId, userId: entry.userId, userTag: entry.userTag, sourceIconURL: channel.guild?.iconURL() || null,
      };
      await msg.edit({ embeds: [buildExpandedEmbed(base, feedbackId)], components: [buttonsStaffPage2(feedbackId, entry.resolved || entry.abandoned, !!entry.threadId)] });
      entry.moreShown = true; feedbackIndex.set(feedbackId, entry);
      await interaction.reply({ content: '↗️ More options.', ephemeral: true });
    } catch { await interaction.reply({ content: '⚠️ Could not open more options.', ephemeral: true }); }
    return true;
  }

  // ---------- STAFF PAGE 2 ----------
  if (id.startsWith('fb:blacklist:')) {
    const feedbackId = id.split(':')[2];
    const entry = feedbackIndex.get(feedbackId);
    if (!entry) { await interaction.reply({ content: '❌ Feedback metadata not found.', ephemeral: true }); return true; }
    if (!isSupportGuildContext(interaction) || !requireSupportStaff(interaction)) { await interaction.reply({ content: '🔒 Staff only.', ephemeral: true }); return true; }

    const until = nowMs() + BLACKLIST_DAYS * ONE_DAY_MS;
    blacklist.set(entry.userId, until);
    await interaction.reply({ content: `🛑 User blacklisted for **${BLACKLIST_DAYS} days**.`, ephemeral: true });
    return true;
  }

  if (id.startsWith('fb:expand:')) {
    const feedbackId = id.split(':')[2];
    const entry = feedbackIndex.get(feedbackId);
    if (!entry) { await interaction.reply({ content: '❌ Feedback metadata not found.', ephemeral: true }); return true; }
    if (!isSupportGuildContext(interaction) || !requireSupportStaff(interaction)) { await interaction.reply({ content: '🔒 Staff only.', ephemeral: true }); return true; }
    try {
      const thread = await ensureDiscussionThread(interaction.client, entry, feedbackId);
      const channel = await interaction.client.channels.fetch(entry.supportChannelId);
      const msg = await channel.messages.fetch(entry.supportMsgId);
      await msg.edit({ components: [buttonsStaffPage2(feedbackId, entry.resolved || entry.abandoned, !!thread)] });
      await interaction.reply({ content: '🧵 Discussion opened.', ephemeral: true });
    } catch { await interaction.reply({ content: '⚠️ Failed to open discussion.', ephemeral: true }); }
    return true;
  }

  if (id.startsWith('fb:less:')) {
    const feedbackId = id.split(':')[2];
    const entry = feedbackIndex.get(feedbackId);
    if (!entry) { await interaction.reply({ content: '❌ Feedback metadata not found.', ephemeral: true }); return true; }
    try {
      const channel = await interaction.client.channels.fetch(entry.supportChannelId);
      const msg = await channel.messages.fetch(entry.supportMsgId);
      const base = {
        content: entry.content, category: entry.category, originGuildName: entry.originGuildName,
        originGuildId: entry.originGuildId, userId: entry.userId, userTag: entry.userTag, sourceIconURL: channel.guild?.iconURL() || null,
      };
      const disabled = entry.resolved || entry.abandoned;
      await msg.edit({ embeds: [buildCompactEmbed(base)], components: [buttonsStaffPage1(feedbackId, disabled)] });
      entry.moreShown = false; feedbackIndex.set(feedbackId, entry);
      await interaction.reply({ content: '↙️ Less options.', ephemeral: true });
    } catch { await interaction.reply({ content: '⚠️ Could not close more options.', ephemeral: true }); }
    return true;
  }

  // ================= USER CARD BUTTONS =================

  // User: Abandon → mark abandoned (red in staff), delete thread, remove user buttons
  if (id.startsWith('fb:userClose:')) {
    const feedbackId = id.split(':')[2];
    const entry = feedbackIndex.get(feedbackId);
    if (!entry) { await replyCompat(interaction, { content: '❌ Case not found.' }); return true; }
    if (entry.abandoned) { await interaction.deferUpdate().catch(()=>{}); return true; }

    try {
      const channel = await interaction.client.channels.fetch(entry.supportChannelId);
      const msg = await channel.messages.fetch(entry.supportMsgId);

      // Build a red "Abandoned" staff embed
      const base = {
        content: entry.content, category: entry.category, originGuildName: entry.originGuildName,
        originGuildId: entry.originGuildId, userId: entry.userId, userTag: entry.userTag, sourceIconURL: channel.guild?.iconURL() || null,
      };
      const abandonedEmbed = buildCompactEmbed(base)
        .setColor(0xED4245) // red
        .addFields({ name: 'Status', value: 'Abandoned' });

      // Staff can only blacklist after abandonment
      await msg.edit({ embeds: [abandonedEmbed], components: [buttonsStaffAbandoned(feedbackId)] });

      // Delete thread if exists
      if (entry.threadId) {
        try {
          const thread = await interaction.client.channels.fetch(entry.threadId);
          if (thread && (thread.type === ChannelType.PublicThread || thread.type === ChannelType.PrivateThread)) {
            await thread.delete('User abandoned the case');
          }
        } catch {}
        entry.threadId = null;
      }

      // Mark state and update DM card (no further help, no abandon button)
      entry.abandoned = true;
      entry.resolved = true; // also considered closed
      feedbackIndex.set(feedbackId, entry);
      await upsertUserDmCard(interaction.client, entry, feedbackId);

      await interaction.deferUpdate().catch(()=>{});
    } catch {
      await replyCompat(interaction, { content: '⚠️ Could not abandon right now.' });
    }
    return true;
  }

  return false;
};

// --- STAFF DM reply modal (updates user DM card preview + logs to thread) ---
module.exports.handleDmReplyModal = async (interaction) => {
  const id = interaction.customId || '';
  if (!id.startsWith('fb:dmModal:')) return false;

  const feedbackId = id.split(':')[2];
  const entry = feedbackIndex.get(feedbackId);
  const replyText = interaction.fields.getTextInputValue('fb:dmText')?.trim();

  if (!entry) { await interaction.reply({ content: '❌ Feedback metadata not found.', ephemeral: true }); return true; }
  if (!replyText) { await interaction.reply({ content: '✏️ Please provide a message.', ephemeral: true }); return true; }
  if (entry.abandoned) { await interaction.reply({ content: '⛔ Case was abandoned by user.', ephemeral: true }); return true; }

  try {
    // DM the user with a staff message
    const user = await interaction.client.users.fetch(entry.userId);
    await user.send({ embeds: [new EmbedBuilder()
      .setTitle('📬 Support Team Reply')
      .setDescription(replyText)
      .setColor(0x5865F2)
      .addFields({ name: 'Feedback ID', value: `\`${feedbackId}\`` })
      .setTimestamp()] });

    // record lastStaffReply and refresh the DM case card (with transcript)
    entry.lastStaffReply = replyText;
    feedbackIndex.set(feedbackId, entry);

    // log to thread + refresh card
    const thread = await ensureDiscussionThread(interaction.client, entry, feedbackId);
    const embed = new EmbedBuilder()
      .setTitle('📬 Staff DM Sent to User')
      .setDescription(replyText)
      .setColor(0x5865F2)
      .addFields({ name: 'Feedback ID', value: `\`${feedbackId}\`` })
      .setTimestamp();
    await thread.send({ embeds: [embed] });

    await upsertUserDmCard(interaction.client, entry, feedbackId);

    await interaction.reply({ content: `✅ DM sent. User’s case card updated.`, ephemeral: true });
  } catch {
    await interaction.reply({ content: '⚠️ Failed to DM the user or update thread.', ephemeral: true });
  }

  return true;
};

// --- USER reply modal (posts into thread, refreshes DM card) -----------------
module.exports.handleUserReplyModal = async (interaction) => {
  const id = interaction.customId || '';
  if (!id.startsWith('fb:userReplyModal:')) return false;

  const feedbackId = id.split(':')[2];
  const entry = feedbackIndex.get(feedbackId);
  const replyText = interaction.fields.getTextInputValue('fb:userReplyText')?.trim();

  if (!entry) { await replyCompat(interaction, { content: '❌ Feedback reference not found.' }, { autoDeleteInDM: true }); return true; }
  if (!replyText) { await replyCompat(interaction, { content: '✏️ Please type a message.' }, { autoDeleteInDM: true }); return true; }
  if (entry.abandoned) { await replyCompat(interaction, { content: '⛔ This case was abandoned. Create a new /feedback.' }, { autoDeleteInDM: true }); return true; }

  try {
    // If somehow closed (but not abandoned), re-open on comment (optional)
    if (entry.resolved) {
      const channel = await interaction.client.channels.fetch(entry.supportChannelId);
      const msg = await channel.messages.fetch(entry.supportMsgId);
      const base = {
        content: entry.content, category: entry.category, originGuildName: entry.originGuildName,
        originGuildId: entry.originGuildId, userId: entry.userId, userTag: entry.userTag, sourceIconURL: channel.guild?.iconURL() || null,
      };
      await msg.edit({ embeds: [buildCompactEmbed(base)], components: [buttonsStaffPage1(feedbackId, false)] });
      entry.resolved = false;
      feedbackIndex.set(feedbackId, entry);
    }

    // ensure discussion thread, log user comment
    const thread = await ensureDiscussionThread(interaction.client, entry, feedbackId);
    const embed = new EmbedBuilder()
      .setTitle('💬 User Comment')
      .setDescription(replyText)
      .setColor(0x57F287)
      .addFields(
        { name: 'From', value: `<@${entry.userId}> (\`${entry.userTag}\`)`, inline: true },
        { name: 'Feedback ID', value: `\`${feedbackId}\``, inline: true },
      )
      .setTimestamp();
    await thread.send({ embeds: [embed] });

    // refresh the DM card (to include the new line in the description)
    await upsertUserDmCard(interaction.client, entry, feedbackId);

    await replyCompat(interaction, { content: '✅ Sent your comment to the support team.' }, { autoDeleteInDM: true });
  } catch {
    await replyCompat(interaction, { content: '⚠️ Could not forward your comment.' }, { autoDeleteInDM: true });
  }

  return true;
};

// Exports for optional persistence/debugging
module.exports.__feedbackIndex = feedbackIndex;
module.exports.__blacklist = blacklist;
module.exports.__cooldown = cooldown;
module.exports.__categoryChannels = CATEGORY_CHANNELS;

// Export the intake panel ensure function so you can call it on ready
module.exports.ensureIntakePanel = ensureIntakePanel;
