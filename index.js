const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Bot configuration
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ]
});

// ====== CONFIGURATION ======
// Set your suggestion channel ID here
const SUGGESTION_CHANNEL_ID = '1408820930393800798'; // Replace with your channel ID

// Store for paginated results
const searchResults = new Map();

// Store for custom approved tags (guild_id -> [tags])
const customTags = new Map();

// Store for pending suggestions
const pendingSuggestions = new Map();

// Register slash commands
const commands = [
    new SlashCommandBuilder()
        .setName('tag-search')
        .setDescription('Search for Discord servers by tag')
        .addStringOption(option =>
            option.setName('tag')
                .setDescription('The tag to search for')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('tag-suggest')
        .setDescription('Suggest a new tag for a server')
        .addStringOption(option =>
            option.setName('server')
                .setDescription('The server name or ID to add the tag to')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('tag')
                .setDescription('The tag you want to suggest')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Why this tag fits the server')
                .setRequired(false)
        ),
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show help information about the bot')
];

// Bot ready event
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} is online!`);
    
    // Register slash commands globally
    try {
        console.log('🔄 Refreshing slash commands...');
        await client.application.commands.set(commands);
        console.log('✅ Slash commands registered successfully!');
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
});

// Function to search guilds by tag
async function searchGuildsByTag(tag) {
    const results = [];
    
    // Iterate through all guilds the bot is in
    for (const [guildId, guild] of client.guilds.cache) {
        try {
            // Fetch full guild data to get tags
            const fullGuild = await guild.fetch();
            
            // Check if guild has the tag (case insensitive)
            if (fullGuild.features && fullGuild.features.some(feature => 
                feature.toLowerCase().includes(tag.toLowerCase())
            )) {
                // Try to get an invite link
                let inviteLink = null;
                try {
                    const channels = guild.channels.cache.filter(ch => 
                        ch.type === 0 && ch.permissionsFor(guild.members.me).has(['CreateInstantInvite'])
                    );
                    
                    if (channels.size > 0) {
                        const invite = await channels.first().createInvite({
                            maxAge: 0, // Permanent
                            maxUses: 0, // Unlimited uses
                            reason: 'Tag search bot invite'
                        });
                        inviteLink = invite.url;
                    }
                } catch (inviteError) {
                    console.log(`Could not create invite for ${guild.name}:`, inviteError.message);
                }
                
                results.push({
                    name: guild.name,
                    id: guild.id,
                    icon: guild.iconURL({ dynamic: true, size: 256 }) || null,
                    memberCount: guild.memberCount,
                    features: fullGuild.features,
                    inviteLink: inviteLink,
                    description: guild.description || 'No description available'
                });
            }
        } catch (error) {
            console.error(`Error processing guild ${guild.name}:`, error);
        }
    }
    
    return results;
}

// Function to create embed for guild results
function createGuildEmbed(guilds, page, totalPages, tag) {
    const guild = guilds[page];
    
    const embed = new EmbedBuilder()
        .setTitle(`🏷️ Tag Search Results: "${tag}"`)
        .setDescription(`**${guild.name}**\n${guild.description}`)
        .setColor(0x5865F2)
        .addFields(
            { name: '👥 Members', value: guild.memberCount.toString(), inline: true },
            { name: '🆔 Guild ID', value: guild.id, inline: true },
            { name: '🔗 Invite', value: guild.inviteLink || 'No invite available', inline: false }
        )
        .setFooter({ 
            text: `Page ${page + 1} of ${totalPages} • ${guilds.length} servers found` 
        })
        .setTimestamp();
    
    if (guild.icon) {
        embed.setThumbnail(guild.icon);
    }
    
    // Add features/tags if available
    if (guild.features && guild.features.length > 0) {
        const features = guild.features.slice(0, 10).join(', ');
        embed.addFields({ name: '✨ Features', value: features, inline: false });
    }
    
    return embed;
}

// Function to create pagination buttons
function createPaginationButtons(currentPage, totalPages, searchId) {
    const row = new ActionRowBuilder();
    
    row.addComponents(
        new ButtonBuilder()
            .setCustomId(`prev_${searchId}`)
            .setLabel('◀️ Previous')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === 0),
        new ButtonBuilder()
            .setCustomId(`next_${searchId}`)
            .setLabel('Next ▶️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === totalPages - 1)
    );
    
    return row;
}

// Handle slash commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    const { commandName } = interaction;
    
    if (commandName === 'tag-search') {
        const tag = interaction.options.getString('tag');
        
        await interaction.deferReply({ ephemeral: true });
        
        try {
            const guilds = await searchGuildsByTag(tag);
            
            if (guilds.length === 0) {
                const noResultsEmbed = new EmbedBuilder()
                    .setTitle('🔍 No Results Found')
                    .setDescription(`No servers found with tag: **${tag}**`)
                    .setColor(0xFF6B6B)
                    .setTimestamp();
                
                return await interaction.editReply({ embeds: [noResultsEmbed] });
            }
            
            // Store search results for pagination
            const searchId = `${interaction.user.id}_${Date.now()}`;
            searchResults.set(searchId, { guilds, tag, currentPage: 0 });
            
            // Auto-cleanup search results after 15 minutes
            setTimeout(() => searchResults.delete(searchId), 15 * 60 * 1000);
            
            const embed = createGuildEmbed(guilds, 0, guilds.length, tag);
            const buttons = guilds.length > 1 ? createPaginationButtons(0, guilds.length, searchId) : null;
            
            const replyOptions = { embeds: [embed] };
            if (buttons) replyOptions.components = [buttons];
            
            await interaction.editReply(replyOptions);
            
        } catch (error) {
            console.error('Error in tag-search command:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Error')
                .setDescription('An error occurred while searching for guilds.')
                .setColor(0xFF6B6B)
                .setTimestamp();
            
            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }
    
    if (commandName === 'help') {
        const helpEmbed = new EmbedBuilder()
            .setTitle('🤖 Guild Tag Search Bot Help')
            .setDescription('Search for Discord servers by their tags!')
            .addFields(
                { 
                    name: '📝 Commands', 
                    value: '`/tag-search <tag>` - Search for servers with a specific tag\n`/help` - Show this help message' 
                },
                { 
                    name: '🔍 How it works', 
                    value: 'The bot searches through all servers it has access to and finds ones that match your tag query.' 
                },
                { 
                    name: '📄 Navigation', 
                    value: 'Use the Previous/Next buttons to browse through multiple results.' 
                }
            )
            .setColor(0x00D4AA)
            .setTimestamp();
        
        await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
    }
});

// Handle button interactions for pagination
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    
    const [action, searchId] = interaction.customId.split('_');
    const searchData = searchResults.get(searchId);
    
    if (!searchData) {
        return await interaction.reply({ 
            content: '❌ Search results have expired. Please run the command again.', 
            ephemeral: true 
        });
    }
    
    const { guilds, tag, currentPage } = searchData;
    let newPage = currentPage;
    
    if (action === 'prev' && currentPage > 0) {
        newPage = currentPage - 1;
    } else if (action === 'next' && currentPage < guilds.length - 1) {
        newPage = currentPage + 1;
    }
    
    // Update stored page
    searchData.currentPage = newPage;
    searchResults.set(searchId, searchData);
    
    const embed = createGuildEmbed(guilds, newPage, guilds.length, tag);
    const buttons = createPaginationButtons(newPage, guilds.length, searchId);
    
    await interaction.update({ embeds: [embed], components: [buttons] });
});

// Error handling
client.on('error', error => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Login with bot token
client.login(process.env.DISCORD_TOKEN);
