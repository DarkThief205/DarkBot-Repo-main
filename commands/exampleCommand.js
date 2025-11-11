const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('test')
        .setDescription('This is an example command.'),
    async execute(interaction) {
        await interaction.reply('Example command executed ZzZ!');
    },
};
