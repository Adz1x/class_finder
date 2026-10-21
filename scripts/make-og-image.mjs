/**
 * Renders the social preview image.
 *
 * A preview card has to be a real image, not an SVG, so this draws the layout
 * in a headless browser and screenshots it. That keeps the design in HTML -
 * where it can be edited like the rest of the app - instead of in a drawing
 * library.
 *
 *   npm run og:image
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const OUT = "public";
mkdirSync(OUT, { recursive: true });

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        width: 1200px;
        height: 630px;
        font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
        background:
          radial-gradient(900px 500px at 82% -10%, #0b3a72 0%, transparent 60%),
          linear-gradient(135deg, #050a14 0%, #0a1224 55%, #071a35 100%);
        color: #f8fafc;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 76px 80px;
      }
      .mark {
        width: 84px; height: 84px; border-radius: 20px;
        background: #00204e; border: 2px solid rgba(255,255,255,.22);
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 18px 40px rgba(0,0,0,.45);
      }
      h1 {
        font-size: 62px; line-height: 1.06; letter-spacing: -0.02em;
        font-weight: 800; margin-top: 40px;
      }
      p {
        font-size: 27px; line-height: 1.45; color: #9fb6d4; margin-top: 22px; max-width: 900px;
      }
      .row { display: flex; gap: 14px; margin-top: 40px; }
      .pill {
        font-size: 21px; font-weight: 600; color: #cfe0f5;
        background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.14);
        border-radius: 999px; padding: 11px 22px;
      }
      .pill b { color: #7dd3fc; font-weight: 700; }
      footer { display: flex; align-items: center; gap: 16px; font-size: 22px; color: #7f95b5; }
    </style>
  </head>
  <body>
    <div>
      <div class="mark">
        <svg width="52" height="52" viewBox="0 0 64 64" fill="none">
          <path d="M32 15.5 53 25 32 34.5 11 25z" fill="#ffffff" />
          <path d="M19.5 29v11.5c0 4.2 5.6 7.5 12.5 7.5s12.5-3.3 12.5-7.5V29L32 34.6z" fill="#b8cde8" />
          <rect x="50" y="27.5" width="3" height="15" rx="1.5" fill="#ffffff" />
        </svg>
      </div>
      <h1>UofT Class &amp; Room Finder</h1>
      <p>Find an empty classroom, or look up any class in the UofT timetable — without being told a room number the University never published.</p>
      <div class="row">
        <div class="pill"><b>21,408</b> class meetings</div>
        <div class="pill"><b>209</b> real classrooms</div>
        <div class="pill"><b>83 KB</b> first load</div>
        <div class="pill"><b>0</b> invented rooms</div>
      </div>
    </div>
    <footer>University of Toronto · St. George · Mississauga · Scarborough</footer>
  </body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT}/og.png` });
await browser.close();

console.log(`wrote ${OUT}/og.png`);
