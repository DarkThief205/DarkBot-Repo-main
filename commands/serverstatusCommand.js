const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('serverstatus')
        .setDescription('Get the current status of the server'),
    async execute(interaction) {
        const guild = interaction.guild;

        const totalMembers = guild.memberCount;
        const onlineMembers = guild.members.cache.filter(member => member.presence?.status === 'online').size;
        const idleMembers = guild.members.cache.filter(member => member.presence?.status === 'idle').size;
        const dndMembers = guild.members.cache.filter(member => member.presence?.status === 'dnd').size;
        const serverCreatedAt = guild.createdAt;
        const serverAge = Math.floor((Date.now() - serverCreatedAt) / (1000 * 60 * 60 * 24));
        const serverIcon = guild.iconURL({ dynamic: true });

        const embed = new EmbedBuilder()
            .setColor('#00AFFF')
            .setTitle(`🏰 Server Status for ${guild.name}`)
            .addFields(
                { name: 'Total Members', value: `${totalMembers}`, inline: true },
                { name: 'Online Members', value: `${onlineMembers}`, inline: true },
                { name: 'Idle Members', value: `${idleMembers}`, inline: true },
                { name: 'Do Not Disturb Members', value: `${dndMembers}`, inline: true },
                { name: 'Server Age', value: `${serverAge} days`, inline: true },
            )
            .setThumbnail(serverIcon)
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
};
