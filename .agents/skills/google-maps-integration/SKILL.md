---
name: google-maps-integration
description: Integrates Google Maps and Geocoding APIs securely, covering the two-key split, runtime key delivery, referrer and API restrictions, and location privacy controls. Use when adding map rendering, location pinning, geocoding, place lookup, or any feature that stores a user's coordinates.
---

# Google Maps Integration Directive

## The honest problem

The Maps JavaScript API key **must** be present in the browser. It cannot be hidden. Any design that claims to hide it is either wrong or is actually a server-side proxy.

So do not try to hide it. Split the keys by exposure requirement, and protect each one at the layer where it actually lives.

## Two keys, never one

| Key | Who holds it | Protection |
|---|---|---|
| `MAPS_BROWSER_API_KEY` | the browser (unavoidable) | ① stored in Secret Manager; ② delivered at **runtime** via `GET /api/config` to authenticated callers, never inlined at build time; ③ HTTP-referrer restriction to the service domain; ④ API restriction to Maps JavaScript API only; ⑤ daily quota cap |
| `MAPS_SERVER_API_KEY` | Cloud Run only | Secret Manager + `--set-secrets`; used for Geocoding/Places; API-restricted to Geocoding only; never sent to a client under any circumstance |

**Never use one key for both.** A single key that permits both the JS API and Geocoding, and that must be handed to the browser, gives anyone who views source the ability to bill your Geocoding quota.

Why runtime delivery rather than `VITE_MAPS_KEY` at build time: a build-time env var is string-substituted into the bundle, so it sits in a public static asset served to anyone who loads the page, logged in or not. Runtime delivery means the key is only obtainable after a valid Firebase ID token, which does not make it secret but does remove it from casual scraping and from your git history.

Verification that this is actually working:

```bash
grep -r "AIza" web/dist/          # must return nothing
```

Put this in the pre-push hook. It is the single check that catches the most common failure in this challenge.

## Geocoding is server-side, always

```
client → POST /api/places/reverse-geocode { lat, lng }
       → server validates ranges, rate limits per uid
       → server calls Geocoding with MAPS_SERVER_API_KEY
       → server computes geohash
       → returns { placeName, geohash, lat, lng }
```

**The client's `placeName` and `geohash` are discarded and recomputed server-side.** If you trust the client's place name, a user can claim to be anywhere, and every aggregate built on location becomes forgeable.

Validate `lat ∈ [-90, 90]`, `lng ∈ [-180, 180]` with Zod before the outbound call — a malformed coordinate should cost you a `400`, not a billed API request.

## Location privacy — three controls, all required

Coordinates are among the most sensitive data this app touches. A journal with locations is a movement history.

1. **Opt-in by default.** Location capture is off until the user turns it on, with a plain-language explanation of what gets stored. Never request `navigator.geolocation` on first page load.
2. **Precision degradation.** Offer a "city-level only" setting that truncates coordinates to 2 decimal places (~1 km) before storage. Many users want the feature without a 5-metre trail.
3. **Revocable.** A "clear location from all my entries" action that runs as a backend batch update and writes an audit log entry. Data you cannot delete is data you should not have collected.

Also: if the user denies the browser permission prompt, the entry must still save. Location is an optional field, never a blocker.

## Frontend

Use `@vis.gl/react-google-maps` (Google-maintained React wrapper). Fetch the key from `/api/config`, pass to `<APIProvider>`. Use `AdvancedMarker` with mood-based coloring and `MarkerClusterer` for density. Handle the case where `/api/config` fails — the map area shows an error state, the rest of the app keeps working.

## Checklist

- [ ] Two separate keys, both in Secret Manager
- [ ] Browser key delivered at runtime, not build time
- [ ] Referrer + API restrictions + quota cap configured in Cloud Console
- [ ] `grep -r "AIza" web/dist/` returns nothing
- [ ] Geocoding server-side; client-supplied `placeName`/`geohash` overwritten
- [ ] Coordinate ranges validated before the outbound call
- [ ] Opt-in, precision degradation, and bulk-clear all implemented
- [ ] Denied permission degrades gracefully
