import fs from 'node:fs';
import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  ChannelType,
  MessageFlags
} from 'discord.js';
import OpenAI from 'openai';

/* ------------------------ Discord Client ------------------------ */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    // Nur aktivieren, wenn du Auto-Replies im Kanal brauchst:
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

/* ------------------------ Lokale KI (Ollama) ------------------------ */
const baseURL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
const CHAT_MODEL = process.env.MODEL || 'llama3.2:3b-instruct';         // schneller Standard
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';       // für KB-Embeddings

// Dummy-Key reicht bei Ollama
const openai = new OpenAI({ apiKey: process.env.OLLAMA_API_KEY || 'ollama', baseURL });

/* ------------------------ KB / RAG Setup ------------------------ */
const KB_PATH = process.env.KB_PATH || './kb.json';
const KB_INDEX_PATH = process.env.KB_INDEX_PATH || './kb.index.json';

function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJSON(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }

let KB = [];
let KB_INDEX = { model: EMBED_MODEL, vectors: [] };

async function ensureKbIndex() {
  if (!fs.existsSync(KB_PATH)) {
    console.warn(`⚠️ KB-Datei fehlt: ${KB_PATH} – lege eine kb.json an.`);
    KB = [];
    KB_INDEX = { model: EMBED_MODEL, vectors: [] };
    return;
  }
  KB = readJSON(KB_PATH);

  // Index laden, wenn vorhanden & Modell passt
  if (fs.existsSync(KB_INDEX_PATH)) {
    const idx = readJSON(KB_INDEX_PATH);
    if (idx?.model === EMBED_MODEL && Array.isArray(idx?.vectors)) {
      KB_INDEX = idx;
      console.log(`KB-Index geladen (${KB_INDEX.vectors.length} Einträge).`);
      return;
    }
  }

  // Neu indizieren
  await rebuildKbIndex();
}

async function rebuildKbIndex() {
  if (!KB.length) {
    if (fs.existsSync(KB_PATH)) KB = readJSON(KB_PATH);
    if (!KB.length) {
      KB_INDEX = { model: EMBED_MODEL, vectors: [] };
      writeJSON(KB_INDEX_PATH, KB_INDEX);
      console.log('KB leer – Index ist leer.');
      return;
    }
  }

  console.log(`KB wird indiziert (${KB.length} Einträge) …`);
  const texts = KB.map(e => e.content);
  const res = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: texts
  });
  const vectors = res.data.map((d, i) => ({
    id: KB[i].id,
    title: KB[i].title,
    tags: KB[i].tags,
    embedding: d.embedding
  }));
  KB_INDEX = { model: EMBED_MODEL, vectors };
  writeJSON(KB_INDEX_PATH, KB_INDEX);
  console.log(`KB-Index erstellt (${vectors.length} Vektoren).`);
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

async function queryKB(query, topK = 3) {
  if (!KB_INDEX?.vectors?.length) return null;

  const qr = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: [query]
  });
  const qv = qr.data[0].embedding;

  const scored = KB_INDEX.vectors
    .map(v => ({ v, s: cosine(qv, v.embedding) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, topK);

  const ids = new Set(scored.map(x => x.v.id));
  const picks = KB.filter(e => ids.has(e.id));
  const ctx = picks.map(e => `# ${e.title}\n${e.content}`).join('\n\n');

  return ctx || null;
}

/* ------------------------ Slash Commands ------------------------ */
const commands = [
  {
    name: 'ask',
    description: 'Stelle eine technische Frage',
    options: [{ name: 'frage', description: 'Deine Frage', type: 3, required: true }]
  },
  {
    name: 'ticket',
    description: 'Neues Support-Ticket eröffnen',
    options: [{ name: 'thema', description: 'Kurzthema', type: 3, required: true }]
  },
  { name: 'close', description: 'Ticket schließen (nur im Ticket-Thread)' },
  { name: 'kb-reindex', description: 'KB neu indizieren (Admin)' },
  { name: 'kb-info', description: 'Zeigt KB-Statistik' }
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const appId = (await client.application?.fetch())?.id || client.user.id;
  await rest.put(
    Routes.applicationGuildCommands(appId, process.env.GUILD_ID),
    { body: commands }
  );
}

/* ------------------------ LLM Helper ------------------------ */
async function askLocalLLM(prompt, kbHit = null, { maxTokens = 220, timeoutMs = 60000, retries = 1 } = {}) {
  const sys =
`Du bist ein sachlicher, hilfsbereiter Firmen-Support-Bot.
- Antworte auf Deutsch, kurz und präzise.
- Nutze die Wissensbasis (KB), wenn vorhanden. Erfinde nichts.
- Wenn du unsicher bist, schlage Eskalation an einen Menschen vor.`;

  const kbContext = kbHit ?? await queryKB(prompt);

  const messages = [
    { role: 'system', content: sys },
    kbContext ? { role: 'system', content: `<<KB>>\n${kbContext}` } : null,
    { role: 'user', content: prompt }
  ].filter(Boolean);

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await openai.chat.completions.create({
        model: CHAT_MODEL,
        messages,
        temperature: 0.2,
        max_tokens: maxTokens,
        stream: false
      }, { signal: controller.signal });

      clearTimeout(timer);
      return res.choices?.[0]?.message?.content?.trim() || 'Keine Antwort erstellt.';
    } catch (err) {
      clearTimeout(timer);
      if (attempt === retries) {
        const aborted = err?.name === 'AbortError';
        throw new Error(aborted ? 'Zeitüberschreitung beim lokalen Modell.' : (err?.message || 'Lokaler KI-Request fehlgeschlagen.'));
      }
      await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
    }
  }
}

function isTicketThread(channel) {
  return channel?.type === ChannelType.PublicThread || channel?.type === ChannelType.PrivateThread;
}

/* ------------------------ Events ------------------------ */
client.on('ready', async () => {
  console.log(`Eingeloggt als ${client.user.tag}`);
  await ensureKbIndex().catch(console.error);
  await registerCommands().catch(console.error);
});

client.on('interactionCreate', async (i) => {
  try {
    if (!i.isChatInputCommand()) return;

    // /ask
    if (i.commandName === 'ask') {
      const frage = i.options.getString('frage', true);
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const answer = await askLocalLLM(frage, null);
        await i.editReply({ content: answer });
      } catch (e) {
        await i.editReply({ content: `⚠️ ${String(e?.message || 'Lokale KI nicht erreichbar.')}` });
      }
    }

    // /ticket
    if (i.commandName === 'ticket') {
      const thema = i.options.getString('thema', true);
      await i.deferReply({ flags: MessageFlags.Ephemeral });

      const ch = await i.guild.channels.fetch(process.env.SUPPORT_CHANNEL_ID);
      const ticketMsg = await ch.send(`🎫 Ticket von <@${i.user.id}> – **${thema}**`);
      const thread = await ticketMsg.startThread({
        name: `ticket-${i.user.username}-${Date.now().toString().slice(-4)}`,
        autoArchiveDuration: 1440
      });

      await thread.members.add(i.user.id);
      if (process.env.SUPPORT_ROLE_ID) await thread.send(`🔔 <@&${process.env.SUPPORT_ROLE_ID}>`);
      await thread.send(`Hi <@${i.user.id}>, ich helfe dir. Bitte beschreibe kurz dein Problem, System/Version und was du schon probiert hast.`);

      await i.editReply({ content: `Ticket erstellt: ${thread.toString()}` });
    }

    // /close
    if (i.commandName === 'close') {
      if (!isTicketThread(i.channel)) {
        return i.reply({ content: 'Bitte in einem Ticket-Thread verwenden.', flags: MessageFlags.Ephemeral });
      }
      await i.deferReply({ flags: MessageFlags.Ephemeral });

      const msgs = await i.channel.messages.fetch({ limit: 30 });
      const concat = msgs
        .map(m => `${m.author.bot ? '[BOT]' : m.author.username}: ${m.content}`)
        .reverse()
        .join('\n')
        .slice(-4000);

      try {
        const summary = await askLocalLLM(`Fasse dieses Ticket kurz zusammen und nenne ggf. nächste Schritte:\n${concat}`);
        await i.channel.send(`✅ Ticket geschlossen.\n**Zusammenfassung:**\n${summary}`);
        await i.editReply({ content: 'Ticket geschlossen.' });
      } catch (e) {
        await i.editReply({ content: `⚠️ ${String(e?.message || 'Lokale KI nicht erreichbar.')}` });
      }
    }

    // /kb-reindex (Admin only – prüfe optional Rolle)
    if (i.commandName === 'kb-reindex') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        KB = fs.existsSync(KB_PATH) ? readJSON(KB_PATH) : [];
        await rebuildKbIndex();
        await i.editReply({ content: `🔄 KB neu indiziert. Einträge: ${KB.length}` });
      } catch (e) {
        await i.editReply({ content: `⚠️ Reindex fehlgeschlagen: ${String(e?.message || e)}` });
      }
    }

    // /kb-info
    if (i.commandName === 'kb-info') {
      await i.reply({
        content: `📚 KB: ${KB.length} Einträge, Index: ${KB_INDEX?.vectors?.length || 0} Vektoren, Embed-Modell: ${EMBED_MODEL}`,
        flags: MessageFlags.Ephemeral
      });
    }

  } catch (err) {
    console.error(err);
    if (i.isRepliable()) {
      i.reply({ content: 'Uff, da ging was schief. Bitte Admin informieren.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

/* Optional: Auto-Thread im Support-Kanal (braucht MessageContent-Intent) */
client.on('messageCreate', async (msg) => {
  try {
    if (msg.author.bot) return;
    if (msg.channel.id !== process.env.SUPPORT_CHANNEL_ID) return;
    if (!msg.content.includes('?')) return;

    const th = await msg.startThread({
      name: `frage-${msg.author.username}-${Date.now().toString().slice(-4)}`,
      autoArchiveDuration: 60
    });
    await th.sendTyping();
    const answer = await askLocalLLM(msg.content);
    await th.send(answer);
  } catch (e) { console.error(e); }
});

client.login(process.env.DISCORD_TOKEN);
