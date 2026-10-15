import { createClient } from "@libsql/client";
const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { email, password } = req.body;
    const result = await client.execute({
      sql: "SELECT id, email, full_name, role, team FROM users WHERE email =? AND password =?",
      args: [email, password]
    });
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    return res.status(200).json(result.rows[0]);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}