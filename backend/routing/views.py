import logging

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .serializers import HeatmapRequestSerializer, PlanRequestSerializer
from .services import corridor, geocoding, planner
from .services.osrm import NoRouteError, RoutingError
from .services.weather import WeatherError

log = logging.getLogger(__name__)


def _upstream_error(exc: Exception) -> Response:
    log.warning("upstream failure: %s", exc)
    return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(["GET"])
def health(request):
    return Response({"status": "ok"})


@api_view(["GET"])
def geocode(request):
    q = request.query_params.get("q", "").strip()
    if len(q) < 2:
        return Response({"results": []})
    try:
        return Response({"results": geocoding.search(q[:200])})
    except geocoding.GeocodingError as exc:
        return _upstream_error(exc)


@api_view(["POST"])
def plan(request):
    s = PlanRequestSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    v = s.validated_data
    try:
        result = planner.plan_trip(
            origin=(v["origin"]["lon"], v["origin"]["lat"]),
            destination=(v["destination"]["lon"], v["destination"]["lat"]),
            departure=v["departure"],
            load_lb=v["load_lb"],
            interval_mi=int(v["interval_mi"]),
        )
    except NoRouteError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
    except (RoutingError, WeatherError) as exc:
        return _upstream_error(exc)
    return Response(result)


@api_view(["POST"])
def heatmap(request):
    s = HeatmapRequestSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    v = s.validated_data
    lines = [[(p[0], p[1]) for p in line] for line in v["lines"]]
    try:
        return Response(corridor.heatmap(lines, v["departure"], v["load_lb"]))
    except WeatherError as exc:
        return _upstream_error(exc)
