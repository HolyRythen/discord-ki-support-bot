// db.js
import mysql from 'mysql2/promise';

export const pool = await mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
  namedPlaceholders: true
});

export async function getCustomerByDiscordId(discordId) {
  const [rows] = await pool.query(
    `SELECT c.* FROM customers c
     JOIN discord_links d ON d.customer_id=c.id
     WHERE d.discord_id=?`, [discordId]
  );
  return rows[0] || null;
}

export async function getActiveContract(customerId) {
  const [rows] = await pool.query(
    `SELECT * FROM contracts
     WHERE customer_id=? AND status='active'
     ORDER BY start_date DESC LIMIT 1`, [customerId]
  );
  return rows[0] || null;
}

export async function insertTicket({discordId, customerId, contractId, guildId, channelId, threadId, title}) {
  await pool.query(
    `INSERT INTO tickets (discord_id, customer_id, contract_id, guild_id, channel_id, thread_id, title)
     VALUES (?,?,?,?,?,?,?)`,
     [discordId, customerId, contractId, guildId, channelId, threadId, title]
  );
}
