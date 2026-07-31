module.exports = {
  apps: [
    {
      name: 'store1',
      script: './src/index.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '300M',
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
      env: {
        NODE_ENV: 'production',
        LAUNCHER_PORT: 20022
      }
    }
  ]
};
