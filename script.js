
const API_URL = "/api/moogle";
const PAGE_SIZE = 18;

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
const profileDialog = document.querySelector("#profile-dialog");
const profileContent = document.querySelector("#profile-content");
const profileCloseButton = document.querySelector("#profile-close");
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CATALOG_PAGE_SIZE = 100;
const PROFILE_TAG_FIELDS = {
  games: ["platform"],
  characters: ["gameName"],
  monsters: ["gameName", "category"]
};
const PROFILE_HIDDEN_FIELDS = new Set([
  "id",
  "name",
  "imageUrl",
  "thumbnailUrl",
  "description",
  "isMainSeries",
  "_profileType"
]);
const PROFILE_LABELS = {
  releaseYear: "Release year",
  hitPoints: "HP",
  magicAttack: "Magic attack",
  magicDefense: "Magic defense"
};

// Store data and current search settings.
let games = [];
let currentPage = 1;
let totalCount = 0;
let requestSequence = 0;
let activeController;
let searchTimer;
let profileRequestSequence = 0;
let prefixResults = [];
const catalogCache = new Map();
const profileDetailsCache = new Map();

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

function loadProfileDetails(resource, id) {
  const key = `${resource}:${id}`;
  if (!profileDetailsCache.has(key)) {
    const request = requestAPI(resource, { id }).catch((error) => {
      profileDetailsCache.delete(key);
      throw error;
    });
    profileDetailsCache.set(key, request);
  }

  return profileDetailsCache.get(key);
}

function prefetchProfileDetails(item) {
  const resource = item._profileType || categoryFilter.value;
  if (["characters", "monsters"].includes(resource) && item.id) {
    loadProfileDetails(resource, item.id).catch(() => {});
  }
}

function normalizeName(value) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleUpperCase();
}

function updateGameSearchField() {
  const isGames = categoryFilter.value === "games";
  searchInput.disabled = isGames;
  searchForm.querySelector('button[type="submit"]').disabled = isGames;
  searchInput.placeholder = isGames
    ? "Choose a game from the Game menu"
    : "Search Cloud, Bomb, or a game name...";
}

function getCatalogKey(category, gameId) {
  return `${category}:${gameId || "all"}`;
}

function getCatalog(category, gameId) {
  const key = getCatalogKey(category, gameId);
  if (!catalogCache.has(key)) {
    catalogCache.set(key, {
      pages: new Map(),
      pageRequests: new Map(),
      totalCount: null,
    });
  }

  return catalogCache.get(key);
}

async function loadCatalogPage(category, gameId, catalog, page) {
  if (catalog.pages.has(page)) return catalog.pages.get(page);
  if (catalog.pageRequests.has(page)) return catalog.pageRequests.get(page);

  const request = (async () => {
    const data = await requestAPI(category, {
      page,
      pageSize: CATALOG_PAGE_SIZE,
      gameId
    });
    const items = getItems(data);

    catalog.pages.set(page, items);
    catalog.totalCount = data.totalCount ?? catalog.totalCount ?? items.length;
    return items;
  })();

  catalog.pageRequests.set(page, request);
  try {
    return await request;
  } finally {
    catalog.pageRequests.delete(page);
  }
}

async function ensurePrefixCatalog(category, gameId, prefix) {
  const catalog = getCatalog(category, gameId);
  const normalizedPrefix = normalizeName(prefix);
  const firstLetter = normalizeName(prefix).charAt(0);
  const firstPage = await loadCatalogPage(category, gameId, catalog, 1);
  if (!firstPage.length || !catalog.totalCount) return [];

  const pageCount = Math.ceil(catalog.totalCount / CATALOG_PAGE_SIZE);
  let low = 1;
  let high = pageCount;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const items = await loadCatalogPage(category, gameId, catalog, middle);
    const lastName = (items.at(-1)?.name || "").toLocaleUpperCase();

    if (lastName < firstLetter) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const matches = [];
  let passedPrefix = false;

  for (let page = low; page <= pageCount && !passedPrefix; page++) {
    const items = await loadCatalogPage(category, gameId, catalog, page);

    for (const item of items) {
      const normalizedName = normalizeName(item.name);
      if (normalizedName.startsWith(normalizedPrefix)) {
        matches.push(item);
      } else if ((item.name || "").trim().toLocaleUpperCase() > normalizedPrefix) {
        passedPrefix = true;
        break;
      }
    }
  }

  return matches;
}

function updateAlphabetIndex() {
  const supportsAlphabet = categoryFilter.value !== "games";
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

function updateLoadMoreLabel(loading = false) {
  const remaining = totalCount - resultsContainer.children.length;
  const count = Math.min(PAGE_SIZE, Math.max(0, remaining));
  loadMoreButton.textContent = `${loading ? "Loading" : "Load"} ${count} more`;
}

// Search and display results.
async function fetchResults(append = false) {
  const sequence = ++requestSequence;
  updateLoadMoreLabel(append);
  activeController?.abort();
  activeController = new AbortController();
  const { signal } = activeController;

  const category = categoryFilter.value;
  const query = searchInput.value.trim();
  const gameId = gameFilter.value;
  updateAlphabetIndex();

  if (category === "all" && !query) {
    resultsContainer.replaceChildren();
    resultCount.textContent = "";
    statusText.textContent = "Choose a letter or type a name to browse all entries.";
    loadMoreButton.hidden = true;
    loadMoreButton.disabled = false;
    return;
  }

  // For games, filter the list already fetched.
  if (category === "games") {
    let filteredGames = games;

    if (gameId) {
      filteredGames = filteredGames.filter((game) => String(game.id) === gameId);
    }

    if (query) {
      filteredGames = filteredGames.filter((game) =>
        normalizeName(game.name).startsWith(normalizeName(query))
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
      const resources = category === "all" ? ["characters", "monsters"] : [category];
      const catalogResults = await Promise.all(resources.map(async (resource) => {
        const items = await ensurePrefixCatalog(resource, gameId, query);
        return items.map((item) => ({ ...item, _profileType: resource }));
      }));
      if (sequence !== requestSequence) return;

      let items = catalogResults.flat();
      if (category === "all") {
        const matchingGames = games
          .filter((game) =>
            normalizeName(game.name).startsWith(normalizeName(query)) &&
            (!gameId || String(game.id) === gameId)
          )
          .map((game) => ({ ...game, _profileType: "games" }));
        items = [...matchingGames, ...items];
        items.sort((first, second) => first.name.localeCompare(second.name));
      }

      totalCount = items.length;
      prefixResults = items;
      showResults(items.slice(0, PAGE_SIZE), false);
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
      updateLoadMoreLabel();
    }
  }
}

function formatProfileValue(value) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatProfileLabel(key) {
  return PROFILE_LABELS[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}

function renderProfile(item, loading = false) {
  profileContent.replaceChildren();

  const layout = document.createElement("article");
  layout.className = "profile-layout";

  const imageUrl = item.thumbnailUrl || item.imageUrl;
  if (imageUrl) {
    const image = document.createElement("img");
    image.className = "profile-image";
    image.src = imageUrl;
    image.alt = `Artwork for ${item.name || "Final Fantasy entry"}`;
    image.addEventListener("error", () => image.remove());
    layout.appendChild(image);
  }

  const summary = document.createElement("div");
  summary.className = "profile-summary";

  const category = document.createElement("p");
  category.className = "profile-eyebrow";
  category.textContent = categoryFilter.selectedOptions[0].textContent;
  summary.appendChild(category);

  const title = document.createElement("h2");
  title.id = "profile-title";
  title.tabIndex = -1;
  title.textContent = item.name || "Unnamed entry";
  summary.appendChild(title);

  const profileType = item._profileType || categoryFilter.value;
  const typeLabels = {
    games: "Game",
    characters: "Character",
    monsters: "Monster"
  };
  category.textContent = typeLabels[profileType] || "Entry";

  if (loading) {
    const loadingMessage = document.createElement("p");
    loadingMessage.className = "profile-loading";
    loadingMessage.setAttribute("role", "status");
    loadingMessage.textContent = "Loading full profile...";
    summary.appendChild(loadingMessage);
  } else {
    const tagFields = PROFILE_TAG_FIELDS[profileType] || [];
    const tags = tagFields.map((field) => item[field]).filter(Boolean);

    if (tags.length) {
      const tagList = document.createElement("div");
      tagList.className = "profile-tags";
      tags.forEach((tag) => {
        const chip = document.createElement("span");
        chip.className = "profile-tag";
        chip.textContent = tag;
        tagList.appendChild(chip);
      });
      summary.appendChild(tagList);
    }

    if (item.description) {
      const description = document.createElement("p");
      description.className = "profile-description";
      description.textContent = item.description;
      summary.appendChild(description);
    }

    const hiddenFields = new Set([...PROFILE_HIDDEN_FIELDS, ...tagFields]);
    const details = Object.entries(item).filter(([key, value]) =>
      !hiddenFields.has(key) && value !== null && value !== undefined && value !== ""
    );

    if (details.length) {
      const detailList = document.createElement("dl");
      detailList.className = "profile-details";
      details.forEach(([key, value]) => {
        const row = document.createElement("div");
        const label = document.createElement("dt");
        label.textContent = formatProfileLabel(key);
        const text = document.createElement("dd");
        text.textContent = formatProfileValue(value);
        row.append(label, text);
        detailList.appendChild(row);
      });
      summary.appendChild(detailList);
    }
  }

  layout.appendChild(summary);
  profileContent.appendChild(layout);
}

async function openProfile(item) {
  const sequence = ++profileRequestSequence;
  const profileType = item._profileType || categoryFilter.value;
  const initialProfile = { ...item, _profileType: profileType };
  const needsDetails = ["characters", "monsters"].includes(profileType) && item.id;

  renderProfile(initialProfile, needsDetails);
  profileDialog.scrollTop = 0;
  profileDialog.showModal();
  profileContent.querySelector("#profile-title").focus();

  if (!needsDetails) return;

  try {
    const details = await loadProfileDetails(profileType, item.id);
    if (sequence !== profileRequestSequence || !profileDialog.open) return;

    renderProfile({ ...initialProfile, ...details, _profileType: profileType });
  } catch (error) {
    if (sequence !== profileRequestSequence || !profileDialog.open) return;

    console.error("Could not load full profile:", error);
    renderProfile(initialProfile);

    const note = document.createElement("p");
    note.className = "profile-loading";
    note.textContent = "Some details could not be loaded.";
    profileContent.querySelector(".profile-summary").appendChild(note);
  }
}

// Create and display result cards.
function showResults(items, append = false) {
  if (!append) {
    resultsContainer.replaceChildren();
  }

  items.forEach((item) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "result-card";
    card.setAttribute("aria-label", `Open profile: ${item.name || "Unnamed entry"}`);
    card.addEventListener("click", () => openProfile(item));
    let prefetchTimer;
    card.addEventListener("pointerenter", () => {
      prefetchTimer = setTimeout(() => prefetchProfileDetails(item), 100);
    });
    card.addEventListener("pointerleave", () => clearTimeout(prefetchTimer));
    card.addEventListener("focus", () => prefetchProfileDetails(item));

    // Add artwork if available.
    const imageUrl = item.thumbnailUrl || item.imageUrl;

    if (imageUrl) {
      const image = document.createElement("img");

      image.className = "result-image";
      image.src = imageUrl;
      image.alt = "";
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
  const isGames = categoryFilter.value === "games";

  loadMoreButton.hidden =
    isGames ||
    displayedCount >= totalCount ||
    items.length === 0;

  updateLoadMoreLabel();
}

profileCloseButton.addEventListener("click", () => profileDialog.close());
profileDialog.addEventListener("click", (event) => {
  if (event.target === profileDialog) profileDialog.close();
});

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
  if (categoryFilter.value === "games") {
    searchInput.value = "";
  }
  updateGameSearchField();
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
  if (searchInput.value.trim() && categoryFilter.value !== "games") {
    const offset = resultsContainer.children.length;
    showResults(prefixResults.slice(offset, offset + PAGE_SIZE), true);
    return;
  }

  currentPage++;
  fetchResults(true);
});

// Start the website.
async function init() {
  createAlphabetIndex();
  updateGameSearchField();
  updateAlphabetIndex();

  await loadGames();
  fetchResults();
}

init();
