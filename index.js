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
    res.end("Himmel versão self-bot - Log e Lembretes Estáveis");
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
// 💾 GESTOR DE LEMBRETES PERSISTENTES COM TRAVA DE REPETIÇÃO
// -----------------------------------------------------------
let bancoLembretes = [];
let idsComandosExecutados = [];

if (fs.existsSync("./lembretes.json")) {
  try {
    const dados = JSON.parse(fs.readFileSync("./lembretes.json", "utf-8"));
    if (dados && dados.lembretes) {
      bancoLembretes = dados.lembretes;
      idsComandosExecutados = dados.idsExecutados || [];
    } else if (Array.isArray(dados)) {
      bancoLembretes = dados;
    }
    console.log(
      `\x1b[34m[LOG BASE] Carregados ${bancoLembretes.length} lembretes e ${idsComandosExecutados.length} IDs travados.\x1b[0m`,
    );
  } catch (e) {
    bancoLembretes = [];
    idsComandosExecutados = [];
  }
}

// CORREÇÃO DO ERRO DE SINTAXE: Nome unificado e sem quebras
function guardarLembretesNoDisco() {
  try {
    const dadosParaSalvar = {
      lembretes: bancoLembretes,
      idsExecutados: idsComandosExecutados,
    };
    fs.writeFileSync(
      "./lembretes.json",
      JSON.stringify(dadosParaSalvar, null, 2),
      "utf-8",
    );
  } catch (err) {
    console.log(
      `\x1b[31m[ERRO DISCO] Falha ao salvar arquivo: ${err.message}\x1b[0m`,
    );
  }
}

// -----------------------------------------------------------
// BUSCA WEB E AUXILIARES
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
    const sistemaBase = `Escreva uma resposta curta como um humano jovem de internet no discord, tudo sempre em minúsculo, sem nenhuma pontuação formal no final das frases. Nunca termine com vírgula. Use gírias de forma natural.\n\nInstrução: ${comandoInstrucao}`;
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

// -----------------------------------------------------------
// RECONSTRUTOR DE CONTEXTO COM EXPURGO DE COMANDOS ANTIGOS
// -----------------------------------------------------------
async function reconstruirContexto(channel, ignoreIds = []) {
  try {
    const fetched = await channel.messages.fetch({ limit: 40 });
    const mensagens = [];
    const lembreteRegexGlobal = /\[LEMBRETE:\s*(\d+)\s*\|\s*(.*?)\]/gi;

    fetched.reverse().forEach((msg) => {
      if (msg.content.trim() === "" || ignoreIds.includes(msg.id)) return;

      // Se essa mensagem gerou um lembrete no passado, o bot finge que ela nunca existiu
      if (idsComandosExecutados.includes(msg.id)) {
        console.log(
          `\x1b[33m[HISTÓRICO LOG] Omitindo mensagem antiga ID: ${msg.id} de ${msg.author.username} para evitar eco do lembrete.\x1b[0m`,
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
1. FORMATO: Escreva TUDO sempre em minúsculo. Nenhuma pontuação formal (proibido usar . ou ! ou ? no final das frases). NUNCA termine uma frase ou linha com vírgula (,).
2. ESPELHAMENTO: Comporte-se como um jovem nativo do Discord baseado no histórico.
3. DATA ATUAL NO BRASIL: ${dataHoraBrasil}.
4. SISTEMA DE LEMBRETE: Se o usuário pedir para você lembrar de algo AGORA nesta última mensagem dele (ex: "me lembra de X em Y minutos"), concorde casualmente no texto (ex: "fechou", "deixa comigo") e obrigatoriamente coloque ESTA tag exata colada no fim do texto: [LEMBRETE: minutos | mensagem do alarme].
Importante: Substitua 'minutos' por números inteiros e 'mensagem do alarme' por um aviso curto seu (ex: 'ow ${nomeUsuario}, tu pediu pra te lembrar de X'). Se a mensagem dele atual não tiver pedidos de alarme novos, responda apenas conversando sem adicionar nenhuma tag de lembrete.`;

    const sistemaPersonalidade =
      (config.personalidade || "Você é um humano jovem no discord.") +
      instrucoesDisfarce;

    let contextoWeb = "";
    if (precisaDeInternet(textoAtual)) {
      const dadosBusca = await buscarNaWebNativo(textoAtual);
      if (dadosBusca && dadosBusca.length > 5) {
        contextoWeb = `\n\n<DADOS_DA_INTERNET>\n${dadosBusca}\n</DADOS_DA_INTERNET>`;
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
      temperature: 0.4,
    });

    return chatCompletion.choices[0]?.message?.content || "fiquei mudo";
  } catch (err) {
    console.log(`\x1b[31m[ERRO GROQ API]: ${err.message}\x1b[0m`);
    return "foi mal, deu teto preto aqui na api kkk perai";
  }
}

// -----------------------------------------------------------
// PRONTO E CRON TRALHAS
// -----------------------------------------------------------
client.once("ready", async () => {
  console.log(
    `\x1b[36m[SISTEMA] ${client.user.username} conectado com sucesso no Discord!\x1b[0m`,
  );

  // Verificador periódico de lembretes ativos (Roda a cada 15 segundos)
  setInterval(async () => {
    const agora = Date.now();
    let mudou = false;

    for (let i = bancoLembretes.length - 1; i >= 0; i--) {
      const item = bancoLembretes[i];
      if (agora >= item.timestampDisparo) {
        try {
          const alvo = item.isDM
            ? await client.users.fetch(item.userId)
            : await client.channels.fetch(item.channelId);
          if (alvo) {
            console.log(
              `\x1b[35m[DISPARADOR] Enviando o lembrete agendado para o ID ${item.userId}\x1b[0m`,
            );
            if (item.isDM) {
              await alvo.send(item.textoAlarme);
            } else {
              await alvo.send(`<@${item.userId}> ${item.textoAlarme}`);
            }
          }
        } catch (e) {
          console.log(`[ALERTA] Erro ao entregar lembrete: ${e.message}`);
        }
        bancoLembretes.splice(i, 1);
        mudou = true;
      }
    }
    if (mudou) guardarLembretesNoDisco();
  }, 15000);
});

// -----------------------------------------------------------
// MONITORAMENTO E BUFFER DE ENTRADAS
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
      return message.reply("calma mano kkk assim vc me quebra").catch(() => {});
    }
  } else {
    userFlood.count = 1;
    userFlood.firstMsg = now;
  }
  userFloodControl.set(message.author.id, userFlood);

  const bufferKey = `${message.channel.id}-${message.author.id}`;
  const botMention = `<@${client.user.id}>`;

  let mencionado =
    message.content.includes(botMention) || message.mentions.has(client.user);
  let textoFiltro = message.content;
  if (textoFiltro.includes(botMention))
    textoFiltro = textoFiltro.replace(botMention, "").trim();

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
  if (textoFiltro.length > 0) buffer.textParts.push(textoFiltro);
  if (!buffer.msgIds.includes(message.id)) buffer.msgIds.push(message.id);

  if (mencionado) buffer.wasMentioned = true;
  if (message.attachments.size > 0 || message.content.includes("http"))
    buffer.hasMedia = true;
  buffer.lastMessageObj = message;

  if (buffer.timer) clearTimeout(buffer.timer);
  buffer.timer = setTimeout(async () => {
    userMessageBuffers.delete(bufferKey);
    await processarMensagemFinal(buffer);
  }, 3000);
});

// -----------------------------------------------------------
// ENGINE DE PROCESSAMENTO FINAL
// -----------------------------------------------------------
async function processarMensagemFinal(buffer) {
  const message = buffer.lastMessageObj;
  const nomeUsuario = message.member
    ? message.member.displayName
    : message.author.username;
  let msgText = buffer.textParts.join(" ... ");
  let foiMencionado = buffer.wasMentioned;

  // Se for servidor e não houver menção/chat morto aleatório, ignora
  if (message.guild && !foiMencionado) {
    if (
      !["jogo", "ia", "discord", "bot"].some((k) =>
        msgText.toLowerCase().includes(k),
      ) ||
      Math.random() > 0.07
    ) {
      return;
    }
  }

  if (msgText.length === 0) return;

  message.channel.sendTyping().catch(() => {});
  const contexto = await reconstruirContexto(message.channel, buffer.msgIds);

  console.log(
    `\x1b[36m[IA REQUISIÇÃO] Gerando resposta para ${nomeUsuario}. Mensagens no histórico: ${contexto.length}\x1b[0m`,
  );
  let resposta = await perguntarAoGroqAvancado(
    message.author.id,
    nomeUsuario,
    msgText,
    contexto,
  );

  // ANALISADOR E CAPTURADOR DE TAGS DE LEMBRETE
  const lembreteRegexGlobal = /\[LEMBRETE:\s*(\d+)\s*\|\s*(.*?)\]/gi;
  let match;
  let criouLembrete = false;

  while ((match = lembreteRegexGlobal.exec(resposta)) !== null) {
    const min = parseInt(match[1], 10);
    const txtAviso = match[2].trim();

    if (!isNaN(min) && min > 0) {
      bancoLembretes.push({
        userId: message.author.id,
        channelId: message.channel.id,
        isDM: !message.guild,
        textoAlarme: txtAviso,
        timestampDisparo: Date.now() + min * 60 * 1000,
      });
      criouLembrete = true;
      console.log(
        `\x1b[32m[SUCESSO] Lembrete novo agendado para daqui a ${min}m: "${txtAviso}"\x1b[0m`,
      );
    }
  }

  if (criouLembrete) {
    // Vincula as mensagens desse gatilho atual na lista negra de histórico antigo
    buffer.msgIds.forEach((id) => {
      if (!idsComandosExecutados.includes(id)) idsComandosExecutados.push(id);
    });

    // Mantém a lista sob controle de memória
    if (idsComandosExecutados.length > 300)
      idsComandosExecutados = idsComandosExecutados.slice(-300);

    resposta = resposta.replace(lembreteRegexGlobal, "").trim();
    guardarLembretesNoDisco();
  }

  // Envio formatado e humanizado no chat
  let textoFinal = resposta.toLowerCase().replace(/,+$/, "").trim();
  if (textoFinal.length > 0) {
    try {
      await message.reply({
        content: textoFinal,
        allowedMentions: { repliedUser: false },
      });
    } catch (e) {
      await message.channel.send(textoFinal).catch(() => {});
    }
  }
}

client.on("interactionCreate", async (interaction) => {
  if (interaction.isCommand()) {
    const slash = client.commands.get(interaction.commandName);
    if (slash)
      try {
        await slash.execute(client, interaction, null);
      } catch (e) {}
  }
});

client.login(config.token);
