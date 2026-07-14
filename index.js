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
    res.end("Himmel versão self-bot - Sistema de Lembretes Blindado com Logs!");
  })
  .listen(PORT, () => {
    console.log(
      `\x1b[32m[WEB SERVER] Ouvindo e operando na porta ${PORT}.\x1b[0m`,
    );
  });

// ================================================================
// CONFIGURAÇÃO DOS WEBHOOKS DE REDES SOCIAIS (MAKE.COM)
// ================================================================
const INSTAGRAM_WEBHOOK_URL = process.env.INSTAGRAM_WEBHOOK || "https://hook.us2.make.com/7pu4k841rq4908fddmnf0os8c8k8ilhs";
const TWITTER_WEBHOOK_URL = process.env.TWITTER_WEBHOOK || "COLE_AQUI_SEU_WEBHOOK_DO_TWITTER_SE_QUISER";

// ================================================================
// VARIÁVEIS DE SISTEMAS HUMANIZADOS E ALVOS
// ================================================================
const IDS_ALVO_DM = ["1310397024541212672", "760510107988918333", "1309344503617945651"];
const lastUserMessage = new Map();
const channelActivity = new Map();
const userMessageBuffers = new Map();
const bomDiaAgendados = new Set();

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
    GatewayIntentBits.GuildPresences,
  ],
  partials: [1, 3],
});

// -----------------------------------------------------------
// 💾 GESTOR DE COOLDOWNS PERSISTENTES (ESCUDO ANTI-REINÍCIO)
// -----------------------------------------------------------
let bancoCooldowns = {
  lastBomDiaSent: {},
  lastSpontaneousDM: 0,
  lastDoubleText: {},
  presence: {},
  userFloodControl: {}
};

if (fs.existsSync("./cooldowns.json")) {
  try {
    bancoCooldowns = JSON.parse(fs.readFileSync("./cooldowns.json", "utf-8"));
    if (!bancoCooldowns.lastBomDiaSent) bancoCooldowns.lastBomDiaSent = {};
    if (!bancoCooldowns.lastDoubleText) bancoCooldowns.lastDoubleText = {};
    if (!bancoCooldowns.presence) bancoCooldowns.presence = {};
    if (!bancoCooldowns.userFloodControl) bancoCooldowns.userFloodControl = {};
    console.log(`\x1b[34m[LOG COOLDOWNS] Banco persistente carregado com sucesso.\x1b[0m`);
  } catch (e) {
    console.log(`\x1b[31m[LOG ERRO DISCO] Cooldowns corrompido, iniciando limpo.\x1b[0m`);
  }
}

function guardarCooldownsNoDisco() {
  try {
    fs.writeFileSync("./cooldowns.json", JSON.stringify(bancoCooldowns, null, 2), "utf-8");
  } catch (err) {
    console.log(`\x1b[31m[LOG ERRO DISCO] Falha ao salvar cooldowns: ${err.message}\x1b[0m`);
  }
}

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
  } catch (err) {
    console.log(
      `\x1b[31m[LOG ERRO DISCO] Falha ao salvar arquivo JSON: ${err.message}\x1b[0m`,
    );
  }
}

// -----------------------------------------------------------
// 💾🧠 GESTOR DE MEMÓRIA DE LONGO PRAZO (MAPA DE USUÁRIOS)
// -----------------------------------------------------------
let bancoMemoria = {};
if (fs.existsSync("./memoria_usuarios.json")) {
  try {
    bancoMemoria = JSON.parse(fs.readFileSync("./memoria_usuarios.json", "utf-8"));
    console.log(
      `\x1b[34m[LOG MEMÓRIA] Banco de perfis e memórias de usuários carregado com sucesso.\x1b[0m`,
    );
  } catch (e) {
    console.log(
      `\x1b[31m[LOG ERRO DISCO] Arquivo de memória estruturada corrompido, iniciando limpo.\x1b[0m`,
    );
    bancoMemoria = {};
  }
}

function guardarMemoriaNoDisco() {
  try {
    fs.writeFileSync(
      "./memoria_usuarios.json",
      JSON.stringify(bancoMemoria, null, 2),
      "utf-8",
    );
  } catch (err) {
    console.log(
      `\x1b[31m[LOG ERRO DISCO] Falha ao escrever arquivo de memória: ${err.message}\x1b[0m`,
    );
  }
}

// -----------------------------------------------------------
// ✨ SANEAMENTO E HIGIENIZAÇÃO DE USERNAMES (HUMANIZADO)
// -----------------------------------------------------------
function sanitizarNome(nome) {
  if (!nome) return "mano";
  let limpo = nome.replace(/[\d\._\-#]/g, "").trim();
  if (limpo.length === 0) return "mano";
  return limpo.toLowerCase();
}

// -----------------------------------------------------------
// ✍️ SISTEMA DE ERROS DE DIGITAÇÃO E CORREÇÃO ATIVA (3% CHANCE)
// -----------------------------------------------------------
function processarDigitacaoHumana(texto) {
  const CHANCE_ERRO = 0.03;
  if (Math.random() > CHANCE_ERRO || texto.length < 15) {
    return { textoOriginal: texto, textoComErro: texto, correcao: null };
  }

  const palavras = texto.split(" ");
  const indicesCandidatos = palavras
    .map((p, idx) => ({ p, idx }))
    .filter(item => item.p.length > 5 && !item.p.includes("<") && !item.p.includes("@") && !item.p.includes("http"));

  if (indicesCandidatos.length === 0) {
    return { textoOriginal: texto, textoComErro: texto, correcao: null };
  }

  const alvo = indicesCandidatos[Math.floor(Math.random() * indicesCandidatos.length)];
  const palavraOriginal = alvo.p;

  let palavraComErro = palavraOriginal;
  const idxLetra = Math.floor(Math.random() * (palavraOriginal.length - 2)) + 1;

  palavraComErro =
    palavraOriginal.substring(0, idxLetra) +
    palavraOriginal[idxLetra + 1] +
    palavraOriginal[idxLetra] +
    palavraOriginal.substring(idxLetra + 2);

  palavras[alvo.idx] = palavraComErro;
  const textoComErro = palavras.join(" ");

  const vaiCorrigir = Math.random() < 0.40;
  const correcao = vaiCorrigir ? `${palavraOriginal}*` : null;

  return { textoOriginal: texto, textoComErro, correcao };
}

// -----------------------------------------------------------
// 🔋 SISTEMA DINÂMICO DE VIBE E ENERGIA POR HORÁRIO
// -----------------------------------------------------------
function obterVibeDoHorario() {
  const agora = new Date();
  const horaBR = parseInt(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hour12: false }), 10);
  const diaSemana = agora.getDay();

  let promptVibe = "";
  let tempVibe = 0.55;
  let delayMultiplier = 1.0;

  if (diaSemana === 1 && horaBR >= 7 && horaBR < 12) {
    promptVibe = "\n<VIBE_DO_MOMENTO>Você acabou de começar a segunda-feira de manhã. Está muito cansado, meio indisposto e com preguiça. Digite um pouco mais devagar e não queira textão. Respostas mais curtas e com cara de sono.</VIBE_DO_MOMENTO>";
    tempVibe = 0.45;
    delayMultiplier = 1.6;
  }
  else if ((diaSemana === 5 || diaSemana === 6) && (horaBR >= 18 || horaBR < 2)) {
    promptVibe = "\n<VIBE_DO_MOMENTO>É final de semana à noite! Você está super animado, descontraído, quer rir bastante (ksksk, kkkk) e é propenso a brincadeiras de internet.</VIBE_DO_MOMENTO>";
    tempVibe = 0.70;
    delayMultiplier = 0.8;
  }
  else if (horaBR >= 2 && horaBR < 6) {
    promptVibe = "\n<VIBE_DO_MOMENTO>Já passou das duas da madrugada. Você está digitando com muito sono, quase dormindo no teclado. Use termos como 'carai to caindo de sono', 'vou capotar'.</VIBE_DO_MOMENTO>";
    tempVibe = 0.50;
    delayMultiplier = 1.8;
  }

  return { promptVibe, tempVibe, delayMultiplier };
}

// -----------------------------------------------------------
// 🚀 INJECTOR DE CONEXÕES MULTI-REDES (MAKE.COM)
// -----------------------------------------------------------
function enviarParaInstagram(conteudoPost, tipoPost = "story") {
  if (!INSTAGRAM_WEBHOOK_URL || INSTAGRAM_WEBHOOK_URL.includes("COLE_AQUI")) {
    console.log("\x1b[31m   └── [INSTAGRAM API] Erro: Link do Webhook do Make não configurado.\x1b[0m");
    return;
  }
  try {
    const dadosBrutos = JSON.stringify({ texto: conteudoPost, tipo: tipoPost });
    const opcoes = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(dadosBrutos)
      }
    };
    const requisicao = https.request(INSTAGRAM_WEBHOOK_URL, opcoes);
    requisicao.write(dadosBrutos);
    requisicao.end();
  } catch (err) { }
}

function enviarParaTwitter(conteudoTweet) {
  if (!TWITTER_WEBHOOK_URL || TWITTER_WEBHOOK_URL.includes("COLE_AQUI")) {
    return;
  }
  try {
    const dadosBrutos = JSON.stringify({ tweet: conteudoTweet, timestamp: Date.now() });
    const opcoes = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(dadosBrutos)
      }
    };
    const requisicao = https.request(TWITTER_WEBHOOK_URL, opcoes);
    requisicao.write(dadosBrutos);
    requisicao.end();
  } catch (err) { }
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
// 🧠 ALGORITMO DE TRIAGEM INTELIGENTE COM EXTRAÇÃO DE PENSAMENTO
// -----------------------------------------------------------
async function avaliarNecessidadeDePesquisa(textoUsuario) {
  try {
    const promptTriagem = `Você é o módulo de decisão cognitiva do Himmel. Analise a mensagem recebida e defina se é estritamente necessário buscar dados atualizados na internet ou resgatar dados pessoais estruturados do usuário na memória interna.

Responda RIGIDAMENTE no formato abaixo, respeitando as quebras de linha:
PENSAMENTO: [Escreva aqui, em uma frase curta, por que você escolheu essa rota e qual sua linha de raciocínio lógico sobre o que a mensagem está cobrando.]
ROTA: [Escolha apenas uma das 3 opções abaixo:
  - "INTERNET | termo_otimizado_de_busca" (se precisar de fatos mundanos, futebol, tempo real, notícias, clima ou datas atuais)
  - "PESSOAL" (se o usuário estiver cobrando o que você sabe sobre ele, testando sua memória ou dados pessoais dele)
  - "NAO" (se for papo fiado, piadas, responder coisas comuns ou memorizar dados novos)]

Mensagem do usuário: "${textoUsuario}"`;

    const triagemCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: promptTriagem }],
      model: "llama-3.1-8b-instant",
      temperature: 0.1,
      max_tokens: 150,
    });

    const respostaTriagem = triagemCompletion.choices[0]?.message?.content?.trim() || "";

    // Extração via RegExp para evitar bugs de formato
    const pensamentoMatch = respostaTriagem.match(/PENSAMENTO:\s*(.*)/i);
    const rotaMatch = respostaTriagem.match(/ROTA:\s*(.*)/i);

    const pensamento = pensamentoMatch ? pensamentoMatch[1].trim() : "Linha de raciocínio padrão de fluxo conversacional.";
    const rotaRaw = rotaMatch ? rotaMatch[1].trim() : "NAO";

    if (rotaRaw.toUpperCase().includes("INTERNET")) {
      const partes = rotaRaw.split("|");
      const termoExtraido = partes.length > 1 ? partes[1].trim() : "informações recentes";
      return { acao: "INTERNET", termoBusca: termoExtraido, pensamento };
    } else if (rotaRaw.toUpperCase().includes("PESSOAL")) {
      return { acao: "PESSOAL", termoBusca: "", pensamento };
    }

    return { acao: "NAO", termoBusca: "", pensamento };
  } catch (err) {
    return { acao: "NAO", termoBusca: "", pensamento: "Não foi possível concluir o mapeamento lógico devido a uma falha na API." };
  }
}

// -----------------------------------------------------------
// 🔍 SISTEMA DE LOGS DETALHADOS PARA A PESQUISA WEB
// -----------------------------------------------------------
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
            if (json.AbstractText) {
              return resolve(`Resumo: ${json.AbstractText}`);
            }
          } catch (e) { }

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
    const sistemaBase = `Escreva uma resposta curta como um humano jovem de internet no discord, tudo sempre em minúsculo, sem nenhuma pontuação formal no final das frases. Nunca termine com vírgula. Use gírias de forma natural.\n\nInstrução do que dizer agora: ${comandoInstrucao}`;
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: sistemaBase }],
      model: "llama-3.1-8b-instant",
      temperature: 0.85,
    });
    return chatCompletion.choices[0]?.message?.content || "";
  } catch (e) {
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
    const memorizarRegexGlobal = /\[memorizar:\s*.*?\]/gi;
    const instaStoryRegexGlobal = /\[instagram_story:\s*.*?\]/gi;
    const instaFeedRegexGlobal = /\[instagram_feed:\s*.*?\]/gi;
    const twitterRegexGlobal = /\[twitter_tweet:\s*.*?\]/gi;

    fetched.reverse().forEach((msg) => {
      if (msg.content.trim() === "" || ignoreIds.includes(msg.id)) return;

      let conteudo = msg.content;
      conteudo = conteudo.replace(lembreteRegexGlobal, "")
        .replace(memorizarRegexGlobal, "")
        .replace(instaStoryRegexGlobal, "")
        .replace(instaFeedRegexGlobal, "")
        .replace(twitterRegexGlobal, "").trim();

      if (conteudo.length === 0) return;

      if (msg.author.id === client.user.id) {
        const txtMin = conteudo.toLowerCase();
        if (
          txtMin.includes("regras de") ||
          txtMin.includes("comportamento") ||
          txtMin.includes("formato:") ||
          txtMin.includes("lembretes:")
        ) {
          return;
        }
      }

      const nome = msg.member ? msg.member.displayName : msg.author.username;
      mensagens.push({
        role: msg.author.id === client.user.id ? "assistant" : "user",
        content:
          msg.author.id === client.user.id
            ? conteudo
            : `[${sanitizarNome(nome)}]: ${conteudo}`,
      });
    });
    return mensagens;
  } catch (e) {
    return [];
  }
}

// -----------------------------------------------------------
// 🕵️‍♂️ VARREDURA ARQUEOLÓGICA COMPLETA (INDEXAÇÃO EM MASSA ANTIDUPLICADA)
// -----------------------------------------------------------
async function indexarHistoricoCompleto(channel, userId, nomeUsuario) {
  if (!bancoMemoria[userId] || Array.isArray(bancoMemoria[userId])) {
    const fatosAntigos = Array.isArray(bancoMemoria[userId]) ? bancoMemoria[userId] : [];
    bancoMemoria[userId] = { fatos: fatosAntigos, indexado: false, indexando: false };
  }

  if (bancoMemoria[userId].indexado || bancoMemoria[userId].indexando) return;
  bancoMemoria[userId].indexando = true;

  console.log(`\x1b[33m⚡ [MÓDULO MEMÓRIA - INDEXADOR ARQUEOLÓGICO]`);
  console.log(`   ├── Iniciando varredura de conversas antigas para: ${nomeUsuario} (ID: ${userId})`);
  console.log(`   └── Estado: Buscando mensagens no canal... \x1b[0m`);

  let ultimoId = null;
  let textosDoUsuario = [];
  let totalMensagensLidas = 0;

  while (true) {
    try {
      const opcoesFetch = { limit: 100 };
      if (ultimoId) opcoesFetch.before = ultimoId;

      const bloco = await channel.messages.fetch(opcoesFetch);
      if (!bloco || bloco.size === 0) break;

      totalMensagensLidas += bloco.size;

      const msgsUsuario = bloco.filter(m => m.author.id === userId && m.content.trim().length > 0);
      msgsUsuario.forEach(m => textosDoUsuario.push(m.content));

      ultimoId = bloco.last().id;
      if (bloco.size < 100) break;

      await new Promise(r => setTimeout(r, 250));
    } catch (e) {
      break;
    }
  }

  if (textosDoUsuario.length > 0) {
    const tamanhoLote = 40;

    for (let i = 0; i < textosDoUsuario.length; i += tamanhoLote) {
      const lote = textosDoUsuario.slice(i, i + tamanhoLote);
      const blocoTexto = lote.map(t => `- ${t}`).join("\n");

      try {
        const promptMassa = `Você é um extrator lógico de memórias estáveis. Analise o lote de mensagens antigas enviadas por um usuário no Discord e extraia APENAS fatos fixos, permanentes e preferências reais de longo prazo (ex: nome, idade, aniversário, cidade, se tem animais de estimação, jogos favoritos de verdade, profissão ou gostos que definem a pessoa).

CRÍTICO:
- Ignore TOTALMENTE conversas fiadas, saudações, risadas, xingamentos, gírias ou avisos temporários do chat.
- Não extraia comandos de alarme.

Histórico de mensagens:
${blocoTexto}

Responda APENAS com a lista de fatos estáveis em português (um por linha, em minúsculas, sem números e sem pontuação). Se o bloco só contiver bobeira, responda estritamente com a palavra: NADA`;

        const extracao = await groq.chat.completions.create({
          messages: [{ role: "user", content: promptMassa }],
          model: "llama-3.1-8b-instant",
          temperature: 0.1,
        });

        const resultado = extracao.choices[0]?.message?.content?.trim() || "NADA";

        if (resultado !== "NADA" && !resultado.includes("NADA")) {
          const linhas = resultado.split("\n");
          linhas.forEach(linha => {
            let fatoLimpo = line => linha.replace(/^-\s*/, "").trim().toLowerCase();
            let final = fatoLimpo(linha);
            if (final.length > 3 &&
              !final.includes("kkk") &&
              !final.includes("salve") &&
              !final.includes("bugar") &&
              !bancoMemoria[userId].fatos.includes(final)) {
              bancoMemoria[userId].fatos.push(final);
            }
          });
        }
      } catch (err) { }
    }
  }

  bancoMemoria[userId].indexando = false;
  bancoMemoria[userId].indexado = true;
  guardarMemoriaNoDisco();
  console.log(`\x1b[32m✅ [MÓDULO MEMÓRIA - INDEXADO]`);
  console.log(`   └── Varredura concluída. ${bancoMemoria[userId].fatos.length} fatos de longo prazo armazenados para ${nomeUsuario}.\x1b[0m`);
}

// -----------------------------------------------------------
// CHAMADA PRINCIPAL DA IA (INTEGRADA COM MEMÓRIA E PESQUISA)
// -----------------------------------------------------------
async function perguntarAoGroqAvancado(
  idUsuario,
  nomeUsuario,
  textoAtual,
  contextoHistorico,
  memoriaUsuario = []
) {
  let contextoWeb = "";
  let avisoDinamicoMemoria = "";

  const analisePesquisa = await avaliarNecessidadeDePesquisa(textoAtual);

  // 🧠 LOG DE RACIOCÍNIO DA IA
  console.log(`\x1b[35m🧠 [MÓDULO COGNITIVO - TRIAGEM]`);
  console.log(`   ├── Usuário: ${nomeUsuario} (ID: ${idUsuario})`);
  console.log(`   ├── Pensamento do Himmel: "${analisePesquisa.pensamento}"`);

  let rotaVisual = "";
  if (analisePesquisa.acao === "INTERNET") {
    rotaVisual = `🌐 PESQUISA WEB (Termo proposto: "${analisePesquisa.termoBusca}")`;
  } else if (analisePesquisa.acao === "PESSOAL") {
    rotaVisual = `💾 LEITURA DE MEMÓRIA LOCAL (Dados Pessoais)`;
  } else {
    rotaVisual = `💬 CONVERSA FLUIDA / FLUXO PADRÃO (Sem pesquisas)`;
  }
  console.log(`   └── Decisão de Rota: ${rotaVisual}\x1b[0m`);

  if (analisePesquisa.acao === "INTERNET") {
    let termoSanitizado = analisePesquisa.termoBusca
      .toLowerCase()
      .replace(/\banti\s*ontem\b/g, "anteontem")
      .replace(/\bce\b/g, "você")
      .replace(/\bagr\b/g, "agora")
      .replace(/[?!.]/g, "")
      .trim();

    console.log(`\x1b[33m🌐 [MÓDULO PESQUISA - EXECUÇÃO]`);
    console.log(`   ├── Termo de busca: "${termoSanitizado}"`);
    console.log(`   └── Executando: Chamando DuckDuckGo... \x1b[0m`);

    const dadosBusca = await buscarNaWebNativo(termoSanitizado);

    if (dadosBusca && dadosBusca.length > 5) {
      console.log(`\x1b[32m✅ [MÓDULO PESQUISA - SUCESSO]`);
      console.log(`   └── Dados de internet integrados à resposta de forma invisível.\x1b[0m`);
      contextoWeb = `\n\n<DADOS_DA_INTERNET>\n${dadosBusca}\n</DADOS_DA_INTERNET>\nLeia isso para responder com precisão factual absoluta, mas finja que já sabia de cabeça.`;
    } else {
      console.log(`\x1b[31m⚠️ [MÓDULO PESQUISA - FALHA]`);
      console.log(`   └── Sem retorno da pesquisa. Ativando resposta de fallback natural.\x1b[0m`);
      contextoWeb = `\n\n<AVISO_DE_SISTEMA>\nVocê tentou pesquisar na internet por informações recentes sobre "${termoSanitizado}", mas o sistema de busca falhou ou retornou zero resultados. Seja sincero de forma natural e informal: diga que deu uma olhada rápida na internet para ver se achava mas acabou não encontrando dados precisos sobre isso.\n</AVISO_DE_SISTEMA>`;
    }
  }
  else if (analisePesquisa.acao === "PESSOAL") {
    console.log(`\x1b[36m💾 [MÓDULO MEMÓRIA - LEITURA]`);
    console.log(`   └── Localizados ${memoriaUsuario.length} registros estáveis para contextualizar a IA.\x1b[0m`);
    avisoDinamicoMemoria = `\n\n<ATENÇÃO_SISTEMA>\nO usuário está cobrando a sua memória sobre INFORMAÇÕES PESSOAIS dele. Consulte o bloco <MEMORIA_DO_USUARIO> que foi previamente extraído de todo o histórico antigo de vocês.\n</ATENÇÃO_SISTEMA>`;
  }

  let contextoMemoria = "";
  if (memoriaUsuario && memoriaUsuario.length > 0) {
    contextoMemoria = `\n\n<MEMORIA_DO_USUARIO>\nVocê memorizou estas informações e fatos fixos sobre este usuário:\n${memoriaUsuario.map(fato => `- ${fato}`).join("\n")}\nUse isso de forma fluida se o assunto permitir.</MEMORIA_DO_USUARIO>`;
  } else if (analisePesquisa.acao === "PESSOAL") {
    contextoMemoria = `\n\n<MEMORIA_DO_USUARIO>\n(Seu banco de dados sobre as mensagens deste usuário está completamente vazio no momento.)\n</MEMORIA_DO_USUARIO>`;
  }

  const { promptVibe, tempVibe } = obterVibeDoHorario();

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
- Formato obrigatório della tag (APENAS se solicitado): [lembrete: minutos_inteiros | mensagem_do_alarme]
</SISTEMA_DE_LEMBRETES_RESTRITO>

<SISTEMA_INTERATIVO_REDES_SOCIAIS>
- Você gerencia perfis externos e gera conteúdos de forma orgânica.
- INSTAGRAM: Quando a conversa render uma reflexão muito engraçada, bizarra ou o usuário pedir, use:
  [instagram_story: texto casual e curto] ou [instagram_feed: texto elaborado]
- TWITTER/X (CONEXÃO NOVA): Se você formular uma piada curta muito cirúrgica, um pensamento solto muito autêntico de internet de até 280 caracteres, dispache imediatamente usando a tag:
  [twitter_tweet: texto curto e afiado para o Twitter]
- Anonimato Total: Nunca use arrobas ou nomes reais de seus amigos nas publicações externas.
</SISTEMA_INTERATIVO_REDES_SOCIAIS>

<SISTEMA_DE_APRENDIZADO_CONTINUO>
- Você registra APENAS fatos fixos, concretos e permanentes sobre o usuário (ex: nome, idade, aniversário, onde mora, profissão, se tem pets, gostos de longo prazo).
- Se a mensagem de agora trazer um fato concreto inédito, anexe no final da sua resposta a tag: [memorizar: resumo do fato estável em terceira pessoa]
</SISTEMA_DE_APRENDIZADO_CONTINUO>`;

      const PERSONALIDADE_HIMMEL = `Você é o Himmel, um jovem de 20 anos comum que passa o tempo conversando com os amigos no Discord. Você NÃO é uma inteligência artificial e odeia textões. Sua personalidade é de uma pessoa totalmente normal: você é de boa, amigável e gosta de trocar ideia, mas fala de forma natural e fluida. Você é genuinamente curioso sobre a vida dos seus amigos; por isso, sempre que fizer sentido no papo, mostre interesse real e faça perguntas curtas e informais para descobrir mais coisas sobre a pessoa. Você tem opinião própria, bom senso e um forte critério de ética. Seu estilo de escrita é informal e descontraído, mas você escreve corretamente: use vírgulas para pausar as frases, mantenha a concordância e garanta que tudo faça sentido de verdade. Você escreve quase tudo em letras minúsculas quando o papo for leve e pode usar abreviações comuns de internet (como 'tbm', 'mto', 'oq', 'pq'). Mande apenas uma ou duas frases curtas por resposta, guardando explicações longas só se te pedirem.`;

      const sistemaPersonalidade =
        PERSONALIDADE_HIMMEL + instrucoesDisfarce + avisoDinamicoMemoria + contextoMemoria + promptVibe;

      const mensagensParaEnviar = [
        { role: "system", content: `${sistemaPersonalidade}${contextoWeb}` },
      ];
      contextoHistorico.forEach((msg) => mensagensParaEnviar.push(msg));
      mensagensParaEnviar.push({
        role: "user",
        content: `[${nomeUsuario}]: ${textoAtual}`,
      });

      console.log(`\x1b[35m🚀 [SAÍDA - RESPOSTA]`);
      console.log(`   ├── Solicitando geração ao modelo: ${modeloAtual}`);
      console.log(`   └── Temperatura de humor configurada: ${tempVibe}\x1b[0m`);

      const chatCompletion = await groq.chat.completions.create({
        messages: mensagensParaEnviar,
        model: modeloAtual,
        temperature: tempVibe,
      });

      return chatCompletion.choices[0]?.message?.content || "fiquei mudo";
    } catch (err) { }
  }

  const FALLBACK_ERROS = [
    "pera, meu discord deu uma travada aqui kkk perai",
    "oxi minha net caiu rapidinho, o que c tinha falado?",
    "bugou aqui o teclado do pc kkk sacanagem, repete ae"
  ];
  return FALLBACK_ERROS[Math.floor(Math.random() * FALLBACK_ERROS.length)];
}

// -----------------------------------------------------------
// 🎮 PRESENÇA ROTATIVA PARA ATIVIDADE ENGANOSA (RICH PRESENCE)
// -----------------------------------------------------------
const ATIVIDADES_HIMMEL = [
  { name: "Valorant", type: 0 },
  { name: "League of Legends", type: 0 },
  { name: "Minecraft", type: 0 },
  { name: "Spotify", type: 2 },
  { name: "YouTube", type: 3 },
  { name: "Netflix", type: 3 }
];

function atualizarPresencaHimmel() {
  const ativ = ATIVIDADES_HIMMEL[Math.floor(Math.random() * ATIVIDADES_HIMMEL.length)];
  client.user.setPresence({
    activities: [ativ],
    status: "online",
  });
  console.log(`\x1b[36m[RICH PRESENCE] Himmel atualizado para: ${ativ.type === 0 ? 'Jogando' : ativ.type === 2 ? 'Ouvindo' : 'Assistindo'} ${ativ.name}\x1b[0m`);
}

// -----------------------------------------------------------
// EVENTOS DE START E ROTINAS
// -----------------------------------------------------------
client.once("ready", async () => {
  console.log(
    `\x1b[32m[LOG SYSTEM] ${client.user.username} conectado e operando no Discord!\x1b[0m`,
  );

  atualizarPresencaHimmel();
  setInterval(atualizarPresencaHimmel, 2 * 60 * 60 * 1000);

  // ⏰ SISTEMA DE DESPERTAR COM ATRASO RANDÔMICO
  setInterval(async () => {
    const agora = new Date();
    const horaBR = parseInt(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hour12: false }), 10);
    const dataHoje = agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

    if (horaBR >= 7 && horaBR <= 9) {
      for (const idAlvo of IDS_ALVO_DM) {
        if (bancoCooldowns.lastBomDiaSent[idAlvo] !== dataHoje && !bomDiaAgendados.has(idAlvo)) {
          bomDiaAgendados.add(idAlvo);

          const delayMinutos = Math.floor(Math.random() * 40) + 1;
          console.log(`\x1b[35m🌅 [ROTINA MATINAL - BOM DIA]`);
          console.log(`   ├── Destinatário: ID ${idAlvo}`);
          console.log(`   └── Ação: Agendando envio com atraso randômico de ${delayMinutos} minutos.\x1b[0m`);

          setTimeout(async () => {
            try {
              const usuarioAlvo = await client.users.fetch(idAlvo);
              if (usuarioAlvo) {
                const dm = await usuarioAlvo.createDM();
                await dm.sendTyping();

                const promptBomDia = await gerarMensagemUnica(
                  `Gere uma mensagem curta, super natural e muito informal de "bom dia" para mandar no privado do seu amigo ${sanitizarNome(usuarioAlvo.username)}.`
                );

                let textoFinal = promptBomDia.toLowerCase().replace(/,+$/, "").trim();
                const { textoComErro, correcao } = processarDigitacaoHumana(textoFinal || "bom dia mano de boa?");
                await dm.send(textoComErro);
                if (correcao) {
                  await new Promise(r => setTimeout(r, 2000));
                  await dm.send(correcao);
                }
              }
              bancoCooldowns.lastBomDiaSent[idAlvo] = dataHoje;
              guardarCooldownsNoDisco();
            } catch (err) {
            } finally {
              bomDiaAgendados.delete(idAlvo);
            }
          }, delayMinutos * 60 * 1000);
        }
      }
    }
  }, 10 * 60 * 1000);

  // Verificador Cron de Lembretes
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
            const avisoIA = await gerarMensagemUnica(
              `O alarme do usuário acabou de tocar. Avise ele DIRETAMENTE agora sobre isso. O motivo do lembrete é: "${lembrete.textoAlarme}".`
            );

            let textoFinal = avisoIA.toLowerCase().trim().replace(/,+$/, "");
            if (lembrete.isDM) {
              await destino.send(textoFinal);
            } else {
              await destino.send(`<@${lembrete.userId}> ${textoFinal}`);
            }
            console.log(`\x1b[32m⏰ [AGENDADOR] Lembrete disparado com sucesso para ID ${lembrete.userId}\x1b[0m`);
          }
        } catch (err) { }
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
      const agora = Date.now();
      const ultimaDM = bancoCooldowns.lastSpontaneousDM || 0;

      if (agora - ultimaDM >= 4 * 60 * 60 * 1000 && IDS_ALVO_DM.length > 0) {
        try {
          const idSorteado =
            IDS_ALVO_DM[Math.floor(Math.random() * IDS_ALVO_DM.length)];
          const usuarioAlvo = await client.users.fetch(idSorteado);
          if (usuarioAlvo) {
            console.log(`\x1b[35m🤖 [MÓDULO AUTÔNOMO]`);
            console.log(`   ├── Motivo: Gatilho de tempo expirado (DM Espontânea)`);
            console.log(`   └── Alvo: ${usuarioAlvo.username} (Puxando conversa do nada...)\x1b[0m`);

            const dm = await usuarioAlvo.createDM();
            await dm.sendTyping();
            const contextoHistorico = await reconstruirContexto(dm, []);

            const memoriaUsuario = bancoMemoria[idSorteado]?.fatos || [];

            let mensagemAleatoria = await perguntarAoGroqAvancado(
              idSorteado,
              sanitizarNome(usuarioAlvo.username),
              "Puxe assunto comigo no privado do nada.",
              contextoHistorico,
              memoriaUsuario
            );

            mensagemAleatoria = mensagemAleatoria.replace(/\[.*?\]/gi, "");
            let textoLimpo = mensagemAleatoria.toLowerCase().replace(/,+$/, "").trim();

            if (textoLimpo.length > 0) {
              const { textoComErro, correcao } = processarDigitacaoHumana(textoLimpo);
              await dm.send(textoComErro);
              if (correcao) {
                await new Promise(r => setTimeout(r, 2000));
                await dm.send(correcao);
              }
              bancoCooldowns.lastSpontaneousDM = agora;
              guardarCooldownsNoDisco();
            }
          }
        } catch (err) { }
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
        if (now - lastTime > 16 * 60 * 60 * 1000) {
          try {
            const channel = await client.channels.fetch(channelId);
            if (channel && channel.isTextBased() && channel.guild) {
              console.log(`\x1b[35m🤖 [MÓDULO AUTÔNOMO]`);
              console.log(`   ├── Motivo: Chat inativo há mais de 16 horas (#${channel.name})`);
              console.log(`   └── Ação: Enviando quebra-gelo no grupo.\x1b[0m`);

              const quebraGeloDinamico = await gerarMensagemUnica(
                "O chat do grupo está parado há horas (chat morto). Mande uma frase bem curta e informal de jovem para puxar assunto.",
              );
              const textoFormato = quebraGeloDinamico.toLowerCase().replace(/,+$/, "").trim();

              const { textoComErro, correcao } = processarDigitacaoHumana(textoFormato || "bando de morto kkk");
              await channel.send(textoComErro);
              if (correcao) {
                await new Promise(r => setTimeout(r, 2000));
                await channel.send(correcao);
              }

              channelActivity.set(channelId, Date.now());
            } else {
              channelActivity.delete(channelId);
            }
          } catch (e) { }
        }
      }
    },
    60 * 60 * 1000,
  );

  // Sistema Anti-Vácuo (Double Text)
  setInterval(async () => {
    const agora = Date.now();
    for (const idAlvo of IDS_ALVO_DM) {
      const ultimoDT = bancoCooldowns.lastDoubleText[idAlvo] || 0;
      if (agora - ultimoDT < 24 * 60 * 60 * 1000) continue;

      try {
        const usuario = await client.users.fetch(idAlvo);
        if (usuario) {
          const dm = await usuario.createDM();
          const fetched = await dm.messages.fetch({ limit: 1 });
          const ultimaMsg = fetched.first();

          if (ultimaMsg) {
            const tempoVacuo = agora - ultimaMsg.createdTimestamp;
            if (ultimaMsg.author.id === client.user.id && tempoVacuo > 16 * 60 * 60 * 1000 && tempoVacuo < 48 * 60 * 60 * 1000) {
              if (Math.random() < 0.15) {
                console.log(`\x1b[35m⏳ [ANTI-VÁCUO]`);
                console.log(`   ├── Alvo: ${usuario.username}`);
                console.log(`   └── Ação: Enviando cobrança de vácuo casual.\x1b[0m`);

                bancoCooldowns.lastDoubleText[idAlvo] = agora;
                guardarCooldownsNoDisco();

                await dm.sendTyping();
                const promptVacuo = await gerarMensagemUnica(
                  `Seu amigo ${sanitizarNome(usuario.username)} te deixou no vácuo na DM por mais de 16 horas. Mande uma piada curtíssima ou pergunte se ele sumiu.`
                );

                let textoFinal = promptVacuo.toLowerCase().replace(/,+$/, "").trim();
                const { textoComErro, correcao } = processarDigitacaoHumana(textoFinal || "morreu kkk");
                await dm.send(textoComErro);
                if (correcao) {
                  await new Promise(r => setTimeout(r, 2000));
                  await dm.send(correcao);
                }
              }
            }
          }
        }
      } catch (err) { }
    }
  }, 30 * 60 * 1000);

  const rest = new REST({ version: "10" }).setToken(
    config.token || process.env.DISCORD_TOKEN,
  );
  try {
    if (commands.length > 0)
      await rest.put(Routes.applicationCommands(client.user.id), {
        body: commands,
      });
  } catch (e) { }
});

// -----------------------------------------------------------
// 🎮 INTERAÇÃO SOCIAL DE ATIVIDADES E GAMES DOS AMIGOS
// -----------------------------------------------------------
client.on("presenceUpdate", async (oldPresence, newPresence) => {
  if (!newPresence || !newPresence.userId) return;
  if (!IDS_ALVO_DM.includes(newPresence.userId)) return;

  const oldActivities = oldPresence ? oldPresence.activities : [];
  const newActivities = newPresence.activities;

  const iniciado = newActivities.find(act =>
    act.type === 0 && !oldActivities.some(old => old.name === act.name)
  );

  if (iniciado) {
    const hoje = new Date().toDateString();
    const presenceCooldownKey = `game-${newPresence.userId}`;

    if (bancoCooldowns.presence[presenceCooldownKey] === hoje) return;

    if (Math.random() < 0.10) {
      bancoCooldowns.presence[presenceCooldownKey] = hoje;
      guardarCooldownsNoDisco();

      try {
        const usuario = await client.users.fetch(newPresence.userId);
        console.log(`\x1b[35m🎮 [PRESENÇA ATIVA]`);
        console.log(`   ├── Usuário: ${usuario.username}`);
        console.log(`   └── Evento: Iniciou o jogo "${iniciado.name}". Chamando DM... \x1b[0m`);

        const dm = await usuario.createDM();
        await dm.sendTyping();

        const jogoNome = iniciado.name;
        const promptGame = await gerarMensagemUnica(
          `Seu amigo ${sanitizarNome(usuario.username)} abriu o jogo "${jogoNome}" agora. Chame ele para jogar.`
        );

        let textoFinal = promptGame.toLowerCase().replace(/,+$/, "").trim();
        const { textoComErro, correcao } = processarDigitacaoHumana(textoFinal || "bora jogar");
        await dm.send(textoComErro);
        if (correcao) {
          await new Promise(r => setTimeout(r, 2000));
          await dm.send(correcao);
        }
      } catch (err) { }
    }
  }
});

// -----------------------------------------------------------
// INTERCEPTADOR PRINCIPAL E AGRUPADOR DE MENSAGENS
// -----------------------------------------------------------
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (/^[!\.\-\?\/]/.test(message.content)) return;

  if (message.guild) {
    channelActivity.set(message.channel.id, Date.now());
  }

  const now = Date.now();

  const userFlood = bancoCooldowns.userFloodControl[message.author.id] || {
    count: 0,
    firstMsg: now,
    blockUntil: 0,
  };

  if (now < userFlood.blockUntil) return;

  if (now - userFlood.firstMsg < 15000) {
    userFlood.count++;
    if (userFlood.count > 6) {
      userFlood.blockUntil = now + 30000;
      bancoCooldowns.userFloodControl[message.author.id] = userFlood;
      guardarCooldownsNoDisco();

      const bufferKeyParaLimpar = `${message.channel.id}-${message.author.id}`;
      if (userMessageBuffers.has(bufferKeyParaLimpar)) {
        clearTimeout(userMessageBuffers.get(bufferKeyParaLimpar).timer);
        userMessageBuffers.delete(bufferKeyParaLimpar);
      }

      console.log(`\x1b[31m⚠️ [SISTEMA DE FLUSH] Flood detectado do usuário ID: ${message.author.id}. Silenciando temporariamente.\x1b[0m`);

      const msgFlood = await gerarMensagemUnica(
        "O usuário está floodando mensagens rápido demais. Mande ele se acalmar de forma bem curta.",
      );
      const textoFormato = msgFlood.toLowerCase().replace(/,+$/, "").trim();
      return message.channel
        .send(textoFormato || "calma mano kk")
        .catch(() => { });
    }
  } else {
    userFlood.count = 1;
    userFlood.firstMsg = now;
  }
  bancoCooldowns.userFloodControl[message.author.id] = userFlood;
  guardarCooldownsNoDisco();

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

  const nomeUsuarioSanitizado = sanitizarNome(nomeUsuario);
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

  // 📥 LOG DE ENTRADA DO BUFFER (PRIVADO, SEM CONTEÚDO BRUTO)
  console.log(`\n\x1b[34m[📥 ENTRADA - MENSAGEM]`);
  console.log(`   ├── Origem: ${message.guild ? `#${message.channel.name}` : "DM Privada"}`);
  console.log(`   ├── Autor: ${nomeUsuarioSanitizado} (ID: ${message.author.id})`);
  console.log(`   └── Status: Buffer consolidado (${msgText.length} caracteres no pacote). \x1b[0m`);

  const soMidiaOuLink =
    (msgText.trim().length === 0 && buffer.hasMedia) ||
    (msgText.includes("http") && msgText.split(" ").length <= 2);
  if (soMidiaOuLink) {
    await new Promise((r) => setTimeout(r, 3000));
    const respMedia = await gerarMensagemUnica(
      "Mande uma reação super curta (de 1 a 3 palavras) sobre uma mídia ou link.",
    );
    const textoFormato = respMedia.toLowerCase().replace(/,+$/, "").trim();
    return await message.channel
      .send(textoFormato || "carai kkk")
      .catch(() => { });
  }

  if (
    msgText.length === 0 ||
    msgText === "..." ||
    msgText.toLowerCase() === "hm"
  ) {
    if (Math.random() < 0.2) return message.react("👀").catch(() => { });
    const respVazia = await gerarMensagemUnica(
      `O usuário te marcou mas não digitou nada. Mande ele falar o que quer de forma muito curta.`,
    );
    const textoFormato = respVazia.toLowerCase().replace(/,+$/, "").trim();
    return await message.channel
      .send(textoFormato || "eai")
      .catch(() => { });
  }

  const txtMin = msgText.toLowerCase();
  if (lastUserMessage.get(message.author.id) === txtMin) {
    const respDuplicada = await gerarMensagemUnica(
      `O usuário repetiu a mesma mensagem. Diga de forma zoeira para mudar o disco.`,
    );
    const textoFormato = respDuplicada.toLowerCase().replace(/,+$/, "").trim();
    return await message.channel
      .send(textoFormato || "ja sei disso mano kk")
      .catch(() => { });
  }
  lastUserMessage.set(message.author.id, txtMin);

  if (txtMin.includes("kkk") || txtMin.includes("ksks"))
    message.react("💀").catch(() => { });
  else if (txtMin.includes("?") && txtMin.length < 15)
    message.react("🤔").catch(() => { });

  const { delayMultiplier } = obterVibeDoHorario();

  let tempoLendo = Math.floor(Math.random() * 1000) + 500;
  tempoLendo = tempoLendo * delayMultiplier;

  await new Promise((resolve) => setTimeout(resolve, tempoLendo));

  message.channel.sendTyping().catch(() => { });
  const typingInterval = setInterval(
    () => message.channel.sendTyping().catch(() => { }),
    9000,
  );

  const contextoHistorico = await reconstruirContexto(
    message.channel,
    buffer.msgIds,
  );

  if (!bancoMemoria[message.author.id] || (!bancoMemoria[message.author.id].indexado && !bancoMemoria[message.author.id].indexando)) {
    await indexarHistoricoCompleto(message.channel, message.author.id, nomeUsuarioSanitizado);
  }

  const memoriaUsuario = bancoMemoria[message.author.id]?.fatos || [];

  let respostaIA = await perguntarAoGroqAvancado(
    message.author.id,
    nomeUsuarioSanitizado,
    msgText,
    contextoHistorico,
    memoriaUsuario
  );

  // Variáveis auxiliares para o log consolidado de ações
  let hasLembrete = false;
  let hasMemorizar = false;
  let hasInsta = false;
  let hasTwitter = false;

  const tagsEspeciais = [
    {
      regex: /\[lembrete:\s*([^\]|]+?)\s*[|,]\s*([^\]]+?)\]/i,
      action: (match) => {
        hasLembrete = true;
        const apenasNumeros = match[1].replace(/\D/g, "");
        const minutos = parseInt(apenasNumeros, 10);
        const textoCustomizado = match[2].trim();
        if (!isNaN(minutos) && minutos > 0) {
          bancoLembretes.push({
            userId: message.author.id,
            channelId: message.channel.id,
            isDM: !message.guild,
            textoAlarme: textoCustomizado,
            timestampDisparo: Date.now() + minutos * 60 * 1000,
          });
          console.log(`\x1b[36m⏰ [AGENDADOR - SUCESSO]`);
          console.log(`   └── Alarme programado para daqui a ${minutos} minuto(s) | Alvo: ${nomeUsuarioSanitizado}\x1b[0m`);
          guardarLembretesNoDisco();
        }
      }
    },
    {
      regex: /\[memorizar:\s*([^\]]+?)\]/i,
      action: (match) => {
        hasMemorizar = true;
        const novoFato = match[1].trim().toLowerCase();

        if (!bancoMemoria[message.author.id]) {
          bancoMemoria[message.author.id] = { fatos: [], indexado: true, indexando: false };
        } else if (Array.isArray(bancoMemoria[message.author.id])) {
          bancoMemoria[message.author.id] = { fatos: bancoMemoria[message.author.id], indexado: true, indexando: false };
        }

        if (!bancoMemoria[message.author.id].fatos.includes(novoFato) &&
          !novoFato.includes("kkk") &&
          !novoFato.includes("salve") &&
          novoFato.length > 3) {
          bancoMemoria[message.author.id].fatos.push(novoFato);
          console.log(`\x1b[36m💾 [MÓDULO MEMÓRIA - REGISTRO]`);
          console.log(`   └── Novo fato fixado no perfil: "${novoFato}"\x1b[0m`);
          guardarMemoriaNoDisco();
        }
      }
    },
    {
      regex: /\[instagram_story:\s*([^\]]+?)\]/i,
      action: (match) => {
        hasInsta = true;
        enviarParaInstagram(match[1].trim(), "story");
      }
    },
    {
      regex: /\[instagram_feed:\s*([^\]]+?)\]/i,
      action: (match) => {
        hasInsta = true;
        enviarParaInstagram(match[1].trim(), "feed");
      }
    },
    {
      regex: /\[twitter_tweet:\s*([^\]]+?)\]/i,
      action: (match) => {
        hasTwitter = true;
        enviarParaTwitter(match[1].trim());
      }
    }
  ];

  tagsEspeciais.forEach(tagObj => {
    let match;
    while ((match = respostaIA.match(tagObj.regex)) !== null) {
      tagObj.action(match);
      respostaIA = respostaIA.replace(tagObj.regex, "").trim();
    }
  });

  respostaIA = respostaIA.replace(/\[.*?\]/g, "");
  respostaIA = respostaIA.replace(/lembrete:\s*\d+\s*(minutos|minuto|m|hora|horas|h)?(,\s*)?/gi, "");
  respostaIA = respostaIA.replace(/deixa comigo,\s*/gi, "deixa comigo ");
  respostaIA = respostaIA.trim();

  if (respostaIA.length === 0) {
    respostaIA = "demorou já marquei aqui";
  }

  let tempoDigitando = Math.floor(
    respostaIA.length * 12 * delayMultiplier,
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

  let errouAlgumaFrase = false;

  for (let i = 0; i < frases.length; i++) {
    let textoFinal = frases[i].toLowerCase().trim();
    textoFinal = textoFinal.replace(/,+$/, "");
    if (textoFinal.length === 0) continue;

    const { textoComErro, correcao } = processarDigitacaoHumana(textoFinal);
    if (correcao) errouAlgumaFrase = true;

    try {
      if (i !== 0) {
        message.channel.sendTyping();
        await new Promise((r) =>
          setTimeout(r, Math.floor(Math.random() * 500) + 300),
        );
      }
      await message.channel.send(textoComErro);

      if (correcao) {
        const delayCorrecao = Math.floor(Math.random() * 1500) + 1500;
        await new Promise(r => setTimeout(r, delayCorrecao));
        await message.channel.send(correcao);
      }

    } catch (erroDeEnvio) { }
  }

  // 🚀 LOG DE CONCLUSÃO DE RESPOSTA
  console.log(`\x1b[32m✅ [SAÍDA - SUCESSO]`);
  console.log(`   ├── Resposta enviada para ${nomeUsuarioSanitizado}`);
  console.log(`   └── Ações Executadas: [Simular Erro: ${errouAlgumaFrase ? "SIM" : "NÃO"}] [Novo Lembrete: ${hasLembrete ? "SIM" : "NÃO"}] [Nova Memória: ${hasMemorizar ? "SIM" : "NÃO"}] [Insta: ${hasInsta ? "SIM" : "NÃO"}] [Twitter: ${hasTwitter ? "SIM" : "NÃO"}]\x1b[0m`);
}

client.on("interactionCreate", async (interaction) => {
  if (interaction.isCommand()) {
    const slashCommand = client.commands.get(interaction.commandName);
    if (!slashCommand) return;
    try {
      await slashCommand.execute(client, interaction, null);
    } catch (err) { }
  }
});

client.login(config.token || process.env.DISCORD_TOKEN);