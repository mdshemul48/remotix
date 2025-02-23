require("dotenv").config();
const express = require("express");
const { Server } = require("ws");
const path = require("path");
const SSHClient = require("./lib/sshClient");

const app = express();
const server = require("http").createServer(app);

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

const wss = new Server({ server });

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

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
