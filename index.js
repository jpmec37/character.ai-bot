const { Client, GatewayIntentBits, Collection } = require("discord.js");
const Groq = require("groq-sdk");
const config = require("./config.json");
const fs = require("fs");
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord.js');

// Inicializa a IA da Groq
const groq = new Groq({ apiKey: config.groqKey });

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages
    ],
    partials: [1, 3]
});

client.commands = new Collection();
const commands = [];
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith(".js"));

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.data.name, command);
    commands.push(command.data.toJSON());
    console.log(`[Command] - ${command.data.name}.js carregado com sucesso.`);
}

// Função que conversa com a Groq (Usa o modelo Llama 3 que aceita personalidades perfeitamente)
async function perguntarAoGroq(nomeUsuario, texto) {
    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: config.personalidade // Força a personalidade aqui
                },
                {
                    role: "user",
                    content: `Usuário [${nomeUsuario}] diz: ${texto}`
                }
            ],
            model: "llama-3.3-70b-versatile", // Modelo ultra-rápido da Meta
            temperature: 0.7,
        });

        return chatCompletion.choices[0]?.message?.content || "Fiquei sem palavras agora...";
    } catch (err) {
        console.error("Erro na API da Groq:", err);
        return "Tive um soluço interno nos meus servidores, pode repetir?";
    }
}

client.once("ready", async () => {
    console.log(`${client.user.username} está online e usando a IA da Groq!`);
    console.log("A atualizar os comandos (/)...");
    
    const rest = new REST({ version: '10' }).setToken(config.token);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log("Comandos (/) recarregados com sucesso!");
    } catch (error) {
        console.error("Erro ao carregar comandos: ", error);
    }
});

client.on("messageCreate", async message => {
    if (message.author.bot) return;

    let msgText = message.content;
    const botMention = `<@${client.user.id}>`;

    if (message.guild && !message.content.startsWith(botMention)) return;

    if (message.content.startsWith(botMention)) {
        msgText = msgText.replace(botMention, "").trim();
    }

    if (msgText.length === 0) return message.reply("Olá! Como posso ajudar você hoje?");

    message.channel.sendTyping();
    
    // Envia a pergunta para a Groq
    const respostaIA = await perguntarAoGroq(message.author.username, msgText);
    return message.reply(respostaIA);
});

client.on("interactionCreate", async interaction => {
    if (interaction.isCommand()) {
        const slashCommand = client.commands.get(interaction.commandName);
        if (!slashCommand) return;
        try {
            await slashCommand.execute(client, interaction, null);
        } catch (err) {
            console.error(err);
        }
    }
});

client.login(config.token);