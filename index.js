const mineflayer = require('mineflayer');
const { Movements, pathfinder, goals } = require('mineflayer-pathfinder');
const { GoalBlock } = goals;
const express = require('express');
const https = require('https');
const config = require('./settings.json');

// ============================================================
// EXPRESS SERVER & WEB DASHBOARD
// ============================================================
const app = express();
const PORT = process.env.PORT || 5000;

let botState = {
  connected: false,
  lastActivity: Date.now(),
  reconnectAttempts: 0,
  startTime: Date.now(),
  errors: []
};

app.get('/', (req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - botState.startTime) / 1000);
  const statusColor = botState.connected ? '#2dd4bf' : '#f43f5e';
  const statusText = botState.connected ? 'ONLINE' : 'OFFLINE';

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${config.name || 'Bot Status'}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            background: #0f172a; 
            color: #f8fafc; 
            display: flex; 
            justify-content: center; 
            align-items: center; 
            min-height: 100vh; 
            margin: 0; 
          }
          .container {
            background: #1e293b;
            padding: 40px;
            border-radius: 20px;
            box-shadow: 0 0 50px rgba(45, 212, 191, 0.2);
            text-align: center;
            width: 350px;
            border: 1px solid #334155;
          }
          h1 { margin-bottom: 30px; font-size: 24px; color: #ccfbf1; }
          .stat-card {
            background: #0f172a;
            padding: 15px;
            margin: 15px 0;
            border-radius: 12px;
            border-left: 5px solid ${statusColor};
            text-align: left;
          }
          .label { font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; }
          .value { font-size: 18px; font-weight: bold; color: ${statusColor}; margin-top: 5px; }
          .status-dot { 
            height: 12px; width: 12px; 
            border-radius: 50%; 
            display: inline-block; 
            margin-right: 8px;
            background-color: ${statusColor};
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>${config.name || 'Bot Dashboard'}</h1>
          <div class="stat-card">
            <div class="label">Status</div>
            <div class="value"><span class="status-dot"></span>${statusText}</div>
          </div>
          <div class="stat-card">
            <div class="label">Server</div>
            <div class="value">${config.server.ip}:${config.server.port}</div>
          </div>
          <div class="stat-card">
            <div class="label">Uptime</div>
            <div class="value">${uptimeSeconds}s</div>
          </div>
          <div class="stat-card">
            <div class="label">Reconnect Attempts</div>
            <div class="value">${botState.reconnectAttempts}</div>
          </div>
        </div>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`[Dashboard] Web server running on port ${PORT}`);
});

// ============================================================
// DISCORD WEBHOOK LOGGING
// ============================================================
function sendDiscordWebhook(title, description, color = 3066993) {
  if (!config.discord || !config.discord.enabled || !config.discord.webhookUrl) return;

  try {
    const url = new URL(config.discord.webhookUrl);
    const payload = JSON.stringify({
      embeds: [{
        title: title,
        description: description,
        color: color,
        timestamp: new Date().toISOString()
      }]
    });

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options);
    req.on('error', (e) => console.error(`[Discord Webhook Error]: ${e.message}`));
    req.write(payload);
    req.end();
  } catch (err) {
    console.error(`[Discord Invalid URL]: ${err.message}`);
  }
}

// ============================================================
// MINEFLAYER BOT CREATION & EVENT HANDLING
// ============================================================
let bot;
let reconnectTimeout = null;
let activeIntervals = [];

function clearAntiAfkIntervals() {
  activeIntervals.forEach(clearInterval);
  activeIntervals = [];
}

function createBot() {
  clearAntiAfkIntervals();

  const username = config.botAccount ? config.botAccount.username : (config['bot-account'] ? config['bot-account'].username : 'Bot');
  console.log(`[Bot] Connecting to ${config.server.ip}:${config.server.port}...`);

  bot = mineflayer.createBot({
    host: config.server.ip,
    port: config.server.port,
    username: username,
    version: config.server.version || false,
    auth: 'offline'
  });

  // Load pathfinder plugin
  bot.loadPlugin(pathfinder);

  bot.once('spawn', () => {
    botState.connected = true;
    botState.reconnectAttempts = 0;
    console.log(`[Bot] Successfully spawned in server as ${bot.username}`);

    // Initialize pathfinder default movements
    const defaultMove = new Movements(bot);
    bot.pathfinder.setMovements(defaultMove);

    if (config.discord && config.discord.events && config.discord.events.connect) {
      sendDiscordWebhook('Bot Connected', `Bot **${bot.username}** successfully connected to \`${config.server.ip}\`.`, 3066993);
    }

    // Auto-authentication (AuthMe support)
    const autoAuth = config.utils ? config.utils['auto-auth'] : null;
    if (autoAuth && autoAuth.enabled && autoAuth.password) {
      setTimeout(() => {
        bot.chat(`/register ${autoAuth.password}${autoAuth.password}`);
        bot.chat(`/login ${autoAuth.password}`);
      }, 1500);
    }

    // Anti-AFK behaviors
    startAntiAfkBehaviors();
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    if (config.utils && config.utils['chat-log']) {
      console.log(`[Chat] <${username}>${message}`);
    }
  });

  bot.on('error', (err) => {
    console.error(`[Bot Error] ${err.message}`);
    botState.errors.push(err.message);
  });

  bot.on('end', (reason) => {
    botState.connected = false;
    clearAntiAfkIntervals();
    console.log(`[Bot] Disconnected: ${reason}`);

    if (config.discord && config.discord.events && config.discord.events.disconnect) {
      sendDiscordWebhook('Bot Disconnected', `Bot disconnected from server. Reason: \`${reason}\``, 15158332);
    }

    // Prevent stacking multiple reconnect timers
    if (reconnectTimeout) clearTimeout(reconnectTimeout);

    const autoReconnect = config.utils ? config.utils['auto-reconnect'] : true;
    if (autoReconnect) {
      botState.reconnectAttempts++;
      const delay = config.utils ? (config.utils['auto-reconnect-delay'] || 5000) : 5000;
      console.log(`[Bot] Reconnecting in ${delay / 1000} seconds...`);
      reconnectTimeout = setTimeout(createBot, delay);
    }
  });
}

// ============================================================
// ANTI-AFK UTILITIES
// ============================================================
function startAntiAfkBehaviors() {
  const movement = config.movement;
  const utils = config.utils;

  // Sneak anti-AFK
  if (utils && utils['anti-afk'] && utils['anti-afk'].enabled && utils['anti-afk'].sneak) {
    const id = setInterval(() => {
      if (!bot || !botState.connected) return;
      bot.setControlState('sneak', true);
      setTimeout(() => bot && bot.setControlState('sneak', false), 1000);
    }, 4000);
    activeIntervals.push(id);
  }

  // Random Jumping
  if (movement && movement['random-jump'] && movement['random-jump'].enabled) {
    const id = setInterval(() => {
      if (!bot || !botState.connected) return;
      bot.setControlState('jump', true);
      setTimeout(() => bot && bot.setControlState('jump', false), 500);
    }, movement['random-jump'].interval || 10000);
    activeIntervals.push(id);
  }

  // Look Around
  if (movement && movement['look-around'] && movement['look-around'].enabled) {
    const id = setInterval(() => {
      if (!bot || !botState.connected) return;
      const yaw = Math.random() * Math.PI * 2;
      const pitch = (Math.random() - 0.5) * Math.PI;
      bot.look(yaw, pitch, false);
    }, movement['look-around'].interval || 5000);
    activeIntervals.push(id);
  }

  // Repeating Chat Messages
  if (utils && utils['chat-messages'] && utils['chat-messages'].enabled) {
    const chatConfig = utils['chat-messages'];
    let messageIndex = 0;

    const id = setInterval(() => {
      if (!bot || !botState.connected || !chatConfig.messages || !chatConfig.messages.length) return;
      bot.chat(chatConfig.messages[messageIndex]);
      messageIndex = (messageIndex + 1) % chatConfig.messages.length;
    }, (chatConfig['repeat-delay'] || 30) * 1000);
    activeIntervals.push(id);
  }
}

// Start the bot
createBot();
