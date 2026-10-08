# Shared merchant rule and icon library

## Goal

Each deployment can store administrator-approved icon assets and matching rules in its own SQLite database/filesystem. The bundled v1 shared library provides a reviewed local baseline for merchant, institution, financial-product, and category rules. It must not become an automatic untrusted-code or tracking channel.

The repository includes a versioned `library/` seed:

```text
library/
  manifest.json
  rules.json
  icons/
```

It is consumed from the checked-out local repository during database initialization. Files are checksummed before import, rules are bounded and declarative, equivalent local rules are preserved, and imported priorities remain below deployment rules. No transaction text or usage data leaves the host. Remote updates remain future work and must add signature verification and explicit operator consent.

## Rule format

Each entry has a stable ID and contains only bounded declarative data:

```json
{
  "id": "merchant.discord",
  "entityType": "merchant",
  "displayName": "Discord",
  "pattern": "discord",
  "matchType": "contains",
  "priority": 20,
  "variants": {
    "32": { "file": "merchant.discord.discord-32.webp", "sha256": "...", "byteSize": 678 },
    "64": { "file": "merchant.discord.discord-64.webp", "sha256": "...", "byteSize": 1652 },
    "128": { "file": "merchant.discord.discord-128.webp", "sha256": "...", "byteSize": 4110 }
  },
  "license": "Third-party or community-provided artwork; no trademark rights granted",
  "source": "Bundled from an administrator-approved SimplerFinance v1 library submission",
  "updatedAt": "2026-08-20T00:00:00Z"
}
```

Allowed entity types should remain `merchant`, `institution`, `financial_product`, and `category`; match types should initially remain `exact` and normalized `contains`. Regex should not be accepted from a remote library because it creates denial-of-service and review complexity. Priorities need a small documented range.

## Resolution precedence

Recommended precedence is:

1. deployment administrator override;
2. deployment-approved customer submission;
3. pinned shared-library rule;
4. primary-category fallback icon;
5. generated letter/avatar fallback.

Customer categorization rules and icon rules are different systems. An icon match must never change transaction categories or merchant text. A shared category icon may visualize a customer-owned category only after normalized name matching.

## Publishing workflow

1. A contributor submits an icon, source/license evidence, test strings, and proposed bounded rule.
2. Repository maintainers verify trademark/license suitability, image safety, normalization, collisions, and false positives.
3. CI validates schema, unique IDs, normalized patterns, file hashes, dimensions, file sizes, and fixtures.
4. Maintainers publish a versioned immutable release containing the manifest, rules, and icons.
5. A detached signature covers the canonical manifest and file hashes.
6. Self-hosters explicitly select a channel/version and review a diff before importing.

Never overwrite a released artifact in place. Immutable versions make rollback and incident response possible.

## Import design

The application should download only over HTTPS, enforce a total archive/response cap, validate a pinned public-key signature, verify every SHA-256 file hash, reject paths/traversal, validate SVGs, normalize raster output through the existing icon pipeline, and apply changes transactionally. Downloaded SVG should not be served directly merely because the manifest is signed.

Imported rows need `source=library`, library rule ID, library version, and an enabled flag. Operator edits should create an override rather than mutating the imported row. On update, show additions, changed patterns/icons, removals, and local conflicts. A removed upstream rule should be disabled only if it has no local override.

## Privacy

Rule resolution should be local. Do not send transaction descriptions or category names to a central service. Update checks should reveal at most ordinary package-fetch metadata. Provide a fully offline import option for privacy-sensitive installations.

## Licensing and trademarks

Logos are often trademarked even when downloadable. The initial hobby-project v1 export preserves administrator-approved community artwork whose original upload records did not capture detailed provenance. It is accompanied by a third-party/trademark notice and deliberately does not claim that the MIT source-code license covers those assets. Future contributions should record provenance and an explicit license or documented permission. Maintainers may prefer generic category icons and institution-provided brand kits with clear terms.

## Abuse resistance

The shared library must keep the same or stronger bounds as customer uploads: finite rule count, finite manifest size, maximum 1 MB source image, pixel/decompression limits, safe SVG checks, normalized output limits, and collision tests. Maintainer review and signatures protect distribution integrity; they do not make broad match patterns semantically safe.
