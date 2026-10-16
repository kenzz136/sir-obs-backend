require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@libsql/client");

const app = express();
app.use(cors());
app.use(express.json());

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

console.log("Connecting to:", process.env.TURSO_DATABASE_URL);

// --- AUTO CREATE ALL TABLES ---
async function initDB() {
  try {
    await client.execute(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE, password TEXT, full_name TEXT, phone TEXT, role TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await client.execute(`CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, title TEXT, type TEXT, location TEXT, lat REAL, lng REAL, description TEXT, status TEXT DEFAULT 'reported', reported_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await client.execute(`CREATE TABLE IF NOT EXISTS resources (id TEXT PRIMARY KEY, name TEXT, type TEXT, quantity INTEGER, status TEXT DEFAULT 'available', location TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await client.execute(`CREATE TABLE IF NOT EXISTS rescue_units (id TEXT PRIMARY KEY, name TEXT, type TEXT, status TEXT DEFAULT 'available', location TEXT, members INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await client.execute(`CREATE TABLE IF NOT EXISTS notifications_read (id TEXT PRIMARY KEY, user_id TEXT, notification_id TEXT, read_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

    // FIXED: moved inside initDB, no top-level await!
    await client.execute(`
      CREATE TABLE IF NOT EXISTS user_notifications (
        user_id TEXT PRIMARY KEY,
        email TEXT,
        push_token TEXT,
        push_enabled INTEGER DEFAULT 1,
        email_enabled INTEGER DEFAULT 1,
        updated_at TEXT
      )
    `);
    
await client.execute(`
  CREATE TABLE IF NOT EXISTS hazard_zones (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hazard_type TEXT NOT NULL DEFAULT 'flood',
    severity TEXT NOT NULL DEFAULT 'high',
    status TEXT NOT NULL DEFAULT 'active',
    city TEXT,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    radius_meters REAL DEFAULT 500,
    coordinates TEXT,
    description TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

    // Add missing columns to incidents if old table exists (so Report works)
    try { await client.execute(`ALTER TABLE incidents ADD COLUMN severity TEXT`); } catch {}
    try { await client.execute(`ALTER TABLE incidents ADD COLUMN latitude REAL`); } catch {}
    try { await client.execute(`ALTER TABLE incidents ADD COLUMN longitude REAL`); } catch {}
    try { await client.execute(`ALTER TABLE incidents ADD COLUMN user_id TEXT`); } catch {}

    console.log("✅ All tables ready: users, incidents, resources, rescue_units, notifications_read, user_notifications");

    const tables = await client.execute("SELECT name FROM sqlite_master WHERE type='table'");
    console.log("Tables in Turso:", tables.rows.map(r => r.name));
  } catch (e) {
    console.log("Init DB error:", e.message);
  }
}
initDB();

// --- USERS ---
app.get("/api/users", async (req, res) => {
  try {
    const r = await client.execute("SELECT id, email, full_name, phone, role, created_at FROM users ORDER BY created_at DESC");
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/users", async (req, res) => {
  try {
    const { id, email, password, full_name, phone, role } = req.body;
    await client.execute({
      sql: "INSERT INTO users (id, email, password, full_name, phone, role) VALUES (?,?,?,?,?,?)",
      args: [id, email, password, full_name, phone, role || "Responder"]
    });
    res.json({ id, email, full_name, phone, role });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/users/update-phone", async (req,res)=>{
  try{
    const { id, email, phone } = req.body;
    if(id){
      await client.execute({ sql:"UPDATE users SET phone=? WHERE id=?", args:[phone, id] });
    } else if(email){
      await client.execute({ sql:"UPDATE users SET phone=? WHERE email=?", args:[phone, email] });
    }
    res.json({ success:true, phone });
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post("/api/users/update-name", async (req,res)=>{
  try{
    const { id, email, full_name } = req.body;
    if(id) await client.execute({ sql:"UPDATE users SET full_name=? WHERE id=?", args:[full_name, id] });
    else await client.execute({ sql:"UPDATE users SET full_name=? WHERE email=?", args:[full_name, email] });
    res.json({ success:true });
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post("/api/users/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const r = await client.execute({
      sql: "SELECT * FROM users WHERE email =? AND password =?",
      args: [email, password]
    });
    if (r.rows.length === 0) return res.status(401).json({ error: "Invalid login" });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- INCIDENTS (FULL DYNAMIC) ---
app.get("/api/incidents", async (req, res) => {
  try {
    const r = await client.execute("SELECT * FROM incidents ORDER BY created_at DESC");
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/incidents', async (req, res) => {
  const { type, title, description, severity, location, lat, lng, reported_by } = req.body;
  await client.execute({
    sql: `INSERT INTO incidents (id, type, title, description, severity, location, lat, lng, status, reported_by, created_at)
          VALUES (?,?,?,?,?,?,?,?, 'reported',?, datetime('now'))`,
    args: [Date.now().toString(), type, title, description, severity, location, lat, lng, reported_by]
  });
  res.json({ id: Date.now().toString(), success: true });
});

app.patch("/api/incidents/:id", async (req, res) => {
  try {
    const { status } = req.body;
    await client.execute({ sql: "UPDATE incidents SET status=? WHERE id=?", args: [status, req.params.id] });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- RESOURCES ---

app.get("/api/resources", async (req, res) => {
  try {
    const r = await client.execute("SELECT * FROM resources");
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


app.post("/api/resources", async (req, res) => {
  try {
    const { id, name, type, quantity, location, status } = req.body;
    const newId = id || "RES-" + Date.now();
    await client.execute({
      sql: "INSERT INTO resources (id, name, type, quantity, location, status) VALUES (?,?,?,?,?,?)",
      args: [newId, name, type, quantity || 1, location || "Base", status || "available"]
    });
    res.json({ id: newId, success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- RESCUE UNITS ---
app.get("/api/rescue-units", async (req, res) => {
  try {
    const r = await client.execute("SELECT * FROM rescue_units ORDER BY created_at DESC");
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/rescue-units", async (req, res) => {
  try {
    const { id, name, type, location, members, status } = req.body;
    const newId = id || "UNIT-" + Date.now();
    await client.execute({
      sql: "INSERT INTO rescue_units (id, name, type, location, members, status) VALUES (?,?,?,?,?,?)",
      args: [newId, name, type, location || "Base", members || 5, status || "available"]
    });
    res.json({ id: newId, success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch("/api/rescue-units/:id", async (req, res) => {
  try {
    await client.execute({ sql: "UPDATE rescue_units SET status=? WHERE id=?", args: [req.body.status, req.params.id] });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- NOTIFICATIONS READ ---
app.get("/api/notifications/read", async (req, res) => {
  try {
    const userId = req.query.user_id || "default";
    const r = await client.execute({ sql: "SELECT notification_id FROM notifications_read WHERE user_id=?", args: [userId] });
    res.json(r.rows.map(x => x.notification_id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/notifications/read", async (req, res) => {
  try {
    const { user_id, notification_id } = req.body;
    const id = `${user_id}-${notification_id}`.replace(/[^a-zA-Z0-9-_]/g, "-");
    await client.execute({ sql: "INSERT OR IGNORE INTO notifications_read (id, user_id, notification_id) VALUES (?,?,?)", args: [id, user_id || "default", notification_id] });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/notifications/read-all", async (req, res) => {
  try {
    const { user_id, notification_ids } = req.body;
    for (const nid of notification_ids) {
      const id = `${user_id}-${nid}`.replace(/[^a-zA-Z0-9-_]/g, "-");
      await client.execute({ sql: "INSERT OR IGNORE INTO notifications_read (id, user_id, notification_id) VALUES (?,?,?)", args: [id, user_id || "default", nid] });
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- USER NOTIFICATIONS PREFS (NOW INSIDE PROPER ROUTES, NO TOP-LEVEL AWAIT) ---
app.get("/api/users/:id/notifications", async (req,res)=>{
  try {
    const r = await client.execute({ sql:"SELECT * FROM user_notifications WHERE user_id=?", args:[req.params.id] });
    res.json(r.rows[0] || { push_enabled:1, email_enabled:1 });
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.patch("/api/users/:id/notifications", async (req,res)=>{
  try {
    const { push_enabled, email_enabled } = req.body;
    await client.execute({
      sql:`INSERT INTO user_notifications (user_id, push_enabled, email_enabled, updated_at)
           VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
           push_enabled=COALESCE(?, push_enabled),
           email_enabled=COALESCE(?, email_enabled),
           updated_at=?`,
      args:[req.params.id, push_enabled, email_enabled, new Date().toISOString(), push_enabled, email_enabled, new Date().toISOString()]
    });
    res.json({ success:true });
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.post("/api/users/save-push-token", async (req,res)=>{
  try {
    const { user_id, email, push_token } = req.body;
    await client.execute({
      sql:`INSERT INTO user_notifications (user_id, email, push_token, updated_at) VALUES (?,?,?,?)
           ON CONFLICT(user_id) DO UPDATE SET push_token=?, email=?, updated_at=?`,
      args:[user_id, email, push_token, new Date().toISOString(), push_token, email, new Date().toISOString()]
    });
    res.json({ success:true });
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.get("/api/alerts", async (req,res)=>{
  const r = await client.execute("SELECT * FROM alerts ORDER BY created_at DESC");
  res.json(r.rows);
});

app.get("/api/resources", async (req, res) => {
  try {
    const r = await client.execute("SELECT * FROM resources ORDER BY created_at DESC");
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** --- HAZARD ZONES --- **/
app.get("/api/hazards", async (req, res) => {
  try {
    const result = await client.execute(
      "SELECT * FROM hazard_zones ORDER BY created_at DESC"
    );

    res.json(
      result.rows.map((row) => ({
        ...row,
        coordinates: row.coordinates
          ? JSON.parse(row.coordinates)
          : null,
      }))
    );
  } catch (error) {
    console.error("Error fetching hazard zones:", error.message);
    res.status(500).json({ error: "Failed to fetch hazard zones." });
  }
});


app.post("/api/hazards", async (req, res) => {
  try {
    const {
      id,
      name,
      hazard_type,
      severity,
      status,
      city,
      latitude,
      longitude,
      radius_meters,
      coordinates,
      description,
      created_by,
    } = req.body;

    if (
      !name ||
      latitude == null ||
      longitude == null ||
      !Number.isFinite(Number(latitude)) ||
      !Number.isFinite(Number(longitude)) ||
      Number(latitude) < -90 ||
      Number(latitude) > 90 ||
      Number(longitude) < -180 ||
      Number(longitude) > 180
    ) {
      return res.status(400).json({
        error: "A name and valid latitude/longitude are required.",
      });
    }

    const hazardId = id || `HAZ-${Date.now()}`;

    const savedCoordinates =
      coordinates == null ? null : JSON.stringify(coordinates);

    await client.execute({
      sql: `INSERT INTO hazard_zones (
        id, name, hazard_type, severity, status, city,
        latitude, longitude, radius_meters, coordinates,
        description, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        hazardId,
        name,
        hazard_type || "flood",
        severity || "high",
        status || "active",
        city || null,
        Number(latitude),
        Number(longitude),
        radius_meters == null ? 500 : Number(radius_meters),
        savedCoordinates,
        description || null,
        created_by || null,
      ],
    });

    res.status(201).json({
      success: true,
      message: "Hazard zone saved successfully.",
      id: hazardId,
    });
  } catch (error) {
    console.error("Error saving hazard zone:", error.message);
    res.status(500).json({ error: "Failed to save hazard zone." });
  }
});


app.delete("/api/hazards/:id", async (req, res) => {
  try {
    const result = await client.execute({
      sql: "DELETE FROM hazard_zones WHERE id = ?",
      args: [req.params.id],
    });

    if (result.rowsAffected === 0) {
      return res.status(404).json({
        error: "Hazard zone not found.",
      });
    }

    res.json({
      success: true,
      message: "Hazard zone deleted successfully.",
    });
  } catch (error) {
    console.error("Error deleting hazard zone:", error.message);
    res.status(500).json({
      error: "Failed to delete hazard zone.",
    });
  }
});


app.patch("/api/hazards/:id", async (req, res) => {
  try {
    const allowedFields = [
      "name",
      "hazard_type",
      "severity",
      "status",
      "city",
      "latitude",
      "longitude",
      "radius_meters",
      "coordinates",
      "description",
    ];

    const updates = [];
    const values = [];

    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        let value = req.body[field];

        if (field === "coordinates" && value !== null) {
          value = JSON.stringify(value);
        }

        updates.push(`${field} = ?`);
        values.push(value);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({
        error: "Provide at least one field to update.",
      });
    }

    values.push(req.params.id);

    const result = await client.execute({
      sql: `UPDATE hazard_zones SET ${updates.join(", ")} WHERE id = ?`,
      args: values,
    });

    if (result.rowsAffected === 0) {
      return res.status(404).json({
        error: "Hazard zone not found.",
      });
    }

    res.json({
      success: true,
      message: "Hazard zone updated successfully.",
    });
  } catch (error) {
    console.error("Error updating hazard zone:", error.message);
    res.status(500).json({
      error: "Failed to update hazard zone.",
    });
  }
});




app.get("/", (req, res) => res.send("✅ DYNAMIC Backend Running! Tables: users, incidents, resources, rescue_units, notifications_read, user_notifications"));

const PORT = 3000;
module.exports = app;
if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n BACKEND RUNNING!`);
  });
}