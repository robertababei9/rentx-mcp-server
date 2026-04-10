#!/usr/bin/env node

import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL = process.env.RENTX_API_URL || "https://api.rentx.ro/api";
const REQUEST_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Romanian cities — top 30 with lat/lng
// ---------------------------------------------------------------------------

interface CityCoords {
  lat: number;
  lng: number;
}

const ROMANIAN_CITIES: Record<string, CityCoords> = {
  bucuresti: { lat: 44.4268, lng: 26.1025 },
  "cluj-napoca": { lat: 46.7712, lng: 23.6236 },
  cluj: { lat: 46.7712, lng: 23.6236 },
  timisoara: { lat: 45.7489, lng: 21.2087 },
  iasi: { lat: 47.1585, lng: 27.6014 },
  constanta: { lat: 44.1598, lng: 28.6348 },
  brasov: { lat: 45.6427, lng: 25.5887 },
  craiova: { lat: 44.3302, lng: 23.7949 },
  oradea: { lat: 47.0458, lng: 21.9189 },
  sibiu: { lat: 45.7983, lng: 24.1256 },
  galati: { lat: 45.4353, lng: 28.008 },
  ploiesti: { lat: 44.9462, lng: 26.0307 },
  arad: { lat: 46.1866, lng: 21.3123 },
  pitesti: { lat: 44.8565, lng: 24.8692 },
  bacau: { lat: 46.567, lng: 26.9146 },
  "targu-mures": { lat: 46.5386, lng: 24.5575 },
  "targu mures": { lat: 46.5386, lng: 24.5575 },
  "baia-mare": { lat: 47.6567, lng: 23.585 },
  "baia mare": { lat: 47.6567, lng: 23.585 },
  buzau: { lat: 45.15, lng: 26.8333 },
  suceava: { lat: 47.6514, lng: 26.2556 },
  "satu-mare": { lat: 47.7833, lng: 22.8833 },
  "satu mare": { lat: 47.7833, lng: 22.8833 },
  botosani: { lat: 47.75, lng: 26.6667 },
  "piatra-neamt": { lat: 46.9275, lng: 26.3719 },
  "piatra neamt": { lat: 46.9275, lng: 26.3719 },
  "alba-iulia": { lat: 46.0667, lng: 23.5833 },
  "alba iulia": { lat: 46.0667, lng: 23.5833 },
  deva: { lat: 45.8833, lng: 22.9 },
  bistrita: { lat: 47.1333, lng: 24.5 },
  braila: { lat: 45.2692, lng: 27.9597 },
  tulcea: { lat: 45.1833, lng: 28.8 },
  "targu-jiu": { lat: 45.0356, lng: 23.2756 },
  "targu jiu": { lat: 45.0356, lng: 23.2756 },
  focsani: { lat: 45.6967, lng: 27.1833 },
  "ramnicu-valcea": { lat: 45.1, lng: 24.3667 },
  "ramnicu valcea": { lat: 45.1, lng: 24.3667 },
  mangalia: { lat: 43.8159, lng: 28.5832 },
};

// ---------------------------------------------------------------------------
// Valid categories
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = [
  "vehicles",
  "sports-equipment",
  "tools-equipment",
  "appliances-electronics",
  "events-parties",
  "medical-equipment",
  "home-household",
  "garden-outdoor",
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Remove Romanian diacritics and normalise to lowercase for fuzzy matching. */
function normalizeCity(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining marks
    .replace(/[đ]/g, "d")
    .replace(/\s+/g, " ");
}

function lookupCity(input: string): CityCoords | null {
  const key = normalizeCity(input);

  // Direct match
  if (ROMANIAN_CITIES[key]) return ROMANIAN_CITIES[key];

  // Match with dashes instead of spaces
  const dashed = key.replace(/ /g, "-");
  if (ROMANIAN_CITIES[dashed]) return ROMANIAN_CITIES[dashed];

  // Partial / starts-with match
  for (const [cityKey, coords] of Object.entries(ROMANIAN_CITIES)) {
    if (cityKey.startsWith(key) || key.startsWith(cityKey)) {
      return coords;
    }
  }

  return null;
}

/** Calculate bounding box around a point. */
function getBoundaries(lat: number, lng: number, radiusKm: number = 25) {
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  return {
    northLat: lat + latDelta,
    southLat: lat - latDelta,
    eastLng: lng + lngDelta,
    westLng: lng - lngDelta,
  };
}

/** Make an HTTP request with timeout. */
async function apiRequest<T>(
  url: string,
  options?: RequestInit
): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS
    );

    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(options?.headers || {}),
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(
        `API error: ${response.status} ${response.statusText} — ${url}`
      );
      return null;
    }

    return (await response.json()) as T;
  } catch (err) {
    console.error(`Request failed for ${url}:`, err);
    return null;
  }
}

/** Slugify a string for URL building. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

interface CarInfo {
  Make?: string;
  Model?: string;
  Year?: number;
  FuelType?: string;
  TransmisionType?: string;
  Seats?: number;
}

interface SearchListing {
  Id: string;
  Title: string;
  Description?: string;
  Price: number;
  City: string;
  ImageUrls?: string[];
  CategoryName?: string;
  SubcategoryName?: string;
  ReviewRate?: number;
  NumberOfReviews?: number;
  TotalRents?: number;
  Owner?: string;
  Car?: CarInfo;
}

interface TopBooking {
  BookingId: string;
  Title: string;
  Rating?: number;
  City: string;
  Price: number;
  NumberOfTrips?: number;
  CategoryName?: string;
  OwnerUsername?: string;
}

interface ApiResponse<T> {
  Success: boolean;
  Data: T;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatListing(item: SearchListing, index: number): string {
  const citySlug = slugify(item.City || "");
  const catSlug = slugify(item.CategoryName || "other");
  const titleSlug = slugify(item.Title || "listing");
  const link = `https://rentx.ro/ro/rent/${citySlug}/${catSlug}/${titleSlug}/${item.Id}`;

  const lines: string[] = [
    `${index}. ${item.Title}`,
    `   Price: ${item.Price} RON/day`,
    `   City: ${item.City}`,
  ];

  if (item.CategoryName) {
    lines.push(
      `   Category: ${item.CategoryName}${item.SubcategoryName ? " > " + item.SubcategoryName : ""}`
    );
  }

  if (item.ReviewRate != null && item.ReviewRate > 0) {
    lines.push(
      `   Rating: ${item.ReviewRate.toFixed(1)}/5 (${item.NumberOfReviews ?? 0} reviews)`
    );
  }

  if (item.TotalRents != null && item.TotalRents > 0) {
    lines.push(`   Total rentals: ${item.TotalRents}`);
  }

  if (item.Car) {
    const c = item.Car;
    const carParts: string[] = [];
    if (c.Make) carParts.push(c.Make);
    if (c.Model) carParts.push(c.Model);
    if (c.Year) carParts.push(String(c.Year));
    if (carParts.length) lines.push(`   Car: ${carParts.join(" ")}`);
    if (c.FuelType) lines.push(`   Fuel: ${c.FuelType}`);
    if (c.TransmisionType) lines.push(`   Transmission: ${c.TransmisionType}`);
    if (c.Seats) lines.push(`   Seats: ${c.Seats}`);
  }

  if (item.Owner) {
    lines.push(`   Owner: ${item.Owner}`);
  }

  lines.push(`   Link: ${link}`);

  return lines.join("\n");
}

function formatTopBooking(item: TopBooking, index: number): string {
  const citySlug = slugify(item.City || "");
  const catSlug = slugify(item.CategoryName || "other");
  const titleSlug = slugify(item.Title || "listing");
  const link = `https://rentx.ro/ro/rent/${citySlug}/${catSlug}/${titleSlug}/${item.BookingId}`;

  const lines: string[] = [
    `${index}. ${item.Title}`,
    `   Price: ${item.Price} RON/day`,
    `   City: ${item.City}`,
  ];

  if (item.CategoryName) {
    lines.push(`   Category: ${item.CategoryName}`);
  }

  if (item.Rating != null && item.Rating > 0) {
    lines.push(`   Rating: ${item.Rating.toFixed(1)}/5`);
  }

  if (item.NumberOfTrips != null && item.NumberOfTrips > 0) {
    lines.push(`   Total rentals: ${item.NumberOfTrips}`);
  }

  if (item.OwnerUsername) {
    lines.push(`   Owner: ${item.OwnerUsername}`);
  }

  lines.push(`   Link: ${link}`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

function createServer() {
  const server = new McpServer({
    name: "rentx",
    version: "1.0.0",
  });

// Tool 1: search_rentals
server.registerTool(
  "search_rentals",
  {
    description:
      "Search for items to rent on RentX.ro — Romania's rental marketplace. Search cars, equipment, electronics and more by location, dates, and category.",
    inputSchema: {
      city: z
        .string()
        .describe(
          "Romanian city name (e.g. București, Cluj-Napoca, Timișoara)"
        ),
      startDate: z
        .string()
        .optional()
        .describe("Start date in YYYY-MM-DD format"),
      endDate: z
        .string()
        .optional()
        .describe("End date in YYYY-MM-DD format"),
      category: z
        .enum(VALID_CATEGORIES)
        .optional()
        .describe("Rental category filter"),
      keyword: z
        .string()
        .optional()
        .describe("Search keyword to filter results"),
    },
  },
  async ({ city, startDate, endDate, category, keyword }) => {
    // Resolve city coordinates
    const coords = lookupCity(city);
    if (!coords) {
      const available = [
        "București",
        "Cluj-Napoca",
        "Timișoara",
        "Iași",
        "Constanța",
        "Brașov",
        "Craiova",
        "Oradea",
        "Sibiu",
        "Galați",
        "Ploiești",
        "Arad",
        "Pitești",
        "Bacău",
        "Târgu Mureș",
        "Baia Mare",
        "Buzău",
        "Suceava",
        "Satu Mare",
        "Botoșani",
        "Piatra Neamț",
        "Alba Iulia",
        "Deva",
        "Bistrița",
        "Brăila",
        "Tulcea",
        "Târgu Jiu",
        "Focșani",
        "Râmnicu Vâlcea",
        "Mangalia",
      ];
      return {
        content: [
          {
            type: "text" as const,
            text: `City "${city}" not found. Supported cities: ${available.join(", ")}`,
          },
        ],
      };
    }

    const boundaries = getBoundaries(coords.lat, coords.lng);

    // Build request body
    const body: Record<string, unknown> = {
      northLat: boundaries.northLat,
      southLat: boundaries.southLat,
      eastLng: boundaries.eastLng,
      westLng: boundaries.westLng,
    };

    if (startDate) body.startDate = startDate;
    if (endDate) body.endDate = endDate;
    if (category) body.category = category;

    const result = await apiRequest<ApiResponse<SearchListing[]>>(
      `${BASE_URL}/bookings/GetAllByCoordinates`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );

    if (!result || !result.Success || !result.Data) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No rental listings found near ${city}. Try a different city or broader search.`,
          },
        ],
      };
    }

    let listings = result.Data;

    // Client-side keyword filter
    if (keyword) {
      const kw = keyword.toLowerCase();
      listings = listings.filter(
        (item) =>
          (item.Title && item.Title.toLowerCase().includes(kw)) ||
          (item.Description && item.Description.toLowerCase().includes(kw)) ||
          (item.CategoryName &&
            item.CategoryName.toLowerCase().includes(kw)) ||
          (item.Car &&
            `${item.Car.Make || ""} ${item.Car.Model || ""}`
              .toLowerCase()
              .includes(kw))
      );
    }

    // Limit results
    listings = listings.slice(0, 10);

    if (listings.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No rental listings matched your search near ${city}.${keyword ? ` Keyword: "${keyword}"` : ""}${category ? ` Category: ${category}` : ""}`,
          },
        ],
      };
    }

    const header = `Found ${listings.length} rental listing(s) near ${city}:`;
    const formatted = listings
      .map((item, i) => formatListing(item, i + 1))
      .join("\n\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `${header}\n\n${formatted}`,
        },
      ],
    };
  }
);

// Tool 2: get_popular_rentals
server.registerTool(
  "get_popular_rentals",
  {
    description:
      "Get the most popular and top-rated rental listings on RentX.ro",
    inputSchema: {
      limit: z
        .number()
        .min(1)
        .max(50)
        .optional()
        .describe("Number of results to return (default 10, max 50)"),
    },
  },
  async ({ limit }) => {
    const pageSize = limit ?? 10;

    const result = await apiRequest<ApiResponse<TopBooking[]>>(
      `${BASE_URL}/bookings/GetTopBookings?Page=1&PageSize=${pageSize}`
    );

    if (!result || !result.Success || !result.Data || result.Data.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Could not retrieve popular listings at this time. Please try again later.",
          },
        ],
      };
    }

    const header = `Top ${result.Data.length} popular rental listing(s) on RentX.ro:`;
    const formatted = result.Data.map((item, i) =>
      formatTopBooking(item, i + 1)
    ).join("\n\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `${header}\n\n${formatted}`,
        },
      ],
    };
  }
);

// Tool 3: check_availability
server.registerTool(
  "check_availability",
  {
    description:
      "Check if a specific RentX listing is available for given dates",
    inputSchema: {
      listingId: z.string().describe("The listing/booking ID (GUID)"),
      startDate: z
        .string()
        .describe("Start date in YYYY-MM-DD format"),
      endDate: z
        .string()
        .describe("End date in YYYY-MM-DD format"),
    },
  },
  async ({ listingId, startDate, endDate }) => {
    // Basic date validation
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Invalid date format. Please use YYYY-MM-DD.",
          },
        ],
      };
    }

    const url = `${BASE_URL}/reservations/CheckAvailability?bookingId=${encodeURIComponent(listingId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;

    const result = await apiRequest<ApiResponse<unknown>>(url);

    if (!result) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Could not check availability. The listing ID may be invalid or the service is temporarily unavailable.",
          },
        ],
      };
    }

    if (result.Success) {
      return {
        content: [
          {
            type: "text" as const,
            text: `The listing is AVAILABLE from ${startDate} to ${endDate}. You can proceed to book it on RentX.ro.`,
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: "text" as const,
            text: `The listing is NOT available for the requested dates (${startDate} to ${endDate}). Try different dates.`,
          },
        ],
      };
    }
  }
);

// Tool 4: get_categories
server.registerTool(
  "get_categories",
  {
    description: "Get all rental categories available on RentX.ro",
  },
  async () => {
    const result = await apiRequest<ApiResponse<unknown>>(
      `${BASE_URL}/categories/GetAll`
    );

    if (!result || !result.Success || !result.Data) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Could not retrieve categories. Please try again later.",
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `RentX.ro categories:\n\n${JSON.stringify(result.Data, null, 2)}`,
        },
      ],
    };
  }
);

// Tool 5: search_suggestions
server.registerTool(
  "search_suggestions",
  {
    description:
      "Get search suggestions/autocomplete for rental queries on RentX.ro",
    inputSchema: {
      query: z
        .string()
        .min(1)
        .describe("Search text to get suggestions for"),
    },
  },
  async ({ query }) => {
    const url = `${BASE_URL}/bookings/GetKeywordSuggestions?query=${encodeURIComponent(query)}`;

    const result = await apiRequest<ApiResponse<string[]>>(url);

    if (!result || !result.Success || !result.Data || result.Data.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No suggestions found for "${query}".`,
          },
        ],
      };
    }

    const suggestions = result.Data.map(
      (s: string, i: number) => `${i + 1}. ${s}`
    ).join("\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `Search suggestions for "${query}":\n\n${suggestions}`,
        },
      ],
    };
  }
);

  return server;
}

// ---------------------------------------------------------------------------
// Smithery hosted mode — export for capability scanning
// ---------------------------------------------------------------------------

export function createSandboxServer() {
  return createServer();
}

// ---------------------------------------------------------------------------
// HTTP entrypoint (when PORT env var is set — for public hosting)
// ---------------------------------------------------------------------------

async function startHttpServer() {
  const port = parseInt(process.env.PORT || "3000", 10);

  const httpServer = http.createServer(async (req, res) => {
    // CORS — allow any AI assistant or browser to call this endpoint
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Accept, Mcp-Session-Id"
    );

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check
    if (req.url === "/health" || req.url === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ status: "ok", server: "rentx-mcp-server", version: "1.0.2" })
      );
      return;
    }

    // MCP endpoint
    if (req.url === "/mcp") {
      let parsedBody: unknown;

      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk as Buffer);
        }
        const raw = Buffer.concat(chunks).toString("utf-8");
        if (raw) {
          try {
            parsedBody = JSON.parse(raw);
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON body" }));
            return;
          }
        }
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless — no session affinity needed
      });
      const server = createServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, parsedBody);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  httpServer.listen(port, () => {
    console.log(`RentX MCP HTTP server listening on port ${port}`);
    console.log(`MCP endpoint: POST http://0.0.0.0:${port}/mcp`);
  });
}

// ---------------------------------------------------------------------------
// Stdio entrypoint (npx / local use)
// ---------------------------------------------------------------------------

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("RentX MCP server started (stdio transport)");
}

// ---------------------------------------------------------------------------
// Entry point — HTTP when PORT is set, stdio otherwise
// ---------------------------------------------------------------------------

if (process.env.PORT) {
  startHttpServer().catch((err) => {
    console.error("Fatal error starting HTTP server:", err);
    process.exit(1);
  });
} else {
  main().catch((err) => {
    console.error("Fatal error starting RentX MCP server:", err);
    process.exit(1);
  });
}
