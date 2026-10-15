// pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "media-livre-monitor",
      script: "node_modules/next/dist/bin/next",
      // Só em localhost: de fora, entra-se pelo Caddy (HTTPS e palavra-passe).
      args: "start --port 3001 -H 127.0.0.1",
      cwd: __dirname,
      instances: 1,
      // Processo único: os jobs correm dentro deste processo (§9).
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "400M",
      env: {
        NODE_ENV: "production",
        PORT: 3001,
        TZ: "Europe/Lisbon",
      },
    },
  ],
};
