# Chrome Web Store listing

Everything the developer dashboard asks for, ready to paste.

## Item

- **Name:** Map for Google Photos™ (from the package; Google's branding rules want "for" plus ™ when a title names a Google product)
- **Summary** (from the package's manifest description, 132 characters max):

```
Adds a map of where you took your pictures to Google Photos™ on the web. Locations stay on your computer.
```

- **Category:** Functionality & UI (the store has no Photos category)
- **Language:** English

## Description

Keep every keyword under five uses across the summary and description (Google's spam FAQ: more than five "may result in increased scrutiny").

```
In Google Photos™ on your computer, a new Map item sits in the left menu, right below Places. Click it and each picture with a location shows up where it was taken:

• Color shows where you shot the most, from the whole world down to the street.
• Click a bubble to zoom in or open a picture.
• What's in view sits beside it, grouped by day.
• A year bar narrows it to one trip or one decade.
• Pictures open in the regular viewer, and Back returns you to the same spot.

It follows your light or dark theme. The address bar keeps where you are and which years you picked, so you can bookmark a place.

Private by design: locations are read through your own sign-in and stay on your computer. There's no server and no account. The streets and place names come from OpenFreeMap (OpenStreetMap data).

Google Photos is a trademark of Google LLC, which doesn't make or endorse this extension. Source code: https://github.com/gtmcknight/photos-map
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

## Review history

- **1.0.0, submitted Nov 17, 2026: rejected the same day.** "Spam and Placement in the Store", violation reference Yellow Nickel, no other detail. The account has one item, so not a duplicate. The listing said "photo" 14 times, "map" 8 and "Google" 6, over the spam FAQ's five, and named Google Photos with no ™ or trademark line.
- **1.0.1:** title and summary carry Google Photos™, the description ends with the trademark line, and no keyword appears more than four times. The description no longer opens like Photo Heat Map's pitch (their site: the phone app has a map, the website doesn't, "Photo Heat Map adds one"), in case Google compares listings for copies. Code unchanged.
