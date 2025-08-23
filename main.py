import discord
from discord.ext import commands
from discord import app_commands
import asyncio
import json
import os
from datetime import datetime
import aiofiles
import logging
from typing import Optional, Dict, Any

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration - Edit these values as needed
CONFIG = {
    "BOT_TOKEN": "MTQwODg1NTczNjcxNjM2NTg2NQ.GcEa2S.GdGO9osk2_BXkh-3zrDsMQLDSLWVEXUt94QSDw",  # Replace with your bot token
    "GUILD_ID": 1389389332883968050,  # Replace with your server ID
    
    # Ticket Categories
    "CATEGORIES": {
        "general": 1408856056293228645,
        "purchase": 1408856107295707238,
        "management": 1408856139730387064
    },
    
    # Thread Auto-Response Configuration
    "THREAD_CHANNELS": {
        1408856980763840654: "Welcome to this thread! Please describe your issue and we'll help you out."  # channel_id: message
    },
    
    # Staff roles that can claim/manage tickets
    "STAFF_ROLES": [1408259928736399433, 1408259929177063456, 1408259930267451512],  # Replace with actual role IDs
    
    # Transcript channel (optional)
    "TRANSCRIPT_CHANNEL": 1408242212751413341,  # Set to channel ID if you want transcripts posted
    
    # Colors
    "COLORS": {
        "success": 0x00ff00,
        "error": 0xff0000,
        "info": 0x0099ff,
        "warning": 0xffaa00
    }
}

class TicketView(discord.ui.View):
    def __init__(self, bot):
        super().__init__(timeout=None)
        self.bot = bot

    @discord.ui.button(label="📩 General Support", style=discord.ButtonStyle.primary, custom_id="ticket_general")
    async def general_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.create_ticket(interaction, "general")

    @discord.ui.button(label="💳 Purchase Support", style=discord.ButtonStyle.success, custom_id="ticket_purchase")
    async def purchase_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.create_ticket(interaction, "purchase")

    @discord.ui.button(label="⚙️ Management", style=discord.ButtonStyle.danger, custom_id="ticket_management")
    async def management_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.create_ticket(interaction, "management")

    async def create_ticket(self, interaction: discord.Interaction, ticket_type: str):
        """Create a new ticket"""
        try:
            # Check if user already has a ticket
            existing_ticket = await self.bot.get_user_ticket(interaction.user.id, ticket_type)
            if existing_ticket:
                embed = discord.Embed(
                    title="❌ Ticket Already Exists",
                    description=f"You already have an open {ticket_type} ticket: {existing_ticket.mention}",
                    color=CONFIG["COLORS"]["error"]
                )
                await interaction.response.send_message(embed=embed, ephemeral=True)
                return

            # Get the category
            category_id = CONFIG["CATEGORIES"][ticket_type]
            category = interaction.guild.get_channel(category_id)
            
            if not category:
                embed = discord.Embed(
                    title="❌ Configuration Error",
                    description="Ticket category not found. Please contact an administrator.",
                    color=CONFIG["COLORS"]["error"]
                )
                await interaction.response.send_message(embed=embed, ephemeral=True)
                return

            # Create the ticket channel
            ticket_name = f"{ticket_type}-{interaction.user.name}-{interaction.user.discriminator}"
            
            overwrites = {
                interaction.guild.default_role: discord.PermissionOverwrite(read_messages=False),
                interaction.user: discord.PermissionOverwrite(
                    read_messages=True, 
                    send_messages=True, 
                    attach_files=True, 
                    embed_links=True
                ),
                interaction.guild.me: discord.PermissionOverwrite(
                    read_messages=True, 
                    send_messages=True, 
                    manage_messages=True,
                    attach_files=True,
                    embed_links=True
                )
            }
            
            # Add staff role permissions
            for role_id in CONFIG["STAFF_ROLES"]:
                role = interaction.guild.get_role(role_id)
                if role:
                    overwrites[role] = discord.PermissionOverwrite(
                        read_messages=True, 
                        send_messages=True, 
                        manage_messages=True,
                        attach_files=True,
                        embed_links=True
                    )

            ticket_channel = await interaction.guild.create_text_channel(
                name=ticket_name,
                category=category,
                overwrites=overwrites
            )

            # Save ticket data
            await self.bot.save_ticket_data(ticket_channel.id, {
                "user_id": interaction.user.id,
                "type": ticket_type,
                "status": "open",
                "claimed_by": None,
                "created_at": datetime.utcnow().isoformat()
            })

            # Create ticket embed and control panel
            ticket_embed = discord.Embed(
                title=f"🎫 {ticket_type.title()} Support Ticket",
                description=f"Thank you for creating a ticket, {interaction.user.mention}!\n\nPlease describe your issue in detail and our team will assist you shortly.",
                color=CONFIG["COLORS"]["info"]
            )
            ticket_embed.add_field(name="Ticket Type", value=ticket_type.title(), inline=True)
            ticket_embed.add_field(name="Created By", value=interaction.user.mention, inline=True)
            ticket_embed.add_field(name="Status", value="🟢 Open", inline=True)
            ticket_embed.set_footer(text=f"Ticket ID: {ticket_channel.id}")

            control_view = TicketControlView(self.bot)
            await ticket_channel.send(embed=ticket_embed, view=control_view)

            # Notify user
            success_embed = discord.Embed(
                title="✅ Ticket Created",
                description=f"Your {ticket_type} ticket has been created: {ticket_channel.mention}",
                color=CONFIG["COLORS"]["success"]
            )
            await interaction.response.send_message(embed=success_embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Error creating ticket: {e}")
            error_embed = discord.Embed(
                title="❌ Error",
                description="An error occurred while creating your ticket. Please try again later.",
                color=CONFIG["COLORS"]["error"]
            )
            await interaction.response.send_message(embed=error_embed, ephemeral=True)


class TicketControlView(discord.ui.View):
    def __init__(self, bot):
        super().__init__(timeout=None)
        self.bot = bot

    @discord.ui.button(label="🔒 Close", style=discord.ButtonStyle.danger, custom_id="ticket_close")
    async def close_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        """Close the ticket"""
        # Check permissions
        if not await self.bot.check_ticket_permissions(interaction):
            return

        await interaction.response.send_modal(CloseTicketModal(self.bot))

    @discord.ui.button(label="🏷️ Claim", style=discord.ButtonStyle.primary, custom_id="ticket_claim")
    async def claim_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        """Claim the ticket"""
        # Check if user is staff
        if not any(role.id in CONFIG["STAFF_ROLES"] for role in interaction.user.roles):
            embed = discord.Embed(
                title="❌ No Permission",
                description="Only staff members can claim tickets.",
                color=CONFIG["COLORS"]["error"]
            )
            await interaction.response.send_message(embed=embed, ephemeral=True)
            return

        # Get ticket data
        ticket_data = await self.bot.get_ticket_data(interaction.channel.id)
        if not ticket_data:
            embed = discord.Embed(
                title="❌ Error",
                description="Ticket data not found.",
                color=CONFIG["COLORS"]["error"]
            )
            await interaction.response.send_message(embed=embed, ephemeral=True)
            return

        if ticket_data.get("claimed_by"):
            claimed_user = interaction.guild.get_member(ticket_data["claimed_by"])
            embed = discord.Embed(
                title="❌ Already Claimed",
                description=f"This ticket is already claimed by {claimed_user.mention if claimed_user else 'Unknown User'}.",
                color=CONFIG["COLORS"]["error"]
            )
            await interaction.response.send_message(embed=embed, ephemeral=True)
            return

        # Claim the ticket
        ticket_data["claimed_by"] = interaction.user.id
        await self.bot.save_ticket_data(interaction.channel.id, ticket_data)

        embed = discord.Embed(
            title="✅ Ticket Claimed",
            description=f"This ticket has been claimed by {interaction.user.mention}.",
            color=CONFIG["COLORS"]["success"]
        )
        await interaction.response.send_message(embed=embed)

    @discord.ui.button(label="🗑️ Delete", style=discord.ButtonStyle.danger, custom_id="ticket_delete")
    async def delete_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        """Delete the ticket"""
        # Check permissions
        if not await self.bot.check_ticket_permissions(interaction):
            return

        embed = discord.Embed(
            title="⚠️ Confirm Deletion",
            description="Are you sure you want to delete this ticket? This action cannot be undone.",
            color=CONFIG["COLORS"]["warning"]
        )
        
        confirm_view = ConfirmDeleteView(self.bot)
        await interaction.response.send_message(embed=embed, view=confirm_view, ephemeral=True)

    @discord.ui.button(label="📋 Transcript", style=discord.ButtonStyle.secondary, custom_id="ticket_transcript")
    async def create_transcript(self, interaction: discord.Interaction, button: discord.ui.Button):
        """Create a transcript"""
        # Check permissions
        if not await self.bot.check_ticket_permissions(interaction):
            return

        await interaction.response.defer(ephemeral=True)
        
        try:
            transcript = await self.bot.create_transcript(interaction.channel)
            
            # Save transcript to file
            filename = f"transcript-{interaction.channel.name}-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}.txt"
            
            with open(filename, 'w', encoding='utf-8') as f:
                f.write(transcript)
            
            # Send transcript
            file = discord.File(filename)
            embed = discord.Embed(
                title="📋 Transcript Created",
                description="The transcript has been generated successfully.",
                color=CONFIG["COLORS"]["success"]
            )
            
            await interaction.followup.send(embed=embed, file=file, ephemeral=True)
            
            # Clean up file
            os.remove(filename)
            
        except Exception as e:
            logger.error(f"Error creating transcript: {e}")
            embed = discord.Embed(
                title="❌ Error",
                description="An error occurred while creating the transcript.",
                color=CONFIG["COLORS"]["error"]
            )
            await interaction.followup.send(embed=embed, ephemeral=True)


class CloseTicketModal(discord.ui.Modal, title="Close Ticket"):
    def __init__(self, bot):
        super().__init__()
        self.bot = bot

    reason = discord.ui.TextInput(
        label="Reason for closing (optional)",
        style=discord.TextStyle.paragraph,
        placeholder="Enter the reason for closing this ticket...",
        required=False,
        max_length=1000
    )

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer()
        
        try:
            # Create transcript before closing
            transcript = await self.bot.create_transcript(interaction.channel)
            
            # Get ticket data
            ticket_data = await self.bot.get_ticket_data(interaction.channel.id)
            
            # Create closure embed
            embed = discord.Embed(
                title="🔒 Ticket Closed",
                description=f"This ticket has been closed by {interaction.user.mention}.",
                color=CONFIG["COLORS"]["info"]
            )
            
            if self.reason.value:
                embed.add_field(name="Reason", value=self.reason.value, inline=False)
            
            embed.add_field(name="Closed At", value=f"<t:{int(datetime.utcnow().timestamp())}:F>", inline=True)
            embed.set_footer(text="This channel will be deleted in 10 seconds.")
            
            await interaction.followup.send(embed=embed)
            
            # Save transcript if channel is configured
            if CONFIG["TRANSCRIPT_CHANNEL"]:
                transcript_channel = interaction.guild.get_channel(CONFIG["TRANSCRIPT_CHANNEL"])
                if transcript_channel:
                    filename = f"transcript-{interaction.channel.name}-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}.txt"
                    with open(filename, 'w', encoding='utf-8') as f:
                        f.write(transcript)
                    
                    file = discord.File(filename)
                    transcript_embed = discord.Embed(
                        title="📋 Ticket Transcript",
                        description=f"Transcript for ticket: {interaction.channel.name}",
                        color=CONFIG["COLORS"]["info"]
                    )
                    transcript_embed.add_field(name="Closed By", value=interaction.user.mention, inline=True)
                    transcript_embed.add_field(name="Ticket Type", value=ticket_data.get("type", "Unknown").title(), inline=True)
                    
                    await transcript_channel.send(embed=transcript_embed, file=file)
                    os.remove(filename)
            
            # Delete ticket data
            await self.bot.delete_ticket_data(interaction.channel.id)
            
            # Delete channel after delay
            await asyncio.sleep(10)
            await interaction.channel.delete(reason=f"Ticket closed by {interaction.user}")
            
        except Exception as e:
            logger.error(f"Error closing ticket: {e}")
            embed = discord.Embed(
                title="❌ Error",
                description="An error occurred while closing the ticket.",
                color=CONFIG["COLORS"]["error"]
            )
            await interaction.followup.send(embed=embed, ephemeral=True)


class ConfirmDeleteView(discord.ui.View):
    def __init__(self, bot):
        super().__init__(timeout=30)
        self.bot = bot

    @discord.ui.button(label="✅ Yes, Delete", style=discord.ButtonStyle.danger)
    async def confirm_delete(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.defer()
        
        try:
            # Delete ticket data
            await self.bot.delete_ticket_data(interaction.channel.id)
            
            # Delete channel
            await interaction.channel.delete(reason=f"Ticket deleted by {interaction.user}")
            
        except Exception as e:
            logger.error(f"Error deleting ticket: {e}")
            embed = discord.Embed(
                title="❌ Error",
                description="An error occurred while deleting the ticket.",
                color=CONFIG["COLORS"]["error"]
            )
            await interaction.followup.send(embed=embed, ephemeral=True)

    @discord.ui.button(label="❌ Cancel", style=discord.ButtonStyle.secondary)
    async def cancel_delete(self, interaction: discord.Interaction, button: discord.ui.Button):
        embed = discord.Embed(
            title="❌ Cancelled",
            description="Ticket deletion cancelled.",
            color=CONFIG["COLORS"]["info"]
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)


class TicketBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.message_content = True
        intents.guilds = True
        intents.members = True
        
        super().__init__(
            command_prefix='!',
            intents=intents,
            help_command=None
        )
        
        # Ensure data directory exists
        os.makedirs('data', exist_ok=True)

    async def setup_hook(self):
        """Setup persistent views"""
        self.add_view(TicketView(self))
        self.add_view(TicketControlView(self))
        
        # Sync commands
        try:
            synced = await self.tree.sync(guild=discord.Object(id=CONFIG["GUILD_ID"]))
            logger.info(f"Synced {len(synced)} command(s)")
        except Exception as e:
            logger.error(f"Failed to sync commands: {e}")

    async def on_ready(self):
        logger.info(f'{self.user} has connected to Discord!')
        await self.change_presence(activity=discord.Game(name="Managing Tickets"))

    async def on_thread_create(self, thread):
        """Handle thread creation auto-response"""
        if thread.parent_id in CONFIG["THREAD_CHANNELS"]:
            message = CONFIG["THREAD_CHANNELS"][thread.parent_id]
            await asyncio.sleep(1)  # Small delay to ensure thread is ready
            await thread.send(message)

    async def save_ticket_data(self, channel_id: int, data: Dict[str, Any]):
        """Save ticket data to JSON file"""
        try:
            filename = f'data/ticket_{channel_id}.json'
            async with aiofiles.open(filename, 'w') as f:
                await f.write(json.dumps(data, indent=2))
        except Exception as e:
            logger.error(f"Error saving ticket data: {e}")

    async def get_ticket_data(self, channel_id: int) -> Optional[Dict[str, Any]]:
        """Get ticket data from JSON file"""
        try:
            filename = f'data/ticket_{channel_id}.json'
            if os.path.exists(filename):
                async with aiofiles.open(filename, 'r') as f:
                    content = await f.read()
                    return json.loads(content)
        except Exception as e:
            logger.error(f"Error loading ticket data: {e}")
        return None

    async def delete_ticket_data(self, channel_id: int):
        """Delete ticket data file"""
        try:
            filename = f'data/ticket_{channel_id}.json'
            if os.path.exists(filename):
                os.remove(filename)
        except Exception as e:
            logger.error(f"Error deleting ticket data: {e}")

    async def get_user_ticket(self, user_id: int, ticket_type: str) -> Optional[discord.TextChannel]:
        """Check if user has existing ticket of this type"""
        try:
            guild = self.get_guild(CONFIG["GUILD_ID"])
            if not guild:
                return None
                
            category = guild.get_channel(CONFIG["CATEGORIES"][ticket_type])
            if not category:
                return None
                
            for channel in category.text_channels:
                ticket_data = await self.get_ticket_data(channel.id)
                if ticket_data and ticket_data.get("user_id") == user_id and ticket_data.get("status") == "open":
                    return channel
                    
        except Exception as e:
            logger.error(f"Error checking user tickets: {e}")
        return None

    async def check_ticket_permissions(self, interaction: discord.Interaction) -> bool:
        """Check if user has permissions to manage tickets"""
        ticket_data = await self.get_ticket_data(interaction.channel.id)
        if not ticket_data:
            embed = discord.Embed(
                title="❌ Error",
                description="This is not a valid ticket channel.",
                color=CONFIG["COLORS"]["error"]
            )
            await interaction.response.send_message(embed=embed, ephemeral=True)
            return False

        # Check if user is ticket owner or staff
        is_owner = ticket_data.get("user_id") == interaction.user.id
        is_staff = any(role.id in CONFIG["STAFF_ROLES"] for role in interaction.user.roles)
        
        if not (is_owner or is_staff):
            embed = discord.Embed(
                title="❌ No Permission",
                description="You don't have permission to manage this ticket.",
                color=CONFIG["COLORS"]["error"]
            )
            await interaction.response.send_message(embed=embed, ephemeral=True)
            return False
        
        return True

    async def create_transcript(self, channel: discord.TextChannel) -> str:
        """Create a transcript of the channel"""
        transcript_lines = []
        transcript_lines.append(f"Transcript for #{channel.name}")
        transcript_lines.append(f"Generated on: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC")
        transcript_lines.append("=" * 50)
        transcript_lines.append("")

        async for message in channel.history(limit=None, oldest_first=True):
            timestamp = message.created_at.strftime('%Y-%m-%d %H:%M:%S')
            author = f"{message.author.display_name} ({message.author})"
            
            transcript_lines.append(f"[{timestamp}] {author}")
            
            if message.content:
                transcript_lines.append(f"    {message.content}")
            
            if message.attachments:
                for attachment in message.attachments:
                    transcript_lines.append(f"    [Attachment: {attachment.filename}]")
            
            if message.embeds:
                for embed in message.embeds:
                    transcript_lines.append(f"    [Embed: {embed.title or 'No Title'}]")
            
            transcript_lines.append("")

        return '\n'.join(transcript_lines)


# Create bot instance
bot = TicketBot()

# Slash commands
@bot.tree.command(name="ticket-setup", description="Setup the ticket system", guild=discord.Object(id=CONFIG["GUILD_ID"]))
@app_commands.describe(channel="The channel to send the ticket panel to")
async def ticket_setup(interaction: discord.Interaction, channel: discord.TextChannel = None):
    """Setup the ticket system"""
    # Check if user is staff
    if not any(role.id in CONFIG["STAFF_ROLES"] for role in interaction.user.roles):
        embed = discord.Embed(
            title="❌ No Permission",
            description="Only staff members can setup the ticket system.",
            color=CONFIG["COLORS"]["error"]
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)
        return

    target_channel = channel or interaction.channel

    embed = discord.Embed(
        title="🎫 Support Ticket System",
        description="Need help? Create a support ticket by clicking one of the buttons below.\n\n"
                   "**📩 General Support** - General questions and assistance\n"
                   "**💳 Purchase Support** - Billing and purchase related issues\n"
                   "**⚙️ Management** - Administrative and management requests",
        color=CONFIG["COLORS"]["info"]
    )
    embed.set_footer(text="Click a button to create your ticket")

    view = TicketView(bot)
    
    await target_channel.send(embed=embed, view=view)
    
    success_embed = discord.Embed(
        title="✅ Ticket System Setup",
        description=f"Ticket system has been setup in {target_channel.mention}",
        color=CONFIG["COLORS"]["success"]
    )
    await interaction.response.send_message(embed=success_embed, ephemeral=True)


@bot.tree.command(name="ticket-stats", description="View ticket statistics", guild=discord.Object(id=CONFIG["GUILD_ID"]))
async def ticket_stats(interaction: discord.Interaction):
    """View ticket statistics"""
    # Check if user is staff
    if not any(role.id in CONFIG["STAFF_ROLES"] for role in interaction.user.roles):
        embed = discord.Embed(
            title="❌ No Permission",
            description="Only staff members can view ticket statistics.",
            color=CONFIG["COLORS"]["error"]
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)
        return

    guild = interaction.guild
    stats = {"general": 0, "purchase": 0, "management": 0, "total": 0}
    
    for ticket_type, category_id in CONFIG["CATEGORIES"].items():
        category = guild.get_channel(category_id)
        if category:
            stats[ticket_type] = len(category.text_channels)
            stats["total"] += len(category.text_channels)

    embed = discord.Embed(
        title="📊 Ticket Statistics",
        color=CONFIG["COLORS"]["info"]
    )
    embed.add_field(name="📩 General Support", value=stats["general"], inline=True)
    embed.add_field(name="💳 Purchase Support", value=stats["purchase"], inline=True)
    embed.add_field(name="⚙️ Management", value=stats["management"], inline=True)
    embed.add_field(name="📊 Total Open Tickets", value=stats["total"], inline=False)
    
    await interaction.response.send_message(embed=embed, ephemeral=True)


# Run the bot
if __name__ == "__main__":
    if CONFIG["BOT_TOKEN"] == "MTQwODg1NTczNjcxNjM2NTg2NQ.GcEa2S.GdGO9osk2_BXkh-3zrDsMQLDSLWVEXUt94QSDw":
        print("Please set your bot token in the CONFIG dictionary!")
    else:
        bot.run(CONFIG["BOT_TOKEN"])
