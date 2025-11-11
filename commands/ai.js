// commands/ai.js
const { SlashCommandBuilder, Events } = require('discord.js');
const fetch = require('node-fetch'); // use node-fetch@2

// ===== CONFIG =====
const COHERE_API_KEY = process.env.COHERE_API_KEY;
const COHERE_MODEL   = process.env.COHERE_MODEL || 'command-a-03-2025';
const MAX_TOKENS     = 300;
const TEMP           = 0.7;
const INACTIVITY_MS  = 5 * 60 * 1000; // 5 minutes

// ===== SESSION STORAGE =====
const sessions = new Map();    // anchorMsgId -> { userId, channelId, history, timeout }
const msgToAnchor = new Map(); // botMsgId -> anchorMsgId

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ai')
    .setDescription('Chat with the AI (reply to continue your own session)')
    .addStringOption(o =>
      o.setName('prompt')
       .setDescription('Your first message to start chatting')
       .setRequired(true)
    ),

  async execute(interaction) {
    const prompt = interaction.options.getString('prompt', true).trim();

    if (!COHERE_API_KEY)
      return interaction.reply({ content: '❌ Missing COHERE_API_KEY in .env', ephemeral: true });
    if (!prompt)
      return interaction.reply({ content: '⚠️ Please type a non-empty message.', ephemeral: true });

    await interaction.deferReply({ ephemeral: true });
    const channel = interaction.channel;

    try {
      await channel.sendTyping();

      const history = [{ role: 'USER', text: prompt }];
      const aiText  = await callCohere(prompt, history);

      // Post the first AI reply publicly (anchor)
      const botMsg = await channel.send({ content: aiText.slice(0, 2000) });

      // Start a new session
      const timeout = startTimeout(botMsg.id, channel);
      sessions.set(botMsg.id, {
        userId: interaction.user.id,
        channelId: channel.id,
        history: [...history, { role: 'CHATBOT', text: aiText }],
        timeout
      });
      msgToAnchor.set(botMsg.id, botMsg.id);

      await interaction.editReply('✅ Session started! Reply to the bot’s message to continue chatting.');
    } catch (err) {
      console.error('AI /ai error:', err);
      await interaction.editReply('❌ Error contacting the AI.');
    }
  },

  async handleMessage(message) {
    try {
      if (!message.reference || message.author.bot) return;

      const repliedTo = await message.channel.messages
        .fetch(message.reference.messageId)
        .catch(() => null);
      if (!repliedTo || !repliedTo.author.bot) return;

      // Find the anchor session
      const anchorId = msgToAnchor.get(repliedTo.id) || msgToAnchor.get(message.reference.messageId);
      if (!anchorId || !sessions.has(anchorId)) return;

      const session = sessions.get(anchorId);

      // Only owner can reply
      if (message.author.id !== session.userId) {
        return message.reply('🚫 This conversation belongs to someone else. Start your own with `/ai`.');
      }

      const userText = message.content.trim();
      if (!userText) return;

      // Check for goodbye words
      if (/\b(end chat|goodbye|bye|cancel|quit|abort)\b/i.test(userText)) {
        await endSession(anchorId, message, '👋 Conversation ended.');
        return;
      }

      // Reset timeout timer (active user)
      resetTimeout(anchorId, message.channel);

      session.history.push({ role: 'USER', text: userText });

      await message.channel.sendTyping();
      const aiText = await callCohere(userText, session.history);

      const botReply = await message.reply(aiText.slice(0, 2000));

      session.history.push({ role: 'CHATBOT', text: aiText });
      msgToAnchor.set(botReply.id, anchorId);

      // Trim old turns
      trimHistory(session.history, 6);
    } catch (err) {
      console.error('AI reply error:', err);
      try { await message.reply('❌ AI error.'); } catch {}
    }
  },

  setup(client) {
    client.on(Events.MessageCreate, this.handleMessage);
  }
};

// ===== Helper Functions =====

function trimHistory(hist, maxTurns) {
  const maxMsgs = maxTurns * 2;
  if (hist.length > maxMsgs) {
    const keep = hist.slice(-maxMsgs);
    hist.length = 0;
    hist.push(...keep);
  }
}

// Start a timeout and announce expiration (auto-delete after 5s)
function startTimeout(anchorId, channel) {
  return setTimeout(async () => {
    const s = sessions.get(anchorId);
    if (!s) return;
    sessions.delete(anchorId);
    try {
      const msg = await channel.send(
        `💤 Conversation with <@${s.userId}> expired after 5 minutes of inactivity.`
      );
      // Auto-delete after 5s (ephemeral-like)
      setTimeout(() => msg.delete().catch(() => {}), 5000);
    } catch {}
    console.log(`💤 Session ${anchorId} expired.`);
  }, INACTIVITY_MS);
}

// Reset existing timeout
function resetTimeout(anchorId, channel) {
  const s = sessions.get(anchorId);
  if (!s) return;
  clearTimeout(s.timeout);
  s.timeout = startTimeout(anchorId, channel);
}

// Manually end session (goodbye detection) - auto-delete after 5s
async function endSession(anchorId, message, msg = '👋 Chat ended.') {
  const s = sessions.get(anchorId);
  if (!s) return;
  clearTimeout(s.timeout);
  sessions.delete(anchorId);

  try {
    const replyMsg = await message.reply({ content: msg });
    // Auto-delete after 5 seconds (ephemeral-like)
    setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
  } catch (err) {
    console.error('Failed to send end-session message:', err);
  }
}

// Cohere API call
async function callCohere(prompt, history) {
  const payload = {
    model: COHERE_MODEL,
    message: prompt,
    chat_history: history.map(h => ({ role: h.role, message: h.text })),
    temperature: TEMP,
    max_tokens: MAX_TOKENS,
  };

  const res = await fetch('https://api.cohere.ai/v1/chat', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${COHERE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Cohere ${res.status}: ${txt.slice(0, 400)}`);
  }

  const data = await res.json();
  return data.text || '⚠️ Empty response.';
}
