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
    res.end("Himmel versão self-bot - Sistema de Lembretes Blindado com Logs!");
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
      `\x1b[34m[LOG GESTOR] Carregados com sucesso ${bancoLembretes.length} lembretes ativos e ${idsComandosExecutados.length} gatilhos travados do disco.\x1b[0m`,
    );
  } catch (e) {
    console.log(
      `\x1b[31m[LOG ERRO DISCO] Falha ao ler arquivo de banco de dados (JSON inválido). Reiniciando limpo.\x1b[0m`,
    );
    bancoLembretes = [];
    idsComandosExecutados = [];
  }
}

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
    console.log(
      `\x1b[36m[LOG DISCO] Banco de lembretes atualizado no disco (Total: ${bancoLembretes.length}).\x1b[0m`,
    );
  } catch (err) {
    console.log(
      `\x1b[31m[LOG ERRO DISCO] Falha crítica ao salvar dados de lembretes no arquivo: ${err.message}\x1b[0m`,
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
  console.log(
    `\x1b[33m[LOG WEB] Detectada intenção de pesquisa. Buscando dados para: "${query}"...\x1b[0m`,
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
                `\x1b[32m[LOG WEB] Dados encontrados na API rápida do DuckDuckGo.\x1b[0m`,
              );
              return resolve(`Resumo: ${json.AbstractText}`);
            }
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
                  ) {
                    console.log(
                      `\x1b[31m[LOG QUEBRÁVEL ERRO] DuckDuckGo barrou a pesquisa por Captcha ou página vazia.\x1b[0m`,
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
                    `\x1b[32m[LOG WEB] Pesquisa HTML concluída. ${resultados.length} trechos capturados.\x1b[0m`,
                  );
                  resolve(resultados.join(" | "));
                });
              },
            )
            .on("error", (err) => {
              console.log(
                `\x1b[31m[LOG QUEBRÁVEL ERRO] Falha na raspagem HTML da Web: ${err.message}\x1b[0m`,
              );
              resolve("");
            });
        });
      })
      .on("error", (err) => {
        console.log(
          `\x1b[31m[LOG QUEBRÁVEL ERRO] Falha na requisição API de busca: ${err.message}\x1b[0m`,
        );
        resolve("");
      });
  });
}

async function gerarMensagemUnica(comandoInstrucao) {
  try {
    const sistemaBase = `Escreva uma resposta corta como um humano jovem de internet no discord, tudo sempre em minúsculo, sem nenhuma pontuação formal no final das frases. Nunca termine com vírgula. Use gírias de forma natural.\n\nInstrução: ${comandoInstrucao}`;
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: sistemaBase }],
      model: "llama-3.1-8b-instant",
      temperature: 0.85,
    });
    return chatCompletion.choices[0]?.message?.content || "";
  } catch (e) {
    console.log(
      `\x1b[31m[LOG QUEBRÁVEL ERRO] Groq API falhou na geração de submensagem rápida: ${e.message}\x1b[0m`,
    );
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

      if (idsComandosExecutados.includes(msg.id)) {
        console.log(
          `\x1b[33m[LOG HISTÓRICO] Ignorando gatilho de lembrete antigo (ID: ${msg.id}) enviado por ${msg.author.username}.\x1b[0m`,
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
    console.log(
      `\x1b[31m[LOG ERRO DISCORD] Falha ao puxar histórico de mensagens do canal: ${e.message}\x1b[0m`,
    );
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
3. INTELIGÊNCIA EMOCIONAL: Seja legal com quem for legal com você e seja frio ou curto com quem for chato/rude.
4. EMOJIS (QUASE NUNCA USE): Só use emojis se for algo MUITO específico ou raro (máximo 1 emoji no fim da mensagem, ex: em 1 a cada 10 mensagens). Alterne risadas como "kkk", "ksksk", "ashuahsu", "mds kkkkk".
5. MENÇÃO: Nunca use a tag azul <@id> para chamar as pessoas no texto, refira-se a elas apenas pelo nome direto.
6. DATA ATUAL NO BRASIL: ${dataHoraBrasil}.
7. SISTEMA DE LEMBRETE: Se o usuário pedir para você lembrar de algo AGORA nesta última mensagem dele (ex: "me lembra de X em Y minutos"), concorde casualmente no texto (ex: "fechou", "deixa comigo") e obrigatoriamente coloque ESTA tag exata colada no fim do texto: [LEMBRETE: minutos | mensagem do alarme].
Importante: Substitua 'minutos' por números inteiros. Em 'mensagem do alarme', escreva uma frase 100% ÚNICA e personalizada para avisar o usuário (ex: 'ow ${nomeUsuario}, tu pediu pra te lembrar de X', 'lembrete pra tu nao esquecer de X kkk'). Esta frase DEVE conter obrigatoriamente a palavra 'lembrar' ou 'lembrete'. Se a mensagem dele atual não tiver pedidos de alarme novos, responda apenas conversando sem adicionar nenhuma tag de lembrete.`;

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
      messages: messagesParaEnviar,
      model: "llama-3.1-8b-instant",
      temperature: 0.4,
    });

    return chatCompletion.choices[0]?.message?.content || "fiquei mudo";
  } catch (err) {
    console.log(
      `\x1b[31m[LOG QUEBRÁVEL ERRO] Groq API falhou ou estourou o limite (Rate Limit)! Erro exato: ${err.message}\x1b[0m`,
    );
    return "foi mal, deu teto preto aqui na api kkk perai";
  }
}

// -----------------------------------------------------------
// PRONTO E CRON TRALHAS
// -----------------------------------------------------------
client.once("ready", async () => {
  console.log(
    `\x1b[32m[LOG INICIALIZAÇÃO] ${client.user.username} conectado com sucesso no Discord!\x1b[0m`,
  );
  client.user.setPresence({
    activities: [{ name: "conversando", type: 0 }],
    status: "online",
  });

  // 🕒 Verificador periódico de lembretes ativos (Roda a cada 15 segundos)
  setInterval(async () => {
    const agora = Date.now();
    let mudou = false;

    for (let i = bancoLembretes.length - 1; i >= 0; i--) {
      const item = bancoLembretes[i];
      if (agora >= item.timestampDisparo) {
        console.log(
          `\x1b[35m[LOG LEMBRETE] Disparando cronômetro do lembrete agendado para o usuário ID: ${item.userId}...\x1b[0m`,
        );
        try {
          const alvo = item.isDM
            ? await client.users.fetch(item.userId)
            : await client.channels.fetch(item.channelId);
          if (alvo) {
            if (item.isDM) {
              await alvo.send(item.textoAlarme);
              console.log(
                `\x1b[32m[LOG LEMBRETE] Alarme enviado com sucesso via DM para ID: ${item.userId}.\x1b[0m`,
              );
            } else {
              await alvo.send(`<@${item.userId}> ${item.textoAlarme}`);
              console.log(
                `\x1b[32m[LOG LEMBRETE] Alarme enviado com sucesso no canal ${item.channelId} marcando usuário.\x1b[0m`,
              );
            }
          }
        } catch (e) {
          console.log(
            `\x1b[31m[LOG QUEBRÁVEL ERRO] Falha ao entregar mensagem do lembrete ativo: ${e.message}\x1b[0m`,
          );
        }
        bancoLembretes.splice(i, 1);
        mudou = true;
      }
    }
    if (mudou) guardarLembretesNoDisco();
  }, 15000);

  // Rotina de Puxar assunto no Privado
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
          console.log(
            `\x1b[34m[LOG DM ROTINA] Iniciando rotina automática de puxada de assunto com ID: ${idSorteado}\x1b[0m`,
          );
          const usuarioAlvo = await client.users.fetch(idSorteado);
          if (usuarioAlvo) {
            const dm = await usuarioAlvo.createDM();
            await dm.sendTyping();
            const contexto = await reconstruirContexto(dm, []);
            let msgIA = await perguntarAoGroqAvancado(
              idSorteado,
              usuarioAlvo.username,
              "Puxe assunto comigo no privado do nada.",
              contexto,
            );
            msgIA = msgIA.replace(/\[LEMBRETE:\s*(\d+)\s*\|\s*(.*?)\]/gi, "");
            let textoFinal = msgIA.toLowerCase().replace(/,+$/, "").trim();
            if (textoFinal.length > 0) await dm.send(textoFinal);
          }
        } catch (e) {
          console.log(
            `\x1b[31m[LOG QUEBRÁVEL ERRO] Rotina de DM falhou: ${e.message}\x1b[0m`,
          );
        }
      }
      rotinaMensagemAleatoria();
    }, tempoEspera);
  }
  rotinaMensagemAleatoria();

  // Verificador de Chat Morto (Após 6 horas sem nenhuma mensagem no canal)
  setInterval(
    async () => {
      const agora = Date.now();
      for (const [channelId, ultimoTempo] of channelActivity.entries()) {
        if (agora - ultimoTempo > 6 * 60 * 60 * 1000) {
          console.log(
            `\x1b[33m[LOG CHAT MORTO] Canal ${channelId} inativo por 6h. Puxando assunto...\x1b[0m`,
          );
          try {
            const canal = await client.channels.fetch(channelId);
            if (canal && canal.isTextBased()) {
              const puxaAssunto = await gerarMensagemUnica(
                "O chat do grupo está parado há horas (chat morto). Mande uma frase bem curta e informal de jovem para puxar assunto ou zoar o silêncio de todo mundo.",
              );
              let textoFinal = puxaAssunto
                .toLowerCase()
                .replace(/,+$/, "")
                .trim();
              await canal.send(textoFinal || "bando de morto kkk alguem vivo?");
              channelActivity.set(channelId, Date.now());
            }
          } catch (e) {
            console.log(
              `\x1b[31m[LOG QUEBRÁVEL ERRO] Falha ao rodar gatilho de quebra de chat morto: ${e.message}\x1b[0m`,
            );
          }
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

      const bufferKeyParaLimpar = `${message.channel.id}-${message.author.id}`;
      if (userMessageBuffers.has(bufferKeyParaLimpar)) {
        clearTimeout(userMessageBuffers.get(bufferKeyParaLimpar).timer);
        userMessageBuffers.delete(bufferKeyParaLimpar);
      }

      console.log(
        `\x1b[33m[LOG FLOOD] Bloqueando temporariamente o usuário ${message.author.username} por spam.\x1b[0m`,
      );
      const avisoFlood = await gerarMensagemUnica(
        "O usuário está floodando mensagens rápido demais. Mande ele se acalmar ou esperar um pouco de forma bem curta, informal e zoeira.",
      );
      let textoFinal = avisoFlood.toLowerCase().replace(/,+$/, "").trim();
      return message.channel
        .send(textoFinal || "calma mano kkk assim vc me quebra")
        .catch(() => {});
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
// ENGINE DE PROCESSAMENTO FINAL (SEM REPLIES)
// -----------------------------------------------------------
async function processarMensagemFinal(buffer) {
  const message = buffer.lastMessageObj;
  const nomeUsuario = message.member
    ? message.member.displayName
    : message.author.username;
  let msgText = buffer.textParts.join(" ... ");
  let foiMencionado = buffer.wasMentioned;
  let seMeteuNoAssunto = false;

  if (!foiMencionado && message.guild) {
    const palavrasChave = [
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
      palavrasChave.some((k) => msgText.toLowerCase().includes(k)) &&
      Math.random() < 0.07
    )
      seMeteuNoAssunto = true;
  }

  if (message.guild && !foiMencionado && !seMeteuNoAssunto) return;

  const apenasMidiaOuLink =
    (msgText.trim().length === 0 && buffer.hasMedia) ||
    (msgText.includes("http") && msgText.split(" ").length <= 2);
  if (apenasMidiaOuLink) {
    await new Promise((r) => setTimeout(r, 3000));
    const respMidia = await gerarMensagemUnica(
      "Mande uma reação super curta (de 1 a 3 palavras) e informal sobre uma mídia, meme ou link que o usuário acabou de mandar.",
    );
    let textoFinal = respMidia.toLowerCase().replace(/,+$/, "").trim();
    return await message.channel
      .send(textoFinal || "carai kkk")
      .catch(() => {});
  }

  if (
    msgText.length === 0 ||
    msgText === "..." ||
    msgText.toLowerCase() === "hm"
  ) {
    if (Math.random() < 0.2) return message.react("👀").catch(() => {});
    const respVazio = await gerarMensagemUnica(
      `O usuário chamado ${nomeUsuario} te marcou mas não digitou nada relevante. Mande ele falar o que quer.`,
    );
    let textoFinal = respVazio.toLowerCase().replace(/,+$/, "").trim();
    return await message.channel
      .send(textoFinal || "eai manda")
      .catch(() => {});
  }

  const txtMin = msgText.toLowerCase();
  if (lastUserMessage.get(message.author.id) === txtMin) {
    const respRepetida = await gerarMensagemUnica(
      `O usuário chamado ${nomeUsuario} repetiu a mesma mensagem. Diga de forma zoeira para mudar o disco.`,
    );
    let textoFinal = respRepetida.toLowerCase().replace(/,+$/, "").trim();
    return await message.channel
      .send(textoFinal || "vc ja perguntou isso doido kkk")
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

  const contexto = await reconstruirContexto(message.channel, buffer.msgIds);

  console.log(
    `\x1b[36m[LOG REQUISIÇÃO IA] Enviando prompt para Groq. Usuário: ${nomeUsuario}. Histórico carregado: ${contexto.length} msgs.\x1b[0m`,
  );
  let respostaIA = await perguntarAoGroqAvancado(
    message.author.id,
    nomeUsuario,
    msgText,
    contexto,
  );

  const lembreteRegexGlobal = /\[LEMBRETE:\s*(\d+)\s*\|\s*(.*?)\]/gi;
  let match;
  let criouLembrete = false;

  while ((match = lembreteRegexGlobal.exec(respostaIA)) !== null) {
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
        `\x1b[32m[LOG GESTOR] AGENDADO COM SUCESSO: Lembrete para ${nomeUsuario} daqui a ${min} minutos.\x1b[0m`,
      );
    }
  }

  if (criouLembrete) {
    buffer.msgIds.forEach((id) => {
      if (!idsComandosExecutados.includes(id)) idsComandosExecutados.push(id);
    });

    if (idsComandosExecutados.length > 300)
      idsComandosExecutados = idsComandosExecutados.slice(-300);

    respostaIA = respostaIA.replace(lembreteRegexGlobal, "").trim();
    guardarLembretesNoDisco();
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
      console.log(
        `\x1b[31m[LOG QUEBRÁVEL ERRO] Falha ao enviar bloco de mensagem final no Discord: ${erroDeEnvio.message}\x1b[0m`,
      );
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

client.login(config.token || process.env.DISCORD_TOKEN);
