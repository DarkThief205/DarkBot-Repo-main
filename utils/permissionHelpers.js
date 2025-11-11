// utils/permissionHelpers.js
const { PermissionsBitField } = require('discord.js');

const BOT_OWNER_ID = process.env.BOT_OWNER_ID || null;

/** True if this user is the configured bot owner. */
function isBotOwner(user) {
  return !!BOT_OWNER_ID && String(user.id) === String(BOT_OWNER_ID);
}

/**
 * Checks if the interaction member has the given permission OR is the bot owner.
 * Returns true when allowed, false when not.
 */
function hasGuildPermOrOwner(interaction, permFlag) {
  if (isBotOwner(interaction.user)) return true;
  return Boolean(interaction.member?.permissions?.has(permFlag));
}

module.exports = { isBotOwner, hasGuildPermOrOwner };
