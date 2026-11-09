"""The pulse board is a monitored page: its node and calls resolve against real routes."""
from fastapi import FastAPI

from app.routers.market_map import router
from app.services import site_graph


def test_pulse_board_node_reaches_the_three_maps_and_logo_proxy():
    app = FastAPI()
    app.include_router(router, prefix="/api/market")
    graph = site_graph.build_graph(app.routes)
    node = next(node for node in graph["nodes"] if node["id"] == "page:/pulse-board")
    assert node["label"] == "증시 전광판" and node["path"] == "/pulse-board"
    targets = {edge["target"] for edge in graph["edges"] if edge["source"] == "page:/pulse-board"}
    for path in ("/api/market/map", "/api/market/kosdaq-map", "/api/market/nasdaq100-map", "/api/market/us-logo/{ticker}"):
        assert f"api:{path}" in targets
    assert not any("pulse-board" in warning and any(path in warning for path in ("/map", "us-logo")) for warning in graph["warnings"])
