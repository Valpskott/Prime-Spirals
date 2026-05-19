# Tile Studio

**An interactive web app for exploring number-theoretic sequences in geometric spiral patterns.**

Tile Studio generates spirals of consecutive integers laid out on regular tessellations — triangles, squares, or hexagons — and overlays mathematical sequences (primes, Fibonacci numbers) as color-coded layers you can toggle, reorder, and customize.

```
        ▲               ■                ⬡
  Triangle spiral    Square spiral    Hexagon spiral
  (honeycomb)        (4-grid)         (honeycomb)
```

## Features

### Three Tile Types
| Tile | Description |
|------|-------------|
| **Triangles** | Triangular honeycomb — each tile shares an edge with up to 3 neighbors |
| **Squares**  | Standard square grid — each tile shares an edge with 4 neighbors |
| **Hexagons** | Hexagonal honeycomb — each tile shares an edge with 6 neighbors |

A **wall-following spiral algorithm** fills each tessellation outward from the center, numbering every tile consecutively. The spiral grows larger as you increase the tile-count level (×1 → ×2 → ×4 → ×8 …).

### Number Sequence Layers
Three independently controllable layers determine which numbers are visible and colored:

| Layer | Highlights |
|-------|-----------|
| **All Numbers** | Every tile (composites and units) |
| **Primes**      | Prime numbers, colored red by default |
| **Fibonacci**   | Fibonacci sequence (1, 1, 2, 3, 5, 8, 13, 21 …), colored blue |

Each layer has:
- **Visibility toggle** — show/hide the layer
- **Color swatch** — pick any color via native color picker
- **Drag-and-drop reorder** — change the stacking order; the topmost visible layer wins the tile color when multiple layers claim the same number (e.g., Fibonacci primes like 2, 3, 5 take the top layer's color)

### Ω-Luminance
Optionally dim tiles based on their **Ω (omega)** value — the total count of prime factors with multiplicity. Numbers with more prime factors appear darker:
- Primes and 1: full brightness (Ω ≤ 1)
- Semiprimes (e.g., 6, 10, 15): (2/3)^1 = 67% brightness
- Numbers with 3 prime factors: (2/3)^2 = 44% brightness
- And so on…

This creates a striking visual pattern where highly composite numbers fade toward the spiral's center.

### Appearance & Controls
- **Tile Labels** — show/hide the number written on each tile
- **Clockwise ↻** — reverse the spiral direction (clockwise vs counter-clockwise)
- **Gradient** — toggle between gradient fill and flat color per tile
- **Grid lines** — toggle the subtle tile borders
- **Tile level** — zoom into detail (×1, ×2, ×4, ×8 density)
- **Start offset** — shift which number appears at the spiral center
- **Reset** — reset zoom and pan to default view

### Interaction
- **Scroll** to zoom in/out (anchored at cursor position)
- **Drag** to pan across the canvas
- **Touch** supported for mobile (one-finger pan)
- All settings are **persisted to localStorage**

## How It Works

### Spiral Generation
Each tile type uses a wall-following algorithm:
1. Start at the center tile (number 1 or offset + 1)
2. From the current position, probe neighboring cells in a priority order (turn, straight, reverse)
3. Place the next unvisited tile in the first available neighbor
4. Repeat until enough tiles fill the viewport

The algorithms are tailored per geometry — triangles use triangular-honeycomb adjacency, squares use 4-neighbor grid adjacency, and hexagons use axial-coordinate 6-neighbor adjacency.

### Rendering
Tiles are drawn on an HTML5 Canvas with:
- Linear gradients from centroid to edge for a polished look
- Frustum culling to skip tiles outside the viewport
- Animated alpha transitions when layers are toggled
- A vignette overlay for visual depth
- Subtle noise dithering to eliminate gradient banding

## Quick Start

```bash
npm install
npm start
```

Then open **http://localhost:3000** in a browser. You can also set `PORT` via environment variable:

```bash
PORT=8080 npm start
```

## Project Structure

```
prime-spirals/
├── server.js           # Express server (static files + SPA fallback)
├── package.json
├── ecosystem.config.js # PM2 configuration
├── public/
│   ├── index.html      # Single-page app shell
│   ├── config.json     # Runtime config (gradient offset, etc.)
│   ├── css/
│   │   └── styles.css  # Dark theme, sidebar, canvas layout
│   └── js/
│       └── tiles.js    # All application logic (~700 lines)
```

## Tech Stack

- **Node.js + Express** — lightweight static file server
- **Vanilla JavaScript** — no framework dependencies
- **HTML5 Canvas** — high-performance 2D rendering
- **localStorage** — persistent settings across sessions

## License

ISC
