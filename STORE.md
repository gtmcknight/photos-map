# Chrome Web Store listing

Everything the developer dashboard asks for, ready to paste.

## Item

- **Name:** Map for Google Photos
- **Summary** (132 characters max):

```
See every photo you've taken on a map, right inside Google Photos on the web. Drag through the years.
```

- **Category:** Functionality & UI (the store has no Photos category)
- **Language:** English

## Description

```
Google Photos has a map on your phone but not on the web. This adds it.

A Map item appears in Google Photos' left menu, next to Places. Open it and every photo with a location shows on the map:

• A heat map of where you've taken photos, from the whole world down to the street.
• Photo bubbles you can click to zoom into a place or open a photo.
• The photos in view, grouped by day, beside the map.
• A year bar to see only the photos from some years.
• Photos open in Google Photos' own viewer, and Back returns you to the same spot.

It follows Google Photos' light and dark themes, and the map's position and years are kept in the address bar, so you can bookmark a place.

Private by design: your photos' locations are read from your own signed-in Google Photos page and kept on your computer. There's no server and no account. The map tiles come from OpenFreeMap (OpenStreetMap data).

Not affiliated with Google. Source code: https://github.com/gtmcknight/photos-map
```

## Privacy practices

- **Single purpose:**

```
Adds a map of your photo locations to Google Photos on the web.
```

- **Permission justifications:**
  - `storage`:

```
Keeps the map's copy of your photo locations and the last map position on this computer, so the map opens instantly.
```

  - `unlimitedStorage`:

```
Large libraries (100,000+ photos) need more than the default 10 MB of local storage for their photo locations.
```

  - Host access, `https://photos.google.com/*`:

```
Adds the Map page inside Google Photos and reads your library's photo locations from your signed-in Google Photos page. The page's session token stays in memory and is only used for requests back to photos.google.com.
```

- **Remote code:** No, I am not using remote code. If the reviewer asks: every script ships in the package. The map's worker is the packaged `maplibre-gl-worker.mjs`, started from a blob because Google Photos' page won't start a worker from an extension URL. MapLibre's worker has a dormant script loader (`importScript`), reachable only through `setRTLTextPlugin` or `importScriptInWorkers`, and neither is ever called.
- **Data usage:** tick **Location** (photo locations are read and kept on the computer; map tile requests show OpenFreeMap the areas you view) and **Website content** (photo dates and thumbnail addresses read from Google Photos, kept on the computer). Leave everything else unticked, and tick all three certifications (not sold, not used for unrelated purposes, not used for lending).
- **Privacy policy URL:** https://taylor.fyi/map-for-google-photos/privacy
- **Homepage URL:** https://taylor.fyi/map-for-google-photos/ · **Support URL:** https://github.com/gtmcknight/photos-map/issues

## Images

- Icon: `static/icons/128.png`
- Screenshots: 1280×800, up to 5.
- Small promo tile: 440×280.
