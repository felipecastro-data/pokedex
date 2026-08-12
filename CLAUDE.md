# Pokedex PWA

## Goal
Single-page PWA (HTML/CSS/JS, no framework) — Kanto Pokédex (#1-150),
optimized for iPhone Safari, installable to home screen, offline-capable.

## Data source
PokeAPI (https://pokeapi.co) — no API key needed.
- List: GET /api/v2/pokemon?limit=150
- Detail: GET /api/v2/pokemon/{id}
- Species/flavor text: GET /api/v2/pokemon-species/{id}
- Evolution chain: GET /api/v2/evolution-chain/{id} (id from species response)

## Screens
1. List view — grid/list of 150 cards (sprite, name, #, type badges),
   search by name/number. Reference: attached mockups.
2. Detail view — back button, artwork, tabs or sections for
   Stats / Types / Evolutions. Show evolution chain as connected cards
   with level-up trigger if available.

## Constraints
- No backend, no build step — plain HTML/CSS/JS only
- Cache PokeAPI responses in localStorage (data doesn't change)
- Mobile-first layout, safe-area-inset padding for iPhone notch/home bar
- PWA: manifest.json + apple-touch-icon + apple-mobile-web-app-capable meta
- Not a web programmer — explain each step briefly, one file/feature at a time