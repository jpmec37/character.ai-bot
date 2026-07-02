const { Client, GatewayIntentBits, Collection } = require("discord.js");
const Groq = require("groq-sdk");
const fs = require("fs");
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord.js');
const http = require("http");
const https = require("https"); 

// ================================================================
// MINI SERVIDOR WEB PARA EVITAR O REPOUSO DA RENDER
// ================================================================
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Himmel versão self-bot (Humano Disfarçado) - Operação Final Ativada!');
}).listen(PORT, () => {
    console.log(`[Web Server] Ouvindo na porta ${PORT} para manter o bot acordado.`);
});

// ================================================================
// VARIÁVEIS DE SISTEMAS HUMANIZADOS E ALVOS
// ================================================================
const IDS_ALVO_DM = ["1310397024541212672", "760510107988918333"]; 
const userFloodControl = new Map();
const lastUserMessage = new Map();
const channelActivity = new Map();
const userMessageBuffers = new Map(); 

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
if (fs.existsSync('./commands')) {
    const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith(".js"));
    for (const file of commandFiles) {
        const command = require(`./commands/${file}`);
        client.commands.set(command.data.name, command);
        commands.push(command.data.toJSON());
    }
}

// -----------------------------------------------------------
// FUNÇÕES AUXILIARES DE BUSCA WEB BLINDADA
// -----------------------------------------------------------
function precisaDeInternet(texto) {
    const termosBusca = ["pesquisa", "busca", "google", "quem é", "quem foi", "o que é", "noticia", "sobre", "onde fica", "atual", "hoje", "placar", "venceu", "lançamento", "preço", "clima", "tempo"];
    return termosBusca.some(termo => texto.toLowerCase().includes(termo));
}

function buscarNaWebNativo(query) {
    return new Promise((resolve) => {
        const urlApi = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
        https.get(urlApi, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.AbstractText) return resolve(`Resumo: ${json.AbstractText}`);
                } catch (e) { }
                const urlHtml = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
                https.get(urlHtml, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/124.0.0.0 Safari/537.36' } }, (resHtml) => {
                    let htmlData = '';
                    resHtml.on('data', chunk => htmlData += chunk);
                    resHtml.on('end', () => {
                        if (htmlData.includes("ddg-captcha") || htmlData.length < 1000) return resolve("");
                        const regex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
                        let resultados = [], match;
                        while ((match = regex.exec(htmlData)) !== null && resultados.length < 3) {
                            let limpo = match[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
                            if (limpo.length > 15) resultados.push(limpo);
                        }
                        resolve(resultados.join(" | "));
                    });
                }).on("error", () => resolve(""));
            });
        }).on("error", () => resolve(""));
    });
}

// -----------------------------------------------------------
// 🧠 MEMÓRIA RESILIENTE MÁXIMA (Agora lê até 100 mensagens)
// -----------------------------------------------------------
async function reconstruirContexto(channel, ignoreIds = []) {
    try {
        // Limite máximo seguro do Discord por requisição e limite prático para a IA não travar
        const fetched = await channel.messages.fetch({ limit: 100 }); 
        const mensagens = [];
        fetched.reverse().forEach(msg => {
            if (msg.content.trim() === '' || ignoreIds.includes(msg.id)) return;
            const nome = msg.member ? msg.member.displayName : msg.author.username;
            mensagens.push({
                role: msg.author.id === client.user.id ? "assistant" : "user",
                content: msg.author.id === client.user.id ? msg.content : `[${nome}]: ${msg.content}`
            });
        });
        return mensagens;
    } catch (e) {
        return [];
    }
}

// -----------------------------------------------------------
// COMUNICAÇÃO COM GROQ (INTELIGÊNCIA EMOCIONAL)
// -----------------------------------------------------------
async function perguntarAoGroqAvancado(idUsuario, nomeUsuario, textoAtual, contextoHistorico) {
    try {
        const dataHoraBrasil = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

        const instrucoesDisfarce = `\n\nREGRAS DE COMPORTAMENTO HUMANIZADO (OBRIGATÓRIO):
1. FORMATO: Escreva TUDO sempre em minúsculo. Nenhuma pontuação formal (proibido usar . ou ! ou ? no final das frases).
2. ESPELHAMENTO: Leia o histórico. Absorva e repita naturalmente algumas gírias ou trejeitos que o usuário usar, mas sem forçar muito.
3. INTELIGÊNCIA EMOCIONAL: Aja conforme é tratado. Se o usuário for amigável, seja parceiro. Se ele for chato, grosso, seco ou te encher o saco, seja frio, irônico, de respostas curtas ou demonstre preguiça de falar com ele.
4. EMOJIS (QUASE NUNCA USE): Use emojis de forma MUITO rara (ex: em 1 a cada 10 mensagens). Você não liga pra emojis. Se for obrigado a usar, use no máximo UM, no final da frase. Opções: 💀, 😭, 🤓, 🤡, 🤨, 🐒, 👀, 🤙, 😂, 🔥, 😎.
5. Variação de risada: nunca use sempre "kkk". Alterne para "ksksk", "ashuahsu", "mds kkkkk".
6. NUNCA use a tag azul <@ID>. Chame o usuário diretamente pelo nome dele.
7. O horário atual no Brasil agora é ${dataHoraBrasil}.`;

        const sistemaPersonalidade = (config.personalidade || process.env.PERSONALIDADE || "Você é um humano jovem no discord.") + instrucoesDisfarce;
        
        let contextoWeb = "";
        if (precisaDeInternet(textoAtual)) {
            const dadosBusca = await buscarNaWebNativo(textoAtual);
            if (dadosBusca && dadosBusca.length > 5) {
                contextoWeb = `\n\n<DADOS_DA_INTERNET>\n${dadosBusca}\n</DADOS_DA_INTERNET>\nLeia isso para responder, mas minta que sabia de cabeça.`;
            }
        }

        const mensagensParaEnviar = [{ role: "system", content: `${sistemaPersonalidade}${contextoWeb}` }];
        contextoHistorico.forEach(msg => mensagensParaEnviar.push(msg));
        mensagensParaEnviar.push({ role: "user", content: `[${nomeUsuario}]: ${textoAtual}` });

        const chatCompletion = await groq.chat.completions.create({
            messages: mensagensParaEnviar,
            model: "llama-3.3-70b-versatile",
            temperature: 0.35, 
        });

        return chatCompletion.choices[0]?.message?.content || "fiquei mudo";
    } catch (err) {
        return "deu um bug mental aq péra";
    }
}

// -----------------------------------------------------------
// EVENTOS DE START E ROTINAS
// -----------------------------------------------------------
client.once("ready", async () => {
    console.log(`${client.user.username} (Self-Bot Humanizado V8) operante com 100 mensagens de memória!`);
    client.user.setPresence({ activities: [{ name: "conversando", type: 0 }], status: "online" });

    // DM Aleatória
    async function rotinaMensagemAleatoria() {
        const tempoMinimo = 3600000; const tempoMaximo = 21600000; 
        const tempoEspera = Math.floor(Math.random() * (tempoMaximo - tempoMinimo + 1)) + tempoMinimo;
        setTimeout(async () => {
            if (IDS_ALVO_DM.length > 0) {
                try {
                    const idSorteado = IDS_ALVO_DM[Math.floor(Math.random() * IDS_ALVO_DM.length)];
                    const usuarioAlvo = await client.users.fetch(idSorteado);
                    if (usuarioAlvo) {
                        const dm = await usuarioAlvo.createDM();
                        await dm.sendTyping();
                        const contextoHistorico = await reconstruirContexto(dm, []);
                        const mensagemAleatoria = await perguntarAoGroqAvancado(idSorteado, usuarioAlvo.username, "Puxe assunto comigo no privado do nada.", contextoHistorico);
                        await dm.send(mensagemAleatoria.toLowerCase());
                    }
                } catch (err) {}
            }
            rotinaMensagemAleatoria();
        }, tempoEspera);
    }
    rotinaMensagemAleatoria();

    // Chat Morto
    setInterval(async () => {
        const now = Date.now();
        for (const [channelId, lastTime] of channelActivity.entries()) {
            if (now - lastTime > 6 * 60 * 60 * 1000) { 
                try {
                    const channel = await client.channels.fetch(channelId);
                    if (channel && channel.isTextBased()) {
                        const quebraGelo = ["bando de morto kkk alguem vivo?", "o q vcs tao arrumando?", "tédio da porra hj"];
                        await channel.send(quebraGelo[Math.floor(Math.random() * quebraGelo.length)]);
                        channelActivity.set(channelId, Date.now()); 
                    }
                } catch(e) {}
            }
        }
    }, 60 * 60 * 1000); 

    const rest = new REST({ version: '10' }).setToken(config.token);
    try { if (commands.length > 0) await rest.put(Routes.applicationCommands(client.user.id), { body: commands }); } catch (e) { }
});

// -----------------------------------------------------------
// 💬 INTERCEPTADOR PRINCIPAL E AGRUPADOR DE MENSAGENS
// -----------------------------------------------------------
client.on("messageCreate", async message => {
    if (message.author.bot) return;

    if (/^[!\.\-\?\/]/.test(message.content)) return;

    channelActivity.set(message.channel.id, Date.now()); 

    // ANTI-FLOOD 
    const now = Date.now();
    const userFlood = userFloodControl.get(message.author.id) || { count: 0, firstMsg: now, blockUntil: 0 };
    if (now < userFlood.blockUntil) return; 

    if (now - userFlood.firstMsg < 15000) {
        userFlood.count++;
        if (userFlood.count > 6) { 
            userFlood.blockUntil = now + 30000; 
            userFloodControl.set(message.author.id, userFlood);
            
            const bufferKeyParaLimpar = `${message.channel.id}-${message.author.id}`;
            if(userMessageBuffers.has(bufferKeyParaLimpar)){
                clearTimeout(userMessageBuffers.get(bufferKeyParaLimpar).timer);
                userMessageBuffers.delete(bufferKeyParaLimpar);
            }
            return message.reply({ content: "mano calma kk deixa eu respirar crlh, pera ae", allowedMentions: { repliedUser: false } }).catch(()=>{});
        }
    } else {
        userFlood.count = 1; userFlood.firstMsg = now;
    }
    userFloodControl.set(message.author.id, userFlood);

    // AGRUPADOR DE MENSAGENS PICADAS
    const bufferKey = `${message.channel.id}-${message.author.id}`; 
    const botMention = `<@${client.user.id}>`;
    
    let partMentioned = message.content.includes(botMention) || message.mentions.has(client.user);

    let cleanText = message.content;
    if (cleanText.includes(botMention)) cleanText = cleanText.replace(botMention, "").trim();

    if (!userMessageBuffers.has(bufferKey)) {
        userMessageBuffers.set(bufferKey, { textParts: [], msgIds: [], timer: null, lastMessageObj: message, wasMentioned: false, hasMedia: false });
    }

    const buffer = userMessageBuffers.get(bufferKey);
    if (cleanText.length > 0) buffer.textParts.push(cleanText);
    buffer.msgIds.push(message.id); 
    if (partMentioned) buffer.wasMentioned = true;
    
    if (message.attachments.size > 0 || message.content.includes("http") || message.stickers.size > 0) buffer.hasMedia = true;
    
    buffer.lastMessageObj = message;

    if (buffer.timer) clearTimeout(buffer.timer);

    buffer.timer = setTimeout(async () => {
        userMessageBuffers.delete(bufferKey); 
        await processarMensagemFinal(buffer); 
    }, 3500); 
});

// -----------------------------------------------------------
// 🧠 PROCESSAMENTO FINAL E ENVIO
// -----------------------------------------------------------
async function processarMensagemFinal(buffer) {
    const message = buffer.lastMessageObj;
    let msgText = buffer.textParts.join(" ... "); 
    let isMentioned = buffer.wasMentioned;
    let chimesIn = false;

    if (!isMentioned && message.guild) {
        const keywords = ["jogo", "filme", "meme", "discord", "cs", "lol", "ia", "groq", "bizarro"];
        if (keywords.some(k => msgText.toLowerCase().includes(k)) && Math.random() < 0.07) chimesIn = true;
    }

    if (message.guild && !isMentioned && !chimesIn) return;

    const soMidiaOuLink = (msgText.trim().length === 0 && buffer.hasMedia) || (msgText.includes("http") && msgText.split(" ").length <= 2);
    if (soMidiaOuLink) {
        await new Promise(r => setTimeout(r, 4500)); 
        const resps = ["carai kkkk", "q porra é essa kkk", "mds ashuash", "massa", "brabo kkk"];
        try { 
            return await message.reply({ content: resps[Math.floor(Math.random() * resps.length)], allowedMentions: { repliedUser: false } }); 
        } catch (e) { 
            return await message.channel.send(resps[Math.floor(Math.random() * resps.length)]).catch(()=>{}); 
        }
    }

    // SISTEMA DE VÁCUO
    if (msgText.length === 0 || msgText === "..." || msgText.toLowerCase() === "hm") {
        if (Math.random() < 0.20) {
            return message.react('👀').catch(()=>{}); 
        }
        try { 
            return await message.reply({ content: "eai, manda", allowedMentions: { repliedUser: false } }); 
        } catch (e) { 
            return await message.channel.send("eai, manda").catch(()=>{}); 
        }
    }

    const txtMin = msgText.toLowerCase();
    if (lastUserMessage.get(message.author.id) === txtMin) {
        try { 
            return await message.reply({ content: "vc acabou de perguntar a msma coisa doido kkkkk muda o disco", allowedMentions: { repliedUser: false } }); 
        } catch (e) {}
    }
    lastUserMessage.set(message.author.id, txtMin);

    if (txtMin.includes("kkk") || txtMin.includes("ksks")) message.react('💀').catch(()=>{});
    else if (txtMin.includes("?") && txtMin.length < 15) message.react('🤔').catch(()=>{});

    // 1. TEMPO DE VISTO/LEITURA
    const horaBR = parseInt(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hour12: false }), 10);
    let tempoLendo = Math.floor(Math.random() * 1000) + 500; 
    let multiplicadorLentidao = 1;
    
    if (horaBR >= 2 && horaBR < 6) { tempoLendo += 2000; multiplicadorLentidao = 1.5; }
    else if (horaBR >= 6 && horaBR < 9) { tempoLendo += 1000; multiplicadorLentidao = 1.2; }

    await new Promise(resolve => setTimeout(resolve, tempoLendo));
    
    message.channel.sendTyping().catch(()=>{});
    const typingInterval = setInterval(() => message.channel.sendTyping().catch(()=>{}), 9000);

    const nomeUsuario = message.member ? message.member.displayName : message.author.username;
    const contextoHistorico = await reconstruirContexto(message.channel, buffer.msgIds); 
    
    // 2. CHAMA A IA PARA PENSAR 
    const respostaIA = await perguntarAoGroqAvancado(message.author.id, nomeUsuario, msgText, contextoHistorico);
    
    // 3. CALCULA O TEMPO REAL DE DIGITAÇÃO 
    let tempoDigitando = Math.floor(respostaIA.length * 12 * multiplicadorLentidao);
    if (tempoDigitando > 8000) tempoDigitando = 8000; 
    if (tempoDigitando < 500) tempoDigitando = 500; 

    console.log(`[Digitação] Texto: ${respostaIA.length} chars | Delay: ${(tempoDigitando/1000).toFixed(1)}s`);

    await new Promise(resolve => setTimeout(resolve, tempoDigitando));
    clearInterval(typingInterval); 

    // 4. CORTE INTELIGENTE DE MENSAGEM 
    let frases = [respostaIA];
    if (Math.random() < 0.30 && respostaIA.length > 30) {
        let quebradas = respostaIA.split(/(?<=[,\n])\s+/).filter(f => f.trim().length > 0);
        if (quebradas.length > 1) {
            if (quebradas.length > 4) {
                frases = [
                    quebradas.slice(0, 2).join(" "),
                    quebradas.slice(2, 4).join(" "),
                    quebradas.slice(4).join(" ")
                ].filter(f => f.trim().length > 0);
            } else {
                frases = quebradas;
            }
        }
    }

    for (let i = 0; i < frases.length; i++) {
        let textoFinal = frases[i].toLowerCase(); 

        try {
            if (i === 0 && isMentioned) {
                await message.reply({ content: textoFinal, allowedMentions: { repliedUser: false } }); 
            } else {
                if (i !== 0) {
                    message.channel.sendTyping(); 
                    await new Promise(r => setTimeout(r, Math.floor(Math.random() * 500) + 300));
                }
                await message.channel.send(textoFinal);
            }
        } catch (erroDeEnvio) {
            await message.channel.send(textoFinal).catch(()=>{});
        }
    }
}

client.on("interactionCreate", async interaction => {
    if (interaction.isCommand()) {
        const slashCommand = client.commands.get(interaction.commandName);
        if (!slashCommand) return;
        try { await slashCommand.execute(client, interaction, null); } catch (err) { }
    }
});

client.login(config.token);