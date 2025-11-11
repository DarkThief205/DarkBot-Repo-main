const { Player, GuildQueueEvent } = require("discord-player");

async function loadExtractorsQuiet(player) {
  try {
    player.extractors.events.on('error', (e) => {
      const msg = (e && e.message) ? e.message : String(e);
      if (/youtube library/i.test(msg)) {
        console.warn('[extractors] Skipping YouTube extractor (no youtube backend lib).');
      } else {
        console.warn('[extractors] Error:', msg);
      }
    });
  } catch {}

  try {
    await player.extractors.loadDefault();
  } catch (err) {
    const msg = String(err?.message || err);
    if (/youtube library/i.test(msg)) {
      console.warn('[extractors] Default load: YouTube backend missing; continuing without it.');
    } else {
      console.warn('[extractors] Default load warning:', msg);
    }
  }
}

let _player;
async function usePlayer(client) {
  if (_player) return _player;

  _player = new Player(client, {
    ytdlOptions: {
      quality: 'highestaudio',
      highWaterMark: 1 << 25,
      liveBuffer: 20_000,
      dlChunkSize: 0,
      requestOptions: { timeout: 20_000 },
    },
    connectionTimeout: 15_000,
    // IMPORTANT: no auto-leave; timers are handled in the command.
  });

  await loadExtractorsQuiet(_player);

  const log = (q, text) => q?.metadata?.log?.(text);

  _player.events.on(GuildQueueEvent.PlayerStart, (queue, track) => {
    log(queue, `▶️ Now playing: **${track.title}**`);
  });

  _player.events.on(GuildQueueEvent.EmptyQueue, (queue) => {
    log(queue, "⏳ Queue ended (staying connected).");
  });

  _player.events.on(GuildQueueEvent.PlayerError, (queue, error) => {
    console.error("[PLAYER ERROR]", error);
    log(queue, `❗ Player error: ${error.message}`);
  });

  _player.events.on(GuildQueueEvent.ConnectionCreate, (queue) => {
    log(queue, "🔊 Connected to voice channel.");
  });

  return _player;
}

module.exports = { usePlayer, GuildQueueEvent };