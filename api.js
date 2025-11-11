// api.js on the audio node
const express = require('express');
const { usePlayer } = require('./src/player.djs.js');
const { playViaPython } = require('./commands/music'); // export it
const app = express(); app.use(express.json());
const SECRET = process.env.API_SECRET;

app.post('/api/play', async (req, res) => {
  try {
    if (req.headers['x-auth'] !== SECRET) return res.status(401).json({ ok:false, error:'unauthorized' });
    const { guildId, channelId, userId, query } = req.body;

    const client = require('./index').client; // export your client instance from index.js
    const guild = await client.guilds.fetch(guildId);
    const channel = guild.channels.cache.get(channelId);

    const player = await usePlayer(client);
    const queue = player.nodes.create(guild, { metadata:{ channel }, leaveOnEnd:false, leaveOnEmpty:false, selfDeaf:true });
    if (!queue.connection) await queue.connect(channel);

    const interactionLike = { guild, user:{ id:userId, tag:`remote:${userId}` } };
    const track = await playViaPython(player, interactionLike, channel, query);
    if (!queue.isPlaying()) await queue.node.play();

    res.json({ ok:true, title: track.title });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error: e.message });
  }
});

module.exports = app;
