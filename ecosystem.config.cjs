module.exports = {
  apps: [
    {
      name: 'store1',
      script: './src/index.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '300M',
      error_file: 'logs/store1-error.log',
      out_file: 'logs/store1-out.log',
      time: true,
      env: {
        NODE_ENV: 'production',
        HTTP_PORT: 2753
      },
      env_file: '.env'
    },
    {
      name: 'store2',
      script: './src/index.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '300M',
      error_file: 'logs/store2-error.log',
      out_file: 'logs/store2-out.log',
      time: true,
      env: {
        NODE_ENV: 'production',
        HTTP_PORT: 8080
      },
      env_file: '.env.store2'
    },
    {
      name: 'launcher',
      script: './scripts/launcher.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '150M',
      error_file: 'logs/launcher-error.log',
      out_file: 'logs/launcher-out.log',
      time: true,
      env: {
        NODE_ENV: 'production',
        LAUNCHER_PORT: 20022
      }
    },
    {
      name: 'backup-job',
      script: 'npm',
      args: 'run backup',
      instances: 1,
      exec_mode: 'fork',
      cron_restart: '0 0,12 * * *',
      autorestart: false,
      watch: false,
      error_file: 'logs/backup-error.log',
      out_file: 'logs/backup-out.log',
      time: true
    }
  ]
};
