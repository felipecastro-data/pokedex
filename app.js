// Kanto Pokédex — data-fetching layer
// Fetches Pokémon #1-150 (detail + species + evolution chain) from PokeAPI,
// flattens each into one plain object, and caches the whole set in
// localStorage so we never hit the network again after first load.

const API_BASE = 'https://pokeapi.co/api/v2';
const POKEMON_COUNT = 150;
const CACHE_KEY = 'pokedex-data-v2';
const FETCH_CHUNK_SIZE = 10; // how many Pokémon to fetch in parallel per batch

// Version groups in release order, oldest to newest. Used to pick the most
// recent game's level-up movepool when a Pokémon's moves span many games.
const VERSION_GROUP_ORDER = [
  'red-blue', 'yellow', 'gold-silver', 'crystal', 'ruby-sapphire', 'emerald',
  'firered-leafgreen', 'diamond-pearl', 'platinum', 'heartgold-soulsilver',
  'black-white', 'colosseum', 'xd', 'black-2-white-2', 'x-y',
  'omega-ruby-alpha-sapphire', 'sun-moon', 'ultra-sun-ultra-moon',
  'lets-go-pikachu-lets-go-eevee', 'sword-shield', 'the-isle-of-armor',
  'the-crown-tundra', 'brilliant-diamond-and-shining-pearl', 'legends-arceus',
  'scarlet-violet', 'the-teal-mask', 'the-indigo-disk',
];

const state = {
  pokemon: [], // filled in once loading finishes
};

document.addEventListener('DOMContentLoaded', init);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .catch((err) => console.warn('Service worker registration failed', err));
  });
}

async function init() {
  setupSearch();
  setupNavigation();

  const cached = loadFromCache();
  if (cached) {
    state.pokemon = cached;
    console.log(`Loaded ${cached.length} Pokémon from cache`);
    renderGrid(state.pokemon);
    return;
  }

  showLoading('Loading Pokédex...');
  try {
    const pokemon = await fetchAllPokemon();
    state.pokemon = pokemon;
    saveToCache(pokemon);
    hideLoading();
    renderGrid(state.pokemon);
    console.log(`Fetched and cached ${pokemon.length} Pokémon`);
  } catch (err) {
    console.error('Failed to load Pokédex data', err);
    showLoading('Failed to load data. Check your connection and reload.');
  }
}

// ---- Cache ----

function loadFromCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data) || data.length !== POKEMON_COUNT) return null;
    return data;
  } catch (err) {
    console.warn('Could not read Pokédex cache, will re-fetch', err);
    return null;
  }
}

function saveToCache(pokemon) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(pokemon));
  } catch (err) {
    console.warn('Could not write Pokédex cache (localStorage full?)', err);
  }
}

// ---- Fetching ----

async function fetchAllPokemon() {
  const evolutionChainCache = new Map(); // chain URL -> in-flight/resolved parsed chain
  const results = [];

  for (let start = 1; start <= POKEMON_COUNT; start += FETCH_CHUNK_SIZE) {
    const ids = [];
    for (let id = start; id < start + FETCH_CHUNK_SIZE && id <= POKEMON_COUNT; id++) {
      ids.push(id);
    }

    const chunk = await Promise.all(ids.map((id) => fetchPokemon(id, evolutionChainCache)));
    results.push(...chunk);
    showLoading(`Loading Pokédex... ${results.length}/${POKEMON_COUNT}`);
  }

  return results;
}

async function fetchPokemon(id, evolutionChainCache) {
  const [detail, species] = await Promise.all([
    fetchJson(`${API_BASE}/pokemon/${id}`),
    fetchJson(`${API_BASE}/pokemon-species/${id}`),
  ]);

  // Several Pokémon share the same evolution chain (e.g. Pidgey/Pidgeotto/Pidgeot).
  // Cache by chain URL so it's only fetched once per chain, not once per Pokémon.
  const chainUrl = species.evolution_chain.url;
  if (!evolutionChainCache.has(chainUrl)) {
    evolutionChainCache.set(chainUrl, fetchJson(chainUrl).then(parseEvolutionChain));
  }
  const evolutionChain = await evolutionChainCache.get(chainUrl);

  const flavorEntry = species.flavor_text_entries.find((e) => e.language.name === 'en');

  return {
    id: detail.id,
    name: detail.name,
    sprite: detail.sprites.front_default,
    artwork: detail.sprites.other?.['official-artwork']?.front_default ?? detail.sprites.front_default,
    types: detail.types.map((t) => t.type.name),
    height: detail.height,
    weight: detail.weight,
    stats: detail.stats.map((s) => ({ name: s.stat.name, value: s.base_stat })),
    flavorText: flavorEntry ? flavorEntry.flavor_text.replace(/[\n\f\r]/g, ' ') : '',
    evolutionChain,
    abilities: detail.abilities.map((a) => ({ name: a.ability.name, isHidden: a.is_hidden })),
    levelUpMoves: extractLevelUpMoves(detail.moves),
  };
}

// Picks the most recent version group with level-up move data (movepools
// can differ between games) and returns its moves sorted by level.
function extractLevelUpMoves(movesRaw) {
  let bestGroup = null;
  let bestIndex = -1;

  movesRaw.forEach((m) => {
    m.version_group_details.forEach((vgd) => {
      if (vgd.move_learn_method.name !== 'level-up') return;
      const idx = VERSION_GROUP_ORDER.indexOf(vgd.version_group.name);
      if (idx > bestIndex) {
        bestIndex = idx;
        bestGroup = vgd.version_group.name;
      }
    });
  });

  if (!bestGroup) return [];

  const moves = [];
  movesRaw.forEach((m) => {
    const entry = m.version_group_details.find(
      (vgd) => vgd.move_learn_method.name === 'level-up' && vgd.version_group.name === bestGroup
    );
    if (entry) moves.push({ name: m.move.name, level: entry.level_learned_at });
  });

  moves.sort((a, b) => a.level - b.level);
  return moves;
}

// Flattens the (possibly branching) evolution-chain tree into an ordered list.
function parseEvolutionChain(data) {
  const chain = [];

  function walk(node) {
    const detail = node.evolution_details[0]; // first trigger, if any (base form has none)
    chain.push({
      id: idFromUrl(node.species.url),
      name: node.species.name,
      minLevel: detail?.min_level ?? null,
      trigger: detail?.trigger?.name ?? null,
    });
    node.evolves_to.forEach(walk);
  }

  walk(data.chain);
  return chain;
}

function idFromUrl(url) {
  const match = url.match(/\/(\d+)\/?$/);
  return match ? Number(match[1]) : null;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${url} (${res.status})`);
  return res.json();
}

// ---- Loading state ----

function showLoading(message) {
  const el = document.getElementById('loading');
  if (el) {
    el.textContent = message;
    el.hidden = false;
  }
}

function hideLoading() {
  const el = document.getElementById('loading');
  if (el) el.hidden = true;
}

// ---- Grid rendering ----

function renderGrid(pokemonList) {
  const grid = document.getElementById('pokemon-grid');
  const noResults = document.getElementById('no-results');

  grid.innerHTML = pokemonList.map(cardHTML).join('');
  noResults.hidden = pokemonList.length > 0;
}

function cardHTML(p) {
  const number = String(p.id).padStart(3, '0');
  const badges = p.types.map((t) => `<span class="type-badge type-${t}">${t}</span>`).join('');

  return `
    <div class="card" data-id="${p.id}">
      <img class="card-sprite" src="${p.sprite}" alt="${p.name}" loading="lazy" width="96" height="96">
      <div class="card-number">#${number}</div>
      <div class="card-name">${capitalize(p.name)}</div>
      <div class="card-types">${badges}</div>
    </div>
  `;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- Search ----

function setupSearch() {
  const input = document.getElementById('search-input');
  if (!input) return;
  input.addEventListener('input', () => {
    renderGrid(filterPokemon(input.value));
  });
}

function filterPokemon(query) {
  const q = query.trim().toLowerCase().replace(/^#/, '');
  if (!q) return state.pokemon;

  return state.pokemon.filter((p) => {
    const number = String(p.id).padStart(3, '0');
    return p.name.includes(q) || number.includes(q) || String(p.id) === q;
  });
}

// ---- Navigation (list <-> detail) ----

function setupNavigation() {
  // Card taps open the detail view. Delegated because #pokemon-grid is
  // re-rendered on every search keystroke.
  document.getElementById('pokemon-grid').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) openDetail(Number(card.dataset.id));
  });

  // Back button and evolution-card taps both live inside #detail-view,
  // which is rebuilt on every openDetail() call, so this listener is
  // delegated too instead of being re-attached each time.
  document.getElementById('detail-view').addEventListener('click', (e) => {
    if (e.target.closest('#back-button')) {
      closeDetail();
      return;
    }

    const evoCard = e.target.closest('.evolution-card');
    if (evoCard) {
      const id = Number(evoCard.dataset.id);
      if (id !== state.currentDetailId) openDetail(id);
    }
  });
}

function openDetail(id) {
  const pokemon = state.pokemon.find((p) => p.id === id);
  if (!pokemon) return;

  state.currentDetailId = id;
  renderDetail(pokemon);
  document.getElementById('list-view').hidden = true;
  document.getElementById('detail-view').hidden = false;
  window.scrollTo(0, 0);
}

function closeDetail() {
  document.getElementById('detail-view').hidden = true;
  document.getElementById('list-view').hidden = false;
}

// ---- Detail rendering ----

const STAT_LABELS = {
  hp: 'HP',
  attack: 'Attack',
  defense: 'Defense',
  'special-attack': 'Sp. Atk',
  'special-defense': 'Sp. Def',
  speed: 'Speed',
};

const STAT_MAX = 200; // reference scale for bar width, not the true max (Blissey HP is 255)

function renderDetail(p) {
  const number = String(p.id).padStart(3, '0');
  const primaryType = p.types[0];
  const badges = p.types.map((t) => `<span class="type-badge type-${t}">${t}</span>`).join('');

  document.getElementById('detail-view').innerHTML = `
    <div class="detail-header type-bg-${primaryType}">
      <button id="back-button" class="icon-button" aria-label="Back to list">&larr;</button>
      <img class="detail-artwork" src="${p.artwork}" alt="${p.name}">
      <div class="detail-title-row">
        <h2 class="detail-name">${capitalize(p.name)}</h2>
        <span class="detail-number">#${number}</span>
      </div>
      <div class="detail-badges">${badges}</div>
    </div>
    <div class="detail-body">
      <section class="detail-section">
        <h3 class="section-title">Types</h3>
        ${typesPanelHTML(p)}
      </section>
      <section class="detail-section">
        <h3 class="section-title">Stats</h3>
        ${statsPanelHTML(p)}
      </section>
      <section class="detail-section">
        <h3 class="section-title">Evolution</h3>
        ${evolutionPanelHTML(p)}
      </section>
      <section class="detail-section">
        <h3 class="section-title">Abilities</h3>
        ${abilitiesPanelHTML(p)}
      </section>
      <section class="detail-section">
        <h3 class="section-title">Moves</h3>
        ${movesPanelHTML(p)}
      </section>
    </div>
  `;
}

function statsPanelHTML(p) {
  const rows = p.stats
    .map((s) => {
      const label = STAT_LABELS[s.name] ?? s.name;
      const pct = Math.min(100, Math.round((s.value / STAT_MAX) * 100));
      return `
        <div class="stat-row">
          <span class="stat-label">${label}</span>
          <span class="stat-bar-track"><span class="stat-bar-fill" style="width:${pct}%"></span></span>
          <span class="stat-value">${s.value}</span>
        </div>
      `;
    })
    .join('');

  const total = p.stats.reduce((sum, s) => sum + s.value, 0);

  return `
    <div class="stat-list">
      ${rows}
      <div class="stat-row stat-total-row">
        <span class="stat-label">Total</span>
        <span class="stat-bar-track"></span>
        <span class="stat-value">${total}</span>
      </div>
    </div>
  `;
}

function typesPanelHTML(p) {
  const badges = p.types
    .map((t) => `<span class="type-badge type-badge-large type-${t}">${t}</span>`)
    .join('');
  return `<div class="detail-type-badges">${badges}</div>`;
}

function evolutionPanelHTML(p) {
  const chain = p.evolutionChain;
  if (!chain || chain.length < 2) {
    return `<p class="evolution-empty">This Pokémon does not evolve.</p>`;
  }

  return `
    <div class="evolution-list">
      ${chain.map((stage, i) => evolutionStageHTML(stage, i, p.id)).join('')}
    </div>
  `;
}

function evolutionStageHTML(stage, index, currentId) {
  const connector = index === 0 ? '' : `
    <div class="evolution-connector">
      <span class="evolution-arrow">&darr;</span>
      <span class="evolution-condition">${evolutionConditionText(stage)}</span>
    </div>
  `;

  // Some chains (e.g. Eevee) branch into later-generation Pokémon outside
  // the Kanto dataset — those aren't in state.pokemon and aren't clickable,
  // but the sprite CDN URL is predictable from the id regardless.
  const inDex = state.pokemon.some((p) => p.id === stage.id);
  const sprite = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${stage.id}.png`;
  const number = String(stage.id).padStart(3, '0');
  const current = stage.id === currentId ? ' current' : '';
  const clickable = inDex && stage.id !== currentId ? ' clickable' : '';

  return `
    ${connector}
    <div class="evolution-card${current}${clickable}" data-id="${stage.id}">
      <img class="evolution-sprite" src="${sprite}" alt="${stage.name}" width="64" height="64">
      <div class="evolution-info">
        <span class="evolution-name">${capitalize(stage.name)}</span>
        <span class="evolution-number">#${number}</span>
      </div>
    </div>
  `;
}

function abilitiesPanelHTML(p) {
  const rows = p.abilities
    .map((a) => {
      const name = capitalize(a.name.replace(/-/g, ' '));
      const hiddenTag = a.isHidden ? '<span class="hidden-tag">Hidden</span>' : '';
      return `
        <div class="ability-row">
          <span class="ability-name">${name}</span>
          ${hiddenTag}
        </div>
      `;
    })
    .join('');

  return `<div class="ability-list">${rows}</div>`;
}

function movesPanelHTML(p) {
  const moves = p.levelUpMoves;
  if (!moves || moves.length === 0) {
    return `<p class="moves-empty">No level-up moves recorded.</p>`;
  }

  const rows = moves
    .map((m) => {
      const name = capitalize(m.name.replace(/-/g, ' '));
      return `
        <div class="move-row">
          <span class="move-level">Lv ${m.level}</span>
          <span class="move-name">${name}</span>
        </div>
      `;
    })
    .join('');

  return `<div class="move-list">${rows}</div>`;
}

function evolutionConditionText(stage) {
  if (stage.trigger === 'level-up') {
    return stage.minLevel ? `Level ${stage.minLevel}` : 'Level up';
  }
  if (stage.trigger === 'trade') return 'Trade';
  if (stage.trigger === 'use-item') return 'Use item';
  if (stage.trigger) return capitalize(stage.trigger.replace(/-/g, ' '));
  return 'Evolves';
}
