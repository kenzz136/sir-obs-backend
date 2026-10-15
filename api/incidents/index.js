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
      const result = await client.execute("SELECT * FROM incidents ORDER BY created_at DESC");
      return res.status(200).json(result.rows);
    }
    if (req.method === "POST") {
      const { title, type, severity, description, latitude, longitude, reporter_name } = req.body;
      const id = `INC-${Date.now().toString().slice(-6)}`;
      await client.execute({
        sql: "INSERT INTO incidents (id, title, type, severity, description, latitude, longitude, reporter_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        args: [id, title || type, type, severity, description, latitude, longitude, reporter_name || "Responder"]
      });
      return res.status(201).json({ id, message: "Saved to Turso" });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}