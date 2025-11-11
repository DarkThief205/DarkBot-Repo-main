const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('weather')
        .setDescription('Get weather information for a city')
        .addStringOption(option =>
            option.setName('city')
                .setDescription('Enter the city name')
                .setRequired(true)),
    async execute(interaction) {
        const city = interaction.options.getString('city');
        try {
            const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${city}`;
            const geocodeResponse = await axios.get(geocodeUrl);
            const { latitude, longitude } = geocodeResponse.data.results[0];

            const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`;
            const weatherResponse = await axios.get(weatherUrl);
            const { temperature, windspeed, winddirection } = weatherResponse.data.current_weather;

            const weatherEmbed = new EmbedBuilder()
                .setColor('#00AAFF')
                .setTitle(`Weather for ${city}`)
                .addFields(
                    { name: 'Temperature', value: `${temperature}°C`, inline: true },
                    { name: 'Wind Speed', value: `${windspeed} km/h`, inline: true },
                    { name: 'Wind Direction', value: `${winddirection}°`, inline: true }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [weatherEmbed] });
        } catch (error) {
            console.error('Error fetching weather:', error.message);
            await interaction.reply('Could not fetch weather data. Try another city.');
        }
    },
};
