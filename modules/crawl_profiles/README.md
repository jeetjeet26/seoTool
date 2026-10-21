# Browser retry profile

`browser.seospiderconfig` is the Screaming Frog 24.3 saved configuration verified
against the Kolter crawl on 2026-10-19. It uses a Chrome desktop HTTP user agent,
keeps robots.txt respect enabled (Screaming Frog robots identity), and does not
enable JavaScript rendering. Authentication and API credentials are not included.
The worker image pins the same Screaming Frog version. Validate this profile
when upgrading that version.

The crawler retries once when an HTML/document request returns HTTP 403. It does
not retry 429 rate limits. The retry uses the same URL scope and export tabs,
and replaces the first crawl only when it recovers more successful HTML pages.
