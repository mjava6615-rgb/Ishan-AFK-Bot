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

function createBot() {
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
