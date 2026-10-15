const BASE_URL = "https://moogleapi.com/api";

module.exports = async function handler(req, res) {
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type");

	if (req.method === "OPTIONS") {
		return res.status(200).end();
	}

	if (req.method !== "GET") {
		return res.status(405).json({
			error: "Method not allowed"
		});
	}

	const {
		resource,
		id,
		query,
		gameId,
		page,
		pageSize
	} = req.query;

	const allowedResources = [
		"games",
		"characters",
		"monsters"
	];

	if (!resource || !allowedResources.includes(resource)) {
		return res.status(400).json({
			error: "Invalid resource"
		});
	}

	if (id !== undefined && !/^\d+$/.test(String(id))) {
		return res.status(400).json({
			error: "Invalid entry ID"
		});
	}

	let endpoint = resource;

	if (id !== undefined) {
		endpoint += `/${id}`;
	} else if (query && resource !== "games") {
		endpoint += "/search";
	}

	const url = new URL(`${BASE_URL}/${endpoint}`);

	if (id === undefined && query && resource !== "games") {
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