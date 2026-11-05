# Community sharing artwork

Created with the built-in `image_gen` tool, using one generation per board. Full final prompts: [community-share-image-prompts-2026-11-05.json](community-share-image-prompts-2026-11-05.json).

Final project assets:

- `I:/ai_root/sm-community-release-20261105/frontend/public/img/social/community-kr-og-v1.png` — 1734 × 907, RGB PNG, 2,202,387 bytes. Seoul financial skyline, illuminated spellbook, market and conversation constellations.
- `I:/ai_root/sm-community-release-20261105/frontend/public/img/social/community-global-og-v1.png` — 1734 × 907, RGB PNG, 2,349,695 bytes. Celestial globe, global financial city and illuminated spellbook.
- `I:/ai_root/sm-community-release-20261105/frontend/public/img/social/community-property-og-v1.png` — 1731 × 909, RGB PNG, 2,442,192 bytes. Korean apartments, house and gold key emerging from a spellbook.

The same assets are copied into `I:/ai_root/sm-deploy/frontend/public/img/social/` for local preview. Original generated images remain in the default Codex generated-images directory. No existing artwork was overwritten.

Each board has its own title, description, absolute OG image, Twitter large-image card, descriptive alt text and actual pixel dimensions in both raw server HTML and SPA navigation. Metadata catalogs stay identical between frontend and backend. New community routes are included in the public share allowlist; copied/native links omit snapshot, search and paging state. Native share titles name the board. Sharing was tested through a captured native-share function; no external messages were sent.

Validation before deployment: 13 isolated SEO/catalog tests; TypeScript/Vite build; browser checks on all three routes for image, dimensions, Twitter metadata, native share title and safe URLs. Generated Korean titles/subtitles and compositions were inspected visually. Production verification follows the deployment.
