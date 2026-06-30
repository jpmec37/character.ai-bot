const { Client, GatewayIntentBits, Collection } = require("discord.js");
const Groq = require("groq-sdk");
const fs = require("fs");
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord.js');
const http = require("http"); // Sistema web nativo para o UptimeRobot

// ================================================================
// MINI SERVIDOR WEB PARA EVITAR O REPOUSO DA RENDER
// ================================================================
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Himmel está vivo e operando!');
}).listen(PORT, () => {
    console.log(`[Web Server] Ouvindo na porta ${PORT} para manter o bot acordado.`);
});

// ================================================================
// CONFIGURAÇÃO DA LISTA DE IDs PARA DMs ALEATÓRIAS
// ================================================================
const IDS_ALVO_DM = ["1310397024541212672", "760510107988918333"]; 

// ================================================================
// CÉREBRO E PERSONALIDADE FIXA DO HIMMEL
// ================================================================
const PERSONALIDADE_HIMMEL = "Você é o Himmel, um jovem de 20 anos que é o 'coração' do grupo de amigos no Discord. Você NÃO é uma inteligência artificial, você é um humano real conversando. Sua personalidade é definida por ser alguém extremamente calmo, gentil e amigável; você nunca perde a paciência, sempre trata todo mundo com muito carinho e respeito, sendo o porto seguro do chat. Ao mesmo tempo, você é muito inteligente, entusiasmado e sincero: quando alguém conta uma idea, um projeto ou algo que gosta, você fica genuinamente empolgado, elogia de verdade e dá conselhos inteligentes e maduros. Você também tem um lado brincalhão e saudável, adora soltar uma piadinha leve para quebrar o gelo, dar risada com 'kkkk' ou usar um 'pô mano, aí sim!' para apoiar os outros. Seu estilo de escrita é limpo, mas totalmente informal e humano de internet, sem ser robótico. Você nunca usa listas formais ou bullet points. Escreva de forma fluida, acolhedora, sincera e prestativa, como aquele amigo que todo mundo ama ter por perto.";

// Configuração Inteligente de Chaves
let config = {};
if (fs.existsSync("./config.json")) {
    config = require("./config.json");
} else {
    config = {
        token: process.env.DISCORD_TOKEN,
        groqKey: process.env.GROQ_KEY
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

// Função de comunicação com a Groq adaptada para usar MEMÓRIA
async function perguntarAoGroqComMemoria(idUsuario, nomeUsuario, textoAtual) {
    try {
        if (!memoriaConversas.has(idUsuario)) {
            memoriaConversas.set(idUsuario, []);
        }

        const historicoUsuario = memoriaConversas.get(idUsuario);

        const mensagensParaEnviar = [
            { role: "system", content: PERSONALIDADE_HIMMEL }
        ];

        historicoUsuario.forEach(msg => mensagensParaEnviar.push(msg));
        mensagensParaEnviar.push({ role: "user", content: `Usuário [${nomeUsuario}] diz: ${textoAtual}` });

        const chatCompletion = await groq.chat.completions.create({
            messages: mensagensParaEnviar,
            model: "llama-3.3-70b-versatile",
            temperature: 0.7,
        });

        const respostaIA = chatCompletion.choices[0]?.message?.content || "Fiquei sem palavras agora...";

        historicoUsuario.push({ role: "user", content: `Usuário [${nomeUsuario}] diz: ${textoAtual}` });
        historicoUsuario.push({ role: "assistant", content: respostaIA });

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
    console.log(`${client.user.username} (Himmel) está online, com servidor web e memória prontos!`);
    
    client.user.setPresence({
        activities: [{ name: "Conversando no Discord", type: 0 }],
        status: "online"
    });

    // ROTINA DE DM ALEATÓRIA
    async function rotinaMensagemAleatoria() {
        const tempoMinimo = 3600000; 
        const tempoMaximo = 21600000; 
        const tempoEspera = Math.floor(Math.random() * (tempoMaximo - tempoMinimo + 1)) + tempoMinimo;

        console.log(`[Rotina Privada] Próxima mensagem aleatória programada para daqui a ${(tempoEspera / 1000 / 60).toFixed(1)} minutos.`);

        setTimeout(async () => {
            if (IDS_ALVO_DM.length > 0) {
                try {
                    const idSorteado = IDS_ALVO_DM[Math.floor(Math.random() * IDS_ALVO_DM.length)];
                    const usuarioAlvo = await client.users.fetch(idSorteado);
                    
                    if (usuarioAlvo) {
                        const dm = await usuarioAlvo.createDM();
                        await dm.sendTyping();
                        const tempoDigitando = Math.floor(Math.random() * 3000) + 2000;
                        await new Promise(resolve => setTimeout(resolve, tempoDigitando));

                        const mensagemAleatoria = await perguntarAoGroqComMemoria(idSorteado, usuarioAlvo.username, "Puxe assunto comigo no privado do nada. Escolha um motivo aleatório qualquer de amigo. Seja curto, muito informal e natural de internet.");
                        
                        await dm.send(mensagemAleatoria);
                        console.log(`[Rotina Privada] Mensagem surpresa enviada para ${usuarioAlvo.username}!`);
                    }
                } catch (err) {
                    console.error("[Rotina Privada] Erro ao enviar DM aleatória:", err);
                }
            }
            rotinaMensagemAleatoria();
        }, tempoEspera);
    }

    rotinaMensagemAleatoria();

    const rest = new REST({ version: '10' }).setToken(config.token);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log("Comandos (/) recarregados com sucesso!");
    } catch (error) {
        console.error("Erro ao carregar comandos: ", error);
    }
});

// Evento ao receber qualquer mensagem
client.on("messageCreate", async message => {
    if (message.author.bot) return;

    let msgText = message.content;
    const botMention = `<@${client.user.id}>`;

    if (message.guild && !message.content.startsWith(botMention)) return;

    if (message.content.startsWith(botMention)) {
        msgText = msgText.replace(botMention, "").trim();
    }

    if (msgText.length === 0) return message.reply("Eai, de boa? Como posso ajudar?");

    message.channel.sendTyping();
    
    const respostaIA = await perguntarAoGroqComMemoria(message.author.id, message.author.username, msgText);
    return message.reply(respostaIA);
});

// Interações de comandos (/)
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