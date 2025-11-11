// commands/serverinfo.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Show a decorated info card for this server'),

  async execute(interaction) {
    const { guild, client } = interaction;
    if (!guild) return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });

    await interaction.deferReply();

    // Owner
    let ownerMention = `<@${guild.ownerId}>`;
    let ownerTag = ownerMention;
    try {
      const owner = await guild.fetchOwner();
      ownerTag = `${owner.user.tag} (${ownerMention})`;
    } catch { /* fallback already set */ }

    // Numbers
    const rolesCount  = Math.max(0, guild.roles.cache.size - 1);
    const emojiCount  = guild.emojis?.cache?.size ?? 0;
    const boosts      = guild.premiumSubscriptionCount ?? 0;
    const channelsAll = guild.channels.cache.filter(c => !c.isThread()).size;

    // Verification pretty text + emoji
    const verificationMap = {
      0: 'None',
      1: 'Low',
      2: 'Medium',
      3: 'High',
      4: 'Very High'
    };
    const verification = verificationMap[guild.verificationLevel] ?? String(guild.verificationLevel);

    // Media
    const iconUrl      = guild.iconURL({ size: 512, extension: 'png' }) ?? null;
    const bannerUrl    = guild.bannerURL({ size: 2048, extension: 'png' }) ?? null;
    const discoveryUrl = guild.discoverySplashURL({ size: 2048, extension: 'png' }) ?? null;

    // cute divider
    const divider = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

    // Build embed
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setAuthor({ name: `${guild.name}`, iconURL: iconUrl ?? client.user.displayAvatarURL() })
      .setTitle('✨ Server Overview')
      .setThumbnail(iconUrl ?? client.user.displayAvatarURL())
      .setDescription([
        `> ${divider}`,
        `**🆔 ID:** \`${guild.id}\``,
        `**👑 Owner:** ${ownerTag}`,
        `**📅 Creation:** <t:${Math.floor(guild.createdTimestamp / 1000)}:d>`,
        `> ${divider}`
      ].join('\n'))
      .addFields(
        { name: '👥 Members',     value: `**${guild.memberCount}**`, inline: true },
        { name: '📁 Channels',    value: `**${channelsAll}**`,       inline: true },
        { name: '🏷️ Roles',       value: `**${rolesCount}**`,        inline: true },
        { name: '😄 Emojis',      value: `**${emojiCount}**`,        inline: true },
        { name: '🚀 Boosts',      value: `**${boosts}**`,            inline: true },
        { name: '🔒 Verification',value: `${verification}`,          inline: true },
      )
      .setFooter({
        text: `${client.user.username} • Cluster ${guild?.shardId ?? 0} • Shard ${guild?.shardId ?? 0}`
      })
      .setTimestamp();

    // If the server has a banner, show it large at the bottom
    if (bannerUrl) embed.setImage(bannerUrl);

    // Buttons (with emojis) — auto-disabled if the asset doesn’t exist
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Icon')
        .setEmoji('🖼️')
        .setStyle(ButtonStyle.Link)
        .setURL(iconUrl || 'https://discord.com')
        .setDisabled(!iconUrl),
      new ButtonBuilder()
        .setLabel('Banner')
        .setEmoji('🖼️')
        .setStyle(ButtonStyle.Link)
        .setURL(bannerUrl || 'https://discord.com')
        .setDisabled(!bannerUrl),
      new ButtonBuilder()
        .setLabel('Discovery')
        .setEmoji('🌐')
        .setStyle(ButtonStyle.Link)
        .setURL(discoveryUrl || 'https://discord.com')
        .setDisabled(!discoveryUrl),
    );

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  },
};
