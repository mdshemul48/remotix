const express = require("express");
const { Server } = require("ws");
const { Client } = require("ssh2");
const path = require("path");

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

const wss = new Server({
  server,
  verifyClient: ({ origin }, callback) => {
    callback(true);
  },
});

const TERMINAL_COLS = 140;
const TERMINAL_ROWS = 30;

app.use(express.static(path.join(__dirname, "public")));

function getSystemInfoCommand() {
  return `
    CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | sed "s/.*, *\\([0-9.]*\\)%* id.*/\\1/" | awk '{print 100 - $1}')
    MEM_INFO=$(free -m | grep Mem)
    MEM_TOTAL=$(echo "$MEM_INFO" | awk '{print $2}')
    MEM_USED=$(echo "$MEM_INFO" | awk '{print $3}')
    MEM_PERCENT=$(awk "BEGIN {printf \\"%.2f\\", $MEM_USED/$MEM_TOTAL*100}")
    
    cat << EOF
    {
      "cpu": "$CPU_USAGE",
      "memory": "$MEM_PERCENT",
      "memoryUsed": "$(echo "scale=2; $MEM_USED/1024" | bc)",
      "totalMemory": "$(echo "scale=2; $MEM_TOTAL/1024" | bc)",
      "uptime": "$(cat /proc/uptime | awk '{print $1}')",
      "hostname": "$(hostname)",
      "platform": "$(uname -s)"
    }
EOF
  `;
}

function createMonitoringClient(connectionInfo, ws) {
  const monitorClient = new Client();

  monitorClient.on("ready", () => {
    monitorClient.shell({ term: "xterm" }, (err, stream) => {
      if (err) {
        return;
      }

      let dataBuffer = "";
      stream.on("data", (data) => {
        dataBuffer += data.toString();
        if (dataBuffer.includes("}")) {
          try {
            const jsonStart = dataBuffer.indexOf("{");
            const jsonEnd = dataBuffer.indexOf("}") + 1;
            const jsonStr = dataBuffer.substring(jsonStart, jsonEnd);

            const info = JSON.parse(jsonStr);
            ws.send(
              JSON.stringify({
                type: "systemInfo",
                data: {
                  cpu: parseFloat(info.cpu).toFixed(2),
                  memory: parseFloat(info.memory).toFixed(2),
                  memoryUsed: parseFloat(info.memoryUsed).toFixed(2),
                  totalMemory: parseFloat(info.totalMemory).toFixed(2),
                  uptime: parseFloat(info.uptime),
                  hostname: info.hostname,
                  platform: info.platform,
                },
              })
            );
          } catch (e) {}
          dataBuffer = "";
        }
      });

      const monitorInterval = setInterval(() => {
        stream.write(getSystemInfoCommand() + "\n");
      }, 2000);

      ws.on("close", () => {
        clearInterval(monitorInterval);
        monitorClient.end();
      });
    });
  });

  monitorClient.connect(connectionInfo);
  return monitorClient;
}

wss.on("connection", (ws) => {
  let terminalClient = null;
  let monitorClient = null;
  let hasExecutedCommands = false;

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data);

      if (message.type === "connect") {
        const connectionInfo = {
          host: message.host,
          port: message.port || 22,
          username: message.username,
          password: message.password,
        };

        terminalClient = new Client();
        terminalClient.on("ready", () => {
          terminalClient.shell(
            {
              term: "xterm-256color",
              cols: TERMINAL_COLS,
              rows: TERMINAL_ROWS,
            },
            (err, stream) => {
              if (err) {
                ws.send(
                  JSON.stringify({ type: "error", message: "Shell failed" })
                );
                return;
              }

              stream.on("data", (data) => {
                const output = data.toString();
                ws.send(JSON.stringify({ type: "data", message: output }));

                if (output.includes("[sudo] password")) {
                  stream.write(message.password + "\n");
                }

                if (!hasExecutedCommands && output.includes("root@")) {
                  hasExecutedCommands = true;
                  if (message.initialPath) {
                    stream.write(`cd "${message.initialPath.trim()}"\n`);
                  }
                }
              });

              ws.stream = stream;
              stream.write("sudo su\n");
            }
          );
        });

        terminalClient.connect(connectionInfo);
        monitorClient = createMonitoringClient(connectionInfo, ws);
      } else if (message.type === "data" && ws.stream) {
        ws.stream.write(message.data);
      }
    } catch (err) {}
  });

  ws.on("close", () => {
    if (terminalClient) terminalClient.end();
    if (monitorClient) monitorClient.end();
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
