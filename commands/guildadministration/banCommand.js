const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');
const path = require('path');
const { hasGuildPermOrOwner } = require(path.join(__dirname, '..', '..', 'utils', 'permissionHelpers'));


module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user from the server')
    .addUserOption(option =>
      option.setName('target')
        .setDescription('The user to ban')
        .setRequired(true)
    ),
  async execute(interaction) {
    const userToBan = interaction.options.getUser('target');
    const memberToBan = interaction.guild.members.cache.get(userToBan.id);

    // ✅ owner override OR BanMembers perm
    if (!hasGuildPermOrOwner(interaction, PermissionsBitField.Flags.BanMembers)) {
      return interaction.reply({ content: 'You do not have permission to ban members.', ephemeral: true });
    }

    // Bot’s own perms and hierarchy still enforced (no override)
    if (!interaction.guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
      return interaction.reply({ content: 'I do not have permission to ban members.', ephemeral: true });
    }

    if (!memberToBan) {
      return interaction.reply({ content: 'I cannot find that user in this server.', ephemeral: true });
    }

    if (memberToBan.roles.highest.position >= interaction.guild.members.me.roles.highest.position) {
      return interaction.reply({ content: 'I cannot ban this user because their role is higher than mine.', ephemeral: true });
    }

    try {
      await memberToBan.ban({ reason: `Banned by ${interaction.user.tag}` });
      const banEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('🚫 User Banned')
        .setDescription(`${userToBan.tag} has been banned from the server!`)
        .setFooter({ text: `Banned by ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.reply({ embeds: [banEmbed] });
    } catch (error) {
      console.error('Error banning user:', error);
      interaction.reply({ content: 'I was unable to ban the user. Please ensure I have the necessary permissions.', ephemeral: true });
    }
  }
};
