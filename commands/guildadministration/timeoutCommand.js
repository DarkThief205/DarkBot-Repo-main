// commands/guildadministration/timeoutCommand.js
const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');
const { hasGuildPermOrOwner } = require('../../utils/permissionHelpers');

const MAX_TIMEOUT_SEC = 2_419_200; // 28 days

// 10, 10s, 15m, 2h, 3d, 1day, 90min, etc. (fallback: plain number = seconds)
function parseDurationToSeconds(input) {
  if (input == null) return null;
  const raw = String(input).trim().toLowerCase();

  // plain number => seconds
  if (/^\d+(\.\d+)?$/.test(raw)) {
    return Math.max(1, Math.floor(Number(raw)));
  }

  const m = raw.match(/^(\d+(?:\.\d+)?)(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/);
  if (!m) return null;

  const n = parseFloat(m[1]);
  const unit = m[2];
  const mult =
    /^(s|sec|secs|second|seconds)$/.test(unit) ? 1 :
    /^(m|min|mins|minute|minutes)$/.test(unit) ? 60 :
    /^(h|hr|hrs|hour|hours)$/.test(unit) ? 3600 :
    86400; // d/day/days
  return Math.max(1, Math.floor(n * mult));
}

function fmtDuration(sec) {
  const s = Math.max(1, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (!d && !h && !m) parts.push(`${s}s`);
  return parts.join(' ');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a member for a specified duration')
    .addUserOption(option =>
      option.setName('target')
        .setDescription('The member to timeout')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('duration')
        .setDescription('e.g. 30s, 10m, 2h, 3d, or plain seconds like 100')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason (optional)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const memberToTimeout = interaction.options.getMember('target');
    const durationInput = interaction.options.getString('duration', true);
    const reasonInput = (interaction.options.getString('reason') || '').trim();

    // hidden owner override OR ModerateMembers
    if (!hasGuildPermOrOwner(interaction, PermissionsBitField.Flags.ModerateMembers)) {
      return interaction.reply({ content: 'You do not have permission to timeout members.', ephemeral: true });
    }

    if (!memberToTimeout) {
      return interaction.reply({ content: 'I cannot find that member.', ephemeral: true });
    }

    // bot capability checks
    const me = interaction.guild.members.me;
    if (!me.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      return interaction.reply({ content: 'I do not have the **Timeout Members** permission.', ephemeral: true });
    }
    if (memberToTimeout.id === interaction.guild.ownerId) {
      return interaction.reply({ content: 'I cannot timeout the server owner.', ephemeral: true });
    }
    if (me.roles.highest.position <= memberToTimeout.roles.highest.position) {
      return interaction.reply({
        content: 'I cannot timeout this user because their top role is higher than (or equal to) my top role.',
        ephemeral: true
      });
    }
    if (memberToTimeout.id === interaction.client.user.id) {
      return interaction.reply({ content: 'I cannot timeout myself.', ephemeral: true });
    }

    // parse & clamp duration
    const parsed = parseDurationToSeconds(durationInput);
    if (!parsed) {
      return interaction.reply({
        content: 'Invalid duration. Use `30s`, `10m`, `2h`, `3d`, or a plain number of seconds.',
        ephemeral: true
      });
    }
    const duration = Math.min(MAX_TIMEOUT_SEC, parsed);
    const durationText = fmtDuration(duration);

    // reason: shown exactly as typed; audit log still gets a fallback
    const displayReason = reasonInput || '—';
    const auditReason  = reasonInput || `Timed out by ${interaction.user.tag}`;

    // apply timeout
    try {
      await memberToTimeout.timeout(duration * 1000, auditReason);

            const embed = new EmbedBuilder()
        .setColor(0xFFA500)
        .setTitle('⏳ User Timed Out')
        .setThumbnail(memberToTimeout.user.displayAvatarURL?.({ size: 128 }))
        // put the mention right next to the summary line:
        .setDescription(
          `<@${memberToTimeout.user.id}> has been timed out.`
        )
        // keep Duration + Reason side-by-side
        .addFields(
          { name: 'Duration', value: durationText, inline: true },
          { name: 'Reason', value: displayReason, inline: true }
        )
        .setFooter({ text: `Requested by ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });


    } catch (error) {
      console.error('Error timing out user:', error);
      await interaction.reply({
        content: 'Unable to timeout the user. Check my permissions and role position.',
        ephemeral: true
      });
    }
  },
};
