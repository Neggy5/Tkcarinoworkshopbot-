
module.exports = {
  apps: [{
    name: "TK-Carino-Workshop-Bot",
    script: "./index.js",
    watch: false,
    autorestart: true,
    max_memory_restart: "800M",
    node_args: "--max-old-space-size=700",
    env: {
      NODE_ENV: "production",
      RESTART_COUNT: "0"
    },
    error_file: "./logs/error.log",
    out_file: "./logs/output.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss",
    combine_logs: true,
    time: true,
    restart_delay: 5000,
    max_restarts: 50,
    min_uptime: "5s",
    listen_timeout: 30000,
    kill_timeout: 5000,
    exp_backoff_restart_delay: 100
  }]
};
