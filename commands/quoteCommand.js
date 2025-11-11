const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('quote')
        .setDescription('Get an inspirational quote'),
    async execute(interaction) {
        try {
            const apiUrl = 'https://api.forismatic.com/api/1.0/?method=getQuote&format=json&lang=en';
            const response = await axios.get(apiUrl);
            const { quoteText, quoteAuthor } = response.data;

            const quoteEmbed = new EmbedBuilder()
                .setColor('#FFFF00')
                .setTitle('📚 Inspirational Quote 🗨️')
                .setDescription(`"${quoteText}"`)
                .setFooter({ text: `— ${quoteAuthor || 'Unknown'}` });

            await interaction.reply({ embeds: [quoteEmbed] });
        } catch (error) {
            console.error('Error fetching quote:', error.message);
            await interaction.reply('Failed to fetch a quote. Please try again later.');
        }
    },
};
