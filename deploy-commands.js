// deploy-commands.js
require('dotenv').config({ path: '.env' });
const fs = require('fs');
const path = require('path');
const { REST } = require('@discordjs/rest');                 // <-- use @discordjs/rest
const { Routes } = require('discord-api-types/v10');         // <-- use discord-api-types

if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
  console.error('CLIENT_ID or DISCORD_TOKEN are not defined in the .env file.');
  process.exit(1);
}

function collectCommands(dir, acc = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectCommands(full, acc);
    else if (entry.isFile() && entry.name.endsWith('.js')) {
      const command = require(full);
      if (command?.data?.toJSON) {
        acc.push(command.data.toJSON());
        console.log(`Found: ${command.data.name}`);
      } else {
        console.warn(`Skipped ${full} (no data.toJSON)`);
      }
    }
  }
  return acc;
}

const commands = collectCommands(path.join(__dirname, 'commands'));
console.log(`Preparing to register ${commands.length} command(s).`);

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    if (process.env.GUILD_ID) {
      // Fast dev cycle: per-guild registration (appears instantly)
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands }
      );
      console.log(`✅ Registered ${commands.length} guild command(s) to ${process.env.GUILD_ID}`);
    } else {
      // Global registration: can take up to ~1 hour to propagate
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
      );
      console.log(`✅ Registered ${commands.length} global command(s).`);
      console.log('Heads up: global updates can take a while to show up.');
    }
  } catch (error) {
    console.error('Deploy failed:', error);
    process.exit(1);
  }
})();
