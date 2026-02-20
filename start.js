import { spawn } from 'child_process';

console.log('Starting LingoComm services...\n');

// Start the bot
const bot = spawn('node', ['bot/index.js'], {
  stdio: 'inherit',
  env: process.env
});

bot.on('error', (err) => {
  console.error('Bot error:', err);
  process.exit(1);
});

// Start the web server
const server = spawn('node', ['server/index.js'], {
  stdio: 'inherit',
  env: process.env
});

server.on('error', (err) => {
  console.error('Server error:', err);
  process.exit(1);
});

// Handle shutdown gracefully
process.on('SIGTERM', () => {
  console.log('\nShutting down services...');
  bot.kill();
  server.kill();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nShutting down services...');
  bot.kill();
  server.kill();
  process.exit(0);
});

console.log('Both services started successfully');
