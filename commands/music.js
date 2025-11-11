const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionsBitField,
  ComponentType,
  MessageFlags
} = require('discord.js');

const path = require('path');
const { QueryType, QueueRepeatMode } = require('discord-player');
const { pyResolve, expandYouTubePlaylist, expandSpotifyPlaylist } = require(path.join(__dirname, '..', 'src', 'pybridge'));
const { usePlayer } = require(path.join(__dirname, '..', 'src', 'player.djs.js'));

// Keep-Alive for fetch/undici (fewer TLS handshakes, faster connects)
const { setGlobalDispatcher, Agent } = require('undici');
setGlobalDispatcher(new Agent({ keepAliveTimeout: 60_000, keepAliveMaxTimeout: 10 * 60_000 }));

/* ---------------------------- per-guild state ---------------------------- */
const stateByGuild = new Map();
const MAX_LOGS = 100;
const INACTIVITY_MS = 10 * 60 * 1000; // 10 minutes

function ensureGuildState(gid) {
  if (!stateByGuild.has(gid)) {
    stateByGuild.set(gid, {
      controllerMsgId: null,
      controllerChannelId: null,
      controllerLocked: false,
      logs: [],
      listenersBound: false,
      lyricsCache: new Map(),
      lastActiveAt: Date.now(),
      idleTimer: null,   // empty-queue timer
      aloneTimer: null   // alone-in-channel timer
    });
  }
  return stateByGuild.get(gid);
}

function pushLog(gid, line) {
  const st = ensureGuildState(gid);
  const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  st.logs.push(`${stamp} ${line}`);
  if (st.logs.length > MAX_LOGS) st.logs.shift();
}

function touchActive(gid) {
  const st = ensureGuildState(gid);
  st.lastActiveAt = Date.now();
  if (st.idleTimer) { clearTimeout(st.idleTimer); st.idleTimer = null; }
}
function scheduleIdleLeave(player, guild) {
  const st = ensureGuildState(guild.id);
  if (st.idleTimer) { clearTimeout(st.idleTimer); }
  st.idleTimer = setTimeout(async () => {
    try {
      const queue = player.nodes.get(guild.id);
      if (queue?.connection) {
        pushLog(guild.id, '🕙 Inactive for 10 minutes — leaving voice.');
        queue.delete();
      }
      await finalizeControllerMessage(guild);
    } catch {}
  }, INACTIVITY_MS);
}

/* ---------- Alone-in-voice: leave after 10 minutes if still alone -------- */
function isBotAloneInVoice(guild) {
  try {
    const vc = guild?.members?.me?.voice?.channel;
    if (!vc) return false;
    const humans = vc.members.filter(m => !m.user.bot);
    return humans.size === 0;
  } catch { return false; }
}
async function scheduleAloneLeave(player, guild) {
  const st = ensureGuildState(guild.id);
  if (st.aloneTimer) clearTimeout(st.aloneTimer);
  st.aloneTimer = setTimeout(async () => {
    try {
      if (isBotAloneInVoice(guild)) {
        const queue = player.nodes.get(guild.id);
        pushLog(guild.id, '🕙 Alone for 10 minutes — leaving voice.');
        if (queue) queue.delete(); else await guild.members.me.voice.disconnect().catch(()=>{});
        await finalizeControllerMessage(guild);
      }
    } catch {}
  }, INACTIVITY_MS);
}
function cancelAloneLeave(gid) {
  const st = ensureGuildState(gid);
  if (st.aloneTimer) { clearTimeout(st.aloneTimer); st.aloneTimer = null; }
}

/* ---------------------------- prefetch helpers ---------------------------- */
function stashPreResolved(track, py) {
  try {
    if (!track.raw) track.raw = {};
    track.raw.preResolved = (py && py.ok && py.stream_url) ? { url: py.stream_url, at: Date.now() } : null;
  } catch {}
}

async function prefetchNext(player, guild, howMany = 2) {
  try {
    const queue = player.nodes.get(guild.id);
    if (!queue || queue.tracks.size === 0) return;

    const arr = queue.tracks.toArray().slice(0, howMany);
    for (const t of arr) {
      if (t?.raw?.preResolved?.url) continue;
      const basis = t.title || t.url || t.query || '';
      if (!basis) continue;
      const py = await pyResolve(basis);
      if (py?.ok && py.stream_url) stashPreResolved(t, py);
    }
  } catch {}
}

/* -------------------------------- helpers ------------------------------- */
function looksLikeUrl(str) { try { new URL(str); return true; } catch { return false; } }
function getUserVoice(interaction) { return interaction.member?.voice?.channel || null; }
function getBotVoice(interaction) { return interaction.guild?.members?.me?.voice?.channel || null; }

function userMustBeInVoice(interaction) {
  const vc = getUserVoice(interaction);
  if (!vc || ![ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(vc.type)) {
    return { ok: false, msg: 'Join a voice channel first.' };
  }
  return { ok: true, vc };
}
function mustBeSameVoice(interaction) {
  const u = getUserVoice(interaction);
  const b = getBotVoice(interaction);
  if (!u) return { ok: false, msg: 'Join a voice channel first.' };
  if (b && b.id !== u.id) {
    const vcName = b.name || 'the bot’s voice channel';
    return { ok: false, msg: `You should join **${vcName}**.` };
  }
  return { ok: true, vc: u };
}

async function ensureBasicPermissions(interaction, voiceChannel) {
  const me = interaction.guild.members.me;
  const perms = me.permissionsIn(voiceChannel);
  if (!perms.has(PermissionsBitField.Flags.Connect)) throw new Error('I cannot connect to that voice channel.');
  if (!perms.has(PermissionsBitField.Flags.Speak)) throw new Error('I cannot speak in that voice channel.');
}

function normalizeYouTubeUrl(q) {
  try {
    const u = new URL(q);
    const host = u.hostname.replace(/^www\./, '');
    if (u.searchParams.has('list')) return q;
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      if (id) return `https://www.youtube.com/watch?v=${id}`;
    }
    if (host.endsWith('youtube.com')) {
      if (u.pathname.startsWith('/shorts/')) {
        const id = u.pathname.split('/')[2];
        if (id) return `https://www.youtube.com/watch?v=${id}`;
      }
      if (u.pathname.startsWith('/embed/')) {
        const id = u.pathname.split('/')[2];
        if (id) return `https://www.youtube.com/watch?v=${id}`;
      }
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube.com/watch?v=${v}`;
    }
  } catch {}
  return q;
}

const _SPOTIFY_OEMBED = new Map();
const OEMBED_TTL = 10 * 60 * 1000;
async function spotifyToSearchQuery(url) {
  const rec = _SPOTIFY_OEMBED.get(url);
  if (rec && (Date.now() - rec.t) < OEMBED_TTL) return rec.title;

  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 350);
  try {
    const res = await fetch('https://open.spotify.com/oembed?url=' + encodeURIComponent(url), { signal: ctl.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const title = typeof data.title === 'string' ? data.title.replace(/\s*–\s*/g, ' ').trim() : null;
    _SPOTIFY_OEMBED.set(url, { title, t: Date.now() });
    return title;
  } catch { return null; }
  finally { clearTimeout(to); }
}

function fieldSafe(v){return(v&&String(v).trim().length)?String(v).slice(0,1024):'—';}
// Build a best-effort lyrics link for the current track.
// We don't fetch anything (public-bot safe); we just return a Genius search URL.
async function getDirectLyricsUrlForTrack(_gid, track) {
  try {
    // prefer a clean "Artist - Title" when available
    let title = (track?.title || '').trim();
    let artist = '';

    // some extractors put artist/uploader in these fields
    artist =
      (track?.author && String(track.author).trim()) ||
      (track?.raw?.author && String(track.raw.author).trim()) ||
      (track?.raw?.artist && String(track.raw.artist).trim()) ||
      '';

    // clean common noise from titles
    const clean = (s) =>
      String(s || '')
        .replace(/\s*\((official|audio|video|lyric[s]?|mv|hd|4k|visualizer|prod\..*?)\)\s*/gi, ' ')
        .replace(/\s*\[(official|audio|video|lyric[s]?|mv|hd|4k|visualizer|prod\..*?)\]\s*/gi, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

    title = clean(title);
    artist = clean(artist);

    // if title already has " - " pattern, keep it; otherwise prepend artist (when we have one)
    const qBase =
      / - /.test(title) || !artist ? title : `${artist} - ${title}`;

    // final query → Genius search
    const q = encodeURIComponent(`${qBase} lyrics`);
    return `https://genius.com/search?q=${q}`;
  } catch {
    return null;
  }
}

/* ---------------------------------- UI ----------------------------------- */
function makeControllerRows() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('music:play').setLabel('Play').setEmoji('▶️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('music:stop').setLabel('Stop').setEmoji('🛑').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('music:next').setLabel('Next').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('music:previous').setLabel('Previous').setEmoji('⏮️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('music:loop').setLabel('Loop').setEmoji('🔁').setStyle(ButtonStyle.Primary),
  );
  return [row];
}

async function buildControllerEmbed(player, guild) {
  const queue = player.nodes.get(guild.id);
  const embed = new EmbedBuilder().setTitle('🎧 Music Controller');

  if (queue?.currentTrack) {
    const t = queue.currentTrack;

    let lyricsFieldValue = '—';
    try {
      const lyricsUrl = await getDirectLyricsUrlForTrack(guild.id, t);
      if (lyricsUrl) lyricsFieldValue = `[here](${lyricsUrl})`;
    } catch {}

    embed
      .setDescription(`**Now Playing**\n[${t.title}](${t.url})\n` + (t.requestedBy ? `*requested by <@${t.requestedBy.id}>*` : ''))
      .addFields(
        { name: 'Loop', value: queue.repeatMode === QueueRepeatMode.TRACK ? 'track' : 'off', inline: true },
        { name: 'Lyrics', value: lyricsFieldValue, inline: true },
        { name: 'Queue size', value: `${queue.tracks.size}`, inline: true },
      )
      .setColor(0x5865F2);
    if (t.thumbnail) embed.setThumbnail(t.thumbnail);
  } else {
    embed.setDescription('No track is currently playing.\nUse **Play** to add something!').setColor(0x2B2D31);
  }
  return embed;
}

async function updateControllerMessage(player, guild) {
  const st = ensureGuildState(guild.id);
  if (st.controllerLocked) return;
  if (!st.controllerChannelId || !st.controllerMsgId) return;
  const channel = guild.channels.cache.get(st.controllerChannelId); if (!channel) return;
  let msg; try { msg = await channel.messages.fetch(st.controllerMsgId); } catch { return; }
  const embed = await buildControllerEmbed(player, guild);
  try { await msg.edit({ embeds: [embed], components: makeControllerRows() }); } catch {}
}

async function finalizeControllerMessage(guild) {
  const st = ensureGuildState(guild.id);
  if (!st.controllerChannelId || !st.controllerMsgId) return;

  st.controllerLocked = true;

  const channel = guild.channels.cache.get(st.controllerChannelId); if (!channel) return;
  let msg; try { msg = await channel.messages.fetch(st.controllerMsgId); } catch { return; }

  const finalEmbed = new EmbedBuilder()
    .setTitle('🎧 DarkBot Music')
    .setDescription('Thanks for using DarkBot music.')
    .setColor(0x2B2D31);

  const disabled = makeControllerRows().map(r => { r.components.forEach(c => c.setDisabled(true)); return r; });
  try { await msg.edit({ embeds: [finalEmbed], components: disabled }); } catch {}
}

/* -------- helper: always create queue with Python-backed stream hook ------- */
/* -------- helper: always create queue with Python-backed stream hook ------- */
async function getOrCreateArbitraryQueue(player, guild, voice, basisForLog) {
  const queue = player.nodes.create(guild, {
    // 🔒 IMPORTANT: disable discord-player's auto-leave features.
    leaveOnEnd: false,               // don't leave when queue ends
    leaveOnEmpty: false,             // don't leave when channel becomes empty
    leaveOnEndCooldown: 0,           // (no cooldown auto-leave)
    leaveOnEmptyCooldown: 0,         // (no cooldown auto-leave)
    selfDeaf: true,                  // good practice for bots

    metadata: { channel: guild?.channels?.cache?.first(), log: (t)=>pushLog(guild.id, t) },
    volume: 50,

    onBeforeCreateStream: async (track) => {
      // Fast-path: if prefetch already resolved, start instantly
      const pre = track?.raw?.preResolved?.url;
      if (pre) {
        touchActive(guild.id);
        return { stream: pre, type: 'arbitrary' };
      }

      // Otherwise resolve now (pyResolve cache still helps)
      const basis = track?.title || track?.query || track?.url || basisForLog;
      const py = await pyResolve(basis);
      if (py.ok && py.stream_url) {
        stashPreResolved(track, py);
        touchActive(guild.id);
        return { stream: py.stream_url, type: 'arbitrary' };
      }
      const page = (py && py.webpage_url) ? py.webpage_url : (track?.url || basis);
      throw new Error('Direct stream unavailable: ' + page);
    },
  });

  if (!queue.connection) await queue.connect(voice);
  return queue;
}


/* ------------------ core: Python-backed playback (arbitrary) --------------- */
async function playViaPython(player, interaction, voice, query) {
  const guild = interaction.guild;
  const queue = await getOrCreateArbitraryQueue(player, guild, voice, query);

  // Fastest path: always resolve via pyResolve (skip player.search)
  const py = await pyResolve(query);
  if (!py.ok || !py.webpage_url) throw new Error(py.error || "No results found.");
  const track = {
    title: py.title || "Unknown title",
    url: py.webpage_url,
    duration: py.duration ? py.duration * 1000 : undefined,
    thumbnail: py.thumbnail,
    requestedBy: interaction.user,
    raw: { source: "arbitrary" }
  };
  stashPreResolved(track, py);

  queue.addTrack(track);
  touchActive(guild.id);

  // Prefetch upcoming tracks after adding this one
  try { await prefetchNext(player, guild, 2); } catch {}

  if (!queue.isPlaying()) await queue.node.play();
  pushLog(guild.id, `➕ **${interaction.user.tag}** added **${track.title}** to the queue.`);
  return track;
}

/* ------------------------------ slash command ----------------------------- */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Music controller (Play • Stop • Next • Previous • Loop).'),

  async execute(interaction) {
    const guard = userMustBeInVoice(interaction);
    if (!guard.ok) return interaction.reply({ content: guard.msg, flags: MessageFlags.Ephemeral });

    const modal = new ModalBuilder().setCustomId('music:play:modal:root').setTitle('Play — URL or keywords');
    const input = new TextInputBuilder()
      .setCustomId('music:play:input')
      .setLabel('YouTube/Spotify URL or search')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(200)
      .setPlaceholder('https://youtu.be/... | https://open.spotify.com/... | "lofi beats"');
    modal.addComponents(new ActionRowBuilder().addComponents(input));

    await interaction.showModal(modal);

    const player = await usePlayer(interaction.client);
    bindPlayerEventsOnce(player, interaction.guild);

    let i;
    try {
      i = await interaction.awaitModalSubmit({
        filter: (m) => m.customId === 'music:play:modal:root' && m.user.id === interaction.user.id,
        time: 60_000
      });
    } catch { return; }

    await i.deferReply({ flags: MessageFlags.Ephemeral });

    const same = mustBeSameVoice(i);
    if (!same.ok) return i.editReply({ content: same.msg, flags: MessageFlags.Ephemeral });

    const voice = getUserVoice(i);
    try { await ensureBasicPermissions(i, voice); }
    catch (e) { return i.editReply({ content: e.message, flags: MessageFlags.Ephemeral }); }

    let query = i.fields.getTextInputValue('music:play:input').trim();

    // Playlists & Spotify
    if (looksLikeUrl(query)) {
      try {
        const u = new URL(query);

        if (u.hostname.includes('open.spotify.com') && /\/track\//.test(u.pathname)) {
          const q2 = await spotifyToSearchQuery(query);
          if (q2) query = q2;
        }

        // Spotify playlist/album → expand and queue all items
        if (u.hostname.includes('open.spotify.com') && (/\/playlist\//.test(u.pathname) || /\/album\//.test(u.pathname))) {
          const items = await expandSpotifyPlaylist(query);
          if (items.length > 0) {
            const queue = await getOrCreateArbitraryQueue(player, i.guild, voice, query);

            let firstTrack = null, addedCount = 0;
            for (const item of items) {
              const metaTrack = {
                title: item.title || 'Untitled',
                url: item.webpage_url || item.title,
                thumbnail: item.thumbnail || null,
                requestedBy: i.user,
                raw: { source: "arbitrary" }
              };
              queue.addTrack(metaTrack);
              if (!firstTrack) firstTrack = metaTrack;
              addedCount++;
            }
            touchActive(i.guild.id);
            try { await prefetchNext(player, i.guild, 3); } catch {}

            if (!queue.isPlaying()) await queue.node.play();
            await i.editReply({ content: `Queued **${addedCount}** tracks from Spotify ${/playlist/.test(u.pathname) ? 'playlist' : 'album'}. Now playing: **${firstTrack.title}**`, flags: MessageFlags.Ephemeral });

            const embed = await buildControllerEmbed(player, i.guild);
            const controller = await i.channel.send({ embeds: [embed], components: makeControllerRows() });

            setupControllerCollectors(controller, player);

            const st = ensureGuildState(i.guild.id);
            st.controllerMsgId = controller.id;
            st.controllerChannelId = controller.channel.id;
            st.controllerLocked = false;
            return;
          }
        }

        // YouTube playlist → expand and queue all items
        if ((u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) && u.searchParams.has('list')) {
          const items = await expandYouTubePlaylist(query);
          if (items.length > 0) {
            const queue = await getOrCreateArbitraryQueue(player, i.guild, voice, query);

            let firstTrack = null, addedCount = 0;
            for (const item of items) {
              const metaTrack = {
                title: item.title || 'Untitled',
                url: item.webpage_url,
                thumbnail: item.thumbnail || null,
                requestedBy: i.user,
                raw: { source: "arbitrary" }
              };
              queue.addTrack(metaTrack);
              if (!firstTrack) firstTrack = metaTrack;
              addedCount++;
            }
            touchActive(i.guild.id);
            try { await prefetchNext(player, i.guild, 3); } catch {}

            if (!queue.isPlaying()) await queue.node.play();
            await i.editReply({ content: `Queued **${addedCount}** tracks from playlist. Now playing: **${firstTrack.title}**`, flags: MessageFlags.Ephemeral });

            const embed = await buildControllerEmbed(player, i.guild);
            const controller = await i.channel.send({ embeds: [embed], components: makeControllerRows() });

            setupControllerCollectors(controller, player);

            const st = ensureGuildState(i.guild.id);
            st.controllerMsgId = controller.id;
            st.controllerChannelId = controller.channel.id;
            st.controllerLocked = false;
            return;
          }
        }

      } catch {}
      query = normalizeYouTubeUrl(query);
    }

    try {
      const track = await playViaPython(player, i, voice, query);
      touchActive(i.guild.id);
      scheduleIdleLeave(player, i.guild);

      await i.editReply({ content: `Added to queue: **${track.title}**`, flags: MessageFlags.Ephemeral });

      const embed = await buildControllerEmbed(player, i.guild);
      const controller = await i.channel.send({ embeds: [embed], components: makeControllerRows() });

      setupControllerCollectors(controller, player);

      const st = ensureGuildState(i.guild.id);
      st.controllerMsgId = controller.id;
      st.controllerChannelId = controller.channel.id;
      st.controllerLocked = false;
    } catch (err) {
      console.error('first play error:', err);
      await i.editReply({ content: 'Could not play that link. Try another link or search words.', flags: MessageFlags.Ephemeral });
    }
  },

  /* -------- called from index.js on voice updates (alone timer logic) ------ */
  async handleVoiceStateUpdate(oldState, newState) {
    try {
      const guild = newState?.guild || oldState?.guild;
      if (!guild) return;

      const player = await usePlayer(guild.client);
      const queue = player.nodes.get(guild.id);
      const botInVc = guild.members.me?.voice?.channel;

      if (!botInVc || !queue?.connection) {
        cancelAloneLeave(guild.id);
        return;
      }

      // If the bot's channel changed members, decide what to do
      if (isBotAloneInVoice(guild)) {
        // keep playing; schedule a leave in 10 minutes
        scheduleAloneLeave(player, guild);
      } else {
        cancelAloneLeave(guild.id);
      }
    } catch {}
  }
};

/* ------------------------- collectors & event binding ---------------------- */
function setupControllerCollectors(controllerMsg, player) {
  const collector = controllerMsg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 1000 * 60 * 45,
  });

  collector.on('collect', async (btn) => {
    if (btn.user.bot) return;

    const st = ensureGuildState(btn.guild.id);
    if (st.controllerMsgId && btn.message.id !== st.controllerMsgId) {
      return btn.deferUpdate();
    }
    if (st.controllerLocked) {
      return btn.reply({ content: 'This controller is closed. Start a new one with /music.', flags: MessageFlags.Ephemeral });
    }

    const same = mustBeSameVoice(btn);
    if (!same.ok) return btn.reply({ content: same.msg, flags: MessageFlags.Ephemeral });

    const gid = btn.guild.id;
    const queue = player.nodes.get(gid);

    try {
      switch (btn.customId) {
        case 'music:play': {
          const modal = new ModalBuilder().setCustomId(`music:play:modal:${controllerMsg.id}`).setTitle('Play — URL or keywords');
          const input = new TextInputBuilder().setCustomId('music:play:input').setLabel('YouTube/Spotify URL or search').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200).setPlaceholder('https://youtu.be/... | https://open.spotify.com/... | "lofi beats"');
          modal.addComponents(new ActionRowBuilder().addComponents(input));
          await btn.showModal(modal);
          return;
        }
        case 'music:stop': {
          if (!queue) return btn.reply({ content: 'Nothing to stop.', flags: MessageFlags.Ephemeral });
          pushLog(gid, `🛑 **${btn.user.tag}** stopped the player and cleared the queue.`);
          queue.delete();
          await finalizeControllerMessage(btn.guild);
          return btn.reply({ content: 'Stopped and cleared the queue.', flags: MessageFlags.Ephemeral });
        }
        case 'music:next':
        case 'music:skip': {
          if (!queue || (!queue.isPlaying() && !queue.node.isPaused())) {
            return btn.reply({ content: 'Nothing to skip.', flags: MessageFlags.Ephemeral });
          }
          const curr = queue.currentTrack;
          queue.node.skip();
          pushLog(gid, `⏭️ **${btn.user.tag}** skipped **${curr?.title || 'current track'}**.`);
          touchActive(gid);
          scheduleIdleLeave(player, btn.guild);
          await updateControllerMessage(player, btn.guild);
          // Warm the cache for next next track
          try { await prefetchNext(player, btn.guild, 2); } catch {}
          return btn.reply({ content: `Skipped **${curr?.title || 'current track'}**.`, flags: MessageFlags.Ephemeral });
        }
        case 'music:previous': {
          if (!queue || !queue.currentTrack) {
            return btn.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
          }

          let did = false;
          try {
            if (queue.history?.previous) { await queue.history.previous(); did = true; }
            else if (typeof queue.back === 'function') { await queue.back(); did = true; }
            else if (queue.node?.previous) { await queue.node.previous(); did = true; }
          } catch {}

          if (!did) {
            try {
              const hist = queue.history;
              const prevTrack =
                hist?.tracks?.toArray?.()?.at(-1) ||
                hist?.previousTrack ||
                null;

              if (prevTrack) {
                try { hist.tracks?.pop?.(); } catch {}
                try { if (queue.currentTrack) queue.insertTrack(queue.currentTrack, 0); } catch {}
                try { queue.insertTrack(prevTrack, 0); } catch {}

                if (queue.node.isPlaying() || queue.node.isPaused()) {
                  await queue.node.skip();
                } else {
                  await queue.node.play();
                }
                did = true;
              } else {
                try { await queue.node.seek(0); did = true; } catch {}
              }
            } catch {}
          }

          if (!did) return btn.reply({ content: 'Previous is not supported by this player build.', flags: MessageFlags.Ephemeral });

          pushLog(gid, `⏮️ **${btn.user.tag}** went to previous track.`);
          touchActive(gid);
          scheduleIdleLeave(player, btn.guild);
          await updateControllerMessage(player, btn.guild);
          try { await prefetchNext(player, btn.guild, 2); } catch {}
          return btn.reply({ content: 'Playing previous track.', flags: MessageFlags.Ephemeral });
        }
        case 'music:loop': {
          if (!queue || !queue.currentTrack) return btn.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
          const enabled = queue.repeatMode === QueueRepeatMode.TRACK;
          queue.setRepeatMode(enabled ? QueueRepeatMode.OFF : QueueRepeatMode.TRACK);
          pushLog(gid, `${enabled ? '🔁❌' : '🔁✅'} **${btn.user.tag}** ${enabled ? 'disabled' : 'enabled'} loop.`);
          touchActive(gid);
          scheduleIdleLeave(player, btn.guild);
          await updateControllerMessage(player, btn.guild);
          return btn.reply({ content: enabled ? 'Loop disabled.' : 'Loop enabled (track).', flags: MessageFlags.Ephemeral });
        }
      }
    } catch (err) {
      console.error('music button error:', err);
      return btn.reply({ content: 'Operation failed.', flags: MessageFlags.Ephemeral });
    }
  });

  collector.on('end', async () => {
    try {
      const st = ensureGuildState(controllerMsg.guild.id);
      const disabled = makeControllerRows().map(r => { r.components.forEach(c => c.setDisabled(true)); return r; });
      await controllerMsg.edit({ components: disabled }).catch(() => {});
    } catch {}
  });

  const modalListener = async (i) => {
    try {
      if (!i.isModalSubmit()) return;

      if (i.customId.startsWith('music:play:modal:')) {
        const msgId = i.customId.split(':').pop();
        if (msgId !== controllerMsg.id) return;

        try { await i.deferReply({ flags: MessageFlags.Ephemeral }); } catch {}

        const same = mustBeSameVoice(i); if (!same.ok) return i.editReply({ content: same.msg, flags: MessageFlags.Ephemeral });
        const voice = getUserVoice(i);
        try { await ensureBasicPermissions(i, voice); } catch (e) { return i.editReply({ content: e.message, flags: MessageFlags.Ephemeral }); }

        let query = i.fields.getTextInputValue('music:play:input').trim();

        if (looksLikeUrl(query)) {
          try {
            const u = new URL(query);

            if (u.hostname.includes('open.spotify.com') && /\/track\//.test(u.pathname)) {
              const q2 = await spotifyToSearchQuery(query);
              if (q2) query = q2;
            }

            if (u.hostname.includes('open.spotify.com') && (/\/playlist\//.test(u.pathname) || /\/album\//.test(u.pathname))) {
              const items = await expandSpotifyPlaylist(query);
              if (items.length > 0) {
                const queue = await getOrCreateArbitraryQueue(player, i.guild, voice, query);

                let firstTrack = null, addedCount = 0;
                for (const item of items) {
                  const metaTrack = {
                    title: item.title || 'Untitled',
                    url: item.webpage_url || item.title,
                    thumbnail: item.thumbnail || null,
                    requestedBy: i.user,
                    raw: { source: "arbitrary" }
                  };
                  queue.addTrack(metaTrack);
                  if (!firstTrack) firstTrack = metaTrack;
                  addedCount++;
                }
                touchActive(i.guild.id);
                try { await prefetchNext(player, i.guild, 3); } catch {}

                if (!queue.isPlaying()) await queue.node.play();
                await i.editReply({ content: `Queued **${addedCount}** tracks from Spotify ${/playlist/.test(u.pathname) ? 'playlist' : 'album'}. Now playing: **${firstTrack.title}**`, flags: MessageFlags.Ephemeral });
                await updateControllerMessage(player, i.guild);
                return;
              }
            }

            if ((u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) && u.searchParams.has('list')) {
              const items = await expandYouTubePlaylist(query);
              if (items.length > 0) {
                const queue = await getOrCreateArbitraryQueue(player, i.guild, voice, query);

                let firstTrack = null, addedCount = 0;
                for (const item of items) {
                  const metaTrack = {
                    title: item.title || 'Untitled',
                    url: item.webpage_url,
                    thumbnail: item.thumbnail || null,
                    requestedBy: i.user,
                    raw: { source: "arbitrary" }
                  };
                  queue.addTrack(metaTrack);
                  if (!firstTrack) firstTrack = metaTrack;
                  addedCount++;
                }
                touchActive(i.guild.id);
                try { await prefetchNext(player, i.guild, 3); } catch {}

                if (!queue.isPlaying()) await queue.node.play();
                await i.editReply({ content: `Queued **${addedCount}** tracks from playlist. Now playing: **${firstTrack.title}**`, flags: MessageFlags.Ephemeral });
                await updateControllerMessage(player, i.guild);
                return;
              }
            }
          } catch {}
          query = normalizeYouTubeUrl(query);
        }

        try {
          const track = await playViaPython(player, i, voice, query);
          touchActive(i.guild.id);
          scheduleIdleLeave(player, i.guild);
          await updateControllerMessage(player, i.guild);
          await i.editReply({ content: `Added to queue: **${track.title}**`, flags: MessageFlags.Ephemeral });
        } catch (err) {
          console.error('music play error:', err);
          await i.editReply({ content: 'Could not play that link. Try another link or search words.', flags: MessageFlags.Ephemeral });
        }
        return;
      }
    } catch (e) { console.error('modal handler error:', e); }
  };

  controllerMsg.client.on('interactionCreate', modalListener);
  collector.once('end', () => controllerMsg.client.off('interactionCreate', modalListener));
}

function bindPlayerEventsOnce(player, guild) {
  const st = ensureGuildState(guild.id);
  if (st.listenersBound) return;
  st.listenersBound = true;

  player.events.on('audioTrackAdd', async (q, track) => {
    if (q.guild.id !== guild.id) return;
    touchActive(guild.id);
    pushLog(guild.id, `➕ Added **${track.title}** to the queue.`);
    try { await prefetchNext(player, guild, 2); } catch {}
    await updateControllerMessage(player, guild);
  });

  player.events.on('audioTracksAdd', async (q, playlist) => {
    if (q.guild.id !== guild.id) return;
    touchActive(guild.id);
    pushLog(guild.id, `📃 Added playlist **${playlist.tracks.length}** tracks.`);
    try { await prefetchNext(player, guild, 3); } catch {}
    await updateControllerMessage(player, guild);
  });

  player.events.on('playerStart', async (q) => {
    if (q.guild.id !== guild.id) return;
    touchActive(guild.id);
    // cancel any idle timer since we just started playing again
    const st = ensureGuildState(guild.id);
    if (st.idleTimer) { clearTimeout(st.idleTimer); st.idleTimer = null; }
    // Warm the next tracks while this one plays
    try { await prefetchNext(player, guild, 2); } catch {}
    await updateControllerMessage(player, guild);
  });

  player.events.on('emptyQueue', async (q) => {
    if (q.guild.id !== guild.id) return;
    pushLog(guild.id, '⏳ Queue finished (staying in channel).');
    scheduleIdleLeave(player, guild);
  });

  player.events.on('disconnect', async (q) => {
    if (q.guild.id !== guild.id) return;
    pushLog(guild.id, '🔚 Disconnected from voice.');
    await finalizeControllerMessage(guild);
  });

  player.events.on('playerError', async (q, error) => {
    if (q.guild.id !== guild.id) return;
    pushLog(guild.id, `⚠️ Player error: ${String(error.message)}`);
    await updateControllerMessage(player, guild);
  });
}