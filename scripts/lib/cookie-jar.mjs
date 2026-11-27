/**
 * Cookie jars in the Netscape format, which curl and Playwright both read.
 *
 * The UofT sign-on cookie is a browser session cookie: it dies when the
 * sign-in window closes. scripts/auth-session.mjs therefore writes each
 * system's cookies to a jar in ~/.uoft-session, and the capture scripts send
 * them from there. The jars live in the home directory, never in the repo.
 */
import { readFileSync } from "node:fs";

/**
 * @typedef {object} JarCookie
 * @property {string} domain   as written, e.g. "metis.utm.utoronto.ca" or ".utoronto.ca"
 * @property {string} path
 * @property {boolean} secure
 * @property {number} expires  seconds since the epoch, 0 for a session cookie
 * @property {string} name
 * @property {string} value
 */

/**
 * The jar text for a list of Playwright cookies.
 *
 * @param {Array<{domain: string, path?: string, secure?: boolean, expires?: number, name: string, value: string}>} cookies
 * @param {string} writtenBy the script writing the jar
 */
export function toJar(cookies, writtenBy) {
  const lines = [
    "# Netscape HTTP Cookie File",
    "# https://curl.se/docs/http-cookies.html",
    `# Written by ${writtenBy}. Edit at your own risk.`,
  ];
  for (const cookie of cookies) {
    const expires =
      cookie.expires && cookie.expires > 0 ? Math.floor(cookie.expires) : 0;
    lines.push(
      [
        cookie.domain,
        cookie.domain.startsWith(".") ? "TRUE" : "FALSE",
        cookie.path || "/",
        cookie.secure ? "TRUE" : "FALSE",
        expires,
        cookie.name,
        cookie.value,
      ].join("\t"),
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The cookies in a jar's text.
 *
 * @param {string} text
 * @returns {JarCookie[]}
 */
export function parseJar(text) {
  const cookies = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("\t");
    if (parts.length < 7) continue;
    const [domain, , path, secure, expires, name, ...value] = parts;
    cookies.push({
      domain,
      path: path || "/",
      secure: secure === "TRUE",
      expires: Number(expires) || 0,
      name,
      value: value.join("\t"),
    });
  }
  return cookies;
}

/** The cookies in a jar file. */
export function readJar(path) {
  return parseJar(readFileSync(path, "utf-8"));
}

/**
 * The Cookie header a browser would send to `url` from these cookies.
 *
 * @param {JarCookie[]} cookies
 * @param {string} url
 * @param {Date} [now]
 */
export function cookieHeader(cookies, url, now = new Date()) {
  const { hostname, pathname, protocol } = new URL(url);
  const nowSeconds = now.getTime() / 1000;
  return cookies
    .filter((cookie) => {
      const domain = cookie.domain.replace(/^\./, "").toLowerCase();
      const host = hostname.toLowerCase();
      const domainMatches = host === domain || host.endsWith(`.${domain}`);
      const pathMatches = pathname.startsWith(cookie.path || "/");
      const secureOk = !cookie.secure || protocol === "https:";
      const fresh = !cookie.expires || cookie.expires > nowSeconds;
      return domainMatches && pathMatches && secureOk && fresh;
    })
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

/**
 * Applies a response's Set-Cookie headers to the jar, so a session the
 * server rotates mid-capture keeps working.
 *
 * @param {JarCookie[]} cookies changed in place
 * @param {string[]} setCookies the response's Set-Cookie header values
 * @param {string} url the URL that answered
 */
export function applySetCookies(cookies, setCookies, url) {
  const { hostname } = new URL(url);
  for (const header of setCookies) {
    const [pair, ...attributes] = header.split(";");
    const eq = pair.indexOf("=");
    if (eq < 1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const attr = (key) =>
      attributes
        .map((a) => a.trim())
        .find((a) => a.toLowerCase().startsWith(`${key}=`))
        ?.slice(key.length + 1);
    const domain = attr("domain") ? `.${attr("domain").replace(/^\./, "")}` : hostname;
    const path = attr("path") || "/";
    const existing = cookies.find(
      (c) => c.name === name && c.domain.replace(/^\./, "") === domain.replace(/^\./, "") && c.path === path,
    );
    if (existing) existing.value = value;
    else
      cookies.push({
        domain,
        path,
        secure: attributes.some((a) => a.trim().toLowerCase() === "secure"),
        expires: 0,
        name,
        value,
      });
  }
}
