"""Canonical public-site identity shared by SEO, notifications, and redirects."""

import os
from urllib.parse import urlparse


PRIMARY_SITE_URL = os.environ.get("SITE_URL", "https://kospimap.com").rstrip("/")
PRIMARY_SITE_HOST = urlparse(PRIMARY_SITE_URL).hostname or "kospimap.com"
LEGACY_RENDER_HOST = "kospi-predictor.onrender.com"
