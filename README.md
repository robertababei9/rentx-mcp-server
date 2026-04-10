# RentX MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server for **[RentX.ro](https://www.rentx.ro)** — Romania's rental marketplace where people rent cars, equipment, electronics and more.

Connect this server to any MCP-compatible AI assistant (Claude Desktop, Claude Code, etc.) and it will be able to search listings, check availability, and browse categories on RentX.ro on your behalf.

## Tools

| Tool | Description |
|------|-------------|
| `search_rentals` | Search for items to rent by city, dates, category, and keyword |
| `get_popular_rentals` | Get the most popular and top-rated listings |
| `check_availability` | Check if a specific listing is available for given dates |
| `get_categories` | Get all rental categories |
| `search_suggestions` | Get autocomplete suggestions for search queries |

### search_rentals

Search listings near a Romanian city. Supports 30 major cities with fuzzy matching (diacritics optional).

**Inputs:**
- `city` (required) — Romanian city name (e.g. "București", "Cluj-Napoca", "Timisoara")
- `startDate` (optional) — Start date, YYYY-MM-DD
- `endDate` (optional) — End date, YYYY-MM-DD
- `category` (optional) — One of: `vehicles`, `sports-equipment`, `tools-equipment`, `appliances-electronics`, `events-parties`, `medical-equipment`, `home-household`, `garden-outdoor`
- `keyword` (optional) — Free-text keyword filter

### get_popular_rentals

**Inputs:**
- `limit` (optional) — Number of results, 1–50, default 10

### check_availability

**Inputs:**
- `listingId` (required) — The listing GUID
- `startDate` (required) — YYYY-MM-DD
- `endDate` (required) — YYYY-MM-DD

### get_categories

No inputs. Returns the full category hierarchy.

### search_suggestions

**Inputs:**
- `query` (required) — Text to get autocomplete suggestions for

## Installation

```bash
git clone <this-repo>
cd rentx-mcp-server
npm install
npm run build
```

## Configuration

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RENTX_API_URL` | `https://api.rentx.ro/api` | RentX backend API base URL |

### Claude Desktop

Add the server to your `claude_desktop_config.json`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "rentx": {
      "command": "node",
      "args": ["C:/ABSOLUTE/PATH/TO/rentx-mcp-server/dist/index.js"]
    }
  }
}
```

### Claude Code

Add to your Claude Code settings (`.claude/settings.json` or project-level):

```json
{
  "mcpServers": {
    "rentx": {
      "command": "node",
      "args": ["C:/ABSOLUTE/PATH/TO/rentx-mcp-server/dist/index.js"]
    }
  }
}
```

## Example queries

Once connected, you can ask your AI assistant things like:

- "Find me a car to rent in Cluj-Napoca next weekend"
- "What are the most popular rentals on RentX?"
- "Search for power tools available in Timișoara"
- "Is listing abc-123 available from June 1 to June 5?"
- "What categories does RentX have?"
- "Search suggestions for 'BMW'"

## Development

```bash
# Watch mode (recompiles on changes)
npm run dev

# Build once
npm run build

# Run the server (stdio transport)
npm start
```

## Supported cities

București, Cluj-Napoca, Timișoara, Iași, Constanța, Brașov, Craiova, Oradea, Sibiu, Galați, Ploiești, Arad, Pitești, Bacău, Târgu Mureș, Baia Mare, Buzău, Suceava, Satu Mare, Botoșani, Piatra Neamț, Alba Iulia, Deva, Bistrița, Brăila, Tulcea, Târgu Jiu, Focșani, Râmnicu Vâlcea, Mangalia

City matching is fuzzy — diacritics are optional and common variations are accepted (e.g. "Bucuresti", "Cluj", "Targu Mures" all work).

## License

MIT
