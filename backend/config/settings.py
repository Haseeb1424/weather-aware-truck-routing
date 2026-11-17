"""Django settings. Everything deploy-specific comes from environment variables."""

import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env_bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).lower() in ("1", "true", "yes")


def env_list(name: str, default: str = "") -> list[str]:
    return [v.strip() for v in os.getenv(name, default).split(",") if v.strip()]


DEBUG = env_bool("DJANGO_DEBUG", False)
# The app signs nothing (no sessions, logins or cookies), so a per-process random
# key is safe when none is configured — deploys work with zero setup.
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY") or secrets.token_urlsafe(50)

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
if render_host := os.getenv("RENDER_EXTERNAL_HOSTNAME"):
    ALLOWED_HOSTS.append(render_host)
if os.getenv("VERCEL"):
    # Production, preview and branch URLs are all *.vercel.app; a custom domain
    # can be added through DJANGO_ALLOWED_HOSTS.
    ALLOWED_HOSTS.append(".vercel.app")
CSRF_TRUSTED_ORIGINS = [
    f"https://*{h}" if h.startswith(".") else f"https://{h}"
    for h in ALLOWED_HOSTS
    if h not in ("localhost", "127.0.0.1")
]

# The app is stateless: no models, no auth, no sessions — so no database.
INSTALLED_APPS = [
    "corsheaders",
    "rest_framework",
    "routing",
]
DATABASES = {}

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.gzip.GZipMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": False,
        "OPTIONS": {},
    }
]

# The React build is served by Django in production (one service, no CORS).
FRONTEND_DIST = Path(os.getenv("FRONTEND_DIST", BASE_DIR.parent / "frontend" / "dist"))
STATIC_URL = "static/"
WHITENOISE_ROOT = FRONTEND_DIST if FRONTEND_DIST.exists() else None
WHITENOISE_MAX_AGE = 3600
WHITENOISE_IMMUTABLE_FILE_TEST = r"^/assets/"  # Vite's content-hashed bundles

CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "http://localhost:5173")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": [],
    "UNAUTHENTICATED_USER": None,
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.AnonRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"anon": os.getenv("API_RATE_LIMIT", "120/min")},
}

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "OPTIONS": {"MAX_ENTRIES": 20_000},
    }
}

USE_TZ = True
TIME_ZONE = "UTC"
LANGUAGE_CODE = "en-us"

# External services (all keyless by default)
OSRM_URL = os.getenv("OSRM_URL", "https://router.project-osrm.org").rstrip("/")
OPEN_METEO_URL = os.getenv("OPEN_METEO_URL", "https://api.open-meteo.com/v1/forecast")
OPEN_METEO_API_KEY = os.getenv("OPEN_METEO_API_KEY", "")
PHOTON_URL = os.getenv("PHOTON_URL", "https://photon.komoot.io/api/")
HTTP_TIMEOUT_S = float(os.getenv("HTTP_TIMEOUT_S", "20"))
HTTP_USER_AGENT = os.getenv("HTTP_USER_AGENT", "weather-aware-truck-routing/1.0")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": os.getenv("LOG_LEVEL", "INFO")},
}

if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_CONTENT_TYPE_NOSNIFF = True
