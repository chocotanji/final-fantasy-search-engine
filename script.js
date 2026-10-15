
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

// Store data and current search settings.
let games = [];
let currentPage = 1;
let totalCount = 0;
let isLoading = false;

// Get the items from the API response.
function getItems(data) {
  if (Array.isArray(data)) {
    return data;
  }

  return data.items || data.results || [];
}

// Send a request to our Vercel backend.
async function requestAPI(resource, options = {}) {
  const url = new URL(API_URL, window.location.origin);

  url.searchParams.set("resource", resource);

  Object.entries(options).forEach(([key, value]) => {
    if (value !== "" && value !== null && value !== undefined) {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json();
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
  if (isLoading) return;

  const category = categoryFilter.value;
  const query = searchInput.value.trim();
  const gameId = gameFilter.value;

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

    showResults(filteredGames, false);
    return;
  }

  isLoading = true;
  statusText.textContent = "Loading results...";
  resultCount.textContent = "";
  loadMoreButton.disabled = true;

  try {
    const options = {
      page: currentPage,
      pageSize: PAGE_SIZE
    };

    if (query) {
      options.query = query;
    }

    if (gameId) {
      options.gameId = gameId;
    }

    const data = await requestAPI(category, options);
    const items = getItems(data);

    totalCount = data.totalCount ?? items.length;

    showResults(items, append);
  } catch (error) {
    console.error("API error:", error);

    resultsContainer.replaceChildren();
    resultCount.textContent = "";
    statusText.textContent =
      "Could not load data. Check your connection and backend.";
    loadMoreButton.hidden = true;
  } finally {
    isLoading = false;
    loadMoreButton.disabled = false;
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
  currentPage = 1;
  fetchResults();
});

// Handle category changes.
categoryFilter.addEventListener("change", () => {
  currentPage = 1;
  gameFilter.value = "";
  gameFilter.disabled = categoryFilter.value === "games";
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
  gameFilter.disabled = categoryFilter.value === "games";

  await loadGames();
  fetchResults();
}

init();
