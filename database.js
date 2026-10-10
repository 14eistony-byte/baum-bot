const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'applications.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('Fehler beim Öffnen der Datenbank:', err.message);
    else console.log('SQLite Datenbank verbunden.');
});

// Tabelle erstellen falls nicht vorhanden
db.run(`CREATE TABLE IF NOT EXISTS applications (
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
    checkCooldown(userId, callback) {
        db.get(
            `SELECT cooldown_until FROM applications WHERE user_id = ? AND status = 'rejected' AND cooldown_until > datetime('now') ORDER BY id DESC LIMIT 1`,
            [userId],
            (err, row) => {
                if (err) return callback(false, null);
                if (row) {
                    const remainingDays = Math.ceil((new Date(row.cooldown_until) - new Date()) / (1000 * 60 * 60 * 24));
                    return callback(true, remainingDays);
                }
                callback(false, 0);
            }
        );
    },

    // Neue Bewerbung speichern
    saveApplication(userId, username, mcName, role, callback) {
        db.run(
            `INSERT INTO applications (user_id, username, mc_name, role, status) VALUES (?, ?, ?, ?, 'pending')`,
            [userId, username, mcName, role],
            function(err) {
                callback(err, this ? this.lastID : null);
            }
        );
    },

    // Bewerbung Status aktualisieren (Akzeptieren / Ablehnen)
    updateStatus(appId, status, callback) {
        let query = `UPDATE applications SET status = ? WHERE id = ?`;
        let params = [status, appId];

        if (status === 'rejected') {
            // 30 Tage Sperre setzen
            query = `UPDATE applications SET status = ?, cooldown_until = datetime('now', '+30 days') WHERE id = ?`;
        }

        db.run(query, params, callback);
    },

    // Bewerbung per ID abrufen
    getApplicationById(appId, callback) {
        db.get(`SELECT * FROM applications WHERE id = ?`, [appId], callback);
    }
};

module.exports = dbModule;