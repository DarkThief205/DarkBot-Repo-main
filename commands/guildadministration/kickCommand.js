const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');
const path = require('path');
const { hasGuildPermOrOwner } = require(path.join(__dirname, '..', '..', 'utils', 'permissionHelpers'));


module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kicks a member from the server.')
    .addUserOption(option =>
      option.setName('member')
        .setDescription('The member to kick')
        .setRequired(true)
    ),
  async execute(interaction) {
    const member = interaction.options.getMember('member');

    // ✅ owner override OR KickMembers perm
    if (!hasGuildPermOrOwner(interaction, PermissionsBitField.Flags.KickMembers)) {
      return interaction.reply({ content: 'You do not have permission to kick members.', ephemeral: true });
    }

    if (!member) {
      return interaction.reply({ content: 'I cannot find that member.', ephemeral: true });
    }

    if (!member.kickable) {
      return interaction.reply({ content: 'I cannot kick this member. Ensure I have the necessary permissions.', ephemeral: true });
    }

    try {
      await member.kick(`Kicked by ${interaction.user.tag}`);
      const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('🔨 User Kicked')
        .setDescription(`${member.user.tag} has been kicked.`)
        .setFooter({ text: `Kicked by ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error('Error kicking user:', error);
      await interaction.reply({ content: 'Failed to kick the member.', ephemeral: true });
    }
  },
};
