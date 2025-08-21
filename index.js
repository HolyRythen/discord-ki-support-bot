// index.js
import fs from "node:fs";
import "dotenv/config";
import {
  Client, GatewayIntentBits, Partials, REST, Routes,
  ChannelType, PermissionsBitField, MessageFlags,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder
} from "discord.js";
import OpenAI from "openai";
import { getCustomerByDiscordId, getActiveContract, insertTicket } from "./db.js";

/* ------------ ENV / Defaults ------------ */
const GUILD_ID = process.env.GUILD_ID;
const SUPPORT_ROLE_IDS = (process.env.SUPPORT_ROLE_ID || "").split(",").map(s => s.trim()).filter(Boolean);
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || null;
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID || null;
const MAX_TICKETS_PER_USER = parseInt(process.env.MAX_TICKETS_PER_USER || "2", 10);
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || "600", 10);
const ADMIN_ALERT_CHANNEL_ID = process.env.ADMIN_ALERT_CHANNEL_ID;

/* ------------ Discord Client ------------ */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel, Partials.Message],
});

/* ------------ Lokale KI (Ollama) ------------ */
const baseURL = process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
const CHAT_MODEL = process.env.MODEL || "gpt-oss:20b";
const EMBED_MODEL = process.env.EMBED_MODEL || "nomic-embed-text";
const openai = new OpenAI({ apiKey: process.env.OLLAMA_API_KEY || "ollama", baseURL });

/* ------------ KB / RAG ------------ */
const KB_PATH = process.env.KB_PATH || "./kb.json";
const KB_INDEX_PATH = process.env.KB_INDEX_PATH || "./kb.index.json";
function readJSON(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function writeJSON(p, o) { fs.writeFileSync(p, JSON.stringify(o, null, 2)); }
let KB = [], KB_INDEX = { model: EMBED_MODEL, vectors: [] };

async function ensureKbIndex() {
  if (!fs.existsSync(KB_PATH)) { console.warn("⚠️ KB-Datei fehlt."); KB = []; KB_INDEX = { model: EMBED_MODEL, vectors: [] }; return; }
  KB = readJSON(KB_PATH);
  if (fs.existsSync(KB_INDEX_PATH)) {
    const idx = readJSON(KB_INDEX_PATH);
    const kbIds = new Set(KB.map(e => e.id)); const indexIds = new Set((idx?.vectors || []).map(v => v.id));
    const sameIds = kbIds.size === indexIds.size && [...kbIds].every(id => indexIds.has(id));
    if (idx?.model === EMBED_MODEL && sameIds) { KB_INDEX = idx; console.log(`KB-Index geladen (${KB_INDEX.vectors.length} Vektoren).`); return; }
  }
  await rebuildKbIndex();
}
async function rebuildKbIndex() {
  if (!KB.length) { KB = fs.existsSync(KB_PATH) ? readJSON(KB_PATH) : []; KB_INDEX = { model: EMBED_MODEL, vectors: [] }; writeJSON(KB_INDEX_PATH, KB_INDEX); console.log("KB leer – Index leer."); return; }
  console.log(`KB wird indiziert (${KB.length} Einträge)…`);
  const res = await openai.embeddings.create({ model: EMBED_MODEL, input: KB.map(e => e.content) });
  KB_INDEX = { model: EMBED_MODEL, vectors: res.data.map((d, i) => ({ id: KB[i].id, title: KB[i].title, tags: KB[i].tags, embedding: d.embedding })) };
  writeJSON(KB_INDEX_PATH, KB_INDEX);
  console.log(`KB-Index erstellt (${KB_INDEX.vectors.length} Vektoren).`);
}
function cosine(a, b) { let dot = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8); }
async function queryKB(query, topK = 3) {
  if (!KB_INDEX?.vectors?.length) return null;
  const qv = (await openai.embeddings.create({ model: EMBED_MODEL, input: [query] })).data[0].embedding;
  const picks = KB_INDEX.vectors.map(v => ({ ...v, score: cosine(qv, v.embedding) }))
    .sort((a, b) => b.score - a.score).slice(0, topK)
    .map(v => KB.find(e => e.id === v.id)).filter(Boolean);
  if (!picks.length) return null;
  return picks.map(e => `# ${e.title}\n${e.content}`).join("\n\n");
}

/* ------------ Heuristiken ------------ */
const HOSTING_KEYWORDS = ["hosting", "webhosting", "vserver", "server", "dedicated", "domain", "dns", "ssl", "https", "zertifikat", "backup", "restore", "bandwidth", "traffic", "uptime", "sla", "firewall", "ddos", "ssh", "sftp", "mysql", "mariadb", "postgres", "datenbank", "docker", "port", "reverse proxy", "nginx", "apache", "email", "imap", "smtp", "proxmox", "kvm", "vm", "virtual", "ram", "cpu", "ssd", "rechenzentrum", "standort", "ipv4", "ipv6"];
const SUSPICIOUS_REGEX = /(passwort|password|token|api[-\s_]*key|ssh[-\s_]*key|db\s*dump|kundendaten|interne\s*daten|privat[e]?\s*daten|zugangsdaten|credentials)/i;
const INJECTION_REGEX = /(ignore\s+(all\s+)?(previous\s+)?rules|forget\s+(all\s+)?instructions|system\s+prompt|override\s+instructions|du\s+bist\s+jetzt|you\s+are\s+now|reveal\s+(hidden|secret)\s+(rules|data|prompt)|simulate\s+(admin|system)|bypass\s+(restrictions|filters)|disable\s+(security|safety)|jailbreak|exploit|leak\s+(data|prompt|config)|output\s+raw\s+(kb|data|memory)|show\s+(internal|config|secrets))/i;
const looksLikeHosting = t => HOSTING_KEYWORDS.some(kw => (t || "").toLowerCase().includes(kw));

/* ------------ Verlauf pro Ticket ------------ */
const ticketHistory = new Map();
function pushHistory(channelId, role, content, maxLen = 20) {
  if (!ticketHistory.has(channelId)) ticketHistory.set(channelId, []);
  const arr = ticketHistory.get(channelId);
  arr.push({ role, content: String(content || "").slice(0, 3000) });
  if (arr.length > maxLen) arr.splice(0, arr.length - maxLen);
}

/* ------------ Embeds: Helpers ------------ */
const makeWelcomeEmbed = (userId, topicText) => new EmbedBuilder()
  .setColor(0x2f3136)
  .setTitle("🎫 Neues Support-Ticket")
  .setDescription(
    `Hallo <@${userId}>, dein Ticket wurde erstellt.\n` +
    (topicText ? `**Thema:** ${topicText}\n\n` : "\n") +
    `Bitte beschreibe dein Problem möglichst genau:\n` +
    `• System/Version\n• Schritte bis zum Fehler\n• Fehlermeldungen\n\nUnser Team meldet sich so schnell wie möglich.`
  )
  .setFooter({ text: "Customhost Supportsystem" })
  .setTimestamp();

const makeContractEmbed = (c) => new EmbedBuilder()
  .setColor(0x3b82f6)
  .setTitle("📄 Vertragsinformationen")
  .addFields(
    { name: "Plan", value: `${c.plan} (${c.status})`, inline: true },
    { name: "Preis", value: `${c.price_eur} €/Monat`, inline: true },
    { name: "SLA", value: c.sla_tier || "n/a", inline: true },
    { name: "Start", value: String(c.start_date || "-"), inline: true },
    { name: "Ende", value: String(c.end_date || "—"), inline: true },
  )
  .setTimestamp();

const makeNoContractEmbed = () => new EmbedBuilder()
  .setColor(0xf59e0b)
  .setTitle("ℹ️ Keine Vertragsdaten gefunden")
  .setDescription("Für diesen Discord-Account ist aktuell kein Vertrag verknüpft (oder die DB ist nicht erreichbar).")
  .setTimestamp();

const makeClosedEmbed = (summary) => new EmbedBuilder()
  .setColor(0x10b981)
  .setTitle("✅ Ticket geschlossen")
  .setDescription(`**Zusammenfassung:**\n${summary.slice(0, 1900)}`)
  .setTimestamp();

const makePanelEmbed = () => new EmbedBuilder()
  .setColor(0x5865F2)
  .setTitle("🛠️ Support benötigt?")
  .setDescription("Klicke auf den Button, um ein privates Ticket zu eröffnen.");

/* ------------ Security Alerts (Embed) ------------ */
async function notifySecurity(guild, authorId, content, reason = "security") {
  try {
    const alertCh = guild.channels.cache.get(ADMIN_ALERT_CHANNEL_ID) || await guild.channels.fetch(ADMIN_ALERT_CHANNEL_ID).catch(() => null);
    if (!alertCh) return;
    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle("🚨 Sicherheitswarnung")
      .setDescription(
        `**Typ:** ${reason.toUpperCase()}\n` +
        `👤 **User:** <@${authorId || "unknown"}>\n\n` +
        `📝 **Inhalt:**\n${(content || "").slice(0, 800)}`
      )
      .setTimestamp();
    const payload = ADMIN_ROLE_ID ? { content: `<@&${ADMIN_ROLE_ID}>`, embeds: [embed] } : { embeds: [embed] };
    await alertCh.send(payload);
  } catch (e) { console.error("notifySecurity error:", e); }
}

/* ------------ LLM Helper (Antwort = normaler Text) ------------ */
async function askLocalLLM(prompt, extraCtx = null, history = [], authorId = null, channel = null) {
  if (SUSPICIOUS_REGEX.test(prompt) || INJECTION_REGEX.test(prompt)) {
    if (channel?.guild) await notifySecurity(channel.guild, authorId, prompt, SUSPICIOUS_REGEX.test(prompt) ? "suspicious" : "injection");
    return "⚠️ Diese Anfrage kann aus Sicherheitsgründen nicht bearbeitet werden.";
  }
  if (!looksLikeHosting(prompt)) {
    return "Bitte beschränke deine Frage auf **Hosting-Themen** (Server, Domains, DNS, SSL, Backups, etc.).";
  }
  const sys = `Du bist ein Firmen-Support-Bot für Hosting-Themen.
- Antworte kurz, sachlich und auf Deutsch (oder Sprache des Nutzers).
- Nur Hosting-Themen! Keine internen/privaten Daten.
- Erfinde nichts. Wenn unsicher → menschlicher Support.`;
  let kbCtx = null; try { kbCtx = extraCtx ?? await queryKB(prompt); } catch { }
  const messages = [{ role: "system", content: sys }, kbCtx ? { role: "system", content: `<<KB>>\n${kbCtx}` } : null, ...history, { role: "user", content: prompt }].filter(Boolean);
  try {
    const res = await openai.chat.completions.create({ model: CHAT_MODEL, messages, temperature: 0.2, max_tokens: MAX_TOKENS });
    let answer = res.choices?.[0]?.message?.content?.trim() || "Keine Antwort erstellt.";
    if (answer.length > 2000) answer = answer.slice(0, 1990) + "…";
    return answer;
  } catch (err) {
    console.error("LLM error:", err?.message || err);
    return "⚠️ Die lokale KI war gerade nicht erreichbar.";
  }
}

/* ------------ Commands & Panel ------------ */
const commands = [
  { name: "panel", description: "Erstellt ein Ticket-Panel (Admin)" },
  { name: "ask", description: "Stelle eine technische Frage (Hosting)", options: [{ name: "frage", description: "Deine Frage", type: 3, required: true }] },
  { name: "ticket", description: "Neues Support-Ticket eröffnen", options: [{ name: "thema", description: "Kurzthema", type: 3, required: true }] },
  { name: "close", description: "Ticket schließen (nur im Ticket-Kanal)" },
  { name: "kb-reindex", description: "KB neu indizieren (Admin)" },
  { name: "kb-info", description: "Zeigt KB-Statistik (Admin)" },
];
async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  const appId = (await client.application?.fetch())?.id || client.user.id;
  await rest.put(Routes.applicationGuildCommands(appId, GUILD_ID), { body: commands });
}
function buildTicketPanelComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("open_ticket").setLabel("🎫 Ticket eröffnen").setStyle(ButtonStyle.Primary)
  )];
}
async function countOpenTicketsForUser(guild, userId) {
  if (!TICKET_CATEGORY_ID) return 0;
  const channels = guild.channels.cache.filter(c => c.parentId === TICKET_CATEGORY_ID && c.type === ChannelType.GuildText);
  let count = 0; for (const ch of channels.values()) { if ((ch.topic || "").includes(`owner:${userId}`)) count++; }
  return count;
}

/* ------------ Events ------------ */
client.on("ready", async () => {
  console.log(`Eingeloggt als ${client.user.tag}`);
  await ensureKbIndex();
  if (!KB_INDEX?.vectors?.length && KB.length) await rebuildKbIndex();
  await registerCommands();
});

/* ----- Interaction Handler (Buttons + Slash) ----- */
client.on("interactionCreate", async (i) => {
  try {
    // Buttons
    if (i.isButton() && i.customId === "open_ticket") {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const openCount = await countOpenTicketsForUser(i.guild, i.user.id);
      if (openCount >= MAX_TICKETS_PER_USER) {
        await i.editReply({ content: `❌ Du hast bereits ${MAX_TICKETS_PER_USER} offene Tickets. Bitte schließe erst ein Ticket.` });
        return;
      }
      let customer = null, contract = null;
      try { customer = await getCustomerByDiscordId(i.user.id); contract = customer ? await getActiveContract(customer.id) : null; } catch { }
      const ov = [
        { id: i.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: i.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
      ];
      for (const rid of SUPPORT_ROLE_IDS) {
        ov.push({ id: rid, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
      }
      const payload = { name: `ticket-${i.user.username}`.toLowerCase(), type: ChannelType.GuildText, permissionOverwrites: ov, topic: `owner:${i.user.id} • via:panel` };
      if (TICKET_CATEGORY_ID) payload.parent = TICKET_CATEGORY_ID;
      const ticketChannel = await i.guild.channels.create(payload);

      // Vertrags-Embed + Welcome-Embed

      if (SUPPORT_ROLE_IDS.length) await ticketChannel.send({ content: `🔔 <@&${SUPPORT_ROLE_IDS[0]}>` });
      await ticketChannel.send({ embeds: [makeWelcomeEmbed(i.user.id, null)] });

      if (contract) await ticketChannel.send({ embeds: [makeContractEmbed(contract)] });
      else await ticketChannel.send({ embeds: [makeNoContractEmbed()] });

      try { await insertTicket({ discordId: i.user.id, customerId: customer?.id || null, contractId: contract?.id || null, guildId: i.guild.id, channelId: ticketChannel.id, title: "Ticket via Panel" }); } catch { }

      await i.editReply({ content: `✅ Ticket erstellt: ${ticketChannel}` });
      return;
    }

    // Slash
    if (!i.isChatInputCommand()) return;

    if (i.commandName === "panel") {
      if (!ADMIN_ROLE_ID || !i.member.roles.cache.has(ADMIN_ROLE_ID)) {
        await i.reply({ content: "❌ Keine Berechtigung.", flags: MessageFlags.Ephemeral }); return;
      }
      await i.reply({ embeds: [makePanelEmbed()], components: buildTicketPanelComponents() });
      return;
    }

    if (i.commandName === "ask") {
      const frage = i.options.getString("frage", true);
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const answer = await askLocalLLM(frage, null, [], i.user.id, i.channel); // <- normaler Text
      await i.editReply({ content: answer });
      return;
    }

    if (i.commandName === "ticket") {
      const thema = i.options.getString("thema", true);
      await i.deferReply({ flags: MessageFlags.Ephemeral });

      const openCount = await countOpenTicketsForUser(i.guild, i.user.id);
      if (openCount >= MAX_TICKETS_PER_USER) {
        await i.editReply({ content: `❌ Du hast bereits ${MAX_TICKETS_PER_USER} offene Tickets. Bitte schließe erst ein Ticket.` }); return;
      }

      let customer = null, contract = null;
      try { customer = await getCustomerByDiscordId(i.user.id); contract = customer ? await getActiveContract(customer.id) : null; } catch { console.warn("DB nicht erreichbar."); }

      const ov = [
        {
          id: i.guild.roles.everyone.id,
          deny: [
            PermissionsBitField.Flags.ViewChannel
          ]
        },
        {
          id: i.user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory
          ]
        }
      ];
      for (const rid of SUPPORT_ROLE_IDS) {
        ov.push({
          id: rid,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory
          ]
        });
      }

      const payload = { name: `ticket-${i.user.username}`.toLowerCase(), type: ChannelType.GuildText, permissionOverwrites: ov, topic: `owner:${i.user.id} • thema:${thema.slice(0, 80)}` };
      if (TICKET_CATEGORY_ID) payload.parent = TICKET_CATEGORY_ID;
      const ticketChannel = await i.guild.channels.create(payload);

      if (contract) await ticketChannel.send({ embeds: [makeContractEmbed(contract)] });
      else await ticketChannel.send({ embeds: [makeNoContractEmbed()] });

      if (SUPPORT_ROLE_IDS.length) await ticketChannel.send({ content: `🔔 <@&${SUPPORT_ROLE_IDS[0]}>` });
      await ticketChannel.send({ embeds: [makeWelcomeEmbed(i.user.id, thema)] });

      try { await insertTicket({ discordId: i.user.id, customerId: customer?.id || null, contractId: contract?.id || null, guildId: i.guild.id, channelId: ticketChannel.id, title: thema }); } catch (e) { console.warn("Ticket DB save fail:", e?.message || e); }

      await i.editReply({ content: `Ticket erstellt: ${ticketChannel}` });
      return;
    }

    if (i.commandName === "close") {
      if (TICKET_CATEGORY_ID && i.channel?.parentId !== TICKET_CATEGORY_ID) {
        await i.reply({ content: "Bitte nur in Ticket-Kanälen verwenden.", flags: MessageFlags.Ephemeral }); return;
      }
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const msgs = await i.channel.messages.fetch({ limit: 40 });
      const concat = msgs.map(m => `${m.author.bot ? "[BOT]" : m.author.username}: ${m.content}`).reverse().join("\n").slice(-4000);
      const summary = await askLocalLLM(`Fasse dieses Ticket kurz zusammen und nenne nächste Schritte:\n${concat}`, null, [], i.user.id, i.channel);
      await i.channel.send({ embeds: [makeClosedEmbed(summary)] });
      setTimeout(() => i.channel.delete().catch(() => { }), 1500);
      await i.editReply({ content: "Ticket wird geschlossen und Kanal entfernt." });
      return;
    }

    if (i.commandName === "kb-reindex") {
      if (!ADMIN_ROLE_ID || !i.member.roles.cache.has(ADMIN_ROLE_ID)) {
        await i.reply({ content: "❌ Keine Berechtigung.", flags: MessageFlags.Ephemeral }); return;
      }
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      await rebuildKbIndex();
      await i.editReply({ content: `🔄 KB neu indiziert. Einträge: ${KB.length}` });
      return;
    }

    if (i.commandName === "kb-info") {
      if (!ADMIN_ROLE_ID || !i.member.roles.cache.has(ADMIN_ROLE_ID)) {
        await i.reply({ content: "❌ Keine Berechtigung.", flags: MessageFlags.Ephemeral }); return;
      }
      await i.reply({ content: `📚 KB: ${KB.length} Einträge, Index: ${KB_INDEX?.vectors?.length || 0} Vektoren (Modell: ${EMBED_MODEL})`, flags: MessageFlags.Ephemeral });
      return;
    }
  } catch (err) {
    console.error(err);
    if (i.isRepliable()) i.reply({ content: "Uff, da ging was schief.", flags: MessageFlags.Ephemeral }).catch(() => { });
  }
});

/* ----- Auto-Antwort in Ticket-Kanälen (KI = Text) ----- */
client.on("messageCreate", async (msg) => {
  try {
    if (msg.author.bot) return;
    if (TICKET_CATEGORY_ID && msg.channel.parentId !== TICKET_CATEGORY_ID) return;

    pushHistory(msg.channel.id, "user", msg.content);
    const history = ticketHistory.get(msg.channel.id) || [];

    await msg.channel.sendTyping();
    const answer = await askLocalLLM(msg.content, null, history, msg.author.id, msg.channel); // <- Text
    pushHistory(msg.channel.id, "assistant", answer);

    await msg.channel.send(answer);
  } catch (e) { console.error(e); }
});

client.login(process.env.DISCORD_TOKEN);
