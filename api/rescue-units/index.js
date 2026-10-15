import { createClient } from "@libsql/client";
const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method === "GET") {
      const result = await client.execute("SELECT * FROM rescue_units ORDER BY updated_at DESC");
      return res.status(200).json(result.rows);
    }
    if (req.method === "POST") {
      const { id, latitude, longitude, status } = req.body;
      await client.execute({
        sql: "UPDATE rescue_units SET latitude =?, longitude =?, status =?, updated_at = CURRENT_TIMESTAMP WHERE id =?",
        args: [latitude, longitude, status || "Available", id]
      });
      return res.status(200).json({ message: "Location updated" });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}