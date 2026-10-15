
const API_URL = "/api/moogle";
const PAGE_SIZE = 20;

// Find the HTML elements.
const searchForm = document.querySelector("#search-form");
const searchInput = document.querySelector("#search-input");
const categoryFilter = document.querySelector("#category-filter");
const gameFilter = document.querySelector("#game-filter");
const resultsContainer = document.querySelector("#results");
const statusText = document.querySelector("#status");
const resultCount = document.querySelector("#result-count");
const loadMoreButton = document.querySelector("#load-more");
const alphabetIndex = document.querySelector("#alphabet-index");
const letterButtons = document.querySelector("#letter-buttons");
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CATALOG_PAGE_SIZE = 100;

// Store data and current search settings.
let games = [];
let currentPage = 1;
let totalCount = 0;
let requestSequence = 0;
let activeController;
let searchTimer;
const catalogCache = new Map();

// Get the items from the API response.
function getItems(data) {
  if (Array.isArray(data)) {
    return data;
  }

  return data.items || data.results || [];
}

// Send a request to our Vercel backend.
async function requestAPI(resource, options = {}, signal) {
  const url = new URL(API_URL, window.location.origin);

  url.searchParams.set("resource", resource);

  Object.entries(options).forEach(([key, value]) => {
    if (value !== "" && value !== null && value !== undefined) {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json();
}

function normalizeName(value) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleUpperCase();
}

function getCatalogKey(category, gameId) {
  return `${category}:${gameId || "all"}`;
}

function getCatalog(category, gameId) {
  const key = getCatalogKey(category, gameId);
  if (!catalogCache.has(key)) {
    catalogCache.set(key, {
      items: [],
      nextPage: 1,
      totalCount: null,
      complete: false,
      loading: null
    });
  }

  return catalogCache.get(key);
}

async function loadNextCatalogPage(category, gameId, catalog) {
  if (catalog.loading) {
    await catalog.loading;
    return;
  }

  if (catalog.complete) return;

  catalog.loading = (async () => {
    const data = await requestAPI(category, {
      page: catalog.nextPage,
      pageSize: CATALOG_PAGE_SIZE,
      gameId
    });
    const items = getItems(data);

    catalog.items.push(...items);
    catalog.totalCount = data.totalCount ?? catalog.items.length;
    catalog.nextPage += 1;
    catalog.complete =
      items.length === 0 || catalog.items.length >= catalog.totalCount;
  })();

  try {
    await catalog.loading;
  } finally {
    catalog.loading = null;
  }
}

async function ensurePrefixCatalog(category, gameId, prefix) {
  const catalog = getCatalog(category, gameId);
  const firstLetter = normalizeName(prefix).charAt(0);

  while (
    !catalog.complete &&
    !catalog.items.some((item) => normalizeName(item.name).charAt(0) > firstLetter)
  ) {
    await loadNextCatalogPage(category, gameId, catalog);
  }

  return catalog.items.filter((item) =>
    normalizeName(item.name).startsWith(normalizeName(prefix))
  );
}

function updateAlphabetIndex() {
  const supportsAlphabet = ["characters", "monsters"].includes(categoryFilter.value);
  alphabetIndex.hidden = !supportsAlphabet;

  const firstLetter = normalizeName(searchInput.value).charAt(0);
  letterButtons.querySelectorAll("button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.textContent === firstLetter));
  });
}

function createAlphabetIndex() {
  [...LETTERS].forEach((letter) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "letter-button";
    button.textContent = letter;
    button.setAttribute("aria-label", `Browse names starting with ${letter}`);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      searchInput.value = letter;
      currentPage = 1;
      updateAlphabetIndex();
      fetchResults();
    });
    letterButtons.appendChild(button);
  });
}

// Load games for the game filter.
async function loadGames() {
  try {
    const data = await requestAPI("games");
    games = getItems(data);

    games.forEach((game) => {
      const option = document.createElement("option");

      option.value = game.id;
      option.textContent = game.name;

      gameFilter.appendChild(option);
    });
  } catch (error) {
    console.error("Could not load games:", error);
  }
}

// Search and display results.
async function fetchResults(append = false) {
  const sequence = ++requestSequence;
  activeController?.abort();
  activeController = new AbortController();
  const { signal } = activeController;

  const category = categoryFilter.value;
  const query = searchInput.value.trim();
  const gameId = gameFilter.value;
  updateAlphabetIndex();

  // For games, filter the list already fetched.
  if (category === "games") {
    let filteredGames = games;

    if (query) {
      filteredGames = games.filter((game) =>
        (game.name || "")
          .toLowerCase()
          .includes(query.toLowerCase())
      );
    }

    if (!filteredGames.length) {
      resultsContainer.replaceChildren();
      statusText.textContent = "No games found. Try another search.";
      resultCount.textContent = "";
      loadMoreButton.hidden = true;
      return;
    }

    totalCount = filteredGames.length;
    showResults(filteredGames, false);
    return;
  }

  statusText.textContent = "Loading results...";
  resultCount.textContent = "";
  loadMoreButton.disabled = true;

  try {
    if (query) {
      const items = await ensurePrefixCatalog(category, gameId, query);
      if (sequence !== requestSequence) return;

      totalCount = items.length;
      showResults(items, false);
      return;
    }

    const options = {
      page: currentPage,
      pageSize: PAGE_SIZE
    };

    if (gameId) {
      options.gameId = gameId;
    }

    const data = await requestAPI(category, options, signal);
    if (sequence !== requestSequence) return;

    const items = getItems(data);

    totalCount = data.totalCount ?? items.length;

    showResults(items, append);
  } catch (error) {
    if (error.name === "AbortError" || sequence !== requestSequence) return;
    console.error("API error:", error);

    resultsContainer.replaceChildren();
    resultCount.textContent = "";
    statusText.textContent =
      "Could not load data. Check your connection and backend.";
    loadMoreButton.hidden = true;
  } finally {
    if (sequence === requestSequence) {
      loadMoreButton.disabled = false;
    }
  }
}

// Create and display result cards.
function showResults(items, append = false) {
  if (!append) {
    resultsContainer.replaceChildren();
  }

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "result-card";

    // Add artwork if available.
    const imageUrl = item.thumbnailUrl || item.imageUrl;

    if (imageUrl) {
      const image = document.createElement("img");

      image.className = "result-image";
      image.src = imageUrl;
      image.alt = `Artwork for ${item.name || "Final Fantasy entry"}`;
      image.loading = "lazy";

      image.addEventListener("error", () => {
        image.remove();
      });

      card.appendChild(image);
    }

    const content = document.createElement("div");
    content.className = "result-content";

    const title = document.createElement("h3");
    title.textContent = item.name || "Unnamed entry";

    content.appendChild(title);

    // Choose details based on the selected category.
    let details = [];

    if (categoryFilter.value === "games") {
      details = [
        item.releaseYear,
        item.platform
      ];
    } else if (categoryFilter.value === "characters") {
      details = [
        item.gameName,
        item.role,
        item.race,
        item.description
      ];
    } else {
      details = [
        item.gameName,
        item.category,
        item.description
      ];
    }

    details.filter(Boolean).forEach((detail) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = detail;
      content.appendChild(paragraph);
    });

    card.appendChild(content);
    resultsContainer.appendChild(card);
  });

  const displayedCount = resultsContainer.children.length;

  statusText.textContent = displayedCount
    ? ""
    : "No results found. Try another search.";

  resultCount.textContent = displayedCount
    ? `${displayedCount} result(s)`
    : "";

  // Only show Load more when additional results may exist.
  const hasSearch = searchInput.value.trim() !== "";
  const isGames = categoryFilter.value === "games";

  loadMoreButton.hidden =
    isGames ||
    hasSearch ||
    displayedCount >= totalCount ||
    items.length === 0;
}

// Handle search submission.
searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearTimeout(searchTimer);
  currentPage = 1;
  fetchResults();
});

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  currentPage = 1;
  updateAlphabetIndex();
  searchTimer = setTimeout(() => fetchResults(), 180);
});

// Handle category changes.
categoryFilter.addEventListener("change", () => {
  currentPage = 1;
  gameFilter.value = "";
  gameFilter.disabled = categoryFilter.value === "games";
  updateAlphabetIndex();
  fetchResults();
});

// Handle game filter changes.
gameFilter.addEventListener("change", () => {
  currentPage = 1;
  fetchResults();
});

// Load additional results.
loadMoreButton.addEventListener("click", () => {
  currentPage++;
  fetchResults(true);
});

// Start the website.
async function init() {
  createAlphabetIndex();
  gameFilter.disabled = categoryFilter.value === "games";
  updateAlphabetIndex();

  await loadGames();
  fetchResults();
}

init();
