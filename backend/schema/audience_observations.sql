-- Owner-applied, additive schema. The runtime account only needs SELECT + INSERT
-- on this table, not schema ownership or permissions to change existing rows.
CREATE TABLE IF NOT EXISTS audience_observations (
    day TEXT NOT NULL,
    browser TEXT NOT NULL,
    session TEXT NOT NULL,
    network TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    location_source TEXT NOT NULL DEFAULT 'unknown',
    PRIMARY KEY (day, browser, session, network, country, region, city, location_source)
);
CREATE INDEX IF NOT EXISTS idx_audience_browser_day ON audience_observations(browser, day);
