from fastapi import APIRouter, HTTPException
from app.services.asset_prices import ASSETS, get_asset_history

router = APIRouter()


def history(asset: str):
    try:
        return get_asset_history(asset)
    except KeyError:
        raise HTTPException(status_code=404, detail="지원하지 않는 자산입니다.") from None
    except RuntimeError:
        raise HTTPException(status_code=503, detail="일별 시세 제공처에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.") from None


def _endpoint(asset: str):
    def asset_history():
        return history(asset)
    asset_history.__name__ = f"history_{asset.replace('-', '_')}"
    return asset_history


# Seven bounded routes give API latency/error monitors a separate series per asset.
for _asset in ASSETS:
    router.add_api_route(f"/{_asset}/history", _endpoint(_asset), methods=["GET"])
