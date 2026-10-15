import { readFileSync } from "node:fs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Load the rooms data from the workspace root
const raw = readFileSync("../../../../../rooms_data.js", "utf-8");

// Extract the JSON from the window.UOFT_ROOMS_DATA assignment
// windows.UOFT_ROOMS_DATA = {...};
const jsonMatch = raw.match(/window\.UOFT_ROOMS_DATA\s*=\s*(\{[\s\S\]+?);\s*$/);
const data = jsonMatch ? JSON.parse(jsonMatch[1]) : {};

export async function GET(request) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "s-maxage=86400, stale-while-revalidate",
    },
  });
}