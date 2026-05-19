module.exports = {
  apps: [
    {
      name:      'tile-studio',
      script:    'server.js',
      cwd:       '/home/prime-spirals',
      instances: 1,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
        PORT:     3000,
      },
    },
  ],
};
