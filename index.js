require('dotenv').config();

const {
    Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
    TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, EmbedBuilder
} = require('discord.js');

// Token und Client-ID kommen sicher aus der .env
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

// Rollen-IDs werden sauber aus der config.json geladen
const { Role } = require('./config.json');

const minecraftService = require('./services/minecraftService');
const ticketService = require('./services/ticketService');
const db = require('./database');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

const commands = [
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Sendet das Ticket-Panel und Bewerbungs-Interface'),
    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Verwaltet das Ticket')
        .addSubcommand(sub =>
            sub.setName('rename')
                .setDescription('Benennt das aktuelle Ticket um')
                .addStringOption(option => option.setName('name').setDescription('Neuer Name').setRequired(true))
        )
];

client.once('clientReady', async () => {
    console.log(`Bot ${client.user.tag} ist online!`);
    const rest = new REST({ version: '10' }).setToken(token);
    try {
        await rest.put(Routes.applicationCommands(clientId), { body: commands.map(c => c.toJSON()) });
        console.log('Slash Commands erfolgreich registriert.');
    } catch (error) {
        console.error(error);
    }
});

client.on('interactionCreate', async interaction => {
    // 1. Slash Commands
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'setup') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('open_ticket').setLabel('🎫 Ticket öffnen').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('open_mc_verify').setLabel('⛏️ Minecraft Bewerbung starten').setStyle(ButtonStyle.Success)
            );
            await interaction.reply({ content: 'Wähle eine Option:', components: [row] });
        }
        else if (interaction.commandName === 'ticket') {
            const sub = interaction.options.getSubcommand();
            if (sub === 'rename') {
                if (!interaction.channel.name.startsWith('ticket-')) {
                    return interaction.reply({ content: 'Das ist kein Ticket-Kanal!', ephemeral: true });
                }
                const newName = interaction.options.getString('name');
                await interaction.channel.setName(newName);
                await interaction.reply({ content: `Ticket wurde in **${newName}** umbenannt.`, ephemeral: true });
            }
        }
    }

    // 2. Button Klicks
    else if (interaction.isButton()) {
        if (interaction.customId === 'open_ticket') {
            await ticketService.createTicket(interaction);
        }
        else if (interaction.customId === 'close_ticket') {
            await ticketService.closeTicket(interaction);
        }
        else if (interaction.customId === 'open_mc_verify') {
            // Cooldown-Prüfung (synchron)
            const { hasCooldown, daysLeft } = db.checkCooldown(interaction.user.id);
            if (hasCooldown) {
                return interaction.reply({
                    content: `Du wurdest vor kurzem abgelehnt. Du hast noch eine Bewerbungssperre von **${daysLeft} Tag(en)**.`,
                    ephemeral: true
                });
            }

            const modal = new ModalBuilder()
                .setCustomId('mc_modal')
                .setTitle('Minecraft Spieler-Suche');

            const mcInput = new TextInputBuilder()
                .setCustomId('mc_username')
                .setLabel('Dein Minecraft Spielername')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(mcInput));
            await interaction.showModal(modal);
        }
        // Akzeptieren / Ablehnen Handler für Teammitglieder
        else if (interaction.customId.startsWith('accept_app_') || interaction.customId.startsWith('reject_app_')) {
            const appId = interaction.customId.split('_')[2];
            const action = interaction.customId.startsWith('accept_app_') ? 'accept' : 'reject';

            const app = db.getApplicationById(appId);
            if (!app) {
                return interaction.reply({ content: 'Bewerbung nicht mehr in der Datenbank gefunden.', ephemeral: true });
            }

            if (app.status !== 'pending') {
                return interaction.reply({ content: `Diese Bewerbung wurde bereits bearbeitet (${app.status}).`, ephemeral: true });
            }

            const member = await interaction.guild.members.fetch(app.user_id).catch(() => null);

            if (action === 'accept') {
                db.updateStatus(appId, 'accepted');
                
                if (member) {
                    const roleConfig = Role[app.role];
                    if (roleConfig && roleConfig.id) {
                        await member.roles.add(roleConfig.id).catch(console.error);
                    }
                    // Schicke DM an den User
                    await member.send(`🎉 Deine Bewerbung als **${app.role.toUpperCase()}** wurde **akzeptiert**! Dir wurden die entsprechenden Rollen zugewiesen.`).catch(() => {});
                }

                const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0x00FF00)
                    .addFields({ name: 'Status', value: `✅ Akzeptiert von ${interaction.user.tag}` });

                await interaction.update({ embeds: [updatedEmbed], components: [] });
            } else {
                // Modal für Ablehnungsgrund öffnen
                const modal = new ModalBuilder()
                    .setCustomId(`reject_modal_${appId}`)
                    .setTitle('Bewerbung ablehnen');

                const reasonInput = new TextInputBuilder()
                    .setCustomId('reject_reason')
                    .setLabel('Grund für die Ablehnung')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
                await interaction.showModal(modal);
            }
        }
    }

    // 3. Modal Submit (Minecraft Namenseingabe ODER Ablehnungsgrund)
    else if (interaction.isModalSubmit()) {
        if (interaction.customId === 'mc_modal') {
            const username = interaction.fields.getTextInputValue('mc_username');
            await interaction.deferReply({ ephemeral: true });

            const profile = await minecraftService.getPlayerProfile(username);
            if (!profile) {
                return interaction.editReply({ content: `Spieler "${username}" wurde nicht gefunden!` });
            }

            const embed = new EmbedBuilder()
                .setTitle(`Minecraft Profil: ${profile.name}`)
                .setThumbnail(profile.avatarUrl)
                .addFields(
                    { name: 'UUID', value: profile.uuid, inline: true },
                    { name: 'Online-Status', value: profile.isOnline ? `Online auf ${profile.server}` : 'Offline / Nicht aufgespürt', inline: true }
                )
                .setColor(0x00AE86);

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`apply_role_${profile.name}`)
                .setPlaceholder('Wähle eine Clan-Stelle aus...')
                .addOptions([
                    new StringSelectMenuOptionBuilder().setLabel('Mitglied').setValue('mitglied'),
                    new StringSelectMenuOptionBuilder().setLabel('Coder').setValue('coder'),
                    new StringSelectMenuOptionBuilder().setLabel('Anwerber').setValue('anwerber'),
                    new StringSelectMenuOptionBuilder().setLabel('Builder').setValue('builder'),
                    new StringSelectMenuOptionBuilder().setLabel('Supporter').setValue('supporter'),
                    new StringSelectMenuOptionBuilder().setLabel('Kassenwart').setValue('kassenwart'),
                ]);

            const row = new ActionRowBuilder().addComponents(selectMenu);
            await interaction.editReply({ embeds: [embed], components: [row] });
        }
        else if (interaction.customId.startsWith('reject_modal_')) {
            const appId = interaction.customId.split('_')[2];
            const reason = interaction.fields.getTextInputValue('reject_reason');

            db.updateStatus(appId, 'rejected');
            const app = db.getApplicationById(appId);

            if (app) {
                const member = await interaction.guild.members.fetch(app.user_id).catch(() => null);
                if (member) {
                    await member.send(`❌ Deine Bewerbung als **${app.role.toUpperCase()}** wurde **abgelehnt**.\n**Grund:** ${reason}\n*Du hast eine 30-tägige Sperre für neue Bewerbungen.*`).catch(() => {});
                }
            }

            const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0xFF0000)
                .addFields(
                    { name: 'Status', value: `❌ Abgelehnt von ${interaction.user.tag}` },
                    { name: 'Ablehnungsgrund', value: reason }
                );

            await interaction.update({ embeds: [updatedEmbed], components: [] });
        }
    }

    // 4. Dropdown Auswahl (Bewerbung abschicken & im Channel posten)
    else if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith('apply_role_')) {
            const selectedRole = interaction.values[0];
            const user = interaction.user;
            const mcName = interaction.customId.replace('apply_role_', '');

            // In Datenbank speichern (synchron)
            const appId = db.saveApplication(user.id, user.tag, mcName, selectedRole);
            if (!appId) {
                return interaction.reply({ content: 'Fehler beim Speichern der Bewerbung.', ephemeral: true });
            }

            // Den Channel "bewerbungen" suchen
            const bChan = interaction.guild.channels.cache.find(c => c.name === 'bewerbungen');
            if (bChan) {
                const appEmbed = new EmbedBuilder()
                    .setTitle(`Neue Bewerbung: ${selectedRole.toUpperCase()}`)
                    .addFields(
                        { name: 'Bewerber', value: `<@${user.id}> (${user.tag})`, inline: true },
                        { name: 'Gewünschte Rolle', value: selectedRole, inline: true },
                        { name: 'Minecraft Name', value: mcName, inline: true }
                    )
                    .setColor(0xFFA500)
                    .setTimestamp();

                const actionRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`accept_app_${appId}`).setLabel('Akzeptieren').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`reject_app_${appId}`).setLabel('Ablehnen').setStyle(ButtonStyle.Danger)
                );

                await bChan.send({ embeds: [appEmbed], components: [actionRow] });
            }

            await interaction.reply({
                content: `Vielen Dank! Deine Bewerbung für die Rolle **${selectedRole.toUpperCase()}** wurde erfolgreich eingereicht und wird geprüft.`,
                ephemeral: true
            });
        }
    }
});

client.login(token);