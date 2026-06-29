const { Client, GatewayIntentBits, Collection } = require("discord.js");
const Groq = require("groq-sdk");
const fs = require("fs");
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord.js');

// ================================================================
// CONFIGURAÇÃO DA LISTA DE IDs PARA DMs ALEATÓRIAS (ATUALIZADO)
// ================================================================
const IDS_ALVO_DM = ["1310397024541212672", "760510107988918333"]; 

// Configuração Inteligente de Chaves (PC Local vs Nuvem Render)
let config = {};
if (fs.existsSync("./config.json")) {
    config = require("./config.json");
} else {
    config = {
        token: process.env.DISCORD_TOKEN,
        groqKey: process.env.GROQ_KEY,
        personalidade: process.env.PERSONALIDADE
    };
}

// Inicializa a IA da Groq
const groq = new Groq({ apiKey: config.groqKey });

// Base de Memória do Bot (Histórico por utilizador)
const memoriaConversas = new Map();

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers
    ],
    partials: [1, 3] // Permite receber DMs perfeitamente
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

// Função de comunicação com a Groq adaptada para usar MEMÓRIA
async function perguntarAoGroqComMemoria(idUsuario, nomeUsuario, textoAtual) {
    try {
        if (!memoriaConversas.has(idUsuario)) {
            memoriaConversas.set(idUsuario, []);
        }

        const historicoUsuario = memoriaConversas.get(idUsuario);

        const mensagensParaEnviar = [
            { role: "system", content: config.personalidade }
        ];

        historicoUsuario.forEach(msg => mensagensParaEnviar.push(msg));
        mensagensParaEnviar.push({ role: "user", content: `Usuário [${nomeUsuario}] diz: ${textoAtual}` });

        const chatCompletion = await groq.chat.completions.create({
            messages: mensagensParaEnviar,
            model: "llama-3.3-70b-versatile",
            temperature: 0.7,
        });

        const respostaIA = chatCompletion.choices[0]?.message?.content || "Fiquei sem palavras agora...";

        // GESTÃO DA MEMÓRIA: Guarda a troca de mensagens atual no histórico
        historicoUsuario.push({ role: "user", content: `Usuário [${nomeUsuario}] diz: ${textoAtual}` });
        historicoUsuario.push({ role: "assistant", content: respostaIA });

        // Limita a memória para lembrar apenas das últimas 10 mensagens
        if (historicoUsuario.length > 10) {
            historicoUsuario.shift();
            historicoUsuario.shift();
        }

        return respostaIA;
    } catch (err) {
        console.error("Erro na API da Groq:", err);
        return "Tive um soluço interno nos meus servidores, pode repetir?";
    }
}

// Evento quando o bot liga
client.once("ready", async () => {
    console.log(`${client.user.username} está online, com memória e pronto na nuvem!`);
    
    // Define Status e Atividade de Humano
    client.user.setPresence({
        activities: [{ name: "Conversando no Discord", type: 0 }],
        status: "online"
    });

    // ================================================================
    // ROTINA AUTO-EXECUTÁVEL DE DM ALEATÓRIA (VIDA PRÓPRIA)
    // ================================================================
    async function rotinaMensagemAleatoria() {
        // Define o tempo de espera aleatório (Entre 1 hora e 6 horas)
        const tempoMinimo = 3600000; 
        const tempoMaximo = 21600000; 
        const tempoEspera = Math.floor(Math.random() * (tempoMaximo - tempoMinimo + 1)) + tempoMinimo;

        console.log(`[Rotina Privada] Próxima mensagem aleatória programada para daqui a ${(tempoEspera / 1000 / 60).toFixed(1)} minutos.`);

        setTimeout(async () => {
            if (IDS_ALVO_DM.length > 0) {
                try {
                    // Sorteia uma pessoa da lista de IDs configurada
                    const idSorteado = IDS_ALVO_DM[Math.floor(Math.random() * IDS_ALVO_DM.length)];
                    const usuarioAlvo = await client.users.fetch(idSorteado);
                    
                    if (usuarioAlvo) {
                        const dm = await usuarioAlvo.createDM();
                        
                        // Finge digitação real (entre 2 e 5 segundos)
                        await dm.sendTyping();
                        const tempoDigitando = Math.floor(Math.random() * 3000) + 2000;
                        await new Promise(resolve => setTimeout(resolve, tempoDigitando));

                        // IA gera o assunto surpresa integrado com a memória
                        const mensagemAleatoria = await perguntarAoGroqComMemoria(idSorteado, usuarioAlvo.username, "Puxe assunto comigo no privado do nada. Escolha um motivo aleatório qualquer de amigo. Seja curto, muito informal e natural de internet.");
                        
                        await dm.send(mensagemAleatoria);
                        console.log(`[Rotina Privada] Mensagem surpresa enviada para ${usuarioAlvo.username}!`);
                    }
                } catch (err) {
                    console.error("[Rotina Privada] Erro ao enviar DM aleatória:", err);
                }
            }

            // Reinicia o ciclo criando o próximo horário aleatório do dia
            rotinaMensagemAleatoria();
        }, tempoEspera);
    }

    // Liga a primeira contagem regressiva invisível
    rotinaMensagemAleatoria();
    // ================================================================

    // Registro dos Comandos Slash (/) no Discord
    const rest = new REST({ version: '10' }).setToken(config.token);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log("Comandos (/) recarregados com sucesso!");
    } catch (error) {
        console.error("Erro ao carregar comandos: ", error);
    }
});

// Evento ao receber qualquer mensagem (Menções e Chats)
client.on("messageCreate", async message => {
    if (message.author.bot) return;

    let msgText = message.content;
    const botMention = `<@${client.user.id}>`;

    // Se estiver em servidor, ele só responde se marcarem ele
    if (message.guild && !message.content.startsWith(botMention)) return;

    // Remove a marcação do texto para não confundir a IA
    if (message.content.startsWith(botMention)) {
        msgText = msgText.replace(botMention, "").trim();
    }

    if (msgText.length === 0) return message.reply("Eai, de boa? Como posso ajudar?");

    message.channel.sendTyping();
    
    // Responde lembrando do histórico do autor da mensagem!
    const respostaIA = await perguntarAoGroqComMemoria(message.author.id, message.author.username, msgText);
    return message.reply(respostaIA);
});

// Interações de comandos (/clearChat, /stop, etc)
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