## What this changes

<!-- One or two sentences. -->

## Why

<!-- The problem it solves. If it fixes a data bug, say which one and how you
     proved it. -->

## Checklist

- [ ] `npm run lint`
- [ ] `npm run scraper:test`
- [ ] `npm test`
- [ ] `npm run data:verify`
- [ ] `npm run data:size`
- [ ] `npm run build`
- [ ] `npx playwright test`
- [ ] If the scraper changed: `npm run data:build` was run and `data/` is committed
- [ ] If the dataset changed: `data/campus/*.json` shrank or grew only by what
      the change explains, and `data:verify` passes

## The data rule

- [ ] Nothing in this change invents a value that the source does not publish.
      Room numbers, building names and availability hours are either published or
      shown as unknown.

## Screenshots

<!-- Before/after for anything visual. -->
