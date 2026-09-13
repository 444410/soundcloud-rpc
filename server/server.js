const net = require('net');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'config.json');
let config = {
  clientId: '1156699732765310976',
  port: 3020,
  showButtons: true,
  showArtwork: true,
  showSmallIcon: false,
  idleTimeoutSeconds: 25,
  defaultArtwork: 'https://cdn.discordapp.com/app-icons/1156699732765310976/0769c6999504c3379497999d4c90ef86.png',
  smallIconUrl: null
};

try {
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf8');
    config = { ...config, ...JSON.parse(raw) };
  }
} catch (e) {
  console.error('Error reading config.json:', e.message);
}

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  orange: '\x1b[38;5;208m'
};

function log(tag, msg, color = colors.reset) {
  const time = new Date().toLocaleTimeString();
  console.log(`${colors.dim}[${time}]${colors.reset} ${color}[${tag}]${colors.reset} ${msg}`);
}

class DiscordIpcClient {
  constructor(clientId) {
    this.clientId = clientId;
    this.socket = null;
    this.connected = false;
    this.ready = false;
    this.currentActivity = null;
    this.reconnectTimer = null;
    this.incomingBuffer = Buffer.alloc(0);
    this.nonceCounter = 0;
  }

  connect() {
    if (this.socket) {
      try { this.socket.destroy(); } catch (_) {}
      this.socket = null;
    }
    this.connected = false;
    this.ready = false;
    this._tryConnectPipe(0);
  }

  _tryConnectPipe(index) {
    if (index > 9) {
      log('Discord', 'Discord not found on IPC pipes. Retrying in 5s...', colors.yellow);
      this._scheduleReconnect(5000);
      return;
    }

    const pipePath = `\\\\?\\pipe\\discord-ipc-${index}`;
    const sock = net.connect(pipePath, () => {
      this.socket = sock;
      this.connected = true;
      log('Discord', `Connected to pipe discord-ipc-${index}`, colors.green);
      this._sendHandshake();
    });

    sock.on('data', (chunk) => this._handleData(chunk));

    sock.on('error', (err) => {
      sock.destroy();
      if (!this.connected) {
        this._tryConnectPipe(index + 1);
      } else {
        log('Discord', `Socket error: ${err.message}`, colors.red);
        this._onDisconnected();
      }
    });

    sock.on('close', () => {
      if (this.connected) {
        log('Discord', 'Connection closed.', colors.yellow);
        this._onDisconnected();
      }
    });
  }

  _scheduleReconnect(delayMs = 5000) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), delayMs);
  }

  _onDisconnected() {
    this.connected = false;
    this.ready = false;
    this.socket = null;
    this.incomingBuffer = Buffer.alloc(0);
    this._scheduleReconnect(5000);
  }

  _sendPacket(opcode, payloadObj) {
    if (!this.socket || !this.connected) return;
    try {
      const jsonStr = JSON.stringify(payloadObj);
      const jsonLen = Buffer.byteLength(jsonStr, 'utf8');
      const packet = Buffer.alloc(8 + jsonLen);
      packet.writeInt32LE(opcode, 0);
      packet.writeInt32LE(jsonLen, 4);
      packet.write(jsonStr, 8, jsonLen, 'utf8');
      this.socket.write(packet);
    } catch (err) {
      log('Discord', `Send failed: ${err.message}`, colors.red);
    }
  }

  _sendHandshake() {
    this._sendPacket(0, {
      v: 1,
      client_id: this.clientId
    });
  }

  _handleData(chunk) {
    this.incomingBuffer = Buffer.concat([this.incomingBuffer, chunk]);

    while (this.incomingBuffer.length >= 8) {
      const opcode = this.incomingBuffer.readInt32LE(0);
      const length = this.incomingBuffer.readInt32LE(4);

      if (this.incomingBuffer.length < 8 + length) {
        break;
      }

      const payloadBuf = this.incomingBuffer.subarray(8, 8 + length);
      this.incomingBuffer = this.incomingBuffer.subarray(8 + length);

      let payload = null;
      try {
        payload = JSON.parse(payloadBuf.toString('utf8'));
      } catch (err) {
        continue;
      }

      this._processPayload(opcode, payload);
    }
  }

  _processPayload(opcode, payload) {
    if (opcode === 2) {
      log('Discord', `Closed by Discord: ${JSON.stringify(payload)}`, colors.red);
      this._onDisconnected();
      return;
    }

    if (opcode === 3) {
      this._sendPacket(4, payload);
      return;
    }

    if (opcode === 1) {
      if (payload.cmd === 'DISPATCH' && payload.evt === 'READY') {
        this.ready = true;
        const user = payload.data?.user?.username || 'User';
        log('Discord', `Logged in as: ${colors.bright}${user}${colors.reset}`, colors.green);

        if (this.currentActivity) {
          this.setActivity(this.currentActivity);
        }
      }
    }
  }

  setActivity(activity) {
    this.currentActivity = activity;
    if (!this.ready) return;

    this.nonceCounter++;
    const nonce = `sc-${Date.now()}-${this.nonceCounter}`;
    this._sendPacket(1, {
      cmd: 'SET_ACTIVITY',
      args: {
        pid: process.pid,
        activity: activity
      },
      nonce: nonce
    });
  }

  clearActivity() {
    this.setActivity(null);
  }
}

const discord = new DiscordIpcClient(config.clientId);

let lastTrackState = null;
let lastDiscordActivity = null;
let lastSendTimestamp = 0;
let idleTimer = null;

function upscaleArtwork(url) {
  if (!url || typeof url !== 'string') return config.defaultArtwork;
  url = url.replace(/&quot;/g, '').replace(/^["']|["']$/g, '').trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return config.defaultArtwork;
  }
  return url.replace(/-t\d+x\d+\.(jpg|png|jpeg)/i, '-t500x500.$1').replace(/-large\.(jpg|png|jpeg)/i, '-t500x500.$1');
}

function formatActivity(track) {
  if (!track || !track.title) return null;

  const isPlaying = Boolean(track.playing);
  const title = (track.title || 'Unknown Track').trim();
  const artist = (track.artist || 'Unknown Artist').trim();
  const artwork = upscaleArtwork(track.artwork);

  const stateText = isPlaying ? `by ${artist}` : `Paused • ${artist}`;

  const activity = {
    details: title.length > 128 ? title.slice(0, 125) + '...' : title,
    state: stateText.length > 128 ? stateText.slice(0, 125) + '...' : stateText,
    assets: {
      large_image: config.showArtwork && artwork ? artwork : config.defaultArtwork,
      large_text: title.length > 128 ? title.slice(0, 125) + '...' : title
    }
  };

  if (config.showSmallIcon && config.smallIconUrl) {
    activity.assets.small_image = config.smallIconUrl;
    activity.assets.small_text = isPlaying ? 'SoundCloud' : 'Paused';
  }

  const now = Math.floor(Date.now() / 1000);
  const currentTime = typeof track.currentTime === 'number' && !isNaN(track.currentTime) ? track.currentTime : 0;

  if (isPlaying) {
    activity.timestamps = {
      start: Math.max(0, now - Math.floor(currentTime))
    };
  }

  if (config.showButtons && track.link && (track.link.startsWith('http://') || track.link.startsWith('https://'))) {
    activity.buttons = [
      {
        label: 'Listen on SoundCloud',
        url: track.link
      }
    ];
  }

  return activity;
}

function updateTrackState(track) {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  if (!track || !track.title) {
    clearTrackState('No track info');
    return;
  }

  const isPlaying = Boolean(track.playing);
  const now = Date.now();

  const activity = formatActivity(track);

  const songChanged = !lastTrackState ||
    lastTrackState.title !== track.title ||
    lastTrackState.artist !== track.artist ||
    lastTrackState.playing !== track.playing ||
    Math.abs((lastTrackState.currentTime || 0) - (track.currentTime || 0)) > 4;

  const timeSinceLastSend = now - lastSendTimestamp;

  if (songChanged || timeSinceLastSend > 15000) {
    discord.setActivity(activity);
    lastDiscordActivity = activity;
    lastSendTimestamp = now;

    if (!lastTrackState || lastTrackState.title !== track.title || lastTrackState.playing !== track.playing) {
      const statusIcon = isPlaying ? '▶' : '⏸';
      const curMin = Math.floor((track.currentTime || 0) / 60);
      const curSec = Math.floor((track.currentTime || 0) % 60).toString().padStart(2, '0');
      const durMin = Math.floor((track.duration || 0) / 60);
      const durSec = Math.floor((track.duration || 0) % 60).toString().padStart(2, '0');
      const timeStr = track.duration ? `[${curMin}:${curSec} / ${durMin}:${durSec}]` : `[${curMin}:${curSec}]`;

      log(
        'Now Playing',
        `${colors.orange}${statusIcon} ${track.title}${colors.reset} by ${colors.cyan}${track.artist}${colors.reset} ${colors.dim}${timeStr}${colors.reset}`,
        colors.bright
      );
    }
  }

  lastTrackState = { ...track };

  if (!isPlaying) {
    idleTimer = setTimeout(() => {
      log('Presence', 'Paused timeout reached, clearing presence.', colors.yellow);
      discord.clearActivity();
      lastDiscordActivity = null;
      lastTrackState = null;
    }, config.idleTimeoutSeconds * 1000);
  }
}

function clearTrackState(reason = 'Cleared') {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (lastDiscordActivity) {
    log('Presence', `Clearing Rich Presence (${reason})`, colors.yellow);
    discord.clearActivity();
    lastDiscordActivity = null;
  }
  lastTrackState = null;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/track') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        updateTrackState(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', discordReady: discord.ready }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/clear') {
    clearTrackState('Tab closed or stopped');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'cleared' }));
    return;
  }

  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      discordConnected: discord.connected,
      discordReady: discord.ready,
      lastTrack: lastTrackState,
      port: config.port
    }));
    return;
  }

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>SoundCloud Discord RPC</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #121214; color: #eee; padding: 40px; display: flex; justify-content: center; }
          .card { background: #1e1f22; border-radius: 12px; padding: 24px; width: 450px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
          h1 { margin-top: 0; color: #ff5500; font-size: 22px; display: flex; align-items: center; gap: 10px; }
          .badge { display: inline-block; padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: bold; }
          .connected { background: #23a55a; color: #fff; }
          .disconnected { background: #f23f43; color: #fff; }
          .track-box { background: #2b2d31; border-radius: 8px; padding: 16px; margin-top: 16px; display: flex; gap: 14px; align-items: center; }
          .artwork { width: 64px; height: 64px; border-radius: 6px; background-size: cover; background-position: center; flex-shrink: 0; background-color: #313338; }
          .track-info { overflow: hidden; }
          .title { font-weight: 600; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .artist { color: #949ba4; font-size: 13px; margin-top: 4px; }
        </style>
        <meta http-equiv="refresh" content="3">
      </head>
      <body>
        <div class="card">
          <h1>SoundCloud Discord RPC</h1>
          <p>Discord: <span class="badge ${discord.ready ? 'connected' : 'disconnected'}">${discord.ready ? 'Connected' : 'Connecting...'}</span></p>
          <div class="track-box">
            <div class="artwork" style="background-image: url('${lastTrackState?.artwork || config.defaultArtwork}')"></div>
            <div class="track-info">
              <div class="title">${lastTrackState ? lastTrackState.title : 'Waiting for music...'}</div>
              <div class="artist">${lastTrackState ? (lastTrackState.playing ? '▶ ' : '⏸ ') + lastTrackState.artist : 'Play a track on SoundCloud'}</div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `);
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.on('upgrade', (req, socket, head) => {
  if (req.headers['upgrade'] !== 'websocket') {
    socket.destroy();
    return;
  }

  const key = req.headers['sec-websocket-key'];
  const hash = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  const responseHeaders = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${hash}`
  ];

  socket.write(responseHeaders.join('\r\n') + '\r\n\r\n');

  socket.on('data', (buf) => {
    try {
      if (buf.length < 2) return;
      const firstByte = buf[0];
      const opcode = firstByte & 0x0f;

      if (opcode === 8) {
        socket.end();
        return;
      }
      if (opcode === 9) {
        const pong = Buffer.from([0x8a, 0x00]);
        socket.write(pong);
        return;
      }

      if (opcode === 1) {
        const secondByte = buf[1];
        const isMasked = (secondByte & 0x80) !== 0;
        let payloadLen = secondByte & 0x7f;
        let offset = 2;

        if (payloadLen === 126) {
          payloadLen = buf.readUInt16BE(offset);
          offset += 2;
        } else if (payloadLen === 127) {
          payloadLen = Number(buf.readBigUInt64BE(offset));
          offset += 8;
        }

        let mask = null;
        if (isMasked) {
          mask = buf.subarray(offset, offset + 4);
          offset += 4;
        }

        const payloadData = buf.subarray(offset, offset + payloadLen);
        if (isMasked && mask) {
          for (let i = 0; i < payloadData.length; i++) {
            payloadData[i] ^= mask[i % 4];
          }
        }

        const json = JSON.parse(payloadData.toString('utf8'));
        if (json.type === 'track') {
          updateTrackState(json.data);
        } else if (json.type === 'clear') {
          clearTrackState('WebSocket clear');
        }
      }
    } catch (_) {}
  });

  socket.on('error', () => {});
});

server.listen(config.port, '127.0.0.1', () => {
  console.log(`Server listening on http://127.0.0.1:${config.port}`);
  discord.connect();
});

function shutdown() {
  discord.clearActivity();
  setTimeout(() => {
    process.exit(0);
  }, 300);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
