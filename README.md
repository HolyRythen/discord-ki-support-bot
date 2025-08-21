# 🤖 Discord KI-Support-Bot

Ein moderner **Discord-Support-Bot** für Hosting-Unternehmen, basierend auf einer **lokalen KI (Ollama)**.  
Der Bot erstellt Tickets, beantwortet technische Fragen und nutzt eine **Wissensdatenbank (KB)** mit Infos zu Tarifen, Verträgen und Produkten.  

---

## ✨ Features
- 🎫 **Ticketsystem**
  - `/ticket` → Neues Support-Ticket eröffnen
  - `/close` → Ticket schließen + automatische Zusammenfassung
  - Panel-Button → Benutzerfreundliches Ticket-Panel im Discord-Channel
- 🤖 **KI-Support**
  - `/ask` → Stelle technische Fragen (nur Hosting-Themen)
  - Lokale KI über **Ollama** (keine API-Kosten, keine Cloud-Abhängigkeit)
- 📚 **Knowledge Base**
  - KB mit Tarifen, Verträgen und Firmeninfos
  - Admin-Commands: `kb-reindex`, `kb-info`
- 🔐 **Sicherheitsfunktionen**
  - Erkennt **verdächtige Eingaben** (z. B. Passwort, API-Keys)
  - Erkennt **Manipulationsversuche (Jailbreak, Prompt Injection)**
  - Meldet automatisch in einem Admin-Channel
- 📊 **SQL-Datenbank-Anbindung**
  - Speicherung von Tickets, Kunden, Verträgen
  - Beispiel-Schema: `support_bot.sql`

---

## 📂 Projektstruktur
```bash
discord-ki-bot/
├── index.js          # Haupt-Bot-Code
├── db.js             # Datenbankfunktionen (MySQL/MariaDB)
├── support_bot.sql   # Beispiel-SQL-Schema für Tickets & Kunden
├── kb.json           # Wissensbasis-Einträge
├── kb.index.json     # Vektor-Index der KB (Auto-Generiert)
├── package.json      # NPM Dependencies
├── .env              # Umgebungsvariablen
```
## ⚙️ Installation
1. Repository klonen
```bash
Kopieren
Bearbeiten
git clone https://github.com/DEINUSERNAME/discord-ki-bot.git
cd discord-ki-bot
```
2. Abhängigkeiten installieren
```bash
Kopieren
Bearbeiten
npm install
```
3. Ollama installieren
👉 Anleitung: https://ollama.com
Empfohlenes Modell:

```bash
Kopieren
Bearbeiten
ollama pull gpt-oss:20b
4. .env Datei erstellen
Beispiel:

env
Kopieren
Bearbeiten
```
## Discord Bot 
DISCORD_TOKEN=DEIN_DISCORD_BOT_TOKEN
GUILD_ID=DEIN_SERVER_ID
SUPPORT_ROLE_ID=DEINE_SUPPORT_ROLLE
TICKET_CATEGORY_ID=DEINE_TICKET_KATEGORIE
ADMIN_ROLE_ID=DEINE_ADMIN_ROLLE
ADMIN_ALERT_CHANNEL_ID=DEIN_ADMIN_ALERT_KANAL
MAX_TICKETS_PER_USER=2

## KI / Ollama
OLLAMA_BASE_URL=http://localhost:11434/v1
MODEL=gpt-oss:20b
EMBED_MODEL=nomic-embed-text

## Wissensdatenbank
KB_PATH=./kb.json
KB_INDEX_PATH=./kb.index.json

## Datenbank 
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASS=PASSWORT
DB_NAME=support_bot
5. Datenbank einrichten
Importiere das Beispiel-Schema:

bash
Kopieren
Bearbeiten
mysql -u root -p support_bot < support_bot.sql
🚀 Nutzung
Bot starten:

bash
Kopieren
Bearbeiten
node index.js
🔒 Sicherheit
Antworten nur zu Hosting-Themen

Verdächtige Anfragen → Meldung im Admin-Kanal

## Keine Speicherung von sensiblen Daten
