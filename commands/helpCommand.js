const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Lists all available commands and their descriptions.'),
    async execute(interaction) {
        const commands = interaction.client.commands;

        // Embed builder
        const helpEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('Available Commands')
            .setDescription('Here is a list of all available commands:')
            .setFooter({ text: 'Use "/" followed by the command name to execute.' })
            .setTimestamp();

        // Add each command to the embed
        commands.forEach((command) => {
            helpEmbed.addFields({ name: `/${command.data.name}`, value: command.data.description, inline: false });
        });

        // Reply with the embed
        await interaction.reply({ embeds: [helpEmbed] });
    },
};
