# Community source mix and internal reading

The default collector no longer requests DCInside. Its legacy parser remains for compatibility with old article references and isolated fixtures; it is not a fallback source.

Domestic/global stock boards use Ppomppu Stock, Damoang Stock and Clien Stock. Property uses Ppomppu House and 82cook's property/apartment searches. Global stock titles are classified using explicit overseas-market/company/ticker keywords; other stock-specific titles go to Korea. Property searches require property terms in the title. Promotional solicitation, several explicit insults, notices and undated posts are skipped. This is a keyword filter, not a claim that every article is high quality.

Only articles with a successfully extracted public body/attachment enter the feed. Read-only requests retain the provider robots check, bounded response size, per-host pacing and short list cache shared by Korea/global collection. Recent source candidates are limited to seven days. Provider failure retains that active source's last readable slice; it never inserts DC articles or changes an old article's creation date. Damoang's explicitly marked today/minute timestamps are refined with the body's full JSON-LD creation time.

The homepage selects up to ten latest readable posts per board, first limiting each community to four slots and then filling unused slots on quiet boards. Selected posts remain ordered by actual publication time. The upward rolling interval and progress indicator are 1.5 seconds; focus/hover/touch pause and reduced motion remain.

Headline clicks open `/community/{board}?post_id=...&snapshot=...` in the current tab. `/entry` resolves the chosen article from an immutable snapshot; after expiration it reconstructs a URL only from an active provider's validated numeric ID and reads public metadata/body. It never accepts arbitrary visitor URLs, changes the latest board feed to a single article, or silently replaces a missing article with another one. Refresh/back/forward preserve article identity. Original links remain an explicit secondary action. New-source comments are explicitly marked as available at the original provider; an unsupported comment adapter is not presented as zero comments or a temporary failure.

Mobile reader height accounts for the existing sticky header/top rail and bottom navigation so the close button and text remain reachable. Neon tokens and existing reading components are reused. No member data, database schema, stored posts, DB files or backups are modified.

Validation: isolated provider parsing/identity/router tests; mocked desktop/mobile UI tests for internal reading, expired snapshots, refresh/back navigation and close; 1.5-second rolling, pause, keyboard, reduced motion and seven viewport widths; TypeScript/Vite build. Live-source probes are read-only and do not run app startup or connect to a DB. Production source availability is verified separately after deployment.
