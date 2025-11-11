const { SlashCommandBuilder } = require('@discordjs/builders');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const fs = require('fs');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reload')
        .setDescription('Reload commands dynamically and update Discord API.'),
    async execute(interaction) {
        if (interaction.user.id !== '1330971801286606880') {
            return interaction.reply({
                content: 'You do not have permission to use this command!',
                ephemeral: true,
            });
        }

        const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
        interaction.client.commands.clear();

        for (const file of commandFiles) {
            delete require.cache[require.resolve(`./${file}`)];
            const command = require(`./${file}`);
            interaction.client.commands.set(command.data.name, command);
        }

        const commands = interaction.client.commands.map(cmd => cmd.data.toJSON());
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

        try {
            await rest.put(
                Routes.applicationCommands(process.env.CLIENT_ID),
                { body: commands }
            );
            await interaction.reply({
                content: '✅ Commands reloaded and registered successfully!',
                ephemeral: true,
            });
        } catch (error) {
            console.error('Failed to reload commands:', error);
            await interaction.reply({
                content: `❌ Failed to reload commands: ${error.message}`,
                ephemeral: true,
            });
        }
    },
};




