
const BASE_URL = "https://moogleapi.com/api";

module.exports = async function handler(req, res) {
  // Only allow GET requests.
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const {
    resource,
    query,
    gameId,
    page,
    pageSize
  } = req.query;

  // Only allow these three API categories.
  const allowedResources = [
    "games",
    "characters",
    "monsters"
  ];

  if (!allowedResources.includes(resource)) {
    return res.status(400).json({
      error: "Invalid resource"
    });
  }

  // Choose the appropriate endpoint.
  let endpoint = resource;

  if (query && resource !== "games") {
    endpoint += "/search";
  }

  // Build the URL to MoogleAPI.
  const url = new URL(`${BASE_URL}/${endpoint}`);

  // Forward supported search and filter parameters.
  if (query && resource !== "games") {
    url.searchParams.set("query", query);
  }

  if (gameId) {
    url.searchParams.set("gameId", gameId);
  }

  if (page) {
    url.searchParams.set("page", page);
  }

  if (pageSize) {
    url.searchParams.set("pageSize", pageSize);
  }

  try {
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(response.status).json({
        error: "MoogleAPI request failed"
      });
    }

    const data = await response.json();

    // Cache results briefly to reduce repeated requests.
    res.setHeader(
      "Cache-Control",
      "s-maxage=60, stale-while-revalidate=300"
    );

    return res.status(200).json(data);

  } catch (error) {
    console.error("MoogleAPI error:", error);

    return res.status(502).json({
      error: "Could not retrieve data from MoogleAPI"
    });
  }
};
