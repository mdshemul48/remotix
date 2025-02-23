require("dotenv").config();
const express = require("express");
const { Server } = require("ws");
const path = require("path");
const fs = require("fs");
const https = require("https");
const SSHClient = require("./lib/sshClient");

const app = express();

// SSL configuration
const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, "certs/private.key")),
  cert: fs.readFileSync(path.join(__dirname, "certs/certificate.pem")),
};

const server = https.createServer(sslOptions, app);

// CORS middleware - allow all origins or specific ones from env
app.use((req, res, next) => {
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",")
    : ["*"];

  const origin = req.headers.origin;

  if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Allow-Credentials", "true");
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// WebSocket server with origin verification
const wss = new Server({
  server,
  verifyClient: ({ origin, req }, callback) => {
    const allowedOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
      : ["*"];

    if (allowedOrigins.includes("*")) {
      callback(true);
    } else {
      callback(allowedOrigins.includes(origin));
    }
  },
  clientTracking: true,
});

app.use(express.static(path.join(__dirname, "public")));

wss.on("connection", (ws) => {
  const sshClient = new SSHClient(ws);

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data);

      if (message.type === "connect") {
        sshClient.connect({
          host: message.host || process.env.DEFAULT_SSH_HOST,
          port: message.port || process.env.DEFAULT_SSH_PORT || 22,
          username: message.username || process.env.DEFAULT_SSH_USERNAME,
          password: message.password || process.env.DEFAULT_SSH_PASSWORD,
          initialPath: message.initialPath || process.env.DEFAULT_INITIAL_PATH,
        });
      } else if (message.type === "data") {
        sshClient.write(message.data);
      }
    } catch (err) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Invalid message format",
        })
      );
    }
  });

  ws.on("error", () => sshClient.cleanup());
  ws.on("close", () => sshClient.cleanup());
});

const PORT = process.env.HOST_PORT || 3000;
server.listen(PORT, () => {
  console.log(`Secure server running on https://localhost:${PORT}`);
});
