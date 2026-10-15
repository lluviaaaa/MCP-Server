// pm2 process definition. Start with:  npm run pm2:start   then:  pm2 save
// The app loads .env itself, so no secrets live in this file.
module.exports = {
  apps: [
    {
      name: "mcp-file-server",
      script: "src/index.js",
      cwd: __dirname,
      // Keep exactly one instance: the per-file write locks live in this process's memory.
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      min_uptime: "10s",
      max_restarts: 20,
      restart_delay: 2000,
      max_memory_restart: "300M",
      time: true,
      env: { NODE_ENV: "production" },
    },
  ],
};
