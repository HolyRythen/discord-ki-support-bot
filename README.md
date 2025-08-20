📄 README.md
# 🤖 Discord KI-Support-Bot

Ein Discord-Bot für Firmen-Support, basierend auf einer **lokalen KI (Ollama)**.  
Der Bot kann Support-Tickets erstellen, Fragen beantworten und nutzt eine **Wissensbasis (kb.index.json)** mit Informationen über dein Unternehmen, Tarife und Verträge.

---

## ✨ Features
- `/ask` → Stelle technische Fragen, Bot antwortet mit KI
- `/ticket` → Erstellt ein neues Support-Ticket (Thread im Support-Channel)
- `/close` → Schließt ein Ticket + erstellt Zusammenfassung
- Automatische Antworten im Technik-Kanal bei Fragen (`?`)
- Lokale Wissensbasis (`kb.index.json`) für Unternehmensinfos, Tarife und Verträge

---

## 📂 Projektstruktur

```bash
discord-ki-bot/
├── index.js # Haupt-Bot-Code
├── kb.index.json # Wissensbasis mit Firmeninfos, Tarifen, Verträgen
├── package.json # NPM Dependencies
├── .env # Umgebungsvariablen
```


---

## ⚙️ Installation

1. **Repository klonen**
   ```bash
   git clone https://github.com/DEINUSERNAME/discord-ki-bot.git
   cd discord-ki-bot


**Abhängigkeiten installieren**
   ```bash
   npm install
```

**.env Datei erstellen**
```bash
DISCORD_TOKEN=DEIN_DISCORD_BOT_TOKEN
GUILD_ID=DEINE_DISCORD_SERVER_ID
SUPPORT_CHANNEL_ID=ID_DES_SUPPORT_CHANNELS
SUPPORT_ROLE_ID=OPTIONALE_SUPPORTROLLE
OLLAMA_BASE_URL=http://localhost:11434/v1
MODEL=gpt-oss:20b
```

Ollama installieren (falls noch nicht vorhanden)
