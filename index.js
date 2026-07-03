const { Client, GatewayIntentBits, Collection } = require("discord.js");
const Groq = require("groq-sdk");
const fs = require("fs");
const { REST } = require("@discordjs/rest");
const { Routes } = require("discord.js");
const http = require("http");
const https = require("https");

// ================================================================
// SISTEMA DE PROTEÇÃO CONTRA QUEDAS E ERROS INESPERADOS (ANTI-CRASH)
// ================================================================
process.on("unhandledRejection", (reason, promise) => {
  console.error("\x1b[31m[ERRO CRÍTICO - Unhandled Rejection]:\x1b[0m", reason);
});
process.on("uncaughtException", (err, origin) => {
  console.error(
    "\x1b[31m[ERRO CRÍTICO - Uncaught Exception]:\x1b[0m",
    err,
    "Origem:",
    origin,
  );
});

// ================================================================
// MINI SERVIDOR WEB PARA EVITAR O REPOUSO DA RENDER
// ================================================================
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Himmel versão self-bot - Sistema de Lembretes Blindado com Logs!");
  })
  .listen(PORT, () => {
    console.log(
      `\x1b[32m[WEB SERVER] Ouvindo e operando na porta ${PORT}.\x1b[0m`,
    );
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
    personalidade: process.env.PERSONALIDADE,
  };
}

const groq = new Groq({ apiKey: config.groqKey });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [1, 3],
});

// -----------------------------------------------------------
// 💾 GESTOR DE LEMBRETES PERSISTENTES (LOGS DE DISCO)
// -----------------------------------------------------------
let bancoLembretes = [];
if (fs.existsSync("./lembretes.json")) {
  try {
    bancoLembretes = JSON.parse(fs.readFileSync("./lembretes.json", "utf-8"));
    console.log(
      `\x1b[36m[BANCO DADOS] Carregados ${bancoLembretes.length} lembretes ativos do arquivo JSON.\x1b[0m`,
    );
  } catch (e) {
    console.log(
      `\x1b[31m[BANCO DADOS - ERRO] Arquivo de lembretes corrompido, iniciando banco limpo.\x1b[0m`,
    );
    bancoLembretes = [];
  }
}

function guardarLembretesNoDisco() {
  try {
    fs.writeFileSync(
      "./lembretes.json",
      JSON.stringify(bancoLembretes, null, 2),
      "utf-8",
    );
    console.log(
      `\x1b[36m[BANCO DADOS] Arquivo 'lembretes.json' atualizado com sucesso no disco.\x1b[0m`,
    );
  } catch (err) {
    console.log(
      `\x1b[31m[BANCO DADOS - ERRO] Falha ao salvar arquivo JSON: ${err.message}\x1b[0m`,
    );
  }
}

// -----------------------------------------------------------
// COMANDOS SLASH / SISTEMAS EXTERNOS
// -----------------------------------------------------------
client.commands = new Collection();
const commands = [];
if (fs.existsSync("./commands")) {
  const commandFiles = fs
    .readdirSync("./commands")
    .filter((file) => file.endsWith(".js"));
  for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.data.name, command);
    commands.push(command.data.toJSON());
  }
}

function precisaDeInternet(texto) {
  const termosBusca = [
    "pesquisa",
    "busca",
    "google",
    "quem é",
    "quem foi",
    "o que é",
    "noticia",
    "sobre",
    "onde fica",
    "atual",
    "hoje",
    "placar",
    "venceu",
    "lançamento",
    "preço",
    "clima",
    "tempo",
  ];
  return termosBusca.some((termo) => texto.toLowerCase().includes(termo));
}

// -----------------------------------------------------------
// 🔍 SISTEMA DE LOGS DETALHADOS PARA A PESQUISA WEB
// -----------------------------------------------------------
function buscarNaWebNativo(query) {
  console.log(
    `\x1b[33m[SISTEMA PESQUISA] Iniciando busca externa para o termo: "${query}"\x1b[0m`,
  );
  return new Promise((resolve) => {
    const urlApi = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    https
      .get(urlApi, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (json.AbstractText) {
              console.log(
                `\x1b[32m[SISTEMA PESQUISA] Resposta obtida via API Oficial (AbstractText).\x1b[0m`,
              );
              return resolve(`Resumo: ${json.AbstractText}`);
            }
          } catch (e) {
            console.log(
              `\x1b[31m[SISTEMA PESQUISA - ERRO] Falha ao ler JSON da API oficial.\x1b[0m`,
            );
          }

          console.log(
            `\x1b[33m[SISTEMA PESQUISA] API Oficial sem dados diretos. Ativando fallback de Raspagem HTML...\x1b[0m`,
          );
          const urlHtml = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
          https
            .get(
              urlHtml,
              {
                headers: {
                  "User-Agent": "Mozilla/5.0 Chrome/124.0.0.0 Safari/537.36",
                },
              },
              (resHtml) => {
                let htmlData = "";
                resHtml.on("data", (chunk) => (htmlData += chunk));
                resHtml.on("end", () => {
                  if (
                    htmlData.includes("ddg-captcha") ||
                    htmlData.length < 1000
                  ) {
                    console.log(
                      `\x1b[31m[SISTEMA PESQUISA - BLOQUEIO] DuckDuckGo barrou a raspagem HTML (Captcha detectado).\x1b[0m`,
                    );
                    return resolve("");
                  }
                  const regex =
                    /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
                  let resultados = [],
                    match;
                  while (
                    (match = regex.exec(htmlData)) !== null &&
                    resultados.length < 3
                  ) {
                    let limpo = match[1]
                      .replace(/<[^>]*>/g, "")
                      .replace(/\s+/g, " ")
                      .trim();
                    if (limpo.length > 15) resultados.push(limpo);
                  }
                  console.log(
                    `\x1b[32m[SISTEMA PESQUISA] Raspagem HTML finalizada. Encontrados ${resultados.length} trechos úteis.\x1b[0m`,
                  );
                  resolve(resultados.join(" | "));
                });
              },
            )
            .on("error", (err) => {
              console.log(
                `\x1b[31m[SISTEMA PESQUISA - ERRO] Falha na requisição de raspagem HTML: ${err.message}\x1b[0m`,
              );
              resolve("");
            });
        });
      })
      .on("error", (err) => {
        console.log(
          `\x1b[31m[SISTEMA PESQUISA - ERRO] Falha na requisição da API Oficial: ${err.message}\x1b[0m`,
        );
        resolve("");
      });
  });
}

async function gerarMensagemUnica(comandoInstrucao) {
  try {
    const sistemaBase = `Escreva uma resposta corta como um humano jovem de internet no discord, tudo sempre em minúsculo, sem nenhuma pontuação formal no final das frases. Nunca termine com vírgula. Use gírias de forma natural.\n\nInstrução do que dizer agora: ${comandoInstrucao}`;
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: sistemaBase }],
      model: "llama-3.1-8b-instant",
      temperature: 0.85,
    });
    return chatCompletion.choices[0]?.message?.content || "";
  } catch (e) {
    console.log(
      `\x1b[31m[LOG ERRO API] Falha na chamada secundária da Groq: ${e.message}\x1b[0m`,
    );
    return "";
  }
}

async function reconstruirContexto(channel, ignoreIds = []) {
  try {
    const fetched = await channel.messages.fetch({ limit: 30 });
    const mensagens = [];
    const lembreteRegexGlobal = /\[lembrete:\s*.*?\s*\|\s*.*?\]/gi;

    fetched.reverse().forEach((msg) => {
      if (msg.content.trim() === "" || ignoreIds.includes(msg.id)) return;

      let conteudo = msg.content;
      conteudo = conteudo.replace(lembreteRegexGlobal, "").trim();

      if (conteudo.length === 0) return;

      const nome = msg.member ? msg.member.displayName : msg.author.username;
      mensagens.push({
        role: msg.author.id === client.user.id ? "assistant" : "user",
        content:
          msg.author.id === client.user.id
            ? conteudo
            : `[${nome}]: ${conteudo}`,
      });
    });
    return mensagens;
  } catch (e) {
    return [];
  }
}

async function perguntarAoGroqAvancado(
  idUsuario,
  nomeUsuario,
  textoAtual,
  contextoHistorico,
) {
  try {
    const opcoesData = {
      timeZone: "America/Sao_Paulo",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    };
    const dataHoraBrasil = new Date().toLocaleString("pt-BR", opcoesData);

    const instrucoesDisfarce = `\n\nREGRAS DE COMPORTAMENTO HUMANIZADO (OBRIGATÓRIO):
1. FORMATO: Escreva TUDO sempre em minúsculo. Nenhuma pontuação formal (proibido usar . ou ! ou ? no final das frases). NUNCA termine uma frase, linha ou mensagem com vírgula (,).
2. ESPELHAMENTO: Leia o histórico e aja naturalmente com o usuário.
3. INTELIGÊNCIA EMOCIONAL: Amigável com quem é legal, frio/curto com quem é chato.
4. EMOJIS (QUASE NUNCA USE): Use de forma MUITO rara. Máximo UM no final.
5. Variação de risada: alterne para "ksksk", "ashuahsu", "mds kkkkk".
6. NUNCA use a tag azul <@ID>. Chame o usuário diretamente pelo nome.
7. TEMPO E DATA: A data e o horário atual no Brasil agora são: ${dataHoraBrasil}.
8. SISTEMA DE LEMBRETE (REGRA RESTRITA): APENAS gere um lembrete se o usuário pedir EXPLICITAMENTE na MENSAGEM ATUAL (ex: "me lembra de X"). Ignore coisas do passado. Quando ordenado agora, coloque no final da sua resposta a tag exata em letras minúsculas: [lembrete: minutos | mensagem_customizada].
REGRA DE OURO DO LEMBRETE: Substitua 'minutos' por números inteiros puros (ex: 2, 5, 60). Em 'mensagem_customizada', crie uma frase de alarme 100% ÚNICA e personalizada para o usuário. Essa frase DEVE conter obrigatoriamente a palavra 'lembrar' ou 'lembrete'. Não confirme o lembrete por extenso no seu texto principal; responda apenas concordando normalmente (ex: "beleza", "deixa comigo") e coloque a tag colada no final do seu texto.`;

    const sistemaPersonalidade =
      (config.personalidade || "Você é um humano jovem no discord.") +
      instrucoesDisfarce;

    let contextoWeb = "";
    if (precisaDeInternet(textoAtual)) {
      // LOG removido daqui para evitar poluição geral da IA, mantendo apenas dentro da função buscarNaWebNativo()
      const dadosBusca = await buscarNaWebNativo(textoAtual);
      if (dadosBusca && dadosBusca.length > 5) {
        contextoWeb = `\n\n<DADOS_DA_INTERNET>\n${dadosBusca}\n</DADOS_DA_INTERNET>\nLeia isso para responder, mas minta que sabia de cabeça.`;
      }
    }

    const mensagensParaEnviar = [
      { role: "system", content: `${sistemaPersonalidade}${contextoWeb}` },
    ];
    contextoHistorico.forEach((msg) => mensagensParaEnviar.push(msg));
    mensagensParaEnviar.push({
      role: "user",
      content: `[${nomeUsuario}]: ${textoAtual}`,
    });

    const chatCompletion = await groq.chat.completions.create({
      messages: mensagensParaEnviar,
      model: "llama-3.1-8b-instant",
      temperature: 0.35,
    });

    return chatCompletion.choices[0]?.message?.content || "fiquei mudo";
  } catch (err) {
    console.log(
      `\x1b[31m[LOG CRÍTICO ERRO] Groq rejeitou a requisição: ${err.message}\x1b[0m`,
    );
    return "foi mal, deu teto preto aqui na api kkk perai";
  }
}

// -----------------------------------------------------------
// EVENTOS DE START E ROTINAS (CRON DE LEMBRETES MONITORADO)
// -----------------------------------------------------------
client.once("ready", async () => {
  console.log(
    `\x1b[32m[LOG SYSTEM] ${client.user.username} conectado e operando no Discord!\x1b[0m`,
  );
  client.user.setPresence({
    activities: [{ name: "conversando", type: 0 }],
    status: "online",
  });

  // Verificador Cron de Lembretes Monitorado
  setInterval(async () => {
    const agora = Date.now();
    let houveMudanca = false;

    for (let i = bancoLembretes.length - 1; i >= 0; i--) {
      const lembrete = bancoLembretes[i];

      if (agora >= lembrete.timestampDisparo) {
        console.log(
          `\x1b[34m[SISTEMA LEMBRETE] Cron detectou alarme expirado! Disparando para o usuário ID: ${lembrete.userId}\x1b[0m`,
        );
        try {
          const destino = lembrete.isDM
            ? await client.users.fetch(lembrete.userId)
            : await client.channels.fetch(lembrete.channelId);

          if (destino) {
            if (lembrete.isDM) {
              await destino.send(lembrete.textoAlarme);
              console.log(
                `\x1b[32m[SISTEMA LEMBRETE] Mensagem entregue com sucesso via DM direta.\x1b[0m`,
              );
            } else {
              await destino.send(
                `<@${lembrete.userId}> ${lembrete.textoAlarme}`,
              );
              console.log(
                `\x1b[32m[SISTEMA LEMBRETE] Mensagem entregue com sucesso no Canal ID: ${lembrete.channelId}.\x1b[0m`,
              );
            }
          } else {
            console.log(
              `\x1b[31m[SISTEMA LEMBRETE - ERRO] Destino não encontrado ou inacessível.\x1b[0m`,
            );
          }
        } catch (err) {
          console.log(
            `\x1b[31m[SISTEMA LEMBRETE - ERRO DISCORD] Falha ao entregar lembrete (DM fechada ou sem permissão): ${err.message}\x1b[0m`,
          );
        }
        bancoLembretes.splice(i, 1);
        houveMudanca = true;
      }
    }
    if (houveMudanca) guardarLembretesNoDisco();
  }, 15000);

  // DM Aleatória
  async function rotinaMensagemAleatoria() {
    const tempoMinimo = 3600000;
    const tempoMaximo = 21600000;
    const tempoEspera =
      Math.floor(Math.random() * (tempoMaximo - tempoMinimo + 1)) + tempoMinimo;
    setTimeout(async () => {
      if (IDS_ALVO_DM.length > 0) {
        try {
          const idSorteado =
            IDS_ALVO_DM[Math.floor(Math.random() * IDS_ALVO_DM.length)];
          const usuarioAlvo = await client.users.fetch(idSorteado);
          if (usuarioAlvo) {
            const dm = await usuarioAlvo.createDM();
            await dm.sendTyping();
            const contextoHistorico = await reconstruirContexto(dm, []);
            let mensagemAleatoria = await perguntarAoGroqAvancado(
              idSorteado,
              usuarioAlvo.username,
              "Puxe assunto comigo no privado do nada.",
              contextoHistorico,
            );

            mensagemAleatoria = mensagemAleatoria.replace(
              /\[lembrete:\s*.*?\s*\|\s*.*?\]/gi,
              "",
            );
            let textoLimpo = mensagemAleatoria
              .toLowerCase()
              .replace(/,+$/, "")
              .trim();

            if (textoLimpo.length > 0) await dm.send(textoLimpo);
          }
        } catch (err) {}
      }
      rotinaMensagemAleatoria();
    }, tempoEspera);
  }
  rotinaMensagemAleatoria();

  // Chat Morto
  setInterval(
    async () => {
      const now = Date.now();
      for (const [channelId, lastTime] of channelActivity.entries()) {
        if (now - lastTime > 6 * 60 * 60 * 1000) {
          try {
            const channel = await client.channels.fetch(channelId);
            if (channel && channel.isTextBased()) {
              const quebraGeloDinamico = await gerarMensagemUnica(
                "O chat do grupo está parado há horas (chat morto). Mande uma frase bem curta e informal de jovem para puxar assunto ou zoar o silêncio de todo mundo.",
              );
              const textoFormato = quebraGeloDinamico
                .toLowerCase()
                .replace(/,+$/, "")
                .trim();
              await channel.send(
                textoFormato || "bando de morto kkk alguem vivo?",
              );
              channelActivity.set(channelId, Date.now());
            }
          } catch (e) {}
        }
      }
    },
    60 * 60 * 1000,
  );

  const rest = new REST({ version: "10" }).setToken(
    config.token || process.env.DISCORD_TOKEN,
  );
  try {
    if (commands.length > 0)
      await rest.put(Routes.applicationCommands(client.user.id), {
        body: commands,
      });
  } catch (e) {}
});

// -----------------------------------------------------------
// INTERCEPTADOR PRINCIPAL E AGRUPADOR DE MENSAGENS
// -----------------------------------------------------------
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (/^[!\.\-\?\/]/.test(message.content)) return;

  channelActivity.set(message.channel.id, Date.now());

  const now = Date.now();
  const userFlood = userFloodControl.get(message.author.id) || {
    count: 0,
    firstMsg: now,
    blockUntil: 0,
  };
  if (now < userFlood.blockUntil) return;

  if (now - userFlood.firstMsg < 15000) {
    userFlood.count++;
    if (userFlood.count > 6) {
      userFlood.blockUntil = now + 30000;
      userFloodControl.set(message.author.id, userFlood);

      const bufferKeyParaLimpar = `${message.channel.id}-${message.author.id}`;
      if (userMessageBuffers.has(bufferKeyParaLimpar)) {
        clearTimeout(userMessageBuffers.get(bufferKeyParaLimpar).timer);
        userMessageBuffers.delete(bufferKeyParaLimpar);
      }

      const msgFlood = await gerarMensagemUnica(
        "O usuário está floodando mensagens rápido demais. Mande ele se acalmar ou esperar um pouco de forma bem curta, informal e zoeira.",
      );
      const textoFormato = msgFlood.toLowerCase().replace(/,+$/, "").trim();
      return message.channel
        .send(textoFormato || "mano calma kk deixa eu respirar")
        .catch(() => {});
    }
  } else {
    userFlood.count = 1;
    userFlood.firstMsg = now;
  }
  userFloodControl.set(message.author.id, userFlood);

  const bufferKey = `${message.channel.id}-${message.author.id}`;
  const botMention = `<@${client.user.id}>`;

  let partMentioned =
    message.content.includes(botMention) || message.mentions.has(client.user);
  let cleanText = message.content;
  if (cleanText.includes(botMention))
    cleanText = cleanText.replace(botMention, "").trim();

  if (!userMessageBuffers.has(bufferKey)) {
    userMessageBuffers.set(bufferKey, {
      textParts: [],
      msgIds: [],
      timer: null,
      lastMessageObj: message,
      wasMentioned: false,
      hasMedia: false,
    });
  }

  const buffer = userMessageBuffers.get(bufferKey);
  if (cleanText.length > 0) buffer.textParts.push(cleanText);
  buffer.msgIds.push(message.id);
  if (partMentioned) buffer.wasMentioned = true;
  if (
    message.attachments.size > 0 ||
    message.content.includes("http") ||
    message.stickers.size > 0
  )
    buffer.hasMedia = true;
  buffer.lastMessageObj = message;

  if (buffer.timer) clearTimeout(buffer.timer);

  buffer.timer = setTimeout(async () => {
    userMessageBuffers.delete(bufferKey);
    await processarMensagemFinal(buffer);
  }, 3500);
});

// -----------------------------------------------------------
// PROCESSAMENTO FINAL E ENVIO
// -----------------------------------------------------------
async function processarMensagemFinal(buffer) {
  const message = buffer.lastMessageObj;
  const nomeUsuario = message.member
    ? message.member.displayName
    : message.author.username;
  let msgText = buffer.textParts.join(" ... ");
  let isMentioned = buffer.wasMentioned;
  let chimesIn = false;

  if (!isMentioned && message.guild) {
    const keywords = [
      "jogo",
      "filme",
      "meme",
      "discord",
      "cs",
      "lol",
      "ia",
      "groq",
      "bizarro",
    ];
    if (
      keywords.some((k) => msgText.toLowerCase().includes(k)) &&
      Math.random() < 0.07
    )
      chimesIn = true;
  }

  if (message.guild && !isMentioned && !chimesIn) return;

  const soMidiaOuLink =
    (msgText.trim().length === 0 && buffer.hasMedia) ||
    (msgText.includes("http") && msgText.split(" ").length <= 2);
  if (soMidiaOuLink) {
    await new Promise((r) => setTimeout(r, 3000));
    const respMedia = await gerarMensagemUnica(
      "Mande uma reação super curta (de 1 a 3 palavras) e informal sobre uma mídia, meme ou link que o usuário acabou de mandar.",
    );
    const textoFormato = respMedia.toLowerCase().replace(/,+$/, "").trim();
    return await message.channel
      .send(textoFormato || "carai kkk")
      .catch(() => {});
  }

  if (
    msgText.length === 0 ||
    msgText === "..." ||
    msgText.toLowerCase() === "hm"
  ) {
    if (Math.random() < 0.2) return message.react("👀").catch(() => {});
    const respVazia = await gerarMensagemUnica(
      `O usuário chamado ${nomeUsuario} te marcou mas não digitou nada relevante. Mande ele falar o que quer.`,
    );
    const textoFormato = respVazia.toLowerCase().replace(/,+$/, "").trim();
    return await message.channel
      .send(textoFormato || "eai manda")
      .catch(() => {});
  }

  const txtMin = msgText.toLowerCase();
  if (lastUserMessage.get(message.author.id) === txtMin) {
    const respDuplicada = await gerarMensagemUnica(
      `O usuário chamado ${nomeUsuario} repetiu a mesma mensagem. Diga de forma zoeira para mudar o disco.`,
    );
    const textoFormato = respDuplicada.toLowerCase().replace(/,+$/, "").trim();
    return await message.channel
      .send(textoFormato || "vc ja perguntou isso doido kkk")
      .catch(() => {});
  }
  lastUserMessage.set(message.author.id, txtMin);

  if (txtMin.includes("kkk") || txtMin.includes("ksks"))
    message.react("💀").catch(() => {});
  else if (txtMin.includes("?") && txtMin.length < 15)
    message.react("🤔").catch(() => {});

  const horaBR = parseInt(
    new Date().toLocaleString("en-US", {
      timeZone: "America/Sao_Paulo",
      hour: "numeric",
      hour12: false,
    }),
    10,
  );
  let tempoLendo = Math.floor(Math.random() * 1000) + 500;
  let multiplicadorLentidao = 1;
  if (horaBR >= 2 && horaBR < 6) {
    tempoLendo += 2000;
    multiplicadorLentidao = 1.5;
  } else if (horaBR >= 6 && horaBR < 9) {
    tempoLendo += 1000;
    multiplicadorLentidao = 1.2;
  }

  await new Promise((resolve) => setTimeout(resolve, tempoLendo));

  message.channel.sendTyping().catch(() => {});
  const typingInterval = setInterval(
    () => message.channel.sendTyping().catch(() => {}),
    9000,
  );

  const contextoHistorico = await reconstruirContexto(
    message.channel,
    buffer.msgIds,
  );
  let respostaIA = await perguntarAoGroqAvancado(
    message.author.id,
    nomeUsuario,
    msgText,
    contextoHistorico,
  );

  // ================================================================
  // SISTEMA CORRIGIDO DE CAPTURA E PARSING DE LEMBRETES (MONITORADO)
  // ================================================================
  const regexLembreteFlexivel =
    /\[lembrete:\s*([^\]|]+?)\s*[|,]\s*([^\]]+?)\]/i;
  let matchLembrete = respostaIA.match(regexLembreteFlexivel);

  if (matchLembrete) {
    const apenasNumeros = matchLembrete[1].replace(/\D/g, "");
    const minutos = parseInt(apenasNumeros, 10);
    const textoCustomizado = matchLembrete[2].trim();

    if (!isNaN(minutos) && minutos > 0) {
      bancoLembretes.push({
        userId: message.author.id,
        channelId: message.channel.id,
        isDM: !message.guild,
        textoAlarme: textoCustomizado,
        timestampDisparo: Date.now() + minutos * 60 * 1000,
      });

      console.log(
        `\x1b[32m[SISTEMA LEMBRETE] Novo alarme registrado! Usuário: ${nomeUsuario} (${message.author.id}) | Tempo: ${minutos}m | Alarme: "${textoCustomizado}"\x1b[0m`,
      );

      respostaIA = respostaIA.replace(regexLembreteFlexivel, "").trim();
      guardarLembretesNoDisco();
    } else {
      console.log(
        `\x1b[31m[SISTEMA LEMBRETE - FALHA] IA tentou gerar uma tag de lembrete mas os minutos eram inválidos: "${matchLembrete[1]}"\x1b[0m`,
      );
    }
  }
  // ================================================================

  let tempoDigitando = Math.floor(
    respostaIA.length * 12 * multiplicadorLentidao,
  );
  if (tempoDigitando > 8000) tempoDigitando = 8000;
  if (tempoDigitando < 500) tempoDigitando = 500;

  await new Promise((resolve) => setTimeout(resolve, tempoDigitando));
  clearInterval(typingInterval);

  let frases = [respostaIA];
  if (Math.random() < 0.3 && respostaIA.length > 30) {
    let quebradas = respostaIA
      .split(/(?<=[,\n])\s+/)
      .filter((f) => f.trim().length > 0);
    if (quebradas.length > 1) {
      if (quebradas.length > 4) {
        frases = [
          quebradas.slice(0, 2).join(" "),
          quebradas.slice(2, 4).join(" "),
          quebradas.slice(4).join(" "),
        ].filter((f) => f.trim().length > 0);
      } else {
        frases = quebradas;
      }
    }
  }

  for (let i = 0; i < frases.length; i++) {
    let textoFinal = frases[i].toLowerCase().trim();
    textoFinal = textoFinal.replace(/,+$/, "");
    if (textoFinal.length === 0) continue;

    try {
      if (i !== 0) {
        message.channel.sendTyping();
        await new Promise((r) =>
          setTimeout(r, Math.floor(Math.random() * 500) + 300),
        );
      }
      await message.channel.send(textoFinal);
    } catch (erroDeEnvio) {
      console.log(
        `\x1b[31m[CHAT - ERRO ENVIO] Falha ao enviar mensagem fracionada no Discord.\x1b[0m`,
      );
    }
  }
}

client.on("interactionCreate", async (interaction) => {
  if (interaction.isCommand()) {
    const slashCommand = client.commands.get(interaction.commandName);
    if (!slashCommand) return;
    try {
      await slashCommand.execute(client, interaction, null);
    } catch (err) {
      console.log(
        `\x1b[31m[SLASH COMMAND - ERRO] Falha ao executar /${interaction.commandName}: ${err.message}\x1b[0m`,
      );
    }
  }
});

client.login(config.token || process.env.DISCORD_TOKEN);
