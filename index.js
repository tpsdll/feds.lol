const { 
    Client, 
    GatewayIntentBits, 
    Collection, 
    Events, 
    ActivityType, 
    EmbedBuilder, 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    ChannelType,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const sqlite3 = require('sqlite3').verbose();

// ==================== CONFIGURATION ====================
const config = {
    token: "MTQwODQwODg2NDIwMTc2OTAxMg.GxicLO.at027sNjamOTWA4OfZRsM_0iJ4wmCN8cpsBat8",
    clientId: "1408408864201769012",
    prefix: "!",
    colors: {
        primary: "#5865F2",
        success: "#57F287",
        error: "#ED4245",
        warning: "#FEE75C"
    },
    emojis: {
        success: "✅",
        error: "❌",
        warning: "⚠️",
        info: "ℹ️"
    }
};

// ==================== DATABASE CLASS ====================
class Database {
    constructor() {
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database('./bot.db', (err) => {
                if (err) {
                    console.error('Error opening database:', err);
                    reject(err);
                } else {
                    console.log('Connected to SQLite database');
                    this.createTables();
                    resolve();
                }
            });
        });
    }

    async createTables() {
        const tables = [
            `CREATE TABLE IF NOT EXISTS guilds (
                id TEXT PRIMARY KEY,
                name TEXT,
                prefix TEXT DEFAULT '!',
                welcome_channel TEXT,
                welcome_message TEXT,
                log_channel TEXT,
                ticket_category TEXT,
                ticket_counter INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS invites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT,
                user_id TEXT,
                inviter_id TEXT,
                code TEXT,
                uses INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT,
                user_id TEXT,
                message_count INTEGER DEFAULT 1,
                last_message DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT,
                channel_id TEXT,
                user_id TEXT,
                claimed_by TEXT,
                status TEXT DEFAULT 'open',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS giveaways (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT,
                channel_id TEXT,
                message_id TEXT,
                host_id TEXT,
                prize TEXT,
                winners INTEGER,
                end_time DATETIME,
                entries TEXT,
                ended BOOLEAN DEFAULT FALSE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS warnings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT,
                user_id TEXT,
                moderator_id TEXT,
                reason TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS self_roles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT,
                message_id TEXT,
                channel_id TEXT,
                roles TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        for (const table of tables) {
            this.db.run(table);
        }
    }

    async get(query, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(query, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async all(query, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async run(query, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(query, params, function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, changes: this.changes });
            });
        });
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

// ==================== MAIN BOT CLASS ====================
class MultipurposeBot extends Client {
    constructor() {
        super({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.GuildMessageReactions,
                GatewayIntentBits.GuildInvites,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.DirectMessages
            ],
            presence: {
                activities: [{
                    name: 'servers | /help',
                    type: ActivityType.Watching
                }],
                status: 'online'
            }
        });

        this.commands = new Collection();
        this.cooldowns = new Collection();
        this.giveaways = new Collection();
        this.tickets = new Collection();
        this.invites = new Collection();
        this.db = new Database();
        
        this.setupCommands();
        this.setupEvents();
        this.init();
    }

    async init() {
        await this.db.init();
        this.login(config.token);
    }

    setupCommands() {
        const commands = [
            // MODERATION COMMANDS
            {
                data: new SlashCommandBuilder()
                    .setName('ban')
                    .setDescription('Ban a user from the server')
                    .addUserOption(option =>
                        option.setName('user')
                            .setDescription('The user to ban')
                            .setRequired(true))
                    .addStringOption(option =>
                        option.setName('reason')
                            .setDescription('Reason for the ban')
                            .setRequired(false))
                    .addIntegerOption(option =>
                        option.setName('days')
                            .setDescription('Number of days of messages to delete (0-7)')
                            .setMinValue(0)
                            .setMaxValue(7)
                            .setRequired(false))
                    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
                execute: this.banCommand.bind(this)
            },
            {
                data: new SlashCommandBuilder()
                    .setName('kick')
                    .setDescription('Kick a user from the server')
                    .addUserOption(option =>
                        option.setName('user')
                            .setDescription('The user to kick')
                            .setRequired(true))
                    .addStringOption(option =>
                        option.setName('reason')
                            .setDescription('Reason for the kick')
                            .setRequired(false))
                    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
                execute: this.kickCommand.bind(this)
            },
            {
                data: new SlashCommandBuilder()
                    .setName('warn')
                    .setDescription('Warn a user')
                    .addUserOption(option =>
                        option.setName('user')
                            .setDescription('The user to warn')
                            .setRequired(true))
                    .addStringOption(option =>
                        option.setName('reason')
                            .setDescription('Reason for the warning')
                            .setRequired(true))
                    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
                execute: this.warnCommand.bind(this)
            },
            {
                data: new SlashCommandBuilder()
                    .setName('timeout')
                    .setDescription('Timeout a user')
                    .addUserOption(option =>
                        option.setName('user')
                            .setDescription('The user to timeout')
                            .setRequired(true))
                    .addIntegerOption(option =>
                        option.setName('duration')
                            .setDescription('Duration in minutes')
                            .setMinValue(1)
                            .setMaxValue(40320)
                            .setRequired(true))
                    .addStringOption(option =>
                        option.setName('reason')
                            .setDescription('Reason for the timeout')
                            .setRequired(false))
                    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
                execute: this.timeoutCommand.bind(this)
            },
            {
                data: new SlashCommandBuilder()
                    .setName('purge')
                    .setDescription('Delete multiple messages')
                    .addIntegerOption(option =>
                        option.setName('amount')
                            .setDescription('Number of messages to delete (1-100)')
                            .setMinValue(1)
                            .setMaxValue(100)
                            .setRequired(true))
                    .addUserOption(option =>
                        option.setName('user')
                            .setDescription('Only delete messages from this user')
                            .setRequired(false))
                    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
                execute: this.purgeCommand.bind(this)
            },
            {
                data: new SlashCommandBuilder()
                    .setName('lock')
                    .setDescription('Lock a channel')
                    .addChannelOption(option =>
                        option.setName('channel')
                            .setDescription('Channel to lock')
                            .setRequired(false))
                    .addStringOption(option =>
                        option.setName('reason')
                            .setDescription('Reason for locking')
                            .setRequired(false))
                    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
                execute: this.lockCommand.bind(this)
            },
            {
                data: new SlashCommandBuilder()
                    .setName('unlock')
                    .setDescription('Unlock a channel')
                    .addChannelOption(option =>
                        option.setName('channel')
                            .setDescription('Channel to unlock')
                            .setRequired(false))
                    .addStringOption(option =>
                        option.setName('reason')
                            .setDescription('Reason for unlocking')
                            .setRequired(false))
                    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
                execute: this.unlockCommand.bind(this)
            },

            // TICKET COMMANDS
            {
                data: new SlashCommandBuilder()
                    .setName('ticket-setup')
                    .setDescription('Setup the ticket system')
                    .addChannelOption(option =>
                        option.setName('category')
                            .setDescription('The category where tickets will be created')
                            .addChannelTypes(ChannelType.GuildCategory)
                            .setRequired(true))
                    .addChannelOption(option =>
                        option.setName('channel')
                            .setDescription('The channel where the ticket creation message will be sent')
                            .addChannelTypes(ChannelType.GuildText)
                            .setRequired(true))
                    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
                execute: this.ticketSetupCommand.bind(this)
            },
            {
                data: new SlashCommandBuilder()
                    .setName('ticket-close')
                    .setDescription('Close the current ticket')
                    .addStringOption(option =>
                        option.setName('reason')
                            .setDescription('Reason for closing')
                            .setRequired(false))
                    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
                execute: this.ticketCloseCommand.bind(this)
            },
            {
                data: new SlashCommandBuilder()
                    .setName('ticket-claim')
                    .setDescription('Claim the current ticket')
                    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
                execute: this.ticketClaimCommand.bind(this)
            },

            // GIVEAWAY COMMANDS
            {
                data: new SlashCommandBuilder()
                    .setName('giveaway')
                    .setDescription('Create a giveaway')
                    .addStringOption(option =>
                        option.setName('prize')
                            .setDescription('What is being given away')
                            .setRequired(true))
                    .addIntegerOption(option =>
                        option.setName('duration')
                            .setDescription('Duration in minutes')
                            .setMinValue(1)
                            .setRequired(true))
                    .addIntegerOption(option =>
                        option.setName('winners')
                            .setDescription('Number of winners')
                            .setMinValue(1)
                            .setRequired(true))
                    .addChannelOption(option =>
                        option.setName('channel')
                            .setDescription('Channel to post the giveaway')
                            .setRequired(false))
                    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
                execute: this.giveawayCommand.bind(this)
            },
            {
                data: new SlashCommandBuilder()
                    .setName('gend')
                    .setDescription('End a giveaway early')
                    .addStringOption(option =>
                        option.setName('message_id')
                            .setDescription('Message ID of the giveaway')
                            .setRequired(true))
                    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
                execute: this.gendCommand.bind(this)
            },
            {
                data: new SlashCommandBuilder()
                    .setName('greroll')
                    .setDescription('Reroll giveaway winners')
                    .addStringOption(option =>
                        option.setName('message_id')
                            .setDescription('Message ID of the giveaway')
                            .setRequired(true))
                    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
                execute: this.grerollCommand.bind(this)
            },

            // UTILITY COMMANDS
            {
                data: new SlashCommandBuilder()
                    .setName('help')
                    .setDescription('Display help information'),
                execute: this.helpCommand.bind(this)
            },
            {
                data: new SlashCommandBuilder()
                    .setName('ping')
                    .setDescription('Check bot latency'),
                execute: this.pingCommand.bind(this)
            },
            {
                data: new SlashCommandBuilder()
                    .setName('avatar')
                    .setDescription('Display user avatar')
                    .addUserOption(option =>
                        option.setName('user')
                            .setDescription('The user whose avatar to display')
                            .setRequired(false)),
                execute: this.avatarCommand.bind(this)
            },
            {
                data: new SlashCommandBuilder()
                    .setName('userinfo')
                    .setDescription('Display user information')
                    .addUserOption(option =>
                        option.setName('user')
                            .setDescription('The user to get information about')
                            .setRequired(false)),
                execute: this.userinfoCommand.bind(this)
            },
            {
                data: new SlashCommandBuilder()
                    .setName('serverinfo')
                    .setDescription('Display server information'),
                execute: this.serverinfoCommand.bind(this)
            },
            {
                data: new SlashCommandBuilder()
                    .setName('invites')
                    .setDescription('Check invite count for a user')
                    .addUserOption(option =>
                        option.setName('user')
                            .setDescription('The user to check invites for')
                            .setRequired(false)),
                execute: this.invitesCommand.bind(this)
            },
            {
                data: new SlashCommandBuilder()
                    .setName('leaderboard')
                    .setDescription('View server leaderboards')
                    .addStringOption(option =>
                        option.setName('type')
                            .setDescription('Type of leaderboard')
                            .setRequired(true)
                            .addChoices(
                                { name: 'Messages', value: 'messages' },
                                { name: 'Invites', value: 'invites' }
                            )),
                execute: this.leaderboardCommand.bind(this)
            },

            // SETUP COMMANDS
            {
                data: new SlashCommandBuilder()
                    .setName('setup')
                    .setDescription('Configure bot settings for your server')
                    .addChannelOption(option =>
                        option.setName('welcome_channel')
                            .setDescription('Channel for welcome messages')
                            .addChannelTypes(ChannelType.GuildText)
                            .setRequired(false))
                    .addChannelOption(option =>
                        option.setName('log_channel')
                            .setDescription('Channel for moderation logs')
                            .addChannelTypes(ChannelType.GuildText)
                            .setRequired(false))
                    .addStringOption(option =>
                        option.setName('prefix')
                            .setDescription('Command prefix for the bot')
                            .setMaxLength(5)
                            .setRequired(false))
                    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
                execute: this.setupCommand.bind(this)
            },
            {
                data: new SlashCommandBuilder()
                    .setName('welcome')
                    .setDescription('Setup welcome messages')
                    .addStringOption(option =>
                        option.setName('message')
                            .setDescription('Welcome message (use {user} for mention, {server} for server name)')
                            .setRequired(true))
                    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
                execute: this.welcomeCommand.bind(this)
            },
            {
                data: new SlashCommandBuilder()
                    .setName('selfrole')
                    .setDescription('Setup self-assignable roles')
                    .addStringOption(option =>
                        option.setName('title')
                            .setDescription('Title for the role selection message')
                            .setRequired(true))
                    .addRoleOption(option =>
                        option.setName('role1')
                            .setDescription('First role option')
                            .setRequired(true))
                    .addRoleOption(option =>
                        option.setName('role2')
                            .setDescription('Second role option')
                            .setRequired(false))
                    .addRoleOption(option =>
                        option.setName('role3')
                            .setDescription('Third role option')
                            .setRequired(false))
                    .addRoleOption(option =>
                        option.setName('role4')
                            .setDescription('Fourth role option')
                            .setRequired(false))
                    .addRoleOption(option =>
                        option.setName('role5')
                            .setDescription('Fifth role option')
                            .setRequired(false))
                    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
                execute: this.selfroleCommand.bind(this)
            }
        ];

        commands.forEach(command => {
            this.commands.set(command.data.name, command);
        });
    }

    setupEvents() {
        // Ready event
        this.once(Events.ClientReady, async () => {
            console.log(`Ready! Logged in as ${this.user.tag}`);
            console.log(`Bot is in ${this.guilds.cache.size} servers`);
            
            // Cache invites for all guilds
            for (const guild of this.guilds.cache.values()) {
                try {
                    const invites = await guild.invites.fetch();
                    this.invites.set(guild.id, new Map(invites.map(invite => [invite.code, invite.uses])));
                } catch (error) {
                    console.log(`Could not fetch invites for ${guild.name}`);
                }
            }

            await this.registerCommands();
        });

        // Interaction handling
        this.on(Events.InteractionCreate, async (interaction) => {
            if (interaction.isChatInputCommand()) {
                const command = this.commands.get(interaction.commandName);

                if (!command) {
                    console.error(`No command matching ${interaction.commandName} was found.`);
                    return;
                }

                try {
                    await command.execute(interaction, this);
                } catch (error) {
                    console.error(error);
                    const errorEmbed = new EmbedBuilder()
                        .setColor(config.colors.error)
                        .setTitle('Error')
                        .setDescription('There was an error while executing this command!');

                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
                    } else {
                        await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
                    }
                }
            } else if (interaction.isButton()) {
                await this.handleButtonInteraction(interaction);
            } else if (interaction.isStringSelectMenu()) {
                await this.handleSelectMenuInteraction(interaction);
            }
        });

        // Guild member add (welcome messages and invite tracking)
        this.on(Events.GuildMemberAdd, async (member) => {
            // Handle welcome messages
            const guild = await this.db.get('SELECT * FROM guilds WHERE id = ?', [member.guild.id]);
            
            if (guild && guild.welcome_channel && guild.welcome_message) {
                const welcomeChannel = member.guild.channels.cache.get(guild.welcome_channel);
                
                if (welcomeChannel) {
                    let message = guild.welcome_message
                        .replace(/{user}/g, `<@${member.id}>`)
                        .replace(/{server}/g, member.guild.name)
                        .replace(/{memberCount}/g, member.guild.memberCount);

                    const welcomeEmbed = new EmbedBuilder()
                        .setColor(config.colors.success)
                        .setTitle(`Welcome to ${member.guild.name}!`)
                        .setDescription(message)
                        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                        .setFooter({ text: `Member #${member.guild.memberCount}` })
                        .setTimestamp();

                    await welcomeChannel.send({ embeds: [welcomeEmbed] });
                }
            }

            // Handle invite tracking
            const newInvites = await member.guild.invites.fetch();
            const oldInvites = this.invites.get(member.guild.id);

            if (oldInvites) {
                const usedInvite = newInvites.find(inv => oldInvites.get(inv.code) < inv.uses);
                
                if (usedInvite) {
                    await this.db.run(
                        'INSERT INTO invites (guild_id, user_id, inviter_id, code) VALUES (?, ?, ?, ?)',
                        [member.guild.id, member.id, usedInvite.inviter.id, usedInvite.code]
                    );
                }
            }

            this.invites.set(member.guild.id, new Map(newInvites.map(invite => [invite.code, invite.uses])));
        });

        // Message create (message counting)
        this.on(Events.MessageCreate, async (message) => {
            if (message.author.bot || !message.guild) return;

            const existingUser = await this.db.get(
                'SELECT * FROM messages WHERE guild_id = ? AND user_id = ?',
                [message.guild.id, message.author.id]
            );

            if (existingUser) {
                await this.db.run(
                    'UPDATE messages SET message_count = message_count + 1, last_message = CURRENT_TIMESTAMP WHERE guild_id = ? AND user_id = ?',
                    [message.guild.id, message.author.id]
                );
            } else {
                await this.db.run(
                    'INSERT INTO messages (guild_id, user_id, message_count) VALUES (?, ?, 1)',
                    [message.guild.id, message.author.id]
                );
            }
        });

        // Invite create/delete
        this.on(Events.InviteCreate, (invite) => {
            const guildInvites = this.invites.get(invite.guild.id) || new Map();
            guildInvites.set(invite.code, invite.uses);
            this.invites.set(invite.guild.id, guildInvites);
        });

        this.on(Events.InviteDelete, (invite) => {
            const guildInvites = this.invites.get(invite.guild.id);
            if (guildInvites) {
                guildInvites.delete(invite.code);
                this.invites.set(invite.guild.id, guildInvites);
            }
        });
    }

    async registerCommands() {
        const commands = [];
        
        for (const command of this.commands.values()) {
            commands.push(command.data.toJSON());
        }

        const rest = new REST({ version: '10' }).setToken(config.token);

        try {
            console.log('Started refreshing application (/) commands.');

            await rest.put(
                Routes.applicationCommands(config.clientId),
                { body: commands },
            );

            console.log('Successfully reloaded application (/) commands.');
        } catch (error) {
            console.error(error);
        }
    }

    // ==================== BUTTON INTERACTIONS ====================
    async handleButtonInteraction(interaction) {
        const customId = interaction.customId;

        if (customId === 'create_ticket') {
            const guild = await this.db.get('SELECT * FROM guilds WHERE id = ?', [interaction.guild.id]);
            if (!guild || !guild.ticket_category) {
                return interaction.reply({ content: 'Ticket system is not configured for this server!', ephemeral: true });
            }

            const existingTicket = await this.db.get('SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND status = "open"', 
                [interaction.guild.id, interaction.user.id]);

            if (existingTicket) {
                return interaction.reply({ content: 'You already have an open ticket!', ephemeral: true });
            }

            const category = interaction.guild.channels.cache.get(guild.ticket_category);
            const ticketNumber = guild.ticket_counter + 1;
            
            const channel = await interaction.guild.channels.create({
                name: `ticket-${ticketNumber}`,
                type: ChannelType.GuildText,
                parent: category,
                permissionOverwrites: [
                    {
                        id: interaction.guild.id,
                        deny: ['ViewChannel'],
                    },
                    {
                        id: interaction.user.id,
                        allow: ['ViewChannel', 'SendMessages', 'AttachFiles', 'EmbedLinks'],
                    },
                ],
            });

            await this.db.run('UPDATE guilds SET ticket_counter = ? WHERE id = ?', [ticketNumber, interaction.guild.id]);
            await this.db.run('INSERT INTO tickets (guild_id, channel_id, user_id) VALUES (?, ?, ?)',
                [interaction.guild.id, channel.id, interaction.user.id]);

            const ticketEmbed = new EmbedBuilder()
                .setColor(config.colors.primary)
                .setTitle(`Ticket #${ticketNumber}`)
                .setDescription(`Hello ${interaction.user}, thank you for creating a ticket! Please describe your issue and our staff will assist you shortly.`)
                .setTimestamp();

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('close_ticket')
                        .setLabel('Close Ticket')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🔒'),
                    new ButtonBuilder()
                        .setCustomId('claim_ticket')
                        .setLabel('Claim Ticket')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🎫')
                );

            await channel.send({ 
                content: `${interaction.user}`,
                embeds: [ticketEmbed],
                components: [row]
            });

            await interaction.reply({ content: `Ticket created! ${channel}`, ephemeral: true });
        }

        if (customId === 'close_ticket') {
            const ticket = await this.db.get(
                'SELECT * FROM tickets WHERE guild_id = ? AND channel_id = ? AND status = "open"',
                [interaction.guild.id, interaction.channel.id]
            );

            if (!ticket) {
                return interaction.reply({ content: 'This is not a ticket channel!', ephemeral: true });
            }

            const closeEmbed = new EmbedBuilder()
                .setColor(config.colors.error)
                .setTitle('🔒 Ticket Closed')
                .setDescription(`This ticket has been closed by ${interaction.user}.`)
                .setTimestamp();

            await interaction.reply({ embeds: [closeEmbed] });
            await this.db.run('UPDATE tickets SET status = "closed" WHERE id = ?', [ticket.id]);

            setTimeout(async () => {
                try {
                    await interaction.channel.delete();
                } catch (error) {
                    console.error('Failed to delete ticket channel:', error);
                }
            }, 5000);
        }

        if (customId === 'claim_ticket') {
            const ticket = await this.db.get(
                'SELECT * FROM tickets WHERE guild_id = ? AND channel_id = ? AND status = "open"',
                [interaction.guild.id, interaction.channel.id]
            );

            if (!ticket) {
                return interaction.reply({ content: 'This is not a ticket channel!', ephemeral: true });
            }

            if (ticket.claimed_by) {
                return interaction.reply({ content: 'This ticket is already claimed!', ephemeral: true });
            }

            await this.db.run('UPDATE tickets SET claimed_by = ? WHERE id = ?', [interaction.user.id, ticket.id]);

            const claimEmbed = new EmbedBuilder()
                .setColor(config.colors.success)
                .setTitle('🎫 Ticket Claimed')
                .setDescription(`This ticket has been claimed by ${interaction.user}.`)
                .setTimestamp();

            await interaction.reply({ embeds: [claimEmbed] });
            await interaction.channel.setName(`${interaction.channel.name}-claimed`);
        }
    }

    // ==================== SELECT MENU INTERACTIONS ====================
    async handleSelectMenuInteraction(interaction) {
        if (interaction.customId.startsWith('self_roles_')) {
            const selectedRoles = interaction.values;
            const member = interaction.member;
            
            for (const roleId of selectedRoles) {
                const role = interaction.guild.roles.cache.get(roleId);
                if (role && !member.roles.cache.has(roleId)) {
                    await member.roles.add(role);
                }
            }
            
            await interaction.reply({ 
                content: `Added ${selectedRoles.length} role(s) to your profile!`, 
                ephemeral: true 
            });
        }
    }

    // ==================== MODERATION COMMANDS ====================
    async banCommand(interaction) {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const days = interaction.options.getInteger('days') || 0;

        if (user.id === interaction.user.id) {
            return interaction.reply({ content: 'You cannot ban yourself!', ephemeral: true });
        }

        if (user.id === interaction.guild.ownerId) {
            return interaction.reply({ content: 'You cannot ban the server owner!', ephemeral: true });
        }

        try {
            const member = await interaction.guild.members.fetch(user.id);
            
            if (member && member.roles.highest.position >= interaction.member.roles.highest.position) {
                return interaction.reply({ content: 'You cannot ban this user due to role hierarchy!', ephemeral: true });
            }

            await interaction.guild.members.ban(user, { 
                deleteMessageDays: days, 
                reason: `${reason} | Banned by ${interaction.user.tag}` 
            });

            const banEmbed = new EmbedBuilder()
                .setColor(config.colors.error)
                .setTitle('User Banned')
                .setDescription(`**User:** ${user.tag} (${user.id})\n**Moderator:** ${interaction.user.tag}\n**Reason:** ${reason}`)
                .setTimestamp();

            await interaction.reply({ embeds: [banEmbed] });
            await this.logModeration(interaction, 'ban', user.id, reason);

        } catch (error) {
            console.error(error);
            await interaction.reply({ content: 'Failed to ban the user!', ephemeral: true });
        }
    }

    async kickCommand(interaction) {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        if (user.id === interaction.user.id) {
            return interaction.reply({ content: 'You cannot kick yourself!', ephemeral: true });
        }

        if (user.id === interaction.guild.ownerId) {
            return interaction.reply({ content: 'You cannot kick the server owner!', ephemeral: true });
        }

        try {
            const member = await interaction.guild.members.fetch(user.id);
            
            if (member.roles.highest.position >= interaction.member.roles.highest.position) {
                return interaction.reply({ content: 'You cannot kick this user due to role hierarchy!', ephemeral: true });
            }

            await member.kick(`${reason} | Kicked by ${interaction.user.tag}`);

            const kickEmbed = new EmbedBuilder()
                .setColor(config.colors.warning)
                .setTitle('👢 User Kicked')
                .setDescription(`**User:** ${user.tag} (${user.id})\n**Moderator:** ${interaction.user.tag}\n**Reason:** ${reason}`)
                .setTimestamp();

            await interaction.reply({ embeds: [kickEmbed] });
            await this.logModeration(interaction, 'kick', user.id, reason);

        } catch (error) {
            console.error(error);
            await interaction.reply({ content: 'Failed to kick the user!', ephemeral: true });
        }
    }

    async warnCommand(interaction) {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');

        if (user.id === interaction.user.id) {
            return interaction.reply({ content: 'You cannot warn yourself!', ephemeral: true });
        }

        await this.db.run(
            'INSERT INTO warnings (guild_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?)',
            [interaction.guild.id, user.id, interaction.user.id, reason]
        );

        const warningCount = await this.db.get(
            'SELECT COUNT(*) as count FROM warnings WHERE guild_id = ? AND user_id = ?',
            [interaction.guild.id, user.id]
        );

        const warnEmbed = new EmbedBuilder()
            .setColor(config.colors.warning)
            .setTitle('⚠️ User Warned')
            .setDescription(`**User:** ${user.tag} (${user.id})\n**Moderator:** ${interaction.user.tag}\n**Reason:** ${reason}\n**Total Warnings:** ${warningCount.count}`)
            .setTimestamp();

        await interaction.reply({ embeds: [warnEmbed] });

        try {
            const dmEmbed = new EmbedBuilder()
                .setColor(config.colors.warning)
                .setTitle(`⚠️ You have been warned in ${interaction.guild.name}`)
                .setDescription(`**Reason:** ${reason}\n**Total Warnings:** ${warningCount.count}`)
                .setTimestamp();

            await user.send({ embeds: [dmEmbed] });
        } catch (error) {
            // User has DMs disabled
        }

        await this.logModeration(interaction, 'warn', user.id, reason);
    }

    async timeoutCommand(interaction) {
        const user = interaction.options.getUser('user');
        const duration = interaction.options.getInteger('duration');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        if (user.id === interaction.user.id) {
            return interaction.reply({ content: 'You cannot timeout yourself!', ephemeral: true });
        }

        try {
            const member = await interaction.guild.members.fetch(user.id);
            
            if (member.roles.highest.position >= interaction.member.roles.highest.position) {
                return interaction.reply({ content: 'You cannot timeout this user due to role hierarchy!', ephemeral: true });
            }

            const timeoutDuration = duration * 60 * 1000;
            await member.timeout(timeoutDuration, `${reason} | Timed out by ${interaction.user.tag}`);

            const timeoutEmbed = new EmbedBuilder()
                .setColor(config.colors.warning)
                .setTitle('🔇 User Timed Out')
                .setDescription(`**User:** ${user.tag} (${user.id})\n**Moderator:** ${interaction.user.tag}\n**Duration:** ${duration} minute(s)\n**Reason:** ${reason}`)
                .setTimestamp();

            await interaction.reply({ embeds: [timeoutEmbed] });
            await this.logModeration(interaction, 'timeout', user.id, `${reason} (${duration} minutes)`);

        } catch (error) {
            console.error(error);
            await interaction.reply({ content: 'Failed to timeout the user!', ephemeral: true });
        }
    }

    async purgeCommand(interaction) {
        const amount = interaction.options.getInteger('amount');
        const targetUser = interaction.options.getUser('user');

        await interaction.deferReply({ ephemeral: true });

        try {
            const messages = await interaction.channel.messages.fetch({ limit: amount });
            
            let messagesToDelete = messages;
            if (targetUser) {
                messagesToDelete = messages.filter(msg => msg.author.id === targetUser.id);
            }

            const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
            messagesToDelete = messagesToDelete.filter(msg => msg.createdTimestamp > twoWeeksAgo);

            if (messagesToDelete.size === 0) {
                return interaction.editReply({ content: 'No messages found to delete!' });
            }

            await interaction.channel.bulkDelete(messagesToDelete, true);

            const embed = new EmbedBuilder()
                .setColor(config.colors.success)
                .setTitle('✅ Messages Purged')
                .setDescription(`Successfully deleted ${messagesToDelete.size} message(s)${targetUser ? ` from ${targetUser.tag}` : ''}`)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

            const guild = await this.db.get('SELECT log_channel FROM guilds WHERE id = ?', [interaction.guild.id]);
            
            if (guild && guild.log_channel) {
                const logChannel = interaction.guild.channels.cache.get(guild.log_channel);
                
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setColor(config.colors.warning)
                        .setTitle('🗑️ Messages Purged')
                        .setDescription(`**Channel:** ${interaction.channel}\n**Moderator:** ${interaction.user.tag}\n**Amount:** ${messagesToDelete.size} messages${targetUser ? `\n**Target User:** ${targetUser.tag}` : ''}`)
                        .setTimestamp();

                    await logChannel.send({ embeds: [logEmbed] });
                }
            }

        } catch (error) {
            console.error(error);
            await interaction.editReply({ content: 'Failed to delete messages!' });
        }
    }

    async lockCommand(interaction) {
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const reason = interaction.options.getString('reason') || 'No reason provided';

        try {
            await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
                SendMessages: false
            });

            const lockEmbed = new EmbedBuilder()
                .setColor(config.colors.error)
                .setTitle('🔒 Channel Locked')
                .setDescription(`${channel} has been locked.\n**Reason:** ${reason}`)
                .setTimestamp();

            await interaction.reply({ embeds: [lockEmbed] });

        } catch (error) {
            console.error(error);
            await interaction.reply({ content: 'Failed to lock the channel!', ephemeral: true });
        }
    }

    async unlockCommand(interaction) {
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const reason = interaction.options.getString('reason') || 'No reason provided';

        try {
            await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
                SendMessages: null
            });

            const unlockEmbed = new EmbedBuilder()
                .setColor(config.colors.success)
                .setTitle('🔓 Channel Unlocked')
                .setDescription(`${channel} has been unlocked.\n**Reason:** ${reason}`)
                .setTimestamp();

            await interaction.reply({ embeds: [unlockEmbed] });

        } catch (error) {
            console.error(error);
            await interaction.reply({ content: 'Failed to unlock the channel!', ephemeral: true });
        }
    }

    // ==================== TICKET COMMANDS ====================
    async ticketSetupCommand(interaction) {
        const category = interaction.options.getChannel('category');
        const channel = interaction.options.getChannel('channel');

        await this.db.run(
            `INSERT OR REPLACE INTO guilds (id, name, ticket_category) 
             VALUES (?, ?, ?)`,
            [interaction.guild.id, interaction.guild.name, category.id]
        );

        const ticketEmbed = new EmbedBuilder()
            .setColor(config.colors.primary)
            .setTitle('🎫 Create a Ticket')
            .setDescription('Click the button below to create a new support ticket. Our staff will assist you as soon as possible!')
            .addFields(
                { name: '📝 Before creating a ticket:', value: '• Make sure your question hasn\'t been answered in FAQ\n• Be clear and detailed about your issue\n• Be patient while waiting for a response' }
            )
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('create_ticket')
                    .setLabel('Create Ticket')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🎫')
            );

        await channel.send({ embeds: [ticketEmbed], components: [row] });
        await interaction.reply({ content: `Ticket system setup complete in ${channel}!`, ephemeral: true });
    }

    async ticketCloseCommand(interaction) {
        const ticket = await this.db.get(
            'SELECT * FROM tickets WHERE guild_id = ? AND channel_id = ? AND status = "open"',
            [interaction.guild.id, interaction.channel.id]
        );

        if (!ticket) {
            return interaction.reply({ content: 'This is not a ticket channel!', ephemeral: true });
        }

        const reason = interaction.options.getString('reason') || 'No reason provided';

        const closeEmbed = new EmbedBuilder()
            .setColor(config.colors.error)
            .setTitle('🔒 Ticket Closed')
            .setDescription(`This ticket has been closed by ${interaction.user}.\n**Reason:** ${reason}`)
            .setTimestamp();

        await interaction.reply({ embeds: [closeEmbed] });
        await this.db.run('UPDATE tickets SET status = "closed" WHERE id = ?', [ticket.id]);

        setTimeout(async () => {
            try {
                await interaction.channel.delete();
            } catch (error) {
                console.error('Failed to delete ticket channel:', error);
            }
        }, 5000);
    }

    async ticketClaimCommand(interaction) {
        const ticket = await this.db.get(
            'SELECT * FROM tickets WHERE guild_id = ? AND channel_id = ? AND status = "open"',
            [interaction.guild.id, interaction.channel.id]
        );

        if (!ticket) {
            return interaction.reply({ content: 'This is not a ticket channel!', ephemeral: true });
        }

        if (ticket.claimed_by) {
            return interaction.reply({ content: 'This ticket is already claimed!', ephemeral: true });
        }

        await this.db.run('UPDATE tickets SET claimed_by = ? WHERE id = ?', [interaction.user.id, ticket.id]);

        const claimEmbed = new EmbedBuilder()
            .setColor(config.colors.success)
            .setTitle('🎫 Ticket Claimed')
            .setDescription(`This ticket has been claimed by ${interaction.user}.`)
            .setTimestamp();

        await interaction.reply({ embeds: [claimEmbed] });
        await interaction.channel.setName(`${interaction.channel.name}-claimed`);
    }

    // ==================== GIVEAWAY COMMANDS ====================
    async giveawayCommand(interaction) {
        const prize = interaction.options.getString('prize');
        const duration = interaction.options.getInteger('duration') * 60 * 1000;
        const winners = interaction.options.getInteger('winners');
        const channel = interaction.options.getChannel('channel') || interaction.channel;

        const endTime = new Date(Date.now() + duration);

        const giveawayEmbed = new EmbedBuilder()
            .setColor(config.colors.primary)
            .setTitle('🎉 GIVEAWAY 🎉')
            .setDescription(`**Prize:** ${prize}\n**Winners:** ${winners}\n**Hosted by:** ${interaction.user}\n**Ends:** <t:${Math.floor(endTime.getTime() / 1000)}:R>`)
            .setFooter({ text: 'Click the 🎉 to enter!' })
            .setTimestamp(endTime);

        const giveawayMessage = await channel.send({ embeds: [giveawayEmbed] });
        await giveawayMessage.react('🎉');

        await this.db.run(
            'INSERT INTO giveaways (guild_id, channel_id, message_id, host_id, prize, winners, end_time, entries) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [interaction.guild.id, channel.id, giveawayMessage.id, interaction.user.id, prize, winners, endTime.toISOString(), '[]']
        );

        setTimeout(async () => {
            await this.endGiveaway(interaction.guild.id, giveawayMessage.id);
        }, duration);

        await interaction.reply({ content: `Giveaway created in ${channel}!`, ephemeral: true });
    }

    async gendCommand(interaction) {
        const messageId = interaction.options.getString('message_id');

        const giveaway = await this.db.get(
            'SELECT * FROM giveaways WHERE guild_id = ? AND message_id = ? AND ended = FALSE',
            [interaction.guild.id, messageId]
        );

        if (!giveaway) {
            return interaction.reply({ content: 'Giveaway not found or already ended!', ephemeral: true });
        }

        await this.endGiveaway(interaction.guild.id, messageId);
        await interaction.reply({ content: 'Giveaway ended successfully!', ephemeral: true });
    }

    async grerollCommand(interaction) {
        const messageId = interaction.options.getString('message_id');

        const giveaway = await this.db.get(
            'SELECT * FROM giveaways WHERE guild_id = ? AND message_id = ? AND ended = TRUE',
            [interaction.guild.id, messageId]
        );

        if (!giveaway) {
            return interaction.reply({ content: 'Giveaway not found or not ended!', ephemeral: true });
        }

        const channel = interaction.guild.channels.cache.get(giveaway.channel_id);
        const message = await channel.messages.fetch(messageId);

        const reaction = message.reactions.cache.get('🎉');
        const users = await reaction.users.fetch();
        const entries = users.filter(user => !user.bot).map(user => user.id);

        if (entries.length === 0) {
            return interaction.reply({ content: 'No valid entries to reroll!', ephemeral: true });
        }

        const winnersCount = Math.min(giveaway.winners, entries.length);
        const winners = [];

        for (let i = 0; i < winnersCount; i++) {
            const randomIndex = Math.floor(Math.random() * entries.length);
            winners.push(entries.splice(randomIndex, 1)[0]);
        }

        const winnerMentions = winners.map(id => `<@${id}>`).join(', ');

        const rerollEmbed = new EmbedBuilder()
            .setColor(config.colors.success)
            .setTitle('🎉 GIVEAWAY REROLLED 🎉')
            .setDescription(`**Prize:** ${giveaway.prize}\n**New Winner(s):** ${winnerMentions}\n**Hosted by:** <@${giveaway.host_id}>`)
            .setFooter({ text: 'Congratulations to the new winners!' })
            .setTimestamp();

        await message.edit({ embeds: [rerollEmbed] });
        await channel.send(`🎉 New winners for **${giveaway.prize}**: ${winnerMentions}!`);
        await interaction.reply({ content: 'Giveaway rerolled successfully!', ephemeral: true });
    }

    async endGiveaway(guildId, messageId) {
        const giveaway = await this.db.get(
            'SELECT * FROM giveaways WHERE guild_id = ? AND message_id = ? AND ended = FALSE',
            [guildId, messageId]
        );

        if (!giveaway) return;

        const guild = this.guilds.cache.get(guildId);
        const channel = guild.channels.cache.get(giveaway.channel_id);
        const message = await channel.messages.fetch(messageId);

        const reaction = message.reactions.cache.get('🎉');
        const users = await reaction.users.fetch();
        const entries = users.filter(user => !user.bot).map(user => user.id);

        if (entries.length === 0) {
            const noEntriesEmbed = new EmbedBuilder()
                .setColor(config.colors.error)
                .setTitle('🎉 GIVEAWAY ENDED 🎉')
                .setDescription(`**Prize:** ${giveaway.prize}\n**Winner:** No valid entries`)
                .setFooter({ text: 'Better luck next time!' });

            await message.edit({ embeds: [noEntriesEmbed] });
            return;
        }

        const winnersCount = Math.min(giveaway.winners, entries.length);
        const winners = [];

        for (let i = 0; i < winnersCount; i++) {
            const randomIndex = Math.floor(Math.random() * entries.length);
            winners.push(entries.splice(randomIndex, 1)[0]);
        }

        const winnerMentions = winners.map(id => `<@${id}>`).join(', ');

        const endEmbed = new EmbedBuilder()
            .setColor(config.colors.success)
            .setTitle('🎉 GIVEAWAY ENDED 🎉')
            .setDescription(`**Prize:** ${giveaway.prize}\n**Winner(s):** ${winnerMentions}\n**Hosted by:** <@${giveaway.host_id}>`)
            .setFooter({ text: 'Congratulations!' })
            .setTimestamp();

        await message.edit({ embeds: [endEmbed] });
        await channel.send(`🎉 Congratulations ${winnerMentions}! You won **${giveaway.prize}**!`);
        await this.db.run('UPDATE giveaways SET ended = TRUE WHERE id = ?', [giveaway.id]);
    }

    // ==================== UTILITY COMMANDS ====================
    async helpCommand(interaction) {
        const helpEmbed = new EmbedBuilder()
            .setColor(config.colors.primary)
            .setTitle('🤖 Bot Help')
            .setDescription('Here are all the available commands and features:')
            .addFields(
                {
                    name: '🛡️ Moderation',
                    value: '`/ban` - Ban a user\n`/kick` - Kick a user\n`/warn` - Warn a user\n`/timeout` - Timeout a user\n`/purge` - Delete messages\n`/lock` - Lock a channel\n`/unlock` - Unlock a channel',
                    inline: true
                },
                {
                    name: '🎫 Tickets',
                    value: '`/ticket-setup` - Setup ticket system\n`/ticket-close` - Close a ticket\n`/ticket-claim` - Claim a ticket',
                    inline: true
                },
                {
                    name: '🎉 Giveaways',
                    value: '`/giveaway` - Create a giveaway\n`/gend` - End a giveaway early\n`/greroll` - Reroll giveaway winners',
                    inline: true
                },
                {
                    name: '📊 Statistics',
                    value: '`/leaderboard` - View leaderboards\n`/invites` - Check invite count\n`/serverinfo` - Server information',
                    inline: true
                },
                {
                    name: '⚙️ Setup',
                    value: '`/setup` - Configure bot settings\n`/welcome` - Setup welcome messages\n`/selfrole` - Setup self-assignable roles',
                    inline: true
                },
                {
                    name: '📋 Utility',
                    value: '`/userinfo` - User information\n`/avatar` - User avatar\n`/ping` - Bot latency',
                    inline: true
                }
            )
            .setFooter({ text: 'Use /command for detailed information about each command' })
            .setTimestamp();

        await interaction.reply({ embeds: [helpEmbed] });
    }

    async pingCommand(interaction) {
        const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
        const timeDiff = sent.createdTimestamp - interaction.createdTimestamp;

        const embed = new EmbedBuilder()
            .setColor(config.colors.primary)
            .setTitle('🏓 Pong!')
            .addFields(
                { name: 'Bot Latency', value: `${timeDiff}ms`, inline: true },
                { name: 'API Latency', value: `${Math.round(this.ws.ping)}ms`, inline: true }
            )
            .setTimestamp();

        await interaction.editReply({ content: null, embeds: [embed] });
    }

    async avatarCommand(interaction) {
        const user = interaction.options.getUser('user') || interaction.user;

        const embed = new EmbedBuilder()
            .setColor(config.colors.primary)
            .setTitle(`${user.username}'s Avatar`)
            .setImage(user.displayAvatarURL({ dynamic: true, size: 1024 }))
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }

    async userinfoCommand(interaction) {
        const user = interaction.options.getUser('user') || interaction.user;
        const member = interaction.guild.members.cache.get(user.id);

        const embed = new EmbedBuilder()
            .setColor(config.colors.primary)
            .setTitle(`${user.tag} - User Information`)
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '👤 General', value: `**ID:** ${user.id}\n**Created:** <t:${Math.floor(user.createdTimestamp / 1000)}:F>\n**Bot:** ${user.bot ? 'Yes' : 'No'}`, inline: true }
            );

        if (member) {
            embed.addFields(
                { name: '📅 Server Info', value: `**Joined:** <t:${Math.floor(member.joinedTimestamp / 1000)}:F>\n**Nickname:** ${member.nickname || 'None'}`, inline: true },
                { name: '🎭 Roles', value: member.roles.cache.size > 1 ? member.roles.cache.filter(r => r.id !== interaction.guild.id).map(r => r).join(', ').slice(0, 1024) : 'None', inline: false }
            );
        }

        await interaction.reply({ embeds: [embed] });
    }

    async serverinfoCommand(interaction) {
        const { guild } = interaction;

        const embed = new EmbedBuilder()
            .setColor(config.colors.primary)
            .setTitle(`${guild.name} - Server Information`)
            .setThumbnail(guild.iconURL({ dynamic: true }))
            .addFields(
                { name: '📊 General', value: `**Owner:** <@${guild.ownerId}>\n**Created:** <t:${Math.floor(guild.createdTimestamp / 1000)}:F>\n**ID:** ${guild.id}`, inline: true },
                { name: '👥 Members', value: `**Total:** ${guild.memberCount}\n**Humans:** ${guild.members.cache.filter(m => !m.user.bot).size}\n**Bots:** ${guild.members.cache.filter(m => m.user.bot).size}`, inline: true },
                { name: '📁 Channels', value: `**Text:** ${guild.channels.cache.filter(c => c.type === 0).size}\n**Voice:** ${guild.channels.cache.filter(c => c.type === 2).size}\n**Categories:** ${guild.channels.cache.filter(c => c.type === 4).size}`, inline: true },
                { name: '🎭 Roles', value: `${guild.roles.cache.size}`, inline: true },
                { name: '😀 Emojis', value: `${guild.emojis.cache.size}`, inline: true },
                { name: '🚀 Boosts', value: `**Level:** ${guild.premiumTier}\n**Boosts:** ${guild.premiumSubscriptionCount || 0}`, inline: true }
            )
            .setFooter({ text: `Verification Level: ${['None', 'Low', 'Medium', 'High', 'Very High'][guild.verificationLevel]}` })
            .setTimestamp();

        if (guild.banner) {
            embed.setImage(guild.bannerURL({ dynamic: true, size: 1024 }));
        }

        await interaction.reply({ embeds: [embed] });
    }

    async invitesCommand(interaction) {
        const user = interaction.options.getUser('user') || interaction.user;

        const inviteData = await this.db.get(
            'SELECT COUNT(*) as count FROM invites WHERE guild_id = ? AND inviter_id = ?',
            [interaction.guild.id, user.id]
        );

        const embed = new EmbedBuilder()
            .setColor(config.colors.primary)
            .setTitle('📬 Invite Information')
            .setDescription(`${user.tag} has invited **${inviteData.count || 0}** members to this server!`)
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }

    async leaderboardCommand(interaction) {
        const type = interaction.options.getString('type');

        if (type === 'messages') {
            const messages = await this.db.all(
                'SELECT user_id, message_count FROM messages WHERE guild_id = ? ORDER BY message_count DESC LIMIT 10',
                [interaction.guild.id]
            );

            if (messages.length === 0) {
                return interaction.reply({ content: 'No message data available yet!', ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setColor(config.colors.primary)
                .setTitle('📊 Message Leaderboard')
                .setDescription(
                    messages.map((user, index) => {
                        const member = interaction.guild.members.cache.get(user.user_id);
                        const username = member ? member.user.username : 'Unknown User';
                        return `${index + 1}. **${username}** - ${user.message_count} messages`;
                    }).join('\n')
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });

        }
