const { Client, GatewayIntentBits, Collection } = require("discord.js");
const Groq = require("groq-sdk");
const fs = require("fs");
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord.js');
const http = require("http");
const https = require("https"); // Usando o módulo nativo do Node.js

// ================================================================
// MINI SERVIDOR WEB PARA EVITAR O REPOUSO DA RENDER
// ================================================================
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Himmel está vivo, pesquisando na web e operando!');
}).listen(PORT, () => {
    console.log(`[Web Server] Ouvindo na porta ${PORT} para manter o bot acordado.`);
});

// ================================================================
// CONFIGURAÇÃO DA LISTA DE IDs PARA DMs ALEATÓRIAS
// ================================================================
const IDS_ALVO_DM = ["1310397024541212672", "760510107988918333"]; 

// Configuração Inteligente de Chaves
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

const groq = new Groq({ apiKey: config.groqKey });
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
}

// FUNÇÃO AUXILIAR: Decide se a mensagem precisa de busca na internet
function precisaDeInternet(texto) {
    const termosBusca = [
        "pesquisa", "busca", "google", "quem é", "quem foi", "o que é", "noticia", 
        "sobre", "onde fica", "atual", "hoje", "placar", "jogo de ontem", "venceu", 
        "lançamento", "filme", "preço", "quanto tá", "clima", "tempo", "pesquisar"
    ];
    const textoMinusculo = texto.toLowerCase();
    return termosBusca.some(termo => textoMinusculo.includes(termo));
}

// FUNÇÃO AUXILIAR: Faz busca nativa usando uma API livre do DuckDuckGo
function buscarNaWebNativo(query) {
    return new Promise((resolve) => {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        };

        https.get(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                // Raspagem ultra simples dos blocos de texto principais das tags HTML retornadas
                const regex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
                let resultados = [];
                let match;
                while ((match = regex.exec(data)) !== null && resultados.length < 3) {
                    let textoLimpo = match[1].replace(/<[^>]*>/g, '').trim();
                    if (textoLimpo) resultados.push(textoLimpo);
                }
                resolve(resultados.join(" | "));
            });
        }).on("error", (err) => {
            console.error("Erro na busca nativa:", err);
            resolve("");
        });
    });
}

// FUNÇÃO DE COMUNICAÇÃO COM O GROQ (MEMÓRIA + BUSCA WEB + PERSONALIDADE)
async function perguntarAoGroqComMemoriaEBusca(idUsuario, nomeUsuario, textoAtual) {
    try {
        if (!memoriaConversas.has(idUsuario)) {
            memoriaConversas.set(idUsuario, []);
        }

        const historicoUsuario = memoriaConversas.get(idUsuario);
        const sistemaPersonalidade = config.personalidade || process.env.PERSONALIDADE || "Você é um humano conversando no Discord.";
        
        let contextoWeb = "";

        if (precisaDeInternet(textoAtual)) {
            console.log(`[Busca Web] Buscando informações atuais para: "${textoAtual}"`);
            const dadosBusca = await buscarNaWebNativo(textoAtual);
            if (dadosBusca) {
                contextoWeb = `\n\n[CONTEXTO ATUAL DA INTERNET]: ${dadosBusca}\nUse essas informações para responder o usuário de forma natural. Lembre-se de manter sua personalidade curta, informal e com sentido.`;
                console.log("[Busca Web] Dados acoplados com sucesso!");
            }
        }

        const mensagensParaEnviar = [
            { role: "system", content: sistemaPersonalidade + contextoWeb }
        ];

        historicoUsuario.forEach(msg => mensagensParaEnviar.push(msg));
        mensagensParaEnviar.push({ role: "user", content: `Usuário [${nomeUsuario}] diz: ${textoAtual}` });

        const chatCompletion = await groq.chat.completions.create({
            messages: mensagensParaEnviar,
            model: "llama-3.3-70b-versatile",
            temperature: 0.6,
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
        return "Tive um soluço interno aqui, pode repetir?";
    }
}

// Evento quando o bot liga
client.once("ready", async () => {
    console.log(`${client.user.username} está online com busca estável nativa!`);
    
    client.user.setPresence({
        activities: [{ name: "Conversando no Discord", type: 0 }],
        status: "online"
    });

    // ROTINA DE DM ALEATÓRIA
    async function rotinaMensagemAleatoria() {
        const tempoMinimo = 3600000; 
        const tempoMaximo = 21600000; 
        const tempoEspera = Math.floor(Math.random() * (tempoMaximo - tempoMinimo + 1)) + tempoMinimo;

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

                        const mensagemAleatoria = await perguntarAoGroqComMemoriaEBusca(idSorteado, usuarioAlvo.username, "Puxe assunto comigo no privado do nada. Escolha um motivo aleatório qualquer de amigo. Seja curto, muito informal e natural de internet.");
                        await dm.send(mensagemAleatoria);
                    }
                } catch (err) {
                    console.error("[Rotina Privada] Erro:", err);
                }
            }
            rotinaMensagemAleatoria();
        }, tempoEspera);
    }

    rotinaMensagemAleatoria();

    const rest = new REST({ version: '10' }).setToken(config.token);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    } catch (error) {
        console.error("Erro ao carregar comandos: ", error);
    }
});

// Evento ao receber mensagens
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
    
    const respostaIA = await perguntarAoGroqComMemoriaEBusca(message.author.id, message.author.username, msgText);
    return message.reply(respostaIA);
});

// Comandos de Interação (/)
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