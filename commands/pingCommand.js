// commands/ping.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

function msFmt(ms) {
  if (ms < 1000) return `${ms} ms`;
  const s = Math.floor(ms / 1000);
  const rem = ms % 1000;
  return `${s}s`;
}

function colorForPing(ping) {
  if (ping <= 120) return 0x57F287; // green
  if (ping <= 250) return 0xFEE75C; // yellow
  return 0xED4245;                  // red
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Replies with Pong! and latency metrics')
    .addBooleanOption(o =>
      o.setName('ephemeral')
        .setDescription('Show only to you (default: true)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const ephemeral = interaction.options.getBoolean('ephemeral') ?? true;

    // 1) Send a minimal reply and fetch the created timestamp in one go
    const sent = await interaction.reply({
      content: '🏓',
      ephemeral,
      fetchReply: true
    });

    // 2) Metrics
    const wsPing = Math.round(interaction.client.ws.ping); // gateway ping
    // REST round-trip: time Discord took to accept and create the message
    const restLatency = sent.createdTimestamp - interaction.createdTimestamp;

    // 3) Build final embed
    const uptimeMs = interaction.client.uptime ?? 0;
    const color = colorForPing(wsPing);

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle('🏓 Pong!')
      .addFields(
        { name: '🌐 Gateway (WS)', value: `${wsPing} ms`, inline: true },
        { name: '📨 REST Create', value: `${restLatency} ms`, inline: true },
        { name: '⏱️ Uptime', value: msFmt(uptimeMs), inline: true },
      )
      .setTimestamp(new Date())
      .setFooter({ text: interaction.client.user.tag });

    // 4) Replace the placeholder with the metrics
    await interaction.editReply({
      embeds: [embed],
      content: null,
      ephemeral
    });
  },
};
