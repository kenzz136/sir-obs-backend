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
      const result = await client.execute("SELECT id, email, full_name, role, team FROM users ORDER BY created_at DESC");
      return res.status(200).json(result.rows);
    }
    if (req.method === "POST") {
      const { email, password, full_name, phone, role } = req.body;
      const id = `USER-${Date.now().toString().slice(-4)}`;
      await client.execute({
        sql: "INSERT INTO users (id, email, password, full_name, phone, role) VALUES (?,?,?,?,?,?)",
        args: [id, email, password, full_name, phone || "", role || "Responder"]
      });
      return res.status(201).json({ id, email, full_name, role: role || "Responder" });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}