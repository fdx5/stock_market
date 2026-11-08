"""Compatibility entry point; publishes the complete static asset set."""
import sys
from pathlib import Path
from publish_static_assets import publish

if __name__ == "__main__":
    publish(Path(sys.argv[1]).resolve())
