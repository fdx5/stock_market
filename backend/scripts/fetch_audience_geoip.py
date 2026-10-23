"""Build-time public DB-IP City Lite download, CC BY 4.0. Never overwrite a DB.

No visitor IP, credential or operational database is involved in this download.
"""
import gzip
import shutil
import sys
import requests
from pathlib import Path

target = Path(sys.argv[1])
target.parent.mkdir(parents=True, exist_ok=True)
url = "https://download.db-ip.com/free/dbip-city-lite-2026-10.mmdb.gz"
with requests.get(url, timeout=(10, 90), stream=True, headers={"User-Agent": "Mozilla/5.0"}) as response:
    response.raise_for_status()
    with gzip.GzipFile(fileobj=response.raw) as compressed, target.open("xb") as output:
        shutil.copyfileobj(compressed, output, length=1024 * 1024)
import maxminddb
with maxminddb.open_database(str(target)) as reader:
    assert reader.metadata().database_type
print("DB-IP City Lite 2026-10 ready; attribution: https://db-ip.com")
