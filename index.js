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
  console.log(
    `\x1b[31m[SISTEMA ANTI-QUEDA] Rejeição não tratada ignorada:\x1b[0m`,
    reason,
  );
});
process.on("uncaughtException", (err) => {
  console.log(
    `\x1b[31m[SISTEMA ANTI-QUEDA] Exceção não tratada capturada:\x1b[0m`,
    err,
  );
});

// ================================================================
// MINI SERVIDOR WEB PARA EVITAR O REPOUSO DA RENDER E UPTIMEROBOT
// ================================================================
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    // TEXTO ORIGINAL MANTIDO PARA O UPTIMEROBOT NÃO APITAR FALSO POSITIVO
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
// 💾 GESTOR DE LEMBRETES PERSISTENTES
// -----------------------------------------------------------
let bancoLembretes = [];
if (fs.existsSync("./lembretes.json")) {
  try {
    bancoLembretes = JSON.parse(fs.readFileSync("./lembretes.json", "utf-8"));
    console.log(
      `\x1b[34m[LOG GESTOR] Carregados ${bancoLembretes.length} lembretes ativos do disco.\x1b[0m`,
    );
  } catch (e) {
    console.log(
      `\x1b[31m[LOG ERRO DISCO] Arquivo de lembretes corrompido, iniciando limpo.\x1b[0m`,
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
      `\x1b[36m[LOG DISCO] Banco de lembretes updated com sucesso.\x1b[0m`,
    );
  } catch (err) {
    console.log(
      `\x1b[31m[LOG ERRO DISCO] Falha ao salvar arquivo JSON: ${err.message}\x1b[0m`,
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

// -----------------------------------------------------------
// 🧠 ALGORITMO DE TRIAGEM INTELIGENTE (CÉREBRO IA RÍGIDO)
// -----------------------------------------------------------
async function avaliarNecessidadeDePesquisa(textoUsuario) {
  try {
    const promptTriagem = `Você é um analisador lógico RÍGIDO de um bot do Discord. Sua ÚNICA função é decidir se a mensagem atual exige uma pesquisa na internet.

Você SÓ DEVE retornar "SIM" se a mensagem for EXPLICITAMENTE uma pergunta sobre fatos recentes, notícias do dia, clima atual, resultados/placares de futebol ou esportes, ou dados concretos do mundo real.
Se for conversa fiada, perguntas sobre você mesmo, pedir conselhos, falar sobre pesquisas ("quero testar a pesquisa"), saudações ou piadas, retorne APENAS a palavra: NAO.

Regras de Resposta:
- Precisa pesquisar fatos externos: responda "SIM | termo_de_busca_otimizado" (Ex: SIM | placar jogo flamengo ontem)
- É apenas conversa: responda "NAO"

Exemplos Práticos:
User: "quem ganhou o jogo de ontem?" -> SIM | resultado jogo ontem placar
User: "testando a pesquisa do bot" -> NAO
User: "qual a temperatura agora em SP?" -> SIM | temperatura clima são paulo agora
User: "vc acha o neymar bom?" -> NAO
User: "me lembra de dormir" -> NAO

Mensagem atual do usuário: "${textoUsuario}"`;

    const triagemCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: promptTriagem }],
      model: "llama-3.1-8b-instant",
      temperature: 0.0,
      max_tokens: 30,
    });

    const respostaTriagem =
      triagemCompletion.choices[0]?.message?.content?.trim() || "NAO";

    if (respostaTriagem.toUpperCase().startsWith("SIM")) {
      const partes = respostaTriagem.split("|");
      const termoExtraido = partes.length > 1 ? partes[1].trim() : textoUsuario;
      console.log(
        `\x1b[35m[IA TRIAGEM] Decidiu que SIM. Busca gerada: "${termoExtraido}"\x1b[0m`,
      );
      return { devePesquisar: true, termoBusca: termoExtraido };
    }

    console.log(
      `\x1b[35m[IA TRIAGEM] Decidiu que NAO precisa de internet para essa mensagem.\x1b[0m`,
    );
    return { devePesquisar: false, termoBusca: "" };
  } catch (err) {
    console.log(
      `\x1b[31m[IA TRIAGEM - ERRO] Falha ao consultar Groq para triagem.\x1b[0m`,
    );
    return { devePesquisar: false, termoBusca: "" };
  }
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
                `\x1b[32m[SISTEMA PESQUISA] Resposta obtida via API Oficial.\x1b[0m`,
              );
              return resolve(`Resumo: ${json.AbstractText}`);
            }
          } catch (e) {}

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
            .on("error", () => resolve(""));
        });
      })
      .on("error", () => resolve(""));
  });
}

// -----------------------------------------------------------
// GERAÇÃO DE TEXTOS MENORES DA IA
// -----------------------------------------------------------
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

// -----------------------------------------------------------
// 💾 RECONSTRUÇÃO DE CONTEXTO COM FILTRO ANTI-LOOP
// -----------------------------------------------------------
async function reconstruirContexto(channel, ignoreIds = []) {
  try {
    const fetched = await channel.messages.fetch({ limit: 15 });
    const mensagens = [];
    const lembreteRegexGlobal = /\[lembrete:\s*.*?\s*\|\s*.*?\]/gi;

    fetched.reverse().forEach((msg) => {
      if (msg.content.trim() === "" || ignoreIds.includes(msg.id)) return;

      let conteudo = msg.content;
      conteudo = conteudo.replace(lembreteRegexGlobal, "").trim();

      if (conteudo.length === 0) return;

      if (msg.author.id === client.user.id) {
        const txtMin = conteudo.toLowerCase();
        if (
          txtMin.includes("regras de") ||
          txtMin.includes("comportamento") ||
          txtMin.includes("formato:") ||
          txtMin.includes("lembretes:")
        ) {
          console.log(
            `\x1b[33m[SEGURANÇA] Mensagem antiga de bug do bot ignorada no histórico para evitar loop.\x1b[0m`,
          );
          return;
        }
      }

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

// -----------------------------------------------------------
// CHAMADA PRINCIPAL DA IA (COM TRATAMENTO DE BUSCA E BLINDAGEM)
// -----------------------------------------------------------
async function perguntarAoGroqAvancado(
  idUsuario,
  nomeUsuario,
  textoAtual,
  contextoHistorico,
) {
  let contextoWeb = "";

  const analisePesquisa = await avaliarNecessidadeDePesquisa(textoAtual);

  if (analisePesquisa.devePesquisar) {
    let termoSanitizado = analisePesquisa.termoBusca
      .toLowerCase()
      .replace(/\banti\s*ontem\b/g, "anteontem")
      .replace(/\bce\b/g, "você")
      .replace(/\bagr\b/g, "agora")
      .replace(/[?!.]/g, "")
      .trim();

    console.log(
      `\x1b[36m[SISTEMA PESQUISA] Sanitizado e otimizado para: "${termoSanitizado}"\x1b[0m`,
    );

    const dadosBusca = await buscarNaWebNativo(termoSanitizado);

    if (dadosBusca && dadosBusca.length > 5) {
      contextoWeb = `\n\n<DADOS_DA_INTERNET>\n${dadosBusca}\n</DADOS_DA_INTERNET>\nLeia isso para responder com precisão factual absoluta, mas finja que já sabia de cabeça.`;
    } else {
      console.log(
        `\x1b[31m[LOG IA] Avisando o modelo que a busca na web falhou ou retornou vazia.\x1b[0m`,
      );
      contextoWeb = `\n\n<AVISO_DE_SISTEMA>\nVocê tentou pesquisar na internet por informações recentes sobre "${termoSanitizado}", mas o sistema de busca falhou ou retornou zero resultados. Seja sincero de forma natural e informal: diga que deu uma olhada rápida na internet para ver se achava mas acabou não encontrando dados precisos sobre isso ou que a busca bugou.\n</AVISO_DE_SISTEMA>`;
    }
  }

  const modelosParaTentar = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "llama3-8b-8192",
  ];

  for (const modeloAtual of modelosParaTentar) {
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

      const instrucoesDisfarce = `\n\n
<REGRAS_DE_ESTILO>
- Formato: tudo sempre em minúsculo, sem nenhuma pontuação formal no fim das frases (. ! ?). Nunca termine mensagens com vírgula (,).
- Espelhamento: aja naturalmente de acordo com o tom do histórico.
- Risadas: mude entre "ksksk", "ashuahsu", "mds kkkkk".
- Emojis: use muito raramente, no máximo um no final se combinar muito.
- Menções: nunca use a tag azul <@ID>. Chame a pessoa pelo nome normal.
- Tempo: a data/hora atualizada no Brasil agora é ${dataHoraBrasil}.
</REGRAS_DE_ESTILO>

<SISTEMA_DE_LEMBRETES_RESTRITO>
- Você é um modelo de linguagem e está PROIBIDO de gerar a tag "[lembrete:...]" por iniciativa própria.
- Você SÓ DEVE gerar a tag se o usuário no prompt atual pedir explicitamente por uma ação de tempo futuro (ex: "me lembra de", "me avise em", "marca um alarme").
- Se o usuário estiver apenas conversando, fazendo perguntas cotidianas ou perguntas sobre pesquisas da internet, IGNORE COMPLETAMENTE a existência desse sistema e nunca escreva a palavra "lembrete" entre colchetes.
- Formato obrigatório da tag (APENAS se solicitado): [lembrete: minutos_inteiros | mensagem_do_alarme]
</SISTEMA_DE_LEMBRETES_RESTRITO>`;

      const sistemaPersonalidade =
        (config.personalidade || "Você é um humano jovem no discord.") +
        instrucoesDisfarce;

      const mensagensParaEnviar = [
        { role: "system", content: `${sistemaPersonalidade}${contextoWeb}` },
      ];
      contextoHistorico.forEach((msg) => mensagensParaEnviar.push(msg));
      mensagensParaEnviar.push({
        role: "user",
        content: `[${nomeUsuario}]: ${textoAtual}`,
      });

      console.log(
        `\x1b[35m[LOG API] Fazendo chamada principal usando o modelo: ${modeloAtual}...\x1b[0m`,
      );

      const chatCompletion = await groq.chat.completions.create({
        messages: mensagensParaEnviar,
        model: modeloAtual,
        temperature: 0.3,
      });

      return chatCompletion.choices[0]?.message?.content || "fiquei mudo";
    } catch (err) {
      console.log(
        `\x1b[33m[LOG AVISO] Modelo ${modeloAtual} bateu limite/erro. Tentando modelo reserva... Erro: ${err.message}\x1b[0m`,
      );
    }
  }

  console.log(
    `\x1b[31m[LOG CRÍTICO] Todos os modelos da Groq falharam.\x1b[0m`,
  );
  return "foi mal, deu teto preto aqui na api kkk perai";
}

// -----------------------------------------------------------
// EVENTOS DE START E ROTINAS
// -----------------------------------------------------------
client.once("ready", async () => {
  console.log(
    `\x1b[32m[LOG SYSTEM] ${client.user.username} conectado e operando no Discord!\x1b[0m`,
  );
  client.user.setPresence({
    activities: [{ name: "conversando", type: 0 }],
    status: "online",
  });

  // Verificador Cron de Lembretes (AGORA HUMANIZADO COM IA E SLANGS)
  setInterval(async () => {
    const agora = Date.now();
    let houveMudanca = false;

    for (let i = bancoLembretes.length - 1; i >= 0; i--) {
      const lembrete = bancoLembretes[i];

      if (agora >= lembrete.timestampDisparo) {
        console.log(
          `\x1b[34m[LOG LEMBRETE] Disparando alarme agendado do usuário ${lembrete.userId}\x1b[0m`,
        );
        try {
          const destino = lembrete.isDM
            ? await client.users.fetch(lembrete.userId)
            : await client.channels.fetch(lembrete.channelId);

          if (destino) {
            // Solicita um aviso customizado gerado de forma fluida pela IA
            const avisoIA = await gerarMensagemUnica(
              `O cronômetro de um usuário acabou de bater. O que ele tinha pedido para lembrar é: "${lembrete.textoAlarme}". Crie uma frase bem curta, de jovem de internet, avisando ou zoando ele de forma descontraída, sem pontuação formal.`,
            );

            let textoFinal = avisoIA.toLowerCase().trim();
            textoFinal = textoFinal.replace(/,+$/, "");

            // FALLBACKS RESERVA: Se a API falhar ou demorar, usa uma rota humana alternativa
            if (!textoFinal || textoFinal.length < 3) {
              const giriasReserva = [
                `ow mano, tu pediu pra te lembrar de ${lembrete.textoAlarme} ksks`,
                `passando pra avisar da fita lá: ${lembrete.textoAlarme} mds tinha esquecido né`,
                `bro, aqui o aviso q tu pediu pra lembrar: ${lembrete.textoAlarme}`,
                `lembrete pra tu não mofar: ${lembrete.textoAlarme} ashuahsu`,
                `acorda ae kkk tu pediu pra lembrar de ${lembrete.textoAlarme}`,
              ];
              textoFinal =
                giriasReserva[Math.floor(Math.random() * giriasReserva.length)];
            }

            if (lembrete.isDM) {
              await destino.send(textoFinal);
            } else {
              await destino.send(`<@${lembrete.userId}> ${textoFinal}`);
            }
          }
        } catch (err) {
          console.log(
            `\x1b[31m[LOG ERRO DISCORD] Erro ao entregar lembrete: ${err.message}\x1b[0m`,
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
        `\x1b[32m[SUCESSO GESTOR] Novo alarme agendado via chat: "${textoCustomizado}" para daqui a ${minutos}m.\x1b[0m`,
      );

      respostaIA = respostaIA.replace(regexLembreteFlexivel, "").trim();
      guardarLembretesNoDisco();
    }
  }

  respostaIA = respostaIA.replace(
    /lembrete:\s*\d+\s*(minutos|minuto|m|hora|horas|h|dia|dias|d)?(,\s*)?/gi,
    "",
  );
  respostaIA = respostaIA.replace(/vou te lembrar de\s+[^,]+(,\s*)?/gi, "");
  respostaIA = respostaIA.replace(/deixa comigo,\s*/gi, "deixa comigo ");
  respostaIA = respostaIA.trim();

  if (respostaIA.length === 0) {
    respostaIA = "demorou, já deixei anotado aqui";
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
      if (i !== 0) {
        message.channel.sendTyping();
        await new Promise((r) =>
          setTimeout(r, Math.floor(Math.random() * 500) + 300),
        );
      }
      await message.channel.send(textoFinal);
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

client.login(config.token || process.env.DISCORD_TOKEN);
