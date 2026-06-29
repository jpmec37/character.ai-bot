const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clearchat')
        .setDescription('Apaga as mensagens do chat atual.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages), // Apenas quem tem permissão de gerenciar mensagens pode usar
    async execute(client, interaction) {
        // Garante que o comando foi usado em um canal de texto de um servidor
        if (!interaction.channel) return;

        await interaction.deferReply({ ephemeral: true });

        try {
            // Apaga as últimas 99 mensagens do canal
            const deleted = await interaction.channel.bulkDelete(99, true);
            return interaction.editReply({ 
                content: `Sucesso! Foram apagadas ${deleted.size} mensagens deste canal.` 
            });
        } catch (error) {
            console.error(error);
            return interaction.editReply({ 
                content: 'Ocorreu um erro ao tentar apagar as mensagens deste canal. Mensagens com mais de 14 dias não podem ser apagadas em massa.' 
            });
        }
    },
};