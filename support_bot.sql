-- support_bot.sql
-- Beispiel-Datenbank für den Discord Support Bot

CREATE DATABASE IF NOT EXISTS support_bot
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE support_bot;

-- Kunden-Tabelle
CREATE TABLE IF NOT EXISTS customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  discord_id VARCHAR(32) UNIQUE NOT NULL,
  name VARCHAR(100) DEFAULT NULL,
  email VARCHAR(150) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Verträge / Pläne
CREATE TABLE IF NOT EXISTS contracts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  plan VARCHAR(100) NOT NULL,
  price_eur DECIMAL(10,2) NOT NULL,
  sla_tier VARCHAR(50) DEFAULT NULL,
  status ENUM('active','paused','terminated') DEFAULT 'active',
  start_date DATE NOT NULL,
  end_date DATE DEFAULT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

-- Tickets
CREATE TABLE IF NOT EXISTS tickets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT DEFAULT NULL,
  contract_id INT DEFAULT NULL,
  discord_id VARCHAR(32) NOT NULL,
  guild_id VARCHAR(32) NOT NULL,
  channel_id VARCHAR(32) NOT NULL,
  title VARCHAR(200) NOT NULL,
  status ENUM('open','closed') DEFAULT 'open',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE SET NULL
);

-- Beispiel-Datensätze (können gelöscht werden)
INSERT INTO customers (discord_id, name, email) VALUES
('111111111111111111', 'Max Mustermann', 'kunde@example.com');

INSERT INTO contracts (customer_id, plan, price_eur, sla_tier, status, start_date)
VALUES (1, 'VPS-BASIC', 9.99, 'Silver', 'active', '2025-01-01');

INSERT INTO tickets (customer_id, contract_id, discord_id, guild_id, channel_id, title)
VALUES (1, 1, '111111111111111111', '222222222222222222', '333333333333333333', 'Beispiel-Ticket: Testeintrag');
-- Beispiel-Ticket für den Support-Bot