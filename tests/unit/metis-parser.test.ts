import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  METIS_HEADERS,
  cellText,
  decodeEntities,
  metisDateText,
  parseMetisPage,
  tableRows,
} from "../../scripts/lib/metis-parser.mjs";

const HEADER_ROW = `<tr>${METIS_HEADERS.map((h) => `<th>${h}</th>`).join("")}</tr>`;

/** A results page laid out the way old PHP pages are: a table inside a table. */
const ROOMS_PAGE = `
<html><body>
<table class="layout"><tr><td>
  <h2>Classroom Space Database</h2>
  <table id="results">
    ${HEADER_ROW}
    <tr><td>Tuesday, Oct 20, 2026<td>01:00 PM<td>02:00 PM<td>Kaneff Centre<td>KN 137<td>350<td><a href="#">See image</a></tr>
    <tr>
      <td>Tuesday, Oct 20, 2026</td><td>01:00&nbsp;PM</td><td>02:00 PM</td>
      <td>Communication, Culture &amp; Technology</td><td>CC 1080</td><td>500</td><td>See image</td>
    </tr>
  </table>
</td></tr></table>
</body></html>`;

const NO_ROOMS_PAGE = `
<table>
  ${HEADER_ROW}
  <tr><td colspan="7">No rooms available. Please see &#39;More resources&#39; at the top of this page</td></tr>
</table>`;

const SIGN_IN_PAGE = `
<html><body><form action="/idp/profile/SAML2/Redirect/SSO">
  <h1>UTORid sign in</h1><input name="j_username"><input type="password">
</form></body></html>`;

describe("parseMetisPage", () => {
  it("reads the free rooms of an hour, kept as Metis prints them", () => {
    const answer = parseMetisPage(ROOMS_PAGE);
    expect(answer.kind).toBe("rooms");
    if (answer.kind !== "rooms") return;
    expect(answer.rows).toEqual([
      ["Tuesday, Oct 20, 2026", "01:00 PM", "02:00 PM", "Kaneff Centre", "KN 137", "350", "See image"],
      [
        "Tuesday, Oct 20, 2026",
        "01:00 PM",
        "02:00 PM",
        "Communication, Culture & Technology",
        "CC 1080",
        "500",
        "See image",
      ],
    ]);
  });

  it("keeps the 'No rooms available' row as one cell, as metis.py expects", () => {
    expect(parseMetisPage(NO_ROOMS_PAGE)).toEqual({
      kind: "none",
      rows: [["No rooms available. Please see 'More resources' at the top of this page"]],
    });
  });

  it("accepts the message outside a table too", () => {
    expect(parseMetisPage("<p>No rooms available.</p>")).toEqual({
      kind: "none",
      rows: [["No rooms available"]],
    });
  });

  it("refuses a sign-in page instead of reading it as an empty hour", () => {
    expect(parseMetisPage(SIGN_IN_PAGE).kind).toBe("unexpected");
  });

  it("refuses a results table with no rows and no message", () => {
    expect(parseMetisPage(`<table>${HEADER_ROW}</table>`).kind).toBe("unexpected");
  });
});

describe("page helpers", () => {
  it("decodes the entities a PHP page uses", () => {
    expect(decodeEntities("A &amp; B&nbsp;&#39;C&#x27; &lt;D&gt;")).toBe("A & B 'C' <D>");
  });

  it("collapses a cell to its visible text", () => {
    expect(cellText(" <b>KN</b>\n  137<br>")).toBe("KN 137");
  });

  it("only returns innermost rows", () => {
    const rows = tableRows(ROOMS_PAGE);
    expect(rows[0]).toEqual(METIS_HEADERS);
    expect(rows).toHaveLength(3);
  });

  it("prints dates the way Metis does", () => {
    expect(metisDateText(new Date(2026, 9, 19))).toBe("Monday, Oct 19, 2026");
    expect(metisDateText(new Date(2026, 11, 4))).toBe("Friday, Dec 4, 2026");
  });
});

describe("the committed snapshot", () => {
  const snapshot = JSON.parse(
    readFileSync(join(process.cwd(), "data", "utm_metis_data.json"), "utf-8"),
  );

  it("has the shape the capture writes", () => {
    expect(snapshot.headers).toEqual(METIS_HEADERS);
    for (const { val, text } of snapshot.dates) {
      const [y, m, d] = val.split("-").map(Number);
      expect(text).toBe(metisDateText(new Date(y, m - 1, d)));
    }
  });

  it("holds only room rows and 'No rooms available' rows", () => {
    for (const hours of Object.values(snapshot.byDateAndHour) as Record<string, string[][]>[]) {
      for (const rows of Object.values(hours)) {
        for (const row of rows) {
          const ok =
            row.length === METIS_HEADERS.length ||
            (row.length === 1 && /No rooms available/i.test(row[0]));
          expect(ok, JSON.stringify(row)).toBe(true);
        }
      }
    }
  });
});
