from django.conf import settings
from django.http import FileResponse, Http404
from django.urls import include, path, re_path


def spa(request, path=""):
    """Serve the React app for any non-API route (client-side routing)."""
    index = settings.FRONTEND_DIST / "index.html"
    if not index.exists():
        raise Http404("Frontend not built. Run `npm run build` in frontend/ or use the Vite dev server.")
    return FileResponse(index.open("rb"), content_type="text/html")


urlpatterns = [
    path("api/", include("routing.urls")),
    re_path(r"^(?!api/).*$", spa),
]
