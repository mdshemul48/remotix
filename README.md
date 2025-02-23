# Web-based SSH Client with System Monitoring

A modern web-based SSH client with real-time system monitoring capabilities. Connect to remote servers through your browser while monitoring system resources.

![SSH Web Client Screenshot](screenshots/main.png)

## Features

### SSH Terminal
- Browser-based SSH terminal access
- Full terminal emulation support
- Automatic sudo elevation
- Custom initial directory navigation
- Persistent connection handling
- Fixed terminal dimensions for consistency
- Support for all standard terminal operations

### System Monitoring
- Real-time CPU usage monitoring with graphical representation
- Memory usage tracking (Used/Total)
- System uptime display
- Host information display
- Platform details
- Auto-refreshing metrics (2-second intervals)

### User Interface
- Clean, modern design with light theme
- Responsive layout
- Interactive monitoring cards with hover effects
- Progress bars for resource visualization
- Material Design icons
- Mobile-friendly interface

### Security & Convenience
- Credential storage in localStorage
- CORS enabled for cross-origin requests
- Secure password handling
- Single password for both SSH and sudo
- Automatic connection recovery
- Error handling with visual feedback

### Technical Features
- WebSocket-based real-time communication
- Separate connections for terminal and monitoring
- JSON-based message protocol
- Express.js backend
- No external dependencies for monitoring (uses standard Linux commands)

## Installation

1. Clone the repository:
```bash
git clone [<repository-url>](https://github.com/mdshemul48/remotix)
cd ssh-web-client
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
node index.js
```

4. Open in browser:
```
http://localhost:3000
```

## Technologies Used
- Node.js
- Express
- WebSocket (ws)
- SSH2
- Xterm.js
- Material Icons

## Contributing
Feel free to submit issues and enhancement requests!

## License
MIT License - Use it freely!
