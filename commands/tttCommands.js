const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tictactoe')
        .setDescription('Play Tic-Tac-Toe!')
        .addUserOption(option =>
            option.setName('opponent')
                .setDescription('Choose an opponent to play against or leave empty to play with the bot.')),
    async execute(interaction) {
        const starter = interaction.user.id;
        const opponent = interaction.options.getUser('opponent');
        const isBotGame = !opponent; // No opponent means playing vs Bot

        let gameBoard = Array(9).fill('⬜'); // Empty cells
        let currentPlayer = 'X';
        let gameEnded = false;
        let scores = { X: 0, O: 0 };

        const players = {
            X: starter,
            O: opponent ? opponent.id : 'Bot'
        };

        const createEmbed = (title) => {
            return new EmbedBuilder()
                .setTitle('Tic-Tac-Toe')
                .setDescription(`**${title}**`)
                .setColor(0x00FF00);
        };

        const createBoard = () => {
            const rows = [];
            for (let i = 0; i < 3; i++) {
                const row = new ActionRowBuilder();
                for (let j = 0; j < 3; j++) {
                    const cellIndex = i * 3 + j;
                    row.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`cell_${cellIndex}`)
                            .setLabel(gameBoard[cellIndex])
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(gameBoard[cellIndex] !== '⬜')
                    );
                }
                rows.push(row);
            }
            return rows;
        };

        const resetGame = () => {
            gameBoard = Array(9).fill('⬜');
            currentPlayer = 'X';
            gameEnded = false;
        };

        const checkWin = (board) => {
            const winPatterns = [
                [0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]
            ];
            for (const pattern of winPatterns) {
                const [a, b, c] = pattern;
                if (board[a] !== '⬜' && board[a] === board[b] && board[a] === board[c]) {
                    return board[a];
                }
            }
            return board.includes('⬜') ? null : 'Draw';
        };

        const botMove = () => {
            const emptyCells = gameBoard
                .map((cell, index) => (cell === '⬜' ? index : null))
                .filter(i => i !== null);

            const move = emptyCells[Math.floor(Math.random() * emptyCells.length)];
            gameBoard[move] = 'O';
        };

        const updateGame = async (interaction, winner = null) => {
            if (winner) {
                scores[winner]++;
                gameEnded = true;
                await interaction.update({
                    embeds: [createEmbed(winner === 'Draw' ? "It's a draw!" : `${winner} wins!`)],
                    components: [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('replay').setLabel('Replay').setStyle(ButtonStyle.Success),
                            new ButtonBuilder().setCustomId('endgame').setLabel('End Game').setStyle(ButtonStyle.Danger)
                        )
                    ]
                });
            } else {
                await interaction.update({
                    embeds: [createEmbed(`Turn: ${currentPlayer}`)],
                    components: createBoard()
                });
            }
        };

        await interaction.reply({
            embeds: [createEmbed(`Turn: ${currentPlayer}`)],
            components: createBoard()
        });

        const collector = interaction.channel.createMessageComponentCollector({ time: 600000 });

        collector.on('collect', async (btnInteraction) => {
            const userId = btnInteraction.user.id;
            const customId = btnInteraction.customId;

            if (customId === 'replay') {
                resetGame();
                await btnInteraction.update({
                    embeds: [createEmbed(`New game started! Turn: ${currentPlayer}`)],
                    components: createBoard()
                });
                return;
            } else if (customId === 'endgame') {
                gameEnded = true;
                await btnInteraction.update({
                    embeds: [createEmbed(`Game Over! Results:\n**X: ${scores.X} wins**\n**O: ${scores.O} wins**`)],
                    components: []
                });
                return;
            }

            if ((currentPlayer === 'X' && userId !== players.X) || (currentPlayer === 'O' && userId !== players.O)) {
                return btnInteraction.reply({ content: 'It is not your turn!', ephemeral: true });
            }

            const cellIndex = parseInt(customId.split('_')[1]);
            if (gameBoard[cellIndex] !== '⬜' || gameEnded) {
                return btnInteraction.reply({ content: 'Invalid move or game has ended!', ephemeral: true });
            }

            gameBoard[cellIndex] = currentPlayer;

            const winner = checkWin(gameBoard);
            if (winner) {
                await updateGame(btnInteraction, winner);
                return;
            }

            currentPlayer = currentPlayer === 'X' ? 'O' : 'X';

            if (isBotGame && currentPlayer === 'O') {
                botMove();
                const botWinner = checkWin(gameBoard);
                if (botWinner) {
                    await updateGame(btnInteraction, botWinner);
                    return;
                }
                currentPlayer = 'X';
            }

            await updateGame(btnInteraction);
        });

        collector.on('end', async () => {
            if (!gameEnded) {
                await interaction.editReply({ content: 'The game has ended due to inactivity.', components: [] });
            }
        });
    },
};



