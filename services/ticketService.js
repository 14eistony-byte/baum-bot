const { ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

class TicketService {
    async createTicket(interaction) {
        const guild = interaction.guild;
        const user = interaction.user;

        const existingChannel = guild.channels.cache.find(
            c => c.name === `ticket-${user.username.toLowerCase()}`
        );
        if (existingChannel) {
            return interaction.reply({ content: 'Du hast bereits ein offenes Ticket!', ephemeral: true });
        }

        const ticketChannel = await guild.channels.create({
            name: `ticket-${user.username}`,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: guild.id, denied: [PermissionFlagsBits.ViewChannel] },
                { id: user.id, allowed: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            ],
        });

        const embed = new EmbedBuilder()
            .setTitle('🎫 Support Ticket')
            .setDescription('Ein Teammitglied wird sich gleich um dein Anliegen kümmern.\nNutze `/ticket rename <neuer-name>`, um dieses Ticket umzubenennen.')
            .setColor(0x00FF00);

        const closeButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('close_ticket').setLabel('Ticket schließen').setStyle(ButtonStyle.Danger)
        );

        await ticketChannel.send({ content: `<@${user.id}>`, embeds: [embed], components: [closeButton] });
        await interaction.reply({ content: `Dein Ticket wurde erstellt: ${ticketChannel}`, ephemeral: true });
    }

    async closeTicket(interaction) {
        const channel = interaction.channel;
        if (!channel.name.startsWith('ticket-')) {
            return interaction.reply({ content: 'Dieser Befehl kann nur in Tickets genutzt werden!', ephemeral: true });
        }

        await interaction.reply({ content: 'Ticket wird in 5 Sekunden geschlossen...' });
        setTimeout(() => channel.delete().catch(() => {}), 5000);
    }
}

module.exports = new TicketService();