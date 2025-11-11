// --- FFmpeg: make discord-player/@discordjs/voice find the bundled binary ---
const ffmpegPath = require('ffmpeg-static');
if (ffmpegPath) {
  process.env.FFMPEG_PATH = ffmpegPath;
}

require('dotenv').config({ path: __dirname + '/.env' });

const { Client, GatewayIntentBits, Collection, Events, Partials } = require('discord.js');
const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');
// in index.js after login
const app = require('./api');
app.listen(process.env.PORT || 3000, () => console.log('Audio API up'));

let usePlayer = null;
try { ({ usePlayer } = require(path.join(__dirname, 'src', 'player.djs.js'))); } catch {}

if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
  console.error('CLIENT_ID or DISCORD_TOKEN are not defined in the .env file.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

client.commands = new Collection();

/* ------------------------------ command loader ---------------------------- */
function loadCommands(dir) {
  try {
    const entries = fssync.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        loadCommands(full);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        const command = require(full);
        if (command?.data?.name && typeof command.execute === 'function') {
          client.commands.set(command.data.name, command);
          console.log(`Loaded command: ${command.data.name}`);
        }
      }
    }
  } catch (e) {
    console.warn('Command loader warning:', e.message);
  }
}
loadCommands(path.join(__dirname, 'commands'));

/* -------------------------- guilds.json (optional) ------------------------ */
const outPath = path.join(__dirname, 'guilds.json');
async function writeGuildsJson() {
  const guilds = client.guilds.cache.map(g => ({
    id: g.id,
    name: g.name,
    icon_url: g.iconURL({ size: 256 }) || null,
  }));
  const payload = {
    generated_at: new Date().toISOString(),
    count: guilds.length,
    guilds,
  };
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Saved ${guilds.length} guilds to ${outPath}`);
}

/* ------------------------------------ ready ------------------------------- */
client.once(Events.ClientReady, async () => {
  try {
    if (typeof usePlayer === 'function') {
      try { await usePlayer(client); } catch (e) { console.warn('Player init warning:', e?.message || e); }
    }
    console.log(`Logged in as ${client.user.tag}`);
    await writeGuildsJson();
  } catch (err) {
    console.error('Startup error:', err);
  }
});

client.on(Events.GuildCreate, async () => { try { await writeGuildsJson(); } catch (e) { console.error(e); } });
client.on(Events.GuildDelete, async () => { try { await writeGuildsJson(); } catch (e) { console.error(e); } });

/* ----------------------------- interactions ------------------------------- */
client.on(Events.InteractionCreate, async interaction => {
  try {
    // Modals
    if (interaction.isModalSubmit()) {
      for (const cmd of client.commands.values()) {
        if (typeof cmd.handleModalSubmit === 'function' && await cmd.handleModalSubmit(interaction)) return;
        if (typeof cmd.handleGrantAccessModal === 'function' && await cmd.handleGrantAccessModal(interaction)) return;
        if (typeof cmd.handleDmReplyModal === 'function' && await cmd.handleDmReplyModal(interaction)) return;
        if (typeof cmd.handleUserReplyModal === 'function' && await cmd.handleUserReplyModal(interaction)) return;
      }
      return;
    }

    // Buttons
    if (interaction.isButton()) {
      for (const cmd of client.commands.values()) {
        if (typeof cmd.handleButton === 'function' && await cmd.handleButton(interaction)) return;
      }
      return;
    }

    // Slash commands
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
      return;
    }

  } catch (error) {
    console.error('Error handling interaction:', error);
    const reply = { content: 'There was an error while executing this interaction!', flags: 64 };
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    } catch {}
  }
});

/* -------------------------------- messages -------------------------------- */
client.on(Events.MessageCreate, async message => {
  try {
    for (const cmd of client.commands.values()) {
      if (typeof cmd.handleMessage === 'function') {
        await cmd.handleMessage(message);
      }
    }
  } catch (err) {
    console.error('Error handling message:', err);
  }
});

/* ---------------------------- voice state hook ---------------------------- */
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    for (const cmd of client.commands.values()) {
      if (typeof cmd.handleVoiceStateUpdate === 'function') {
        await cmd.handleVoiceStateUpdate(oldState, newState);
      }
    }
  } catch (err) {
    console.error('VoiceStateUpdate error:', err);
  }
});

/* ---------------------------------- login --------------------------------- */
client.login(process.env.DISCORD_TOKEN);
