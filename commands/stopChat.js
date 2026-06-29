const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Desliga o bot com segurança.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator), // Apenas administradores
    async execute(client, interaction) {
        await interaction.reply({ content: 'Desligando o bot com segurança...', ephemeral: true });
        process.exit(0); // Fecha o terminal e desliga o processo do Node
    },
};