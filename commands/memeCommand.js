const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

module.exports = {
    data: new SlashCommandBuilder()
        .setName('meme')
        .setDescription('Fetches a random meme!'),
    async execute(interaction) {
        try {
            const response = await fetch('https://meme-api.com/gimme');
            const data = await response.json();

            const memeEmbed = new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle(data.title)
                .setImage(data.url)
                .setFooter({ text: `Subreddit: ${data.subreddit}` });

            await interaction.reply({ embeds: [memeEmbed] });
        } catch (error) {
            console.error('Error fetching meme:', error);
            await interaction.reply('Failed to fetch a meme. Try again later!');
        }
    },
};

