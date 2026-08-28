// pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "media-livre-monitor",
      script: "node_modules/next/dist/bin/next",
      args: "start --port 3000",
      cwd: __dirname,
      instances: 1,
      // Processo único: os jobs correm dentro deste processo (§9).
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "400M",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        TZ: "Europe/Lisbon",
      },
    },
  ],
};
