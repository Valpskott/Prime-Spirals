const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Disable caching for dev — ensures latest JS is served
app.use(function disableCache(req, res, next) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Catch-all: serve index.html for any route (SPA fallback)
app.use((_req, res, next) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Tile-server running on http://0.0.0.0:${PORT}`);
});
