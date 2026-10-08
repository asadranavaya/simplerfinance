module.exports = {
  apps: [
    {
      name: 'budget-api',
      script: 'server/index.js',
      cwd: __dirname,

      // Watch server files and restart on change
      watch: ['server'],
      ignore_watch: ['node_modules', 'data', '*.db', '*.db-shm', '*.db-wal'],
      watch_delay: 500, // ms debounce before restart

      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3001,
      },
    },
  ],
};
