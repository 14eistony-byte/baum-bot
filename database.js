const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'applications.db');
const db = new Database(dbPath);

console.log('Better-SQLite3 Datenbank verbunden.');

// Tabelle erstellen falls nicht vorhanden
db.exec(`CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    username TEXT,
    mc_name TEXT,
    role TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    cooldown_until DATETIME
)`);

const dbModule = {
    // Prüfen, ob der User eine aktive Sperre hat (30 Tage)
    checkCooldown(userId) {
        const stmt = db.prepare(`
            SELECT cooldown_until FROM applications 
            WHERE user_id = ? AND status = 'rejected' AND cooldown_until > datetime('now') 
            ORDER BY id DESC LIMIT 1
        `);
        const row = stmt.get(userId);
        if (row) {
            const remainingDays = Math.ceil((new Date(row.cooldown_until) - new Date()) / (1000 * 60 * 60 * 24));
            return { hasCooldown: true, daysLeft: remainingDays };
        }
        return { hasCooldown: false, daysLeft: 0 };
    },

    // Neue Bewerbung speichern
    saveApplication(userId, username, mcName, role) {
        const stmt = db.prepare(`
            INSERT INTO applications (user_id, username, mc_name, role, status) 
            VALUES (?, ?, ?, ?, 'pending')
        `);
        const info = stmt.run(userId, username, mcName, role);
        return info.lastInsertRowid;
    },

    // Bewerbung Status aktualisieren (Akzeptieren / Ablehnen)
    updateStatus(appId, status) {
        if (status === 'rejected') {
            const stmt = db.prepare(`
                UPDATE applications SET status = ?, cooldown_until = datetime('now', '+30 days') 
                WHERE id = ?
            `);
            stmt.run(status, appId);
        } else {
            const stmt = db.prepare(`UPDATE applications SET status = ? WHERE id = ?`);
            stmt.run(status, appId);
        }
    },

    // Bewerbung per ID abrufen
    getApplicationById(appId) {
        const stmt = db.prepare(`SELECT * FROM applications WHERE id = ?`);
        return stmt.get(appId);
    }
};

module.exports = dbModule;