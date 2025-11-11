const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const path = require('path');
const { hasGuildPermOrOwner } = require(path.join(__dirname, '..', '..', 'utils', 'permissionHelpers'));


module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Deletes a specified number of messages from the channel.')
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('Number of messages to delete')
        .setRequired(true)
    ),
  async execute(interaction) {
    const amount = interaction.options.getInteger('amount');

    // ✅ owner override OR ManageMessages perm
    if (!hasGuildPermOrOwner(interaction, PermissionsBitField.Flags.ManageMessages)) {
      return interaction.reply({ content: 'You do not have permission to manage messages.', ephemeral: true });
    }

    if (amount < 1 || amount > 100) {
      return interaction.reply({ content: 'Please provide a number between 1 and 100.', ephemeral: true });
    }

    try {
      await interaction.channel.bulkDelete(amount, true);
      await interaction.reply({ content: `Successfully deleted ${amount} messages.`, ephemeral: true });
    } catch (error) {
      console.error('Error clearing messages:', error);
      await interaction.reply({ content: 'Failed to clear messages. Ensure I have the correct permissions.', ephemeral: true });
    }
  },
};
