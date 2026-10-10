const fetch = require('node-fetch');

class MinecraftService {
    async getPlayerProfile(username) {
        try {
            const uuidRes = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`);
            if (!uuidRes.ok) return null;
            const playerData = await uuidRes.json();

            const uuid = playerData.id;
            const name = playerData.name;
            const avatarUrl = `https://crafatar.com/avatars/${uuid}?size=128&overlay`;

            let onlineInfo = { isOnline: false, server: null };
            try {
                const statusRes = await fetch(`https://api.mcsrvstat.us/3/play.opsucht.net`);
                if (statusRes.ok) {
                    const statusData = await statusRes.json();
                    if (statusData.online && statusData.players && statusData.players.list) {
                        const foundPlayer = statusData.players.list.find(
                            p => p.toLowerCase() === name.toLowerCase()
                        );
                        if (foundPlayer) {
                            onlineInfo = { isOnline: true, server: "OPSucht.net" };
                        }
                    }
                }
            } catch (e) {
                // Fallback falls Status-API blockiert
            }

            return { uuid, name, avatarUrl, ...onlineInfo };
        } catch (error) {
            console.error("Fehler beim Abrufen der Minecraft-Daten:", error);
            return null;
        }
    }
}

module.exports = new MinecraftService();