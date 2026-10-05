const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const pythonExe = path.join(__dirname, 'VoiceAssis', '.venv', 'Scripts', 'python.exe');

const processes = [
  {
    name: 'MindPulse API (8001)',
    cmd: pythonExe,
    args: ['-m', 'uvicorn', 'main:app', '--port', '8001', '--reload'],
    cwd: path.join(__dirname, 'mindpulse-api'),
    color: '\x1b[36m' // Cyan
  },
  {
    name: 'Voice Assistant (8000)',
    cmd: pythonExe,
    args: ['-m', 'uvicorn', 'main:app', '--port', '8000'],
    cwd: path.join(__dirname, 'VoiceAssis'),
    color: '\x1b[35m' // Magenta
  },
  {
    name: 'Frontend Web App (3000)',
    cmd: pythonExe,
    args: ['-m', 'http.server', '3000', '--directory', path.join(__dirname, 'mentalhealth', 'mentalhealth')],
    cwd: __dirname,
    color: '\x1b[32m' // Green
  }
];

const children = [];

console.log('\x1b[1m\x1b[34m=======================================================');
console.log('🚀 Starting MindPulse Mental Health Platform Services');
console.log('=======================================================\x1b[0m\n');
console.log('📍 Frontend:        \x1b[32mhttp://localhost:3000/index.html\x1b[0m');
console.log('📍 MindPulse API:   \x1b[36mhttp://localhost:8001/docs\x1b[0m');
console.log('📍 Voice Assistant: \x1b[35mhttp://localhost:8000\x1b[0m\n');

processes.forEach(proc => {
  const child = spawn(proc.cmd, proc.args, {
    cwd: proc.cwd,
    stdio: 'pipe',
    shell: false
  });

  child.stdout.on('data', (data) => {
    process.stdout.write(`${proc.color}[${proc.name}]\x1b[0m ${data}`);
  });

  child.stderr.on('data', (data) => {
    process.stderr.write(`${proc.color}[${proc.name}]\x1b[0m ${data}`);
  });

  child.on('error', (err) => {
    console.error(`${proc.color}[${proc.name}] Error:\x1b[0m`, err);
  });

  children.push(child);
});

function cleanup() {
  console.log('\nShutting down all services...');
  children.forEach(child => {
    try {
      if (os.platform() === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/f', '/t']);
      } else {
        child.kill('SIGINT');
      }
    } catch (e) {}
  });
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
