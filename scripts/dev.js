import { spawn } from 'child_process';

console.log('Starting backend server and frontend Vite...');

const backend = spawn('node', ['server.js'], { stdio: 'inherit', shell: true });
const frontend = spawn('npx', ['vite'], { stdio: 'inherit', shell: true });

process.on('SIGINT', () => {
  backend.kill();
  frontend.kill();
  process.exit();
});
