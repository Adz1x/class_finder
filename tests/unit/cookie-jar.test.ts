import { describe, expect, it } from "vitest";
import {
  applySetCookies,
  cookieHeader,
  parseJar,
  toJar,
} from "../../scripts/lib/cookie-jar.mjs";

const NOW = new Date("2026-11-29T23:00:00Z");
const LATER = Math.floor(NOW.getTime() / 1000) + 3600;
const EARLIER = Math.floor(NOW.getTime() / 1000) - 3600;

const jar = toJar(
  [
    { domain: "metis.utm.utoronto.ca", path: "/", secure: true, expires: -1, name: "PHPSESSID", value: "abc" },
    { domain: ".utoronto.ca", path: "/", secure: true, expires: LATER, name: "shared", value: "s1" },
    { domain: "lsm.utoronto.ca", path: "/", secure: true, expires: -1, name: "ORA_WWV", value: "lsm" },
    { domain: "metis.utm.utoronto.ca", path: "/admin", secure: true, expires: -1, name: "adminonly", value: "x" },
    { domain: "metis.utm.utoronto.ca", path: "/", secure: true, expires: EARLIER, name: "old", value: "gone" },
  ],
  "a test",
);

describe("cookie jars", () => {
  it("round-trips through the Netscape format", () => {
    const cookies = parseJar(jar);
    expect(cookies).toHaveLength(5);
    expect(cookies[0]).toMatchObject({ domain: "metis.utm.utoronto.ca", name: "PHPSESSID", value: "abc", expires: 0 });
    expect(jar).toContain("# Written by a test.");
  });

  it("sends only the cookies a browser would send to Metis", () => {
    const header = cookieHeader(parseJar(jar), "https://metis.utm.utoronto.ca/space/index.php", NOW);
    expect(header).toBe("PHPSESSID=abc; shared=s1");
  });

  it("keeps a session the server rotates mid-capture", () => {
    const cookies = parseJar(jar);
    applySetCookies(
      cookies,
      ["PHPSESSID=def; path=/; secure; HttpOnly", "fresh=1; Path=/"],
      "https://metis.utm.utoronto.ca/space/index.php",
    );
    const header = cookieHeader(cookies, "https://metis.utm.utoronto.ca/space/index.php", NOW);
    expect(header).toBe("PHPSESSID=def; shared=s1; fresh=1");
  });
});
