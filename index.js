const { Client, GatewayIntentBits, Collection } = require("discord.js");
const Groq = require("groq-sdk");
const fs = require("fs");
const { REST } = require("@discordjs/rest");
const { Routes } = require("discord.js");
const http = require("http");
const https = require("https");

// ================================================================
// MINI SERVIDOR WEB PARA EVITAR O REPOUSO DA RENDER
// ================================================================
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(
      "Himmel versão self-bot - Sistema de Lembretes Blindado com Logs e Trava de ID!",
    );
  })
  .listen(PORT, () => {
    console.log(`\x1b[32m[Web Server] Ouvindo na porta ${PORT}.\x1b[0m`);
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
// 💾 GESTOR DE LEMBRETES PERSISTENTES E BANCO DE IDS USADOS
// -----------------------------------------------------------
let bancoLembretes = [];
let idsComandosExecutados = []; // Guarda os IDs de mensagens que já geraram lembretes com sucesso

if (fs.existsSync("./lembretes.json")) {
  try {
    const dados = JSON.parse(fs.readFileSync("./lembretes.json", "utf-8"));
    // Suporta tanto o formato antigo (array simples) quanto o novo estruturado
    if (dados && dados.lembretes) {
      bancoLembretes = dados.lembretes;
      idsComandosExecutados = dados.idsExecutados || [];
    } else if (Array.isArray(dados)) {
      bancoLembretes = dados;
      idsComandosExecutados = [];
    }
    console.log(
      `\x1b[34m[SISTEMA DE LEMBRETES] Carregados ${bancoLembretes.length} lembretes ativos e ${idsComandosExecutados.length} travas de IDs do disco.\x1b[0m`,
    );
  } catch (e) {
    bancoLembretes = [];
    idsComandosExecutados = [];
  }
}

function guardarLembretesNoDisco() {
  const estrutura = {
    lembretes: bancoLembretes,
    idsExecutados: idsComandosExecutados,
  };
  fs.writeFileSync(
    "./lembretes.json",
    JSON.stringify(estrutura, null, 2),
    "utf-8",
  );
}

// -----------------------------------------------------------
// COMANDOS SLASHE/SISTEMAS EXTERNOS
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

function buscarNaWebNativo(query) {
  return new Promise((resolve) => {
    const urlApi = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    https
      .get(urlApi, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (json.AbstractText)
              return resolve(`Resumo: ${json.AbstractText}`);
          } catch (e) {}
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
                  )
                    return resolve("");
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
                  resolve(resultados.join(" | "));
                });
              },
            )
            .on("error", () => resolve(""));
        });
      })
      .on("error", () => resolve(""));
  });
}

async function gerarMensagemUnica(comandoInstrucao) {
  try {
    const sistemaBase = `Escreva uma resposta corta como um humano jovem de internet no discord, tudo sempre em minúsculo, sem nenhuma pontuação formal no final das frases (proibido usar ponto final, exclamação ou interrogação no fim da mensagem). Nunca termine com vírgula. Apenas deixe sem nada no final. Use gírias de forma natural.\n\nInstrução do que dizer agora: ${comandoInstrucao}`;
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: sistemaBase }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.85,
    });
    return chatCompletion.choices[0]?.message?.content || "";
  } catch (e) {
    return "";
  }
}

async function reconstruirContexto(channel, ignoreIds = []) {
  try {
    const fetched = await channel.messages.fetch({ limit: 100 });
    const mensagens = [];
    const lembreteRegexGlobal = /\[LEMBRETE:\s*(\d+)\s*\|\s*(.*?)\]/gi;

    fetched.reverse().forEach((msg) => {
      if (msg.content.trim() === "" || ignoreIds.includes(msg.id)) return;

      // 🛑 TRAVA DE HISTÓRICO ANTI-ECO: Se essa mensagem originou um lembrete que já salvamos,
      // nós ignoramos ela por completo. O bot NUNCA mais lerá o fantasma desse comando antigo!
      if (idsComandosExecutados.includes(msg.id)) {
        console.log(
          `\x1b[33m[HISTÓRICO] Mensagem ID ${msg.id} de ${msg.author.username} ignorada no contexto pois já gerou um lembrete anteriormente.\x1b[0m`,
        );
        return;
      }

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
4. EMOJIS (QUASE NUNCA USE): Use de forma MUITO rara (ex: em 1 a cada 10 mensagens). Máximo UM no final.
5. Variação de risada: alterne para "ksksk", "ashuahsu", "mds kkkkk".
6. NUNCA use a tag azul <@ID>. Chame o usuário diretamente pelo nome.
7. TEMPO E DATA: A data e o horário atual no Brasil agora são: ${dataHoraBrasil}.
8. SISTEMA DE LEMBRETE (REGRA RESTRITA): APENAS gere um lembrete se o usuário pedir EXPLICITAMENTE na MENSAGEM ATUAL (ex: "me lembra de X"). Ignore coisas do passado. Quando ordenado agora, coloque no final da sua resposta a tag exata: [LEMBRETE: minutos | mensagem_customizada].
REGRA DE OURO DO LEMBRETE: Em 'mensagem_customizada', crie uma frase de alarme 100% ÚNICA e personalizada para o usuário (ex: 'ow ${nomeUsuario}, passando pra te lembrar de X', 'lembrete pra tu nao esquecer de X kkk'). Essa frase DEVE conter obrigatoriamente a palavra 'lembrar' ou 'lembrete'. Não confirme o lembrete por extenso no seu texto principal; responda apenas concordando normalmente (ex: "beleza", "deixa comigo") and coloque a tag no final. O sistema interno enviará exatamente o texto da sua mensagem_customizada quando o tempo acabar.`;

    const sistemaPersonalidade =
      (config.personalidade ||
        process.env.PERSONALIDADE ||
        "Você é um humano jovem no discord.") + instrucoesDisfarce;

    let contextoWeb = "";
    if (precisaDeInternet(textoAtual)) {
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
  console.log(
    `\x1b[36m${client.user.username} - Online com Sistema de IDs Únicos Ativo!\x1b[0m`,
  );
  client.user.setPresence({
    activities: [{ name: "conversando", type: 0 }],
    status: "online",
  });

  // 🕒 VERIFICADOR CRON DE LEMBRETES (Corre a cada 30 segundos)
  setInterval(async () => {
    const agora = Date.now();
    let houveMudanca = false;

    for (let i = bancoLembretes.length - 1; i >= 0; i--) {
      const lembrete = bancoLembretes[i];

      if (agora >= lembrete.timestampDisparo) {
        try {
          const destino = lembrete.isDM
            ? await client.users.fetch(lembrete.userId)
            : await client.channels.fetch(lembrete.channelId);

          if (destino) {
            console.log(
              `\x1b[35m[SISTEMA DE LEMBRETES] Disparando alarme para o usuário ${lembrete.userId}\x1b[0m`,
            );
            if (lembrete.isDM) {
              await destino.send(lembrete.textoAlarme);
            } else {
              await destino.send(
                `<@${lembrete.userId}> ${lembrete.textoAlarme}`,
              );
            }
          }
        } catch (err) {
          console.log(
            `[Lembretes] Erro ao entregar lembrete para ${lembrete.userId}:`,
            err,
          );
        }
        bancoLembretes.splice(i, 1);
        houveMudanca = true;
      }
    }

    if (houveMudanca) guardarLembretesNoDisco();
  }, 30000);

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
              /\[LEMBRETE:\s*(\d+)\s*\|\s*(.*?)\]/gi,
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

  const rest = new REST({ version: "10" }).setToken(config.token);
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
      return message
        .reply({
          content: textoFormato || "mano calma kk deixa eu respirar",
          allowedMentions: { repliedUser: false },
        })
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

  // Armazena de forma garantida o ID de todas as mensagens agrupadas do utilizador
  if (!buffer.msgIds.includes(message.id)) buffer.msgIds.push(message.id);

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
    try {
      return await message.reply({
        content: textoFormato || "carai kkk",
        allowedMentions: { repliedUser: false },
      });
    } catch (e) {
      return await message.channel
        .send(textoFormato || "carai kkk")
        .catch(() => {});
    }
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
    try {
      return await message.reply({
        content: textoFormato || "eai manda",
        allowedMentions: { repliedUser: false },
      });
    } catch (e) {
      return await message.channel
        .send(textoFormato || "eai manda")
        .catch(() => {});
    }
  }

  const txtMin = msgText.toLowerCase();
  if (lastUserMessage.get(message.author.id) === txtMin) {
    const respDuplicada = await gerarMensagemUnica(
      `O usuário chamado ${nomeUsuario} repetiu a mesma mensagem. Diga de forma zoeira para mudar o disco.`,
    );
    const textoFormato = respDuplicada.toLowerCase().replace(/,+$/, "").trim();
    try {
      return await message.reply({
        content: textoFormato || "vc ja perguntou isso doido kkk",
        allowedMentions: { repliedUser: false },
      });
    } catch (e) {}
    return;
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

  // Reconstrói o contexto injetando a nova verificação de IDs
  const contextoHistorico = await reconstruirContexto(
    message.channel,
    buffer.msgIds,
  );

  console.log(
    `\x1b[36m[BOT INTERCEPT] Enviando pergunta à Groq. Histórico limpo com ${contextoHistorico.length} mensagens.\x1b[0m`,
  );
  let respostaIA = await perguntarAoGroqAvancado(
    message.author.id,
    nomeUsuario,
    msgText,
    contextoHistorico,
  );

  // ⚡ INTERCEPTADOR AJUSTADO E ROBUSTO COM TRAVA DE ID ÚNICO
  const lembreteRegexGlobal = /\[LEMBRETE:\s*(\d+)\s*\|\s*(.*?)\]/gi;
  let matchLembrete;
  let detetouLembrete = false;

  while ((matchLembrete = lembreteRegexGlobal.exec(respostaIA)) !== null) {
    const minutes = parseInt(matchLembrete[1], 10);
    const textoCustomizado = matchLembrete[2].trim();

    if (!isNaN(minutes) && minutes > 0) {
      bancoLembretes.push({
        userId: message.author.id,
        channelId: message.channel.id,
        isDM: !message.guild,
        textoAlarme: textoCustomizado,
        timestampDisparo: Date.now() + minutes * 60 * 1000,
      });
      detetouLembrete = true;
      console.log(
        `\x1b[32m[SISTEMA DE LEMBRETES] Lembrete agendado com SUCESSO para daqui a ${minutes} minutos. Texto: "${textoCustomizado}"\x1b[0m`,
      );
    }
  }

  if (detetouLembrete) {
    // Bloqueia e salva os IDs das mensagens atuais para que o bot NUNCA mais os processe no histórico futuro
    buffer.msgIds.forEach((id) => {
      if (!idsComandosExecutados.includes(id)) {
        idsComandosExecutados.push(id);
        console.log(
          `\x1b[31m[SISTEMA DE LEMBRETES] Bloqueando ID de mensagem usado: ${id}\x1b[0m`,
        );
      }
    });

    // Mantém apenas os últimos 400 IDs travados salvos em disco para otimizar desempenho e consumo de memória
    if (idsComandosExecutados.length > 400) {
      idsComandosExecutados = idsComandosExecutados.slice(-400);
    }

    respostaIA = respostaIA.replace(lembreteRegexGlobal, "").trim();
    guardarLembretesNoDisco(); // Salva imediatamente as alterações estruturadas no arquivo JSON
  }

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
      if (i === 0 && isMentioned) {
        await message.reply({
          content: textoFinal,
          allowedMentions: { repliedUser: false },
        });
      } else {
        if (i !== 0) {
          message.channel.sendTyping();
          await new Promise((r) =>
            setTimeout(r, Math.floor(Math.random() * 500) + 300),
          );
        }
        await message.channel.send(textoFinal);
      }
    } catch (erroDeEnvio) {
      await message.channel.send(textoFinal).catch(() => {});
    }
  }
}

client.on("interactionCreate", async (interaction) => {
  if (interaction.isCommand()) {
    const slashCommand = client.commands.get(interaction.commandName);
    if (!slashCommand) return;
    try {
      await slashCommand.execute(client, interaction, null);
    } catch (err) {}
  }
});

client.login(config.token);
