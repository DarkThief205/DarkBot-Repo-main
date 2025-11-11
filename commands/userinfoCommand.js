const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('userinfo')
        .setDescription('Fetch information about a user')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user you want to fetch information for')
                .setRequired(false)),
    async execute(interaction) {
        const user = interaction.options.getUser('target') || interaction.user;
        const member = interaction.guild.members.cache.get(user.id);

        let status = 'offline';
        let color = '#808080';

        if (member.presence) {
            switch (member.presence.status) {
                case 'online': status = 'Online'; color = '#00FF00'; break;
                case 'idle': status = 'Idle'; color = '#FFFF00'; break;
                case 'dnd': status = 'Do Not Disturb'; color = '#FF0000'; break;
            }
        }

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(`👤 User Info for ${user.username}`)
            .setThumbnail(user.displayAvatarURL())
            .addFields(
                { name: 'Username:', value: user.username, inline: true },
                { name: 'User ID:', value: user.id, inline: true },
                { name: 'Joined Server On:', value: member.joinedAt.toDateString(), inline: true },
                { name: 'Status:', value: status, inline: true }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
};
