const { Client } = require("ssh2");

class SSHClient {
  constructor(ws) {
    this.ws = ws;
    this.client = null;
    this.stream = null;
    this.isConnecting = false;
    this.isConnected = false;
    this.authTimeout = null;
  }

  connect(connectionInfo) {
    if (this.isConnecting) {
      return;
    }

    if (this.client) {
      this.client.end();
    }

    this.isConnecting = true;
    this.client = new Client();

    this.setupEventHandlers(connectionInfo);
    this.startAuthTimeout();
    this.setupMonitoring(connectionInfo);

    try {
      this.client.connect({
        ...connectionInfo,
        readyTimeout: 20000,
        keepaliveInterval: 10000,
        debug: (debug) => console.log("SSH Debug:", debug), // Helpful for debugging
      });
    } catch (err) {
      this.handleError(err);
    }
  }

  setupEventHandlers(connectionInfo) {
    this.client.on("error", this.handleError.bind(this));
    this.client.on("ready", () => this.handleReady(connectionInfo));
    this.client.on("close", () => this.handleClose());
  }

  handleError(err) {
    this.isConnecting = false;
    let message = "Connection error";
    let isFatal = false;

    if (err.message.includes("Authentication failed")) {
      message = "Invalid username or password";
      isFatal = true;
    } else if (err.level === "client-socket" && err.code === "ECONNREFUSED") {
      message = `Could not reach server at ${err.address}:${err.port}`;
      // Not fatal - will allow retry
    } else if (err.message.includes("ETIMEDOUT")) {
      message = "Connection timed out";
      // Not fatal - will allow retry
    }

    this.sendError(message);

    if (isFatal) {
      this.cleanup();
    } else {
      // Reset connection state but keep client alive for retry
      this.isConnecting = false;
      this.isConnected = false;
      clearTimeout(this.authTimeout);
      if (this.stream) {
        this.stream.end();
        this.stream = null;
      }
    }
  }

  handleReady(connectionInfo) {
    clearTimeout(this.authTimeout);
    this.isConnecting = false;
    this.isConnected = true;

    this.client.shell(
      {
        term: "xterm-256color",
        cols: 140,
        rows: 30,
      },
      (err, stream) => {
        if (err) {
          this.sendError("Failed to start shell");
          return;
        }

        this.stream = stream;
        this.setupStreamHandlers(stream, connectionInfo);
        this.sendStatus("Connected successfully");
      }
    );
  }

  setupStreamHandlers(stream, connectionInfo) {
    let hasExecutedCommands = false;

    stream.on("data", (data) => {
      const output = data.toString();
      this.ws.send(JSON.stringify({ type: "data", message: output }));

      if (output.includes("[sudo] password")) {
        stream.write(connectionInfo.password + "\n");
      }

      if (!hasExecutedCommands && output.includes("root@")) {
        hasExecutedCommands = true;
        if (connectionInfo.initialPath) {
          stream.write(`cd "${connectionInfo.initialPath.trim()}"\n`);
        }
      }
    });

    this.ws.stream = stream;
    stream.write("sudo su\n");
  }

  handleClose() {
    this.isConnecting = false;
    this.isConnected = false;
    this.sendStatus("Connection closed");
  }

  startAuthTimeout() {
    this.authTimeout = setTimeout(() => {
      if (this.isConnecting) {
        this.sendError("Authentication timed out");
        this.cleanup();
      }
    }, 10000);
  }

  sendError(message) {
    this.ws.send(JSON.stringify({ type: "error", message }));
  }

  sendStatus(message) {
    this.ws.send(JSON.stringify({ type: "status", message }));
  }

  cleanup() {
    clearTimeout(this.authTimeout);
    clearInterval(this.monitorInterval);

    if (this.monitorClient) {
      this.monitorClient.end();
      this.monitorClient = null;
    }

    if (this.client) {
      this.client.end();
      this.client = null;
    }

    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }

    this.isConnecting = false;
    this.isConnected = false;
  }

  write(data) {
    if (this.stream) {
      this.stream.write(data);
    }
  }

  getSystemInfoCommand() {
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

  setupMonitoring(connectionInfo) {
    const monitorClient = new Client();

    monitorClient.on("ready", () => {
      monitorClient.shell({ term: "xterm" }, (err, stream) => {
        if (err) return;

        let dataBuffer = "";
        stream.on("data", (data) => {
          dataBuffer += data.toString();
          if (dataBuffer.includes("}")) {
            try {
              const jsonStart = dataBuffer.indexOf("{");
              const jsonEnd = dataBuffer.indexOf("}") + 1;
              const jsonStr = dataBuffer.substring(jsonStart, jsonEnd);
              const info = JSON.parse(jsonStr);

              this.ws.send(
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

        this.monitorInterval = setInterval(() => {
          stream.write(this.getSystemInfoCommand() + "\n");
        }, 2000);

        this.ws.on("close", () => {
          clearInterval(this.monitorInterval);
          monitorClient.end();
        });
      });
    });

    monitorClient.connect(connectionInfo);
    this.monitorClient = monitorClient;
  }
}

module.exports = SSHClient;
