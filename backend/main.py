from __future__ import annotations

import asyncio
import base64
import hashlib
import html
import ipaddress
import json
import os
import re
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode
from xml.etree import ElementTree

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field
from pymongo import ASCENDING, DESCENDING, MongoClient, ReturnDocument, UpdateOne


ROOT_DIR = Path(__file__).resolve().parents[1]
PUBLIC_DIR = ROOT_DIR / "public"
MONGODB_URI = os.getenv(
    "MONGODB_URI",
    "mongodb://127.0.0.1:27017",
)
MONGODB_DB_NAME = os.getenv("MONGODB_DB", "gods_eye")
MONGODB_TIMEOUT_MS = int(os.getenv("MONGODB_TIMEOUT_MS", "5000"))

SOURCE_TIMEOUT_SECONDS = 16
AI_TIMEOUT_SECONDS = 45
EVENT_CACHE_TTL = 60
CHAT_NEWS_CACHE_TTL = 5 * 60
FLIGHT_CACHE_TTL = 15 * 60
MILITARY_CACHE_TTL = 2 * 60
MAX_STORED_EVENTS_PER_TREND = 4000
MAX_ANALYST_EVENTS_PER_TREND = 900
MAX_TOP_EVENTS_FOR_CHAT = 120

HTTP_HEADERS = {
    "User-Agent": "GOD-EYE-v2-OSINT-Dashboard/2.0 (student project; public-source monitoring)"
}

OSINT_CATEGORY_WEIGHTS = {
    "military": 28,
    "geopolitical": 24,
    "cyber": 23,
    "energy": 20,
    "economic": 18,
    "news": 8,
}

NATURAL_CATEGORIES = {
    "earthquake", "wildfire", "storm", "volcano", "flood", "landslide", "drought",
    "dust", "snow", "ice", "weather", "disaster", "manmade",
}

ANALYST_KEYWORDS = [
    "missile", "drone", "air strike", "troops", "naval", "border", "sanction", "ceasefire",
    "embassy", "election", "protest", "coup", "nuclear", "ransomware", "cyberattack",
    "data breach", "pipeline", "power grid", "shipping", "oil", "central bank", "inflation",
    "currency", "trade", "supply chain", "evacuation", "blackout",
]

CHAT_STOPWORDS = {
    "about", "after", "again", "also", "analysis", "analyst", "brief", "check", "current",
    "daily", "data", "from", "give", "have", "important", "incident", "intel", "intelligence",
    "latest", "make", "more", "nation", "news", "only", "please", "regarding", "related",
    "relation", "report", "reported", "reports", "show", "situation", "specific", "specified",
    "status", "summary", "tell", "thing", "trend", "update", "what", "where", "which", "with",
}

REPORT_TEMPLATES = {
    "executive": {
        "label": "Executive Brief",
        "structure": "Executive Summary, Priority Judgments, Key Developments, Hotspots, Confidence, Collection Gaps, Suggested Next Actions",
        "emphasis": "short decision-ready judgments, strongest signals, and what leadership should watch next",
    },
    "military": {
        "label": "Military SITREP",
        "structure": "Executive Summary, Force/Activity Indicators, Theater Hotspots, Escalation Indicators, Confidence, Collection Gaps, Suggested Next Actions",
        "emphasis": "military movement, border activity, strikes, naval/air activity, defense posture, and escalation risk",
    },
    "geopolitical": {
        "label": "Geopolitical Risk",
        "structure": "Executive Summary, Political Developments, Actor Positions, Regional Hotspots, Confidence, Collection Gaps, Suggested Next Actions",
        "emphasis": "state behavior, diplomacy, sanctions, elections, protests, alliances, and regional stability",
    },
    "economic": {
        "label": "Economic Impact",
        "structure": "Executive Summary, Market/Energy Signals, Trade and Supply Chain Risk, Geographic Exposure, Confidence, Collection Gaps, Suggested Next Actions",
        "emphasis": "energy, markets, trade routes, sanctions, supply chains, currency, inflation, and economic disruption",
    },
    "cyber": {
        "label": "Cyber/Security Brief",
        "structure": "Executive Summary, Cyber/Security Developments, Targeted Sectors, Operational Impact, Confidence, Collection Gaps, Suggested Next Actions",
        "emphasis": "cyber incidents, outages, data exposure, ransomware, critical infrastructure, and security impact",
    },
    "daily": {
        "label": "Daily Intelligence Summary",
        "structure": "Executive Summary, Top Developments, Watchlist, Hotspots, Confidence, Collection Gaps, Next 24 Hours",
        "emphasis": "broad daily situational awareness across geopolitical, military, economic, cyber, and disaster signals",
    },
}

app = FastAPI(
    title="GOD EYE v2 Threat Intelligence Correlation Platform",
    version="2.0.0",
    description="FastAPI backend for live OSINT feeds, IOC correlation, history, trends, and analyst chat."
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"]
)

cache: dict[str, dict[str, Any]] = {}
refreshing_event_ranges: set[str] = set()

RANGE_PROFILES = {
    "24h": {"days": 1, "usgs_feed": "all_day", "gdelt_timespan": "24h"},
    "7d": {"days": 7, "usgs_feed": "2.5_week", "gdelt_timespan": "7d"},
    "30d": {"days": 30, "usgs_feed": "4.5_month", "gdelt_timespan": "30d"},
    "90d": {"days": 90, "usgs_feed": "4.5_month", "gdelt_timespan": "3months"},
}

TRAFFIC_REGIONS = {
    "global": {"label": "Global", "flight_box": None},
    "north-america": {"label": "North America", "flight_box": [24, -130, 55, -60]},
    "europe": {"label": "Europe", "flight_box": [35, -12, 62, 35]},
    "middle-east": {"label": "Middle East", "flight_box": [12, 34, 36, 62]},
    "india": {"label": "India", "flight_box": [5, 65, 32, 92]},
    "indo-pacific": {"label": "Indo-Pacific", "flight_box": [-12, 95, 38, 150]},
}

RSS_FEEDS = [
    {
        "key": "gdacs",
        "source": "GDACS Disaster Alerts",
        "category": "disaster",
        "sourceType": "official",
        "url": "https://www.gdacs.org/xml/rss.xml",
        "maxrecords": 80,
    },
    {
        "key": "defense",
        "source": "Defense.gov News",
        "category": "military",
        "sourceType": "official",
        "url": "https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=50",
        "maxrecords": 50,
    },
    {
        "key": "fema",
        "source": "FEMA Updates",
        "category": "disaster",
        "sourceType": "official",
        "url": "https://www.fema.gov/about/news-multimedia/press-releases/rss",
        "maxrecords": 40,
    },
]

BASE_RSS_FEED_COUNT = len(RSS_FEEDS)

SHADOWBROKER_RSS_FEEDS = [
    {
        "key": "shadowbroker-npr-world",
        "source": "NPR World",
        "category": "news",
        "sourceType": "media",
        "url": "https://feeds.npr.org/1004/rss.xml",
        "maxrecords": 35,
    },
    {
        "key": "shadowbroker-bbc-world",
        "source": "BBC World",
        "category": "geopolitical",
        "sourceType": "media",
        "url": "https://feeds.bbci.co.uk/news/world/rss.xml",
        "maxrecords": 45,
    },
    {
        "key": "shadowbroker-aljazeera",
        "source": "Al Jazeera",
        "category": "geopolitical",
        "sourceType": "media",
        "url": "https://www.aljazeera.com/xml/rss/all.xml",
        "maxrecords": 45,
    },
    {
        "key": "shadowbroker-guardian-world",
        "source": "Guardian World",
        "category": "geopolitical",
        "sourceType": "media",
        "url": "https://www.theguardian.com/world/rss",
        "maxrecords": 35,
    },
    {
        "key": "shadowbroker-war-zone",
        "source": "The War Zone",
        "category": "military",
        "sourceType": "specialist",
        "url": "https://www.twz.com/feed",
        "maxrecords": 35,
    },
    {
        "key": "shadowbroker-bellingcat",
        "source": "Bellingcat",
        "category": "geopolitical",
        "sourceType": "investigative",
        "url": "https://www.bellingcat.com/feed/",
        "maxrecords": 35,
    },
    {
        "key": "shadowbroker-defense-news",
        "source": "Defense News",
        "category": "military",
        "sourceType": "specialist",
        "url": "https://www.defensenews.com/arc/outboundfeeds/rss/",
        "maxrecords": 35,
    },
    {
        "key": "shadowbroker-diplomat",
        "source": "The Diplomat",
        "category": "geopolitical",
        "sourceType": "regional-specialist",
        "url": "https://thediplomat.com/feed/",
        "maxrecords": 35,
    },
    {
        "key": "shadowbroker-scmp",
        "source": "SCMP",
        "category": "geopolitical",
        "sourceType": "regional-media",
        "url": "https://www.scmp.com/rss/91/feed",
        "maxrecords": 35,
    },
    {
        "key": "shadowbroker-yonhap",
        "source": "Yonhap",
        "category": "geopolitical",
        "sourceType": "regional-media",
        "url": "https://en.yna.co.kr/RSS/news.xml",
        "maxrecords": 35,
    },
    {
        "key": "shadowbroker-asia-times",
        "source": "Asia Times",
        "category": "geopolitical",
        "sourceType": "regional-media",
        "url": "https://asiatimes.com/feed/",
        "maxrecords": 35,
    },
    {
        "key": "shadowbroker-france24",
        "source": "France 24",
        "category": "geopolitical",
        "sourceType": "media",
        "url": "https://www.france24.com/en/rss",
        "maxrecords": 35,
    },
    {
        "key": "shadowbroker-dw",
        "source": "DW World",
        "category": "geopolitical",
        "sourceType": "media",
        "url": "https://rss.dw.com/xml/rss-en-world",
        "maxrecords": 35,
    },
]

RSS_FEEDS.extend(SHADOWBROKER_RSS_FEEDS)

GOOGLE_NEWS_FEEDS = [
    {
        "key": "google-military",
        "source": "Google News Military OSINT",
        "category": "military",
        "query": "military OR missile OR drone OR troops OR defense OR navy OR air force",
        "maxrecords": 100,
    },
    {
        "key": "google-geopolitical",
        "source": "Google News Geopolitical OSINT",
        "category": "geopolitical",
        "query": "sanctions OR diplomacy OR protest OR border OR ceasefire OR election OR summit",
        "maxrecords": 100,
    },
    {
        "key": "google-economic",
        "source": "Google News Economic OSINT",
        "category": "economic",
        "query": "economy OR inflation OR central bank OR trade OR sanctions OR oil prices OR recession OR currency",
        "maxrecords": 100,
    },
    {
        "key": "google-cyber",
        "source": "Google News Cyber Incident OSINT",
        "category": "cyber",
        "query": "cyberattack OR ransomware OR data breach OR outage OR malware OR phishing",
        "maxrecords": 100,
    },
    {
        "key": "google-energy",
        "source": "Google News Energy Security OSINT",
        "category": "energy",
        "query": "energy security OR oil refinery OR gas pipeline OR power grid OR shipping disruption",
        "maxrecords": 100,
    },
    {
        "key": "google-conflict-hotspots",
        "source": "Google News Conflict Hotspots",
        "category": "geopolitical",
        "query": "(Ukraine OR Gaza OR Taiwan OR Red Sea OR Iran OR South China Sea OR Kashmir OR Sudan) (military OR sanctions OR ceasefire OR drone OR missile)",
        "maxrecords": 100,
    },
    {
        "key": "google-maritime-security",
        "source": "Google News Maritime Security",
        "category": "military",
        "query": "Red Sea OR Strait of Hormuz OR South China Sea OR maritime security OR naval deployment OR shipping attack",
        "maxrecords": 100,
    },
    {
        "key": "google-election-risk",
        "source": "Google News Election Risk",
        "category": "geopolitical",
        "query": "election unrest OR political crisis OR protest OR coup OR emergency powers OR disputed election",
        "maxrecords": 100,
    },
    {
        "key": "google-global-security",
        "source": "Google News Global Security",
        "category": "geopolitical",
        "query": "security crisis OR armed conflict OR diplomatic crisis OR emergency meeting OR intelligence warning",
        "maxrecords": 100,
    },
    {
        "key": "google-south-asia",
        "source": "Google News South Asia Watch",
        "category": "geopolitical",
        "query": "India OR Pakistan OR Bangladesh OR Sri Lanka OR Nepal OR Afghanistan military OR border OR election OR protest OR economy",
        "maxrecords": 100,
    },
    {
        "key": "google-middle-east",
        "source": "Google News Middle East Watch",
        "category": "geopolitical",
        "query": "Iran OR Israel OR Gaza OR Lebanon OR Syria OR Iraq OR Yemen military OR missile OR sanctions OR ceasefire",
        "maxrecords": 100,
    },
    {
        "key": "google-europe-russia",
        "source": "Google News Europe Russia Watch",
        "category": "geopolitical",
        "query": "Russia OR Ukraine OR NATO OR Europe sanctions OR missile OR drone OR energy security",
        "maxrecords": 100,
    },
    {
        "key": "google-indo-pacific",
        "source": "Google News Indo-Pacific Watch",
        "category": "military",
        "query": "China OR Taiwan OR South China Sea OR Philippines OR Japan OR Korea military OR navy OR air force",
        "maxrecords": 100,
    },
    {
        "key": "google-africa-security",
        "source": "Google News Africa Security Watch",
        "category": "geopolitical",
        "query": "Sudan OR Sahel OR Nigeria OR Ethiopia OR Congo coup OR conflict OR military OR election OR protest",
        "maxrecords": 100,
    },
    {
        "key": "google-defense-industry",
        "source": "Google News Defense Industry",
        "category": "military",
        "query": "defense contract OR weapons delivery OR arms sale OR military aid OR missile system OR drone program",
        "maxrecords": 100,
    },
]

GDELT_FEEDS = [
    {
        "key": "osint-news",
        "source": "GDELT OSINT News",
        "category": "news",
        "query": "(military OR missile OR sanctions OR protest OR earthquake OR wildfire OR flood OR volcano)",
        "maxrecords": 250,
    },
    {
        "key": "gdelt-military",
        "source": "GDELT Military Watch",
        "category": "military",
        "query": "(military OR missile OR drone OR troops OR navy OR airstrike OR border clash)",
        "maxrecords": 250,
    },
    {
        "key": "gdelt-economic",
        "source": "GDELT Economic Watch",
        "category": "economic",
        "query": "(inflation OR recession OR central bank OR sanctions OR supply chain OR oil prices OR currency crisis)",
        "maxrecords": 250,
    },
    {
        "key": "gdelt-cyber",
        "source": "GDELT Cyber Incident Watch",
        "category": "cyber",
        "query": "(cyberattack OR ransomware OR data breach OR malware OR phishing OR outage)",
        "maxrecords": 250,
    },
    {
        "key": "gdelt-hotspots",
        "source": "GDELT Geopolitical Hotspots",
        "category": "geopolitical",
        "query": "(Ukraine OR Gaza OR Taiwan OR Red Sea OR Iran OR South China Sea OR Kashmir OR Sudan) (military OR sanctions OR ceasefire OR missile OR drone OR naval)",
        "maxrecords": 250,
    },
    {
        "key": "gdelt-energy-security",
        "source": "GDELT Energy Security Watch",
        "category": "energy",
        "query": "(oil OR gas OR pipeline OR refinery OR power grid OR electricity OR LNG OR shipping) (attack OR disruption OR sanctions OR strike OR outage)",
        "maxrecords": 250,
    },
    {
        "key": "gdelt-market-risk",
        "source": "GDELT Market Risk Watch",
        "category": "economic",
        "query": "(central bank OR inflation OR currency OR sovereign debt OR trade OR tariff OR supply chain OR recession)",
        "maxrecords": 250,
    },
    {
        "key": "gdelt-global-security",
        "source": "GDELT Global Security Wide",
        "category": "geopolitical",
        "query": "(security OR crisis OR conflict OR protest OR sanctions OR diplomacy OR election OR unrest)",
        "maxrecords": 250,
    },
    {
        "key": "gdelt-south-asia",
        "source": "GDELT South Asia Watch",
        "category": "geopolitical",
        "query": "(India OR Pakistan OR Bangladesh OR Sri Lanka OR Nepal OR Afghanistan) (military OR border OR protest OR election OR trade OR economy)",
        "maxrecords": 250,
    },
    {
        "key": "gdelt-middle-east",
        "source": "GDELT Middle East Watch",
        "category": "geopolitical",
        "query": "(Iran OR Israel OR Gaza OR Lebanon OR Syria OR Iraq OR Yemen) (missile OR drone OR sanctions OR ceasefire OR military)",
        "maxrecords": 250,
    },
    {
        "key": "gdelt-europe-russia",
        "source": "GDELT Europe Russia Watch",
        "category": "geopolitical",
        "query": "(Russia OR Ukraine OR NATO OR Europe) (sanctions OR missile OR drone OR energy OR military)",
        "maxrecords": 250,
    },
    {
        "key": "gdelt-indo-pacific",
        "source": "GDELT Indo-Pacific Watch",
        "category": "military",
        "query": "(China OR Taiwan OR South China Sea OR Philippines OR Japan OR Korea) (military OR navy OR missile OR air force)",
        "maxrecords": 250,
    },
    {
        "key": "gdelt-africa-security",
        "source": "GDELT Africa Security Watch",
        "category": "geopolitical",
        "query": "(Sudan OR Sahel OR Nigeria OR Ethiopia OR Congo) (conflict OR coup OR military OR protest OR election)",
        "maxrecords": 250,
    },
    {
        "key": "gdelt-defense-industry",
        "source": "GDELT Defense Industry Watch",
        "category": "military",
        "query": "(defense contract OR weapons delivery OR arms sale OR military aid OR missile system OR drone program)",
        "maxrecords": 250,
    },
]

COUNTRY_CENTROIDS = {
    "AF": [33.9391, 67.71], "AU": [-25.2744, 133.7751], "BD": [23.685, 90.3563],
    "BR": [-14.235, -51.9253], "CA": [56.1304, -106.3468], "CN": [35.8617, 104.1954],
    "DE": [51.1657, 10.4515], "EG": [26.8206, 30.8025], "ES": [40.4637, -3.7492],
    "FR": [46.2276, 2.2137], "GB": [55.3781, -3.436], "GR": [39.0742, 21.8243],
    "ID": [-0.7893, 113.9213], "IL": [31.0461, 34.8516], "IN": [20.5937, 78.9629],
    "IR": [32.4279, 53.688], "IQ": [33.2232, 43.6793], "IT": [41.8719, 12.5674],
    "JP": [36.2048, 138.2529], "KR": [35.9078, 127.7669], "KP": [40.3399, 127.5101],
    "LB": [33.8547, 35.8623], "LK": [7.8731, 80.7718], "MM": [21.9162, 95.956],
    "MX": [23.6345, -102.5528], "NP": [28.3949, 84.124], "NL": [52.1326, 5.2913],
    "PK": [30.3753, 69.3451], "PS": [31.9522, 35.2332], "RU": [61.524, 105.3188],
    "SA": [23.8859, 45.0792], "SD": [12.8628, 30.2176], "SY": [34.8021, 38.9968],
    "TR": [38.9637, 35.2433], "TW": [23.6978, 120.9605], "UA": [48.3794, 31.1656],
    "US": [37.0902, -95.7129], "VE": [6.4238, -66.5897], "VN": [14.0583, 108.2772],
    "YE": [15.5527, 48.5164], "ZA": [-30.5595, 22.9375],
}

COUNTRY_NAMES = {
    "AF": "Afghanistan", "AU": "Australia", "BD": "Bangladesh", "BR": "Brazil", "CA": "Canada",
    "CN": "China", "DE": "Germany", "EG": "Egypt", "ES": "Spain", "FR": "France",
    "GB": "United Kingdom", "GR": "Greece", "ID": "Indonesia", "IL": "Israel", "IN": "India",
    "IR": "Iran", "IQ": "Iraq", "IT": "Italy", "JP": "Japan", "KR": "South Korea",
    "KP": "North Korea", "LB": "Lebanon", "LK": "Sri Lanka", "MM": "Myanmar", "MX": "Mexico",
    "NP": "Nepal", "NL": "Netherlands", "PK": "Pakistan", "PS": "Palestine", "RU": "Russia",
    "SA": "Saudi Arabia", "SD": "Sudan", "SY": "Syria", "TR": "Turkey", "TW": "Taiwan",
    "UA": "Ukraine", "US": "United States", "VE": "Venezuela", "VN": "Vietnam",
    "YE": "Yemen", "ZA": "South Africa",
}

COUNTRY_ALIASES = {
    "united states": "US", "usa": "US", "u.s.": "US", "america": "US",
    "united kingdom": "GB", "uk": "GB", "britain": "GB",
    "russia": "RU", "iran": "IR", "iraq": "IQ", "india": "IN", "china": "CN",
    "israel": "IL", "gaza": "PS", "west bank": "PS", "palestine": "PS",
    "ukraine": "UA", "syria": "SY", "lebanon": "LB", "pakistan": "PK",
    "afghanistan": "AF", "taiwan": "TW", "myanmar": "MM", "yemen": "YE",
    "north korea": "KP", "south korea": "KR", "japan": "JP", "turkey": "TR",
    "saudi arabia": "SA", "sudan": "SD", "egypt": "EG", "mexico": "MX",
    "canada": "CA", "australia": "AU", "indonesia": "ID", "brazil": "BR",
}


class IocLookupRequest(BaseModel):
    value: str = Field(..., min_length=2, max_length=2048)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)


class IncidentReportRequest(BaseModel):
    focus: str = Field("", max_length=2000)
    days: int = Field(7, ge=1, le=90)
    template: str = Field("executive", max_length=40)


@app.on_event("startup")
async def startup() -> None:
    try:
        init_db()
    except Exception as exc:
        print(f"GOD EYE startup warning: MongoDB initialization deferred: {exc}")


@app.get("/api/health")
async def health_endpoint() -> JSONResponse:
    database = database_status()
    healthy = database.get("connected") is True
    return JSONResponse(
        status_code=200 if healthy else 503,
        content={
            "ok": healthy,
            "backend": "FastAPI",
            "serverTime": utc_now(),
            "database": database,
            "cacheKeys": list(cache.keys()),
        },
    )


@app.get("/api/v2/health")
async def v2_health() -> dict[str, Any]:
    return {
        "ok": True,
        "platform": "GOD EYE v2",
        "backend": "FastAPI",
        "database": database_status(),
        "providers": provider_status(),
        "ai": ai_status(),
        "sourceCatalog": source_catalog(),
        "serverTime": utc_now(),
    }


@app.get("/api/events")
async def events(range: str = Query("7d")) -> dict[str, Any]:
    range_key = range if range in RANGE_PROFILES else "7d"
    cache_key = f"events:{range_key}"
    cached = get_cached(cache_key, EVENT_CACHE_TTL)
    if cached:
        return {**cached, "cached": True}

    stored_payload = build_stored_events_payload(range_key)
    if range_key not in refreshing_event_ranges:
        asyncio.create_task(refresh_events_cache(range_key))
    return {**stored_payload, "cached": True, "refreshing": True}


@app.get("/api/traffic/flights")
async def traffic_flights(region: str = Query("global")) -> dict[str, Any]:
    region_key = region if region in TRAFFIC_REGIONS else "global"
    cache_key = f"traffic:flights:{region_key}"
    cached = get_cached(cache_key, FLIGHT_CACHE_TTL)
    if cached:
        return {**cached, "cached": True}

    payload = await get_opensky_traffic(region_key)
    set_cached(cache_key, payload)
    return payload


@app.get("/api/traffic/military")
async def traffic_military(region: str = Query("global")) -> dict[str, Any]:
    region_key = region if region in TRAFFIC_REGIONS else "global"
    cache_key = f"traffic:military:{region_key}"
    cached = get_cached(cache_key, MILITARY_CACHE_TTL)
    if cached:
        return {**cached, "cached": True}

    payload = await get_military_traffic(region_key)
    set_cached(cache_key, payload)
    return payload


@app.get("/api/traffic/{unknown}")
async def unknown_traffic(unknown: str) -> JSONResponse:
    return JSONResponse({"ok": False, "error": f"Unknown traffic endpoint: {unknown}"}, status_code=404)


@app.post("/api/v2/ioc/lookup")
async def lookup_ioc(request: IocLookupRequest) -> dict[str, Any]:
    return await perform_ioc_lookup(request.value)


@app.get("/api/v2/ioc/history")
async def ioc_history(limit: int = Query(25, ge=1, le=200)) -> dict[str, Any]:
    rows = db().ioc_lookups.find({}, sort=[("created_at", DESCENDING)], limit=limit)
    items = []
    for row in rows:
        items.append(
            {
                "id": row["id"],
                "value": row["value"],
                "type": row["type"],
                "riskScore": row["risk_score"],
                "riskLevel": row["risk_level"],
                "verdict": row["verdict"],
                "summary": row["summary"],
                "createdAt": row["created_at"],
                "providers": row.get("providers", []),
            }
        )
    return {"ok": True, "items": items, "count": len(items)}


@app.get("/api/v2/trends")
async def trends(days: int = Query(30, ge=1, le=180)) -> dict[str, Any]:
    return {"ok": True, **build_trends(days)}


@app.get("/api/v2/report/templates")
async def report_templates() -> dict[str, Any]:
    return {"ok": True, "items": report_template_options()}


@app.get("/api/v2/shadowbroker")
async def shadowbroker_source_pack() -> dict[str, Any]:
    return {
        "ok": True,
        "name": "Shadowbroker OSINT Source Pack",
        "mode": "native GOD EYE integration",
        "licenseNote": "Adapted as a source/feature pack. Original Shadowbroker repository is AGPL-3.0; third-party data sources keep their own terms.",
        "imported": {
            "rssFeeds": len(SHADOWBROKER_RSS_FEEDS),
            "cyberFeeds": 2,
            "features": [
                "expanded military/geopolitical/world RSS collection",
                "CISA Known Exploited Vulnerabilities cyber feed",
                "abuse.ch Feodo Tracker / URLhaus cyber feed",
                "source attribution metadata",
                "server-side-only OSINT collection pattern",
            ],
        },
        "sources": source_catalog(),
        "upstream": "https://github.com/BigBodyCobain/Shadowbroker",
    }


@app.get("/api/v2/globe/config")
async def globe_config() -> dict[str, Any]:
    return {
        "ok": True,
        "name": "God's Eye View 3D Globe Companion",
        "mode": "local companion app",
        "upstream": "https://github.com/bilawalsidhu/gods-eye-view",
        "localUrl": os.getenv("GLOBE_VIEW_URL", "http://127.0.0.1:4174"),
        "googleMapsConfigured": bool(os.getenv("GOOGLE_MAPS_API_KEY")),
        "deepseekConfigured": bool(os.getenv("DEEPSEEK_API_KEY")),
        "notes": [
            "DeepSeek remains the AI engine for GOD EYE reports and chatbot analysis.",
            "Google Maps is used only by the 3D globe companion for photorealistic map tiles.",
            "Do not expose the globe server publicly until the Google key has HTTP referrer and API restrictions.",
        ],
    }


@app.get("/api/v2/report")
async def analyst_report(
    days: int = Query(7, ge=1, le=90),
    focus: str = Query("", max_length=500),
    template: str = Query("executive", max_length=40),
) -> dict[str, Any]:
    template_key = normalize_report_template(template)
    focus_text = clean_text(focus)
    snapshot = build_report_snapshot(build_trends(days), focus_text)
    report, ai_meta = await generate_analyst_report(snapshot, focus_text, template_key)
    report_id = store_analyst_report(snapshot, report, focus_text, ai_meta, template_key)
    return {
        "ok": True,
        "id": report_id,
        "generatedAt": utc_now(),
        "days": days,
        "focus": focus_text,
        "template": template_key,
        "templateLabel": REPORT_TEMPLATES[template_key]["label"],
        "report": report,
        "ai": ai_meta,
    }


@app.post("/api/v2/report")
async def custom_analyst_report(request: IncidentReportRequest) -> dict[str, Any]:
    focus = clean_text(request.focus)
    template_key = normalize_report_template(request.template)
    snapshot = build_report_snapshot(build_trends(request.days), focus)
    report, ai_meta = await generate_analyst_report(snapshot, focus, template_key)
    report_id = store_analyst_report(snapshot, report, focus, ai_meta, template_key)
    return {
        "ok": True,
        "id": report_id,
        "generatedAt": utc_now(),
        "days": request.days,
        "focus": focus,
        "template": template_key,
        "templateLabel": REPORT_TEMPLATES[template_key]["label"],
        "report": report,
        "ai": ai_meta,
    }


@app.get("/api/v2/reports/history")
async def report_history(
    limit: int = Query(25, ge=1, le=100),
    q: str = Query("", max_length=200),
    template: str = Query("", max_length=40),
) -> dict[str, Any]:
    query_text = clean_text(q).lower()
    template_filter = normalize_report_template(template) if clean_text(template) else ""
    rows = db().analyst_reports.find({}, sort=[("created_at", DESCENDING)], limit=max(limit * 3, 75))
    items = []
    for row in rows:
        raw = row.get("raw", {})
        if not isinstance(raw, dict):
            raw = {}
        item = report_library_item(row, raw)
        haystack = " ".join(
            clean_text(item.get(key)).lower()
            for key in ("title", "focus", "summary", "report", "templateLabel")
        )
        if query_text and query_text not in haystack:
            continue
        if template_filter and item.get("template") != template_filter:
            continue
        items.append(
            item
        )
        if len(items) >= limit:
            break
    return {"ok": True, "items": items, "count": len(items), "templates": report_template_options()}


@app.get("/api/v2/reports/{report_id}/pdf")
async def report_pdf(report_id: int) -> StreamingResponse:
    report = load_report_by_id(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Analyst report not found.")

    try:
        pdf_bytes = render_analyst_report_pdf(report)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    filename = safe_report_pdf_filename(report["title"], report_id)
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(BytesIO(pdf_bytes), media_type="application/pdf", headers=headers)


@app.post("/api/v2/chat")
async def analyst_chat(request: ChatRequest) -> dict[str, Any]:
    message = clean_text(request.message)
    save_chat_message("user", message)

    live_payload = await collect_news_for_query(message, days=chat_search_days(message), limit=120)
    live_events = live_payload["events"]
    if live_events:
        store_events(live_events)

    snapshot = build_trends(30)
    if wants_report(message):
        report_snapshot = build_report_snapshot(snapshot, message, extra_events=live_events)
        report, ai_meta = await generate_analyst_report(report_snapshot, message, "executive")
        report_id = store_analyst_report(report_snapshot, report, message, ai_meta, "executive")
        reply = f"{report}\n\nSaved as analyst report #{report_id}."
        save_chat_message("assistant", reply)
        return {
            "ok": True,
            "reply": reply,
            "reportId": report_id,
            "report": report,
            "liveSearch": live_payload,
            "ai": ai_meta,
            "generatedAt": utc_now(),
        }

    reports = load_recent_reports(5)
    reply, ai_meta = await build_chat_reply(message, snapshot, reports, live_events)
    save_chat_message("assistant", reply)
    return {
        "ok": True,
        "reply": reply,
        "liveSearch": live_payload,
        "ai": ai_meta,
        "generatedAt": utc_now(),
    }


@app.get("/api/v2/news/search")
async def news_search(q: str = Query(..., min_length=2, max_length=500), days: int = Query(7, ge=1, le=30), limit: int = Query(100, ge=1, le=200)) -> dict[str, Any]:
    payload = await collect_news_for_query(q, days=days, limit=limit)
    if payload["events"]:
        store_events(payload["events"])
    return {"ok": True, **payload}


async def build_events_payload(range_key: str) -> dict[str, Any]:
    profile = RANGE_PROFILES[range_key]
    started = time.perf_counter()
    jobs = [
        get_usgs_earthquakes(profile),
        get_nasa_eonet(profile),
        get_nws_alerts(),
        get_cisa_kev_events(profile),
        get_abuse_ch_threat_events(profile),
        *[get_rss_events(feed, profile) for feed in RSS_FEEDS],
        *[get_google_news_events(feed, profile) for feed in GOOGLE_NEWS_FEEDS],
        *[get_gdelt_articles(feed, profile) for feed in GDELT_FEEDS],
    ]

    results = await asyncio.gather(*jobs, return_exceptions=True)
    collected: list[dict[str, Any]] = []
    source_health: list[dict[str, Any]] = []

    for result in results:
        if isinstance(result, Exception):
            source_health.append(
                {
                    "name": "Unknown source",
                    "source": "Unknown source",
                    "ok": False,
                    "count": 0,
                    "generatedInMs": 0,
                    "error": str(result),
                    "refreshedAt": utc_now(),
                }
            )
            continue
        events_part, health_part = result
        collected.extend(events_part)
        source_health.append(health_part)

    cleaned = [clean_event(item) for item in collected]
    deduped = dedupe_events(cleaned)
    deduped.sort(key=lambda item: (item["severityScore"], parse_time(item["time"])), reverse=True)
    store_events(deduped)

    return {
        "ok": True,
        "backend": "FastAPI",
        "range": range_key,
        "refreshedAt": utc_now(),
        "generatedInMs": round((time.perf_counter() - started) * 1000),
        "sourceHealth": source_health,
        "report": build_report(deduped, source_health),
        "events": deduped,
    }


async def refresh_events_cache(range_key: str) -> None:
    if range_key in refreshing_event_ranges:
        return
    refreshing_event_ranges.add(range_key)
    try:
        payload = await build_events_payload(range_key)
        set_cached(f"events:{range_key}", payload)
    finally:
        refreshing_event_ranges.discard(range_key)


def build_stored_events_payload(range_key: str) -> dict[str, Any]:
    profile = RANGE_PROFILES[range_key]
    since = (datetime.now(timezone.utc) - timedelta(days=profile["days"])).isoformat()
    docs = db().events.find(
        {
            "$or": [
                {"time": {"$gte": since}},
                {"$and": [{"time": {"$in": [None, ""]}}, {"last_seen": {"$gte": since}}]},
            ]
        },
        {
            "_id": 0,
            "raw": 1,
            "id": 1,
            "title": 1,
            "category": 1,
            "severity": 1,
            "severity_score": 1,
            "source": 1,
            "source_type": 1,
            "time": 1,
            "area": 1,
            "lat": 1,
            "lon": 1,
            "url": 1,
            "source_credibility": 1,
            "source_credibility_label": 1,
            "duplicate_group": 1,
            "duplicate_count": 1,
            "source_count": 1,
            "sources": 1,
        },
        sort=[("time", DESCENDING), ("severity_score", DESCENDING)],
        limit=MAX_STORED_EVENTS_PER_TREND,
    )
    events_out = []
    for doc in docs:
        raw = doc.get("raw") or {}
        if raw:
            event = dict(raw)
            event.setdefault("id", doc.get("id"))
            event.setdefault("severityScore", doc.get("severity_score") or 0)
            event.setdefault("sourceType", doc.get("source_type"))
            event.setdefault("sourceCredibility", doc.get("source_credibility") or source_credibility_score(event.get("source"), event.get("sourceType")))
            event.setdefault("sourceCredibilityLabel", doc.get("source_credibility_label") or credibility_label(event.get("sourceCredibility")))
            event.setdefault("duplicateGroup", doc.get("duplicate_group") or event_duplicate_key(event))
            event.setdefault("duplicateCount", doc.get("duplicate_count") or 1)
            event.setdefault("sourceCount", doc.get("source_count") or len(doc.get("sources") or []) or 1)
            event.setdefault("sources", doc.get("sources") or ([event.get("source")] if event.get("source") else []))
        else:
            event = mongo_event_to_api(doc)
        events_out.append(event)

    events_out = dedupe_events(events_out)
    events_out.sort(key=lambda item: (int(item.get("severityScore") or 0), parse_time(item.get("time"))), reverse=True)
    source_health = [
        {
            "name": "MongoDB Atlas stored events",
            "source": "MongoDB Atlas stored events",
            "ok": True,
            "count": len(events_out),
            "generatedInMs": 0,
            "error": "",
            "refreshedAt": utc_now(),
        }
    ]
    return {
        "ok": True,
        "backend": "FastAPI",
        "range": range_key,
        "refreshedAt": utc_now(),
        "generatedInMs": 0,
        "sourceHealth": source_health,
        "report": build_report(events_out, source_health),
        "events": events_out,
    }


def mongo_event_to_api(doc: dict[str, Any]) -> dict[str, Any]:
    severity_score = int(doc.get("severity_score") or 0)
    return {
        "id": doc.get("id"),
        "title": doc.get("title") or "Untitled event",
        "summary": "",
        "category": doc.get("category") or "news",
        "severity": doc.get("severity") or risk_label(severity_score),
        "severityScore": severity_score,
        "source": doc.get("source") or "Stored event",
        "sourceType": doc.get("source_type") or "stored",
        "time": doc.get("time") or utc_now(),
        "area": doc.get("area") or "Global",
        "lat": doc.get("lat"),
        "lon": doc.get("lon"),
        "url": doc.get("url"),
        "confidence": 0.6,
        "sourceCredibility": doc.get("source_credibility") or source_credibility_score(doc.get("source"), doc.get("source_type")),
        "sourceCredibilityLabel": doc.get("source_credibility_label") or credibility_label(doc.get("source_credibility") or 0),
        "duplicateGroup": doc.get("duplicate_group"),
        "duplicateCount": doc.get("duplicate_count") or 1,
        "sourceCount": doc.get("source_count") or len(doc.get("sources") or []) or 1,
        "sources": doc.get("sources") or ([doc.get("source")] if doc.get("source") else []),
        "tags": [],
    }


async def collect_news_for_query(query_text: str, days: int = 7, limit: int = 100) -> dict[str, Any]:
    query = build_dynamic_news_query(query_text)
    if not query:
        return {"query": "", "count": 0, "events": [], "sourceHealth": [], "cached": False}

    days = clamp(days, 1, 30)
    limit = clamp(limit, 1, 200)
    cache_key = f"chat-news:{days}:{limit}:{hash_key(query)}"
    cached = get_cached(cache_key, CHAT_NEWS_CACHE_TTL)
    if cached:
        return {**cached, "cached": True}

    category = preferred_category_for_query(query_text)
    profile = {"days": days, "gdelt_timespan": f"{days}d"}
    google_feed = {
        "key": f"chat-google-{hash_key(query)}",
        "source": "Live Chat Google News",
        "category": category,
        "query": query,
        "maxrecords": limit,
    }
    gdelt_feed = {
        "key": f"chat-gdelt-{hash_key(query)}",
        "source": "Live Chat GDELT News",
        "category": category,
        "query": query,
        "maxrecords": min(250, max(limit, 120)),
    }

    results = await asyncio.gather(
        get_google_news_events(google_feed, profile),
        get_gdelt_articles(gdelt_feed, profile),
        return_exceptions=True,
    )
    collected: list[dict[str, Any]] = []
    source_health: list[dict[str, Any]] = []
    for result in results:
        if isinstance(result, Exception):
            source_health.append(
                {
                    "name": "Live chat news search",
                    "source": "Live chat news search",
                    "ok": False,
                    "count": 0,
                    "generatedInMs": 0,
                    "error": str(result),
                    "refreshedAt": utc_now(),
                }
            )
            continue
        events_part, health_part = result
        collected.extend(events_part)
        source_health.append(health_part)

    cleaned = [with_analyst_priority(clean_event(event)) for event in dedupe_events(collected)]
    cleaned.sort(
        key=lambda event: (
            int(event.get("analyst_priority") or 0),
            parse_time(event.get("time")),
        ),
        reverse=True,
    )
    payload = {
        "query": query,
        "count": len(cleaned[:limit]),
        "events": cleaned[:limit],
        "sourceHealth": source_health,
        "cached": False,
    }
    set_cached(cache_key, payload)
    return payload


async def get_cisa_kev_events(profile: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    source = "CISA Known Exploited Vulnerabilities"
    url = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
    fetched = await fetch_json(source, url)
    if not fetched["ok"]:
        return [], health(source, False, 0, fetched)

    now = datetime.now(timezone.utc)
    max_days = int(profile.get("days") or 7)
    events_out = []
    for vuln in (fetched["data"].get("vulnerabilities") or [])[:350]:
        added = parse_time(vuln.get("dateAdded"))
        if (now - added).days > max(30, max_days):
            continue
        cve = clean_text(vuln.get("cveID") or "CVE")
        vendor = clean_text(vuln.get("vendorProject") or "Unknown vendor")
        product = clean_text(vuln.get("product") or "Unknown product")
        name = clean_text(vuln.get("vulnerabilityName") or "Known exploited vulnerability")
        due = clean_text(vuln.get("dueDate") or "")
        summary = f"{vendor} {product}: {name}."
        if due:
            summary += f" CISA remediation due date {due}."
        events_out.append(
            {
                "id": f"cisa-kev:{cve}",
                "title": f"{cve} actively exploited - {vendor} {product}",
                "summary": summary,
                "category": "cyber",
                "source": source,
                "sourceType": "official",
                "severityScore": 86,
                "confidence": 0.95,
                "time": added.isoformat(),
                "updated": utc_now(),
                "area": "Global",
                "url": "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
                "tags": ["cisa-kev", "exploited-vulnerability", cve.lower(), vendor.lower()],
            }
        )
        if len(events_out) >= 80:
            break
    return events_out, health(source, True, len(events_out), fetched)


async def get_abuse_ch_threat_events(profile: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    source = "abuse.ch Threat Feeds"
    max_days = int(profile.get("days") or 7)
    jobs = [
        fetch_json("abuse.ch Feodo Tracker", "https://feodotracker.abuse.ch/downloads/ipblocklist.json"),
        fetch_json("abuse.ch URLhaus", "https://urlhaus-api.abuse.ch/v1/urls/recent/limit/100/"),
    ]
    results = await asyncio.gather(*jobs, return_exceptions=True)
    events_out: list[dict[str, Any]] = []
    errors = []

    feodo = results[0]
    if isinstance(feodo, Exception):
        errors.append(str(feodo))
    elif feodo.get("ok") and isinstance(feodo.get("data"), list):
        for index, entry in enumerate(feodo["data"][:90]):
            country_code = clean_text(entry.get("country") or "").upper()
            country = COUNTRY_NAMES.get(country_code, country_code or "Global")
            coords = COUNTRY_CENTROIDS.get(country_code)
            events_out.append(
                {
                    "id": f"abuse-feodo:{hash_key(entry)}",
                    "title": f"Botnet C2 observed: {clean_text(entry.get('malware') or 'malware')} in {country}",
                    "summary": f"Feodo Tracker lists {clean_text(entry.get('ip_address') or 'unknown host')}:{clean_text(entry.get('dst_port') or 'unknown port')} as {clean_text(entry.get('status') or 'active')} botnet/C2 infrastructure.",
                    "category": "cyber",
                    "source": "abuse.ch Feodo Tracker",
                    "sourceType": "threat-intel",
                    "severityScore": 72,
                    "confidence": 0.82,
                    "time": parse_date_or_now(entry.get("last_online") or entry.get("first_seen")),
                    "updated": utc_now(),
                    "lat": coords[0] if coords else None,
                    "lon": coords[1] if coords else None,
                    "area": country,
                    "url": "https://feodotracker.abuse.ch/",
                    "tags": ["abuse.ch", "feodo", "botnet-c2", clean_text(entry.get("malware") or "malware").lower()],
                }
            )
            if index >= 60 and max_days <= 7:
                break
    elif isinstance(feodo, dict) and not feodo.get("ok"):
        errors.append(feodo.get("error") or "Feodo fetch failed")

    urlhaus = results[1]
    if isinstance(urlhaus, Exception):
        errors.append(str(urlhaus))
    elif isinstance(urlhaus, dict) and urlhaus.get("ok"):
        for item in ((urlhaus.get("data") or {}).get("urls") or [])[:60]:
            tags = item.get("tags") or []
            tag_text = ", ".join(clean_text(tag) for tag in tags[:5]) or clean_text(item.get("threat") or "malware")
            events_out.append(
                {
                    "id": f"abuse-urlhaus:{item.get('id') or hash_key(item)}",
                    "title": f"URLhaus malware URL: {clean_text(item.get('host') or 'unknown host')}",
                    "summary": f"URLhaus recent feed reports {tag_text} with status {clean_text(item.get('url_status') or 'unknown')}.",
                    "category": "cyber",
                    "source": "abuse.ch URLhaus",
                    "sourceType": "threat-intel",
                    "severityScore": 66,
                    "confidence": 0.78,
                    "time": parse_date_or_now(item.get("dateadded")),
                    "updated": utc_now(),
                    "area": "Global",
                    "url": clean_text(item.get("url") or "https://urlhaus.abuse.ch/"),
                    "tags": ["abuse.ch", "urlhaus", *[clean_text(tag).lower() for tag in tags[:6]]],
                }
            )
    elif isinstance(urlhaus, dict) and not urlhaus.get("ok"):
        errors.append(urlhaus.get("error") or "URLhaus fetch failed")

    ok = bool(events_out) or len(errors) < 2
    fetched_meta = {"ok": ok, "ms": 0, "error": "; ".join(errors[:2]) if errors else ""}
    return events_out, health(source, ok, len(events_out), fetched_meta)


async def get_usgs_earthquakes(profile: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    source = "USGS Earthquakes"
    url = f"https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/{profile['usgs_feed']}.geojson"
    fetched = await fetch_json(source, url)
    if not fetched["ok"]:
        return [], health(source, False, 0, fetched)

    events_out = []
    for feature in fetched["data"].get("features", []):
        props = feature.get("properties") or {}
        geometry = feature.get("geometry") or {}
        coords = geometry.get("coordinates") or [None, None, None]
        mag = number_or_none(props.get("mag")) or 0
        score = earthquake_score(mag, props.get("alert"), props.get("tsunami"))
        events_out.append(
            {
                "id": f"usgs:{feature.get('id')}",
                "title": props.get("title") or "Earthquake",
                "summary": f"Magnitude {mag:g} earthquake. Depth {number_or_none(coords[2]) or 0:g} km.",
                "category": "earthquake",
                "source": source,
                "sourceType": "official",
                "severityScore": score,
                "confidence": 0.96,
                "time": to_iso(props.get("time")),
                "updated": to_iso(props.get("updated")),
                "lat": coords[1],
                "lon": coords[0],
                "area": normalize_area(props.get("place") or "Unknown"),
                "url": props.get("url"),
                "tags": ["earthquake", f"M{mag:g}"],
            }
        )
    return events_out, health(source, True, len(events_out), fetched)


async def get_nasa_eonet(profile: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    source = "NASA EONET"
    url = f"https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days={profile['days']}"
    fetched = await fetch_json(source, url)
    if not fetched["ok"]:
        return [], health(source, False, 0, fetched)

    events_out = []
    for item in fetched["data"].get("events", []):
        geometries = item.get("geometry") or []
        latest_geometry = geometries[-1] if geometries else {}
        lat, lon = centroid(latest_geometry)
        category_info = (item.get("categories") or [{}])[0]
        category = normalize_eonet_category(category_info.get("id") or category_info.get("title") or item.get("title"))
        score = natural_hazard_score(category)
        events_out.append(
            {
                "id": f"eonet:{item.get('id')}",
                "title": item.get("title") or "NASA EONET Event",
                "summary": clean_text(item.get("description") or f"Active {category.replace('-', ' ')} event tracked by NASA EONET."),
                "category": category,
                "source": source,
                "sourceType": "official",
                "severityScore": score,
                "confidence": 0.86,
                "time": parse_date_or_now(latest_geometry.get("date") or item.get("geometryDate")),
                "updated": parse_date_or_now(latest_geometry.get("date")),
                "lat": lat,
                "lon": lon,
                "area": item.get("title") or "Global",
                "url": item.get("link"),
                "tags": [category, "nasa"],
            }
        )
    return events_out, health(source, True, len(events_out), fetched)


async def get_nws_alerts() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    source = "NOAA/NWS Alerts"
    fetched = await fetch_json(source, "https://api.weather.gov/alerts/active")
    if not fetched["ok"]:
        return [], health(source, False, 0, fetched)

    events_out = []
    for feature in fetched["data"].get("features", []):
        props = feature.get("properties") or {}
        event_name = props.get("event") or "Weather Alert"
        score = nws_severity_score(props.get("severity"), props.get("urgency"), props.get("certainty"), event_name)
        lat, lon = centroid(feature.get("geometry"))
        events_out.append(
            {
                "id": f"nws:{props.get('id') or feature.get('id')}",
                "title": event_name,
                "summary": clean_text(props.get("headline") or props.get("description") or "Active weather alert."),
                "category": nws_category(event_name),
                "source": source,
                "sourceType": "official",
                "severityScore": score,
                "confidence": 0.92,
                "time": parse_date_or_now(props.get("sent") or props.get("effective")),
                "updated": parse_date_or_now(props.get("updated")),
                "expires": parse_date_or_none(props.get("expires")),
                "lat": lat,
                "lon": lon,
                "area": props.get("areaDesc") or "United States",
                "url": props.get("@id") or props.get("id"),
                "tags": ["weather", props.get("severity") or "alert"],
            }
        )
    return events_out, health(source, True, len(events_out), fetched)


async def get_rss_events(feed: dict[str, Any], profile: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    source = feed["source"]
    fetched = await fetch_text(source, feed["url"])
    if not fetched["ok"]:
        return [], health(source, False, 0, fetched)

    items = parse_rss_items(fetched["text"])[: feed["maxrecords"]]
    cutoff = datetime.now(timezone.utc) - timedelta(days=profile["days"])
    events_out = []

    for item in items:
        title = clean_text(item.get("title") or "RSS item")
        published = parse_date_or_now(item.get("pubDate") or item.get("published"))
        if parse_time(published) < cutoff:
            continue
        if feed["key"] == "gdacs":
            category = gdacs_category(item, title)
            score = gdacs_severity_score(title, item)
            area = gdacs_area(title) or infer_location(title).get("area")
        else:
            category = classify_news_category(title, feed["category"])
            score = gdelt_severity_score(category, title)
            area = infer_location(title).get("area")
        inferred = infer_location(f"{title} {item.get('description', '')}")
        events_out.append(
            {
                "id": f"{feed['key']}:{hash_key(item.get('link') or title)}",
                "title": title,
                "summary": clean_text(strip_html(item.get("description") or item.get("summary") or title))[:420],
                "category": category,
                "source": source,
                "sourceType": feed.get("sourceType", "open-source"),
                "severityScore": score,
                "confidence": 0.78 if feed["key"] == "gdacs" else 0.68,
                "time": published,
                "updated": published,
                "lat": inferred.get("lat"),
                "lon": inferred.get("lon"),
                "area": area or inferred.get("area") or "Global",
                "url": item.get("link"),
                "tags": extract_priority_keywords(title),
            }
        )
    return events_out, health(source, True, len(events_out), fetched)


async def get_google_news_events(feed: dict[str, Any], profile: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    source = feed["source"]
    query = f"{feed['query']} when:{profile['days']}d"
    url = "https://news.google.com/rss/search?" + urlencode({"q": query, "hl": "en-US", "gl": "US", "ceid": "US:en"})
    fetched = await fetch_text(source, url)
    if not fetched["ok"]:
        return [], health(source, False, 0, fetched)

    items = parse_rss_items(fetched["text"])[: feed["maxrecords"]]
    events_out = []
    for item in items:
        raw_title = clean_text(item.get("title") or "News item")
        publisher = extract_trailing_publisher(raw_title)
        title = remove_trailing_publisher(raw_title)
        category = classify_news_category(title, feed["category"])
        score = gdelt_severity_score(category, title)
        inferred = infer_location(f"{title} {item.get('description', '')}")
        published = parse_date_or_now(item.get("pubDate") or item.get("published"))
        events_out.append(
            {
                "id": f"google-news:{hash_key(item.get('link') or raw_title)}",
                "title": title,
                "summary": f"{publisher + ': ' if publisher else ''}{clean_text(strip_html(item.get('description') or title))[:360]}",
                "category": category,
                "source": publisher or source,
                "sourceType": "news",
                "severityScore": score,
                "confidence": 0.62,
                "time": published,
                "updated": published,
                "lat": inferred.get("lat"),
                "lon": inferred.get("lon"),
                "area": inferred.get("area") or "Global",
                "url": item.get("link"),
                "tags": extract_priority_keywords(title),
            }
        )
    return events_out, health(source, True, len(events_out), fetched)


async def get_gdelt_articles(feed: dict[str, Any], profile: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    source = feed["source"]
    params = {
        "query": feed["query"],
        "mode": "ArtList",
        "format": "json",
        "maxrecords": str(feed["maxrecords"]),
        "sort": "HybridRel",
        "timespan": profile["gdelt_timespan"],
    }
    url = "https://api.gdeltproject.org/api/v2/doc/doc?" + urlencode(params)
    fetched = await fetch_json(source, url)
    if not fetched["ok"]:
        return [], health(source, False, 0, fetched)

    events_out = []
    for article in fetched["data"].get("articles", [])[: feed["maxrecords"]]:
        title = clean_text(article.get("title") or "GDELT article")
        category = classify_news_category(title, feed["category"])
        inferred = infer_location(f"{title} {article.get('sourcecountry', '')}")
        source_name = clean_text(article.get("sourceCommonName") or article.get("domain") or source)
        events_out.append(
            {
                "id": f"gdelt:{hash_key(article.get('url') or title)}",
                "title": title,
                "summary": clean_text(article.get("seendate") or article.get("domain") or title),
                "category": category,
                "source": source_name,
                "sourceType": "news",
                "severityScore": gdelt_severity_score(category, title),
                "confidence": 0.64,
                "time": parse_gdelt_date(article.get("seendate")),
                "updated": parse_gdelt_date(article.get("seendate")),
                "lat": inferred.get("lat"),
                "lon": inferred.get("lon"),
                "area": inferred.get("area") or article.get("sourcecountry") or "Global",
                "url": article.get("url"),
                "tags": extract_priority_keywords(title),
            }
        )
    return events_out, health(source, True, len(events_out), fetched)


async def get_opensky_traffic(region_key: str) -> dict[str, Any]:
    region = TRAFFIC_REGIONS.get(region_key, TRAFFIC_REGIONS["global"])
    params = {"extended": "1"}
    if region["flight_box"]:
        min_lat, min_lon, max_lat, max_lon = region["flight_box"]
        params.update({"lamin": min_lat, "lomin": min_lon, "lamax": max_lat, "lomax": max_lon})
    url = "https://opensky-network.org/api/states/all?" + urlencode(params)
    source = "OpenSky Network"
    fetched = await fetch_json(source, url)
    if not fetched["ok"]:
        return await adsb_fallback_traffic("flights", "civil", region_key, region, source, fetched)

    aircraft = [
        asset for asset in (opensky_state_to_aircraft(row) for row in fetched["data"].get("states", []))
        if has_traffic_coordinates(asset)
    ][:1600]
    return traffic_payload("flights", source, region_key, region, aircraft, fetched)


async def get_military_traffic(region_key: str) -> dict[str, Any]:
    region = TRAFFIC_REGIONS.get(region_key, TRAFFIC_REGIONS["global"])
    source = "Airplanes.live Military"
    fetched = await fetch_json(source, "https://api.airplanes.live/v2/mil")
    if not fetched["ok"]:
        return await adsb_fallback_traffic("military", "military", region_key, region, source, fetched)

    aircraft = [
        asset for asset in (airplanes_live_to_aircraft(item) for item in fetched["data"].get("ac", []))
        if has_traffic_coordinates(asset) and traffic_in_region(asset, region)
    ][:1000]
    return traffic_payload("military", source, region_key, region, aircraft, fetched)


ADS_B_FALLBACK_APIS = [
    ("adsb.lol", "https://api.adsb.lol/v2"),
    ("adsb.fi", "https://opendata.adsb.fi/api/v2"),
]

ADS_B_FALLBACK_POINTS = {
    "global": [(40.0, -75.0), (34.0, -118.0), (50.0, 8.0), (25.0, 55.0), (23.0, 78.0), (1.3, 103.8), (35.0, 139.0)],
    "north-america": [(40.0, -75.0), (34.0, -118.0), (29.0, -95.0)],
    "europe": [(50.0, 8.0), (52.0, -1.0), (41.0, 12.0)],
    "middle-east": [(25.0, 55.0), (32.0, 44.0)],
    "india": [(23.0, 78.0), (13.0, 77.0), (28.0, 77.0)],
    "indo-pacific": [(1.3, 103.8), (35.0, 139.0), (-6.0, 145.0)],
}


def adsb_item_to_aircraft(item: dict[str, Any], kind: str, source_name: str) -> dict[str, Any]:
    asset = airplanes_live_to_aircraft(item)
    if kind == "civil":
        asset["type"] = "civil"
        if not clean_text(item.get("flight")):
            asset["callsign"] = item.get("hex") or "CIVIL"
            asset["label"] = item.get("r") or item.get("hex") or "CIVIL"
        asset["category"] = item.get("t") or item.get("type") or "Civil"
    asset["source"] = source_name
    return asset


async def adsb_fallback_traffic(kind: str, aircraft_type: str, region_key: str, region: dict[str, Any], failed_source: str, failed_fetch: dict[str, Any]) -> dict[str, Any]:
    for api_name, base in ADS_B_FALLBACK_APIS:
        merged: dict[str, dict[str, Any]] = {}
        ok_any = False
        if aircraft_type == "military":
            fetched = await fetch_json(api_name, f"{base}/mil")
            if fetched["ok"]:
                ok_any = True
                for item in (fetched["data"].get("ac") or [])[:1200]:
                    asset = adsb_item_to_aircraft(item, aircraft_type, api_name)
                    if has_traffic_coordinates(asset) and traffic_in_region(asset, region):
                        merged[asset["id"]] = asset
        else:
            for lat, lon in ADS_B_FALLBACK_POINTS.get(region_key, ADS_B_FALLBACK_POINTS["global"]):
                fetched = await fetch_json(api_name, f"{base}/lat/{lat}/lon/{lon}/dist/250")
                if not fetched["ok"]:
                    continue
                ok_any = True
                for item in (fetched["data"].get("ac") or [])[:400]:
                    asset = adsb_item_to_aircraft(item, aircraft_type, api_name)
                    if has_traffic_coordinates(asset) and traffic_in_region(asset, region):
                        merged[asset["id"]] = asset
        if ok_any and merged:
            aircraft = list(merged.values())[:1600 if aircraft_type == "civil" else 1000]
            payload = traffic_payload(kind, f"{api_name} (fallback)", region_key, region, aircraft, {"ok": True, "ms": 0})
            payload["fallback"] = True
            payload["originalSource"] = failed_source
            payload["fallbackReason"] = str(failed_fetch.get("error", "primary source unavailable"))[:200]
            return payload
    return traffic_error_payload(kind, failed_source, region_key, region, failed_fetch)


async def perform_ioc_lookup(value: str, triggered_by_chat: bool = False) -> dict[str, Any]:
    indicator = normalize_ioc(value)
    providers = await asyncio.gather(
        lookup_abuseipdb(indicator),
        lookup_virustotal(indicator),
        lookup_otx(indicator),
        return_exceptions=True,
    )

    normalized_providers = []
    for result in providers:
        if isinstance(result, Exception):
            normalized_providers.append(
                {
                    "provider": "Unknown",
                    "ok": False,
                    "configured": False,
                    "requiresKey": False,
                    "score": 0,
                    "summary": str(result),
                    "raw": {},
                }
            )
        else:
            normalized_providers.append(result)

    aggregate = aggregate_ioc_risk(indicator, normalized_providers)
    record = {
        "ok": True,
        "value": indicator["value"],
        "type": indicator["type"],
        "displayType": indicator["displayType"],
        "riskScore": aggregate["riskScore"],
        "riskLevel": aggregate["riskLevel"],
        "verdict": aggregate["verdict"],
        "summary": aggregate["summary"],
        "providers": normalized_providers,
        "createdAt": utc_now(),
        "triggeredByChat": triggered_by_chat,
    }
    lookup_id = store_ioc_lookup(record)
    record["id"] = lookup_id
    return record


async def lookup_abuseipdb(indicator: dict[str, Any]) -> dict[str, Any]:
    provider = "AbuseIPDB"
    key = os.getenv("ABUSEIPDB_API_KEY")
    if not key:
        return provider_missing(provider, "Set ABUSEIPDB_API_KEY to enable IP reputation checks.")
    if indicator["type"] not in {"ipv4", "ipv6"}:
        return provider_skipped(provider, "AbuseIPDB is used for IP address checks.")
    if indicator.get("private"):
        return provider_skipped(provider, "Private/reserved IP address; external reputation was skipped.")

    params = {"ipAddress": indicator["value"], "maxAgeInDays": "90"}
    headers = {**HTTP_HEADERS, "Key": key, "Accept": "application/json"}
    fetched = await fetch_json(provider, "https://api.abuseipdb.com/api/v2/check?" + urlencode(params), headers=headers)
    if not fetched["ok"]:
        return provider_failed(provider, fetched)

    data = fetched["data"].get("data", {})
    score = clamp(int(data.get("abuseConfidenceScore") or 0), 0, 100)
    reports = int(data.get("totalReports") or 0)
    country = data.get("countryCode") or "unknown country"
    return {
        "provider": provider,
        "ok": True,
        "configured": True,
        "requiresKey": False,
        "score": score,
        "status": risk_label(score),
        "summary": f"{score}/100 abuse confidence, {reports} report(s), country {country}.",
        "raw": compact_json(data),
    }


async def lookup_virustotal(indicator: dict[str, Any]) -> dict[str, Any]:
    provider = "VirusTotal"
    key = os.getenv("VIRUSTOTAL_API_KEY")
    if not key:
        return provider_missing(provider, "Set VIRUSTOTAL_API_KEY to enable VirusTotal v3 checks.")

    endpoint = virustotal_endpoint(indicator)
    if not endpoint:
        return provider_skipped(provider, "Unsupported indicator type for VirusTotal lookup.")

    headers = {**HTTP_HEADERS, "x-apikey": key}
    fetched = await fetch_json(provider, f"https://www.virustotal.com/api/v3/{endpoint}", headers=headers)
    if not fetched["ok"]:
        return provider_failed(provider, fetched)

    attributes = fetched["data"].get("data", {}).get("attributes", {})
    stats = attributes.get("last_analysis_stats") or {}
    malicious = int(stats.get("malicious") or 0)
    suspicious = int(stats.get("suspicious") or 0)
    reputation = int(attributes.get("reputation") or 0)
    score = clamp(malicious * 14 + suspicious * 8 + (12 if reputation < -5 else 0), 0, 100)
    return {
        "provider": provider,
        "ok": True,
        "configured": True,
        "requiresKey": False,
        "score": score,
        "status": risk_label(score),
        "summary": f"{malicious} malicious and {suspicious} suspicious engine result(s); reputation {reputation}.",
        "raw": compact_json({"stats": stats, "reputation": reputation, "categories": attributes.get("categories", {})}),
    }


async def lookup_otx(indicator: dict[str, Any]) -> dict[str, Any]:
    provider = "AlienVault OTX"
    key = os.getenv("OTX_API_KEY")
    if not key:
        return provider_missing(provider, "Set OTX_API_KEY to enable AlienVault OTX pulse correlation.")

    otx_type = otx_indicator_type(indicator)
    if not otx_type:
        return provider_skipped(provider, "Unsupported indicator type for OTX lookup.")

    headers = {**HTTP_HEADERS, "X-OTX-API-KEY": key}
    encoded_value = quote(indicator["value"], safe="")
    url = f"https://otx.alienvault.com/api/v1/indicators/{otx_type}/{encoded_value}/general"
    fetched = await fetch_json(provider, url, headers=headers)
    if not fetched["ok"]:
        return provider_failed(provider, fetched)

    data = fetched["data"]
    pulse_info = data.get("pulse_info") or {}
    pulses = int(pulse_info.get("count") or 0)
    score = clamp(pulses * 12, 0, 100)
    tags = data.get("validation") or []
    return {
        "provider": provider,
        "ok": True,
        "configured": True,
        "requiresKey": False,
        "score": score,
        "status": risk_label(score),
        "summary": f"{pulses} OTX pulse correlation(s) found.",
        "raw": compact_json({"pulse_info": pulse_info, "validation": tags, "sections": data.get("sections", [])}),
    }


async def fetch_json(source: str, url: str, headers: dict[str, str] | None = None) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=SOURCE_TIMEOUT_SECONDS, follow_redirects=True) as client:
            response = await client.get(url, headers=headers or HTTP_HEADERS)
            response.raise_for_status()
            return {"ok": True, "data": response.json(), "ms": round((time.perf_counter() - started) * 1000)}
    except Exception as exc:
        return {"ok": False, "source": source, "error": str(exc), "ms": round((time.perf_counter() - started) * 1000)}


async def fetch_text(source: str, url: str, headers: dict[str, str] | None = None) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=SOURCE_TIMEOUT_SECONDS, follow_redirects=True) as client:
            response = await client.get(url, headers=headers or HTTP_HEADERS)
            response.raise_for_status()
            return {"ok": True, "text": response.text, "ms": round((time.perf_counter() - started) * 1000)}
    except Exception as exc:
        return {"ok": False, "source": source, "error": str(exc), "ms": round((time.perf_counter() - started) * 1000)}


def init_db() -> None:
    database = db()
    database.command("ping")
    database.events.create_index([("time", DESCENDING), ("severity_score", DESCENDING)])
    database.events.create_index([("last_seen", DESCENDING)])
    database.events.create_index([("duplicate_group", ASCENDING)])
    database.events.create_index([("source_credibility", DESCENDING)])
    database.ioc_lookups.create_index([("created_at", DESCENDING)])
    database.provider_results.create_index([("lookup_id", ASCENDING)])
    database.chat_messages.create_index([("created_at", DESCENDING)])
    database.analyst_reports.create_index([("created_at", DESCENDING)])
    database.analyst_reports.create_index([("template", ASCENDING), ("created_at", DESCENDING)])
    ensure_counter_at_least("ioc_lookups", "ioc_lookups")
    ensure_counter_at_least("provider_results", "provider_results")
    ensure_counter_at_least("analyst_reports", "analyst_reports")
    ensure_counter_at_least("chat_messages", "chat_messages")


_mongo_client: MongoClient | None = None


def mongo_client() -> MongoClient:
    global _mongo_client
    if _mongo_client is None:
        _mongo_client = MongoClient(
            MONGODB_URI,
            serverSelectionTimeoutMS=MONGODB_TIMEOUT_MS,
            connectTimeoutMS=MONGODB_TIMEOUT_MS,
            uuidRepresentation="standard",
        )
    return _mongo_client


def db() -> Any:
    return mongo_client()[MONGODB_DB_NAME]


def database_status() -> dict[str, Any]:
    status: dict[str, Any] = {
        "engine": "mongodb",
        "name": MONGODB_DB_NAME,
        "uri": redact_mongodb_uri(MONGODB_URI),
    }
    try:
        db().command("ping")
        status["connected"] = True
    except Exception as exc:
        status["connected"] = False
        status["error"] = clean_text(exc)[:220]
    return status


def redact_mongodb_uri(uri: str) -> str:
    return re.sub(r"(mongodb(?:\+srv)?://)([^:@/]+):([^@/]+)@", r"\1***:***@", uri)


def next_sequence(name: str) -> int:
    doc = db().counters.find_one_and_update(
        {"_id": name},
        {"$inc": {"value": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return int(doc["value"])


def ensure_counter_at_least(counter_name: str, collection_name: str) -> None:
    highest = db()[collection_name].find_one({}, {"id": 1}, sort=[("id", DESCENDING)])
    if not highest:
        return
    try:
        highest_id = int(highest.get("id") or 0)
    except (TypeError, ValueError):
        return
    if highest_id <= 0:
        return
    counter = db().counters.find_one({"_id": counter_name})
    current = int((counter or {}).get("value") or 0)
    if current < highest_id:
        db().counters.update_one({"_id": counter_name}, {"$set": {"value": highest_id}}, upsert=True)


def store_events(events_in: list[dict[str, Any]]) -> None:
    now = utc_now()
    operations = []
    for event in events_in:
        event_id = str(event.get("id") or hash_key(event))
        operations.append(
            UpdateOne(
                {"_id": event_id},
                {
                    "$set": {
                        "id": event_id,
                        "title": event.get("title") or "Untitled event",
                        "summary": clean_text(event.get("summary") or ""),
                        "category": event.get("category"),
                        "severity": event.get("severity"),
                        "severity_score": int(event.get("severityScore") or event.get("severity_score") or 0),
                        "source": event.get("source"),
                        "source_type": event.get("sourceType") or event.get("source_type"),
                        "time": event.get("time"),
                        "area": event.get("area"),
                        "lat": event.get("lat"),
                        "lon": event.get("lon"),
                        "url": event.get("url"),
                        "source_credibility": int(event.get("sourceCredibility") or event.get("source_credibility") or 0),
                        "source_credibility_label": event.get("sourceCredibilityLabel") or event.get("source_credibility_label"),
                        "duplicate_group": event.get("duplicateGroup") or event.get("duplicate_group"),
                        "duplicate_count": int(event.get("duplicateCount") or event.get("duplicate_count") or 1),
                        "source_count": int(event.get("sourceCount") or event.get("source_count") or 1),
                        "sources": event.get("sources") or ([event.get("source")] if event.get("source") else []),
                        "raw": compact_json(event),
                        "last_seen": now,
                    },
                    "$setOnInsert": {"first_seen": now},
                },
                upsert=True,
            )
        )
    if operations:
        db().events.bulk_write(operations, ordered=False)


def store_ioc_lookup(record: dict[str, Any]) -> int:
    lookup_id = next_sequence("ioc_lookups")
    database = db()
    database.ioc_lookups.insert_one(
        {
            "_id": lookup_id,
            "id": lookup_id,
            "value": record["value"],
            "type": record["type"],
            "risk_score": int(record["riskScore"]),
            "risk_level": record["riskLevel"],
            "verdict": record["verdict"],
            "summary": record["summary"],
            "created_at": record["createdAt"],
            "providers": record.get("providers", []),
            "raw": compact_json(record),
        }
    )
    provider_docs = []
    for provider in record.get("providers", []):
        provider_id = next_sequence("provider_results")
        provider_docs.append(
            {
                "_id": provider_id,
                "id": provider_id,
                "lookup_id": lookup_id,
                "provider": provider["provider"],
                "ok": bool(provider.get("ok")),
                "score": int(provider.get("score") or 0),
                "status": provider.get("status"),
                "summary": provider.get("summary"),
                "raw": compact_json(provider),
            }
        )
    if provider_docs:
        database.provider_results.insert_many(provider_docs)
    return lookup_id


def store_analyst_report(snapshot: dict[str, Any], report: str, focus: str, ai_meta: dict[str, Any], template: str = "executive") -> int:
    created_at = utc_now()
    report_id = next_sequence("analyst_reports")
    template_key = normalize_report_template(template)
    title = report_title(focus, snapshot, template_key)
    summary = summarize_report(report)
    metadata = report_library_metadata(snapshot, template_key)
    record = {
        "id": report_id,
        "title": title,
        "focus": focus,
        "days": snapshot["days"],
        "template": template_key,
        "templateLabel": REPORT_TEMPLATES[template_key]["label"],
        "model": ai_meta.get("model") or "local",
        "aiProvider": ai_meta.get("provider") or "local",
        "summary": summary,
        **metadata,
        "report": report,
        "createdAt": created_at,
        "snapshot": compact_snapshot_for_ai(snapshot, event_limit=12),
        "ai": ai_meta,
    }
    db().analyst_reports.insert_one(
        {
            "_id": report_id,
            "id": report_id,
            "title": title,
            "focus": focus,
            "days": snapshot["days"],
            "template": template_key,
            "template_label": REPORT_TEMPLATES[template_key]["label"],
            "model": record["model"],
            "ai_provider": record["aiProvider"],
            "summary": summary,
            "created_at": created_at,
            "report": report,
            "snapshot": record["snapshot"],
            "ai": ai_meta,
            "tags": metadata["tags"],
            "event_count": metadata["eventCount"],
            "high_priority_count": metadata["highPriorityCount"],
            "hotspot_count": metadata["hotspotCount"],
            "top_hotspot": metadata["topHotspot"],
            "credibility": metadata["credibility"],
            "duplicate_groups": metadata["duplicateGroups"],
            "raw": compact_json(record),
        }
    )
    return report_id


def load_recent_reports(limit: int = 5) -> list[dict[str, Any]]:
    rows = db().analyst_reports.find({}, sort=[("created_at", DESCENDING)], limit=limit)
    reports = []
    for row in rows:
        raw = row.get("raw", {})
        if not isinstance(raw, dict):
            raw = {}
        report_text = recover_stored_report_text(row, raw)
        reports.append(
            {
                "id": row["id"],
                "title": row["title"],
                "focus": row["focus"],
                "days": row["days"],
                "template": row.get("template") or raw.get("template") or "executive",
                "templateLabel": row.get("template_label") or raw.get("templateLabel") or REPORT_TEMPLATES["executive"]["label"],
                "model": row["model"],
                "aiProvider": row["ai_provider"],
                "summary": row["summary"],
                "createdAt": row["created_at"],
                "report": report_text,
            }
        )
    return reports


def load_report_by_id(report_id: int) -> dict[str, Any] | None:
    row = db().analyst_reports.find_one({"id": int(report_id)})
    if not row:
        return None

    raw = row.get("raw", {})
    if not isinstance(raw, dict):
        raw = {}
    report_text = recover_stored_report_text(row, raw)
    return {
        "id": row["id"],
        "title": row["title"],
        "focus": row["focus"],
        "days": row["days"],
        "template": row.get("template") or raw.get("template") or "executive",
        "templateLabel": row.get("template_label") or raw.get("templateLabel") or REPORT_TEMPLATES["executive"]["label"],
        "model": row["model"],
        "aiProvider": row["ai_provider"],
        "summary": row["summary"],
        "createdAt": row["created_at"],
        "report": report_text,
        "snapshot": row.get("snapshot") or raw.get("snapshot", {}),
        "ai": row.get("ai") or raw.get("ai", {}),
        "tags": row.get("tags") or raw.get("tags", []),
        "eventCount": row.get("event_count") or raw.get("eventCount", 0),
        "highPriorityCount": row.get("high_priority_count") or raw.get("highPriorityCount", 0),
        "hotspotCount": row.get("hotspot_count") or raw.get("hotspotCount", 0),
        "topHotspot": row.get("top_hotspot") or raw.get("topHotspot", ""),
        "credibility": row.get("credibility") or raw.get("credibility", {}),
        "duplicateGroups": row.get("duplicate_groups") or raw.get("duplicateGroups", []),
    }


def recover_stored_report_text(row: dict[str, Any], raw: dict[str, Any]) -> str:
    for candidate in [row.get("report"), raw.get("report")]:
        text = clean_text(candidate)
        if len(text) > 80 and text.lower() != "report generated.":
            return str(candidate)

    preview_report = extract_report_from_raw_preview(raw.get("preview"))
    if preview_report:
        return preview_report

    summary = clean_text(row.get("summary"))
    if len(summary) > 120 and any(marker in summary.lower() for marker in ["executive summary", "key developments", "osint incident report"]):
        return rebuild_markdown_from_summary(summary)

    return ""


def report_library_item(row: dict[str, Any], raw: dict[str, Any]) -> dict[str, Any]:
    report_text = recover_stored_report_text(row, raw)
    template_key = normalize_report_template(row.get("template") or raw.get("template") or "executive")
    credibility = row.get("credibility") or raw.get("credibility") or {}
    return {
        "id": row["id"],
        "title": row.get("title") or "Analyst Report",
        "focus": row.get("focus") or "",
        "days": row.get("days") or raw.get("days") or 7,
        "template": template_key,
        "templateLabel": row.get("template_label") or raw.get("templateLabel") or REPORT_TEMPLATES[template_key]["label"],
        "model": row.get("model") or raw.get("model") or "local",
        "aiProvider": row.get("ai_provider") or raw.get("aiProvider") or "local",
        "summary": row.get("summary") or summarize_report(report_text),
        "createdAt": row.get("created_at") or raw.get("createdAt") or utc_now(),
        "report": report_text,
        "tags": row.get("tags") or raw.get("tags") or [],
        "eventCount": row.get("event_count") or raw.get("eventCount") or 0,
        "highPriorityCount": row.get("high_priority_count") or raw.get("highPriorityCount") or 0,
        "hotspotCount": row.get("hotspot_count") or raw.get("hotspotCount") or 0,
        "topHotspot": row.get("top_hotspot") or raw.get("topHotspot") or "",
        "credibility": credibility,
        "duplicateGroups": row.get("duplicate_groups") or raw.get("duplicateGroups") or [],
    }


def report_library_metadata(snapshot: dict[str, Any], template: str) -> dict[str, Any]:
    totals = snapshot.get("totals") or {}
    hotspots = snapshot.get("hotspots") or []
    duplicate_groups = snapshot.get("duplicateGroups") or []
    credibility = snapshot.get("sourceCredibilitySummary") or {}
    tags = build_report_tags(snapshot, template)
    return {
        "tags": tags,
        "eventCount": totals.get("events", 0),
        "highPriorityCount": totals.get("highPriority", 0),
        "hotspotCount": len(hotspots),
        "topHotspot": hotspots[0]["name"] if hotspots else "",
        "credibility": credibility,
        "duplicateGroups": duplicate_groups[:5],
    }


def build_report_tags(snapshot: dict[str, Any], template: str) -> list[str]:
    tags = [REPORT_TEMPLATES[normalize_report_template(template)]["label"]]
    tags.extend(label_for_category(category) for category in list((snapshot.get("categoryCounts") or {}).keys())[:4])
    if snapshot.get("hotspots"):
        tags.append(snapshot["hotspots"][0]["name"])
    return list(dict.fromkeys(clean_text(tag) for tag in tags if clean_text(tag)))[:8]


def normalize_report_template(template: Any) -> str:
    key = re.sub(r"[^a-z0-9-]+", "-", clean_text(template).lower()).strip("-")
    aliases = {
        "exec": "executive",
        "brief": "executive",
        "sitrep": "military",
        "military-sitrep": "military",
        "geo": "geopolitical",
        "political": "geopolitical",
        "economy": "economic",
        "market": "economic",
        "security": "cyber",
        "daily-brief": "daily",
    }
    return aliases.get(key, key) if aliases.get(key, key) in REPORT_TEMPLATES else "executive"


def report_template_options() -> list[dict[str, str]]:
    return [
        {"value": key, "label": item["label"], "emphasis": item["emphasis"]}
        for key, item in REPORT_TEMPLATES.items()
    ]


def extract_report_from_raw_preview(preview: Any) -> str:
    if not isinstance(preview, str) or '"report"' not in preview:
        return ""

    marker = '"report"'
    marker_index = preview.find(marker)
    colon_index = preview.find(":", marker_index)
    if colon_index < 0:
        return ""

    candidate = preview[colon_index + 1 :].lstrip()
    if not candidate.startswith('"'):
        return ""

    try:
        value, _ = json.JSONDecoder().raw_decode(candidate)
        return value if clean_text(value) else ""
    except json.JSONDecodeError:
        pass

    # Truncated JSON previews often cut off inside the report string. Recover the readable prefix.
    recovered = []
    escaped = False
    for char in candidate[1:]:
        if escaped:
            recovered.append({"n": "\n", "r": "\r", "t": "\t", '"': '"', "\\": "\\"}.get(char, char))
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == '"':
            break
        recovered.append(char)
    return "".join(recovered).strip()


def rebuild_markdown_from_summary(summary: str) -> str:
    text = re.sub(r"\s+-\s+##\s+", "\n\n## ", summary)
    text = re.sub(r"\s+##\s+", "\n\n## ", text)
    text = re.sub(r"\s+-\s+", "\n- ", text)
    return text.strip()


def safe_report_pdf_filename(title: str, report_id: int) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", clean_text(title).lower()).strip("-")
    slug = slug[:72].strip("-") or "intel-report"
    return f"gods-eye-report-{report_id}-{slug}.pdf"


def render_analyst_report_pdf(report: dict[str, Any]) -> bytes:
    try:
        from reportlab.lib import colors
        from reportlab.lib.enums import TA_CENTER, TA_LEFT
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.lib.units import inch
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    except ImportError as exc:
        raise RuntimeError("PDF renderer dependency missing. Run `python -m pip install -r requirements.txt` and restart the app.") from exc

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=0.62 * inch,
        rightMargin=0.62 * inch,
        topMargin=0.95 * inch,
        bottomMargin=0.66 * inch,
        title=report.get("title") or "OSINT Incident Report",
        author="GOD EYE v2",
    )

    styles = build_pdf_styles(ParagraphStyle, colors, TA_CENTER, TA_LEFT)
    story: list[Any] = []
    snapshot = report.get("snapshot") or {}
    ai_label = " / ".join(
        item
        for item in [
            clean_text(report.get("aiProvider")) or "local",
            clean_text(report.get("model")) or "rule-based",
        ]
        if item
    )

    story.append(Paragraph("GOD'S EYE V2", styles["kicker"]))
    story.append(Paragraph(pdf_inline(report.get("title") or "OSINT Incident Report"), styles["title"]))
    story.append(
        Paragraph(
            "Open-source incident intelligence report. Validate high-impact claims against primary sources, official statements, and local-language reporting before operational use.",
            styles["deck"],
        )
    )
    story.append(Spacer(1, 14))

    meta_rows = [
        ("Report ID", f"#{report.get('id', '--')}"),
        ("Generated", report.get("createdAt") or utc_now()),
        ("Window", f"Last {report.get('days') or snapshot.get('windowDays') or 7} day(s)"),
        ("Focus", report.get("focus") or "Overall open-source incident picture"),
        ("AI Engine", ai_label),
        ("Summary", report.get("summary") or summarize_report(report.get("report", ""))),
    ]
    story.append(build_pdf_meta_table(meta_rows, styles, colors, Paragraph, Table, TableStyle, inch))
    story.append(Spacer(1, 16))

    story.append(Paragraph("Intel Report", styles["section"]))
    report_body = printable_report_body(report)
    append_markdown_to_pdf_story(story, report_body, styles, Paragraph, Spacer)

    hotspots = snapshot.get("hotspots") or []
    if hotspots:
        story.append(Spacer(1, 12))
        story.append(Paragraph("Hotspot Summary", styles["section"]))
        hotspot_rows = [("Area", "Items", "Max Priority", "Categories")]
        for item in hotspots[:8]:
            hotspot_rows.append(
                (
                    clean_text(item.get("name")) or "Unknown",
                    str(item.get("count") or 0),
                    str(item.get("maxSeverity") or 0),
                    ", ".join(label_for_category(category) for category in item.get("categories", [])[:4]) or "Mixed",
                )
            )
        story.append(build_pdf_data_table(hotspot_rows, styles, colors, Paragraph, Table, TableStyle, inch))

    priority_events = snapshot.get("priorityEvents") or []
    if priority_events:
        story.append(Spacer(1, 14))
        story.append(Paragraph("Source Highlights", styles["section"]))
        story.append(
            Paragraph(
                "Priority open-source items used by the analyst context. Links are included where the feed supplied a source URL.",
                styles["body"],
            )
        )
        story.append(Spacer(1, 5))
        for event in priority_events[:10]:
            title = clean_text(event.get("title")) or "Untitled event"
            details = " | ".join(
                item
                for item in [
                    format_time_for_report(event.get("time")),
                    clean_text(event.get("area")) or "Global",
                    label_for_category(event.get("category") or "event"),
                    clean_text(event.get("source")) or "open source",
                    f"priority {event.get('severityScore') or 0}",
                ]
                if item
            )
            story.append(Paragraph(pdf_inline(title), styles["sourceTitle"]))
            story.append(Paragraph(pdf_inline(details), styles["sourceMeta"]))
            if event.get("url"):
                url = clean_text(event.get("url"))
                if len(url) > 170:
                    url = f"{url[:167]}..."
                story.append(Paragraph(pdf_inline(url), styles["sourceUrl"]))
            story.append(Spacer(1, 5))

    def draw_page(canvas: Any, document: Any) -> None:
        width, height = document.pagesize
        canvas.saveState()
        canvas.setFillColor(colors.HexColor("#06111f"))
        canvas.rect(0, height - 54, width, 54, stroke=0, fill=1)
        canvas.setFillColor(colors.HexColor("#26d9f5"))
        canvas.setFont("Helvetica-Bold", 11)
        canvas.drawString(document.leftMargin, height - 32, "GOD'S EYE V2")
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica", 8)
        canvas.drawRightString(width - document.rightMargin, height - 32, "OSINT INCIDENT INTELLIGENCE")
        canvas.setStrokeColor(colors.HexColor("#26d9f5"))
        canvas.setLineWidth(0.6)
        canvas.line(document.leftMargin, height - 56, width - document.rightMargin, height - 56)
        canvas.setFillColor(colors.HexColor("#64748b"))
        canvas.setFont("Helvetica", 7.5)
        canvas.drawString(document.leftMargin, 27, "Open-source report - verify critical claims before operational use")
        canvas.drawRightString(width - document.rightMargin, 27, f"Page {document.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=draw_page, onLaterPages=draw_page)
    return buffer.getvalue()


def printable_report_body(report: dict[str, Any]) -> str:
    body = clean_text(report.get("report", ""))
    if len(body) > 80 and body.lower() != "report generated.":
        return report.get("report", "")

    snapshot = report.get("snapshot") or {}
    priority_events = snapshot.get("priorityEvents") or []
    hotspots = snapshot.get("hotspots") or []
    totals = snapshot.get("totals") or {}

    lines = [
        "# GOD EYE v2 OSINT Incident Report",
        "",
        "## Executive Summary",
        f"- Report body was not available in the stored record, so this PDF was rebuilt from the saved MongoDB intelligence snapshot.",
    ]
    if totals:
        lines.append(f"- {totals.get('events', 0)} analyst-filtered event(s) were visible in the saved window.")
        lines.append(f"- {totals.get('highPriority', 0)} high-priority event(s) and {totals.get('critical', 0)} critical event(s) were recorded.")
    if hotspots:
        top = hotspots[0]
        lines.append(f"- Leading hotspot: {top.get('name') or 'Unknown'} with {top.get('count') or 0} item(s).")

    lines.extend(["", "## Key Developments"])
    if priority_events:
        for event in priority_events[:10]:
            lines.append(f"- {format_event_line(event)}")
    else:
        lines.append("- No source highlights were stored for this report.")

    lines.extend(["", "## Hotspots"])
    if hotspots:
        for hotspot in hotspots[:8]:
            categories = ", ".join(label_for_category(item) for item in hotspot.get("categories", [])[:4])
            lines.append(f"- {hotspot.get('name') or 'Unknown'}: {hotspot.get('count') or 0} item(s), max score {hotspot.get('maxSeverity') or 0}, categories {categories or 'mixed'}.")
    else:
        lines.append("- No geographic hotspot was stored.")

    lines.extend(
        [
            "",
            "## Collection Gaps",
            "- Validate high-impact claims against primary sources and local-language reporting.",
            "- Re-run the report after refreshing feeds to capture newer source material.",
        ]
    )
    return "\n".join(lines)


def build_pdf_styles(ParagraphStyle: Any, colors: Any, align_center: int, align_left: int) -> dict[str, Any]:
    return {
        "kicker": ParagraphStyle(
            "Kicker",
            fontName="Helvetica-Bold",
            fontSize=8.5,
            leading=10,
            textColor=colors.HexColor("#0e7490"),
            alignment=align_center,
            uppercase=True,
            spaceAfter=4,
        ),
        "title": ParagraphStyle(
            "ReportTitle",
            fontName="Helvetica-Bold",
            fontSize=22,
            leading=27,
            textColor=colors.HexColor("#0f172a"),
            alignment=align_center,
            spaceAfter=7,
        ),
        "deck": ParagraphStyle(
            "Deck",
            fontName="Helvetica",
            fontSize=9.8,
            leading=14,
            textColor=colors.HexColor("#475569"),
            alignment=align_center,
        ),
        "section": ParagraphStyle(
            "Section",
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=16,
            textColor=colors.HexColor("#0f172a"),
            borderColor=colors.HexColor("#26d9f5"),
            borderWidth=0,
            borderPadding=0,
            spaceBefore=9,
            spaceAfter=7,
        ),
        "heading": ParagraphStyle(
            "Heading",
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=14,
            textColor=colors.HexColor("#164e63"),
            spaceBefore=7,
            spaceAfter=4,
        ),
        "body": ParagraphStyle(
            "Body",
            fontName="Helvetica",
            fontSize=9.4,
            leading=13,
            textColor=colors.HexColor("#1e293b"),
            alignment=align_left,
            spaceAfter=4,
        ),
        "bullet": ParagraphStyle(
            "Bullet",
            fontName="Helvetica",
            fontSize=9.2,
            leading=12.5,
            leftIndent=14,
            firstLineIndent=-8,
            textColor=colors.HexColor("#1e293b"),
            spaceAfter=3,
        ),
        "metaLabel": ParagraphStyle(
            "MetaLabel",
            fontName="Helvetica-Bold",
            fontSize=8.2,
            leading=10,
            textColor=colors.HexColor("#164e63"),
        ),
        "metaValue": ParagraphStyle(
            "MetaValue",
            fontName="Helvetica",
            fontSize=8.4,
            leading=11,
            textColor=colors.HexColor("#1e293b"),
        ),
        "sourceTitle": ParagraphStyle(
            "SourceTitle",
            fontName="Helvetica-Bold",
            fontSize=8.9,
            leading=11.5,
            textColor=colors.HexColor("#0f172a"),
            spaceBefore=4,
        ),
        "sourceMeta": ParagraphStyle(
            "SourceMeta",
            fontName="Helvetica",
            fontSize=7.8,
            leading=10,
            textColor=colors.HexColor("#475569"),
        ),
        "sourceUrl": ParagraphStyle(
            "SourceUrl",
            fontName="Helvetica",
            fontSize=7.1,
            leading=9,
            textColor=colors.HexColor("#0369a1"),
        ),
    }


def build_pdf_meta_table(
    rows: list[tuple[str, str]],
    styles: dict[str, Any],
    colors: Any,
    Paragraph: Any,
    Table: Any,
    TableStyle: Any,
    inch: float,
) -> Any:
    table_data = [
        [Paragraph(pdf_inline(label), styles["metaLabel"]), Paragraph(pdf_inline(value), styles["metaValue"])]
        for label, value in rows
    ]
    table = Table(table_data, colWidths=[1.25 * inch, 5.05 * inch], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
                ("BOX", (0, 0), (-1, -1), 0.55, colors.HexColor("#bae6fd")),
                ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#dbeafe")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def build_pdf_data_table(
    rows: list[tuple[str, str, str, str]],
    styles: dict[str, Any],
    colors: Any,
    Paragraph: Any,
    Table: Any,
    TableStyle: Any,
    inch: float,
) -> Any:
    table_data = [
        [Paragraph(pdf_inline(cell), styles["metaLabel" if index == 0 else "metaValue"]) for cell in row]
        for index, row in enumerate(rows)
    ]
    table = Table(table_data, colWidths=[2.25 * inch, 0.7 * inch, 0.9 * inch, 2.45 * inch], hAlign="LEFT", repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e0f2fe")),
                ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#ffffff")),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#bae6fd")),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def append_markdown_to_pdf_story(story: list[Any], markdown: str, styles: dict[str, Any], Paragraph: Any, Spacer: Any) -> None:
    text = markdown or "No report body was stored for this item."
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            story.append(Spacer(1, 4))
            continue
        heading = re.match(r"^(#{1,4})\s+(.*)$", line)
        if heading:
            story.append(safe_pdf_paragraph(heading.group(2), styles["heading"], Paragraph))
            continue
        if re.match(r"^[-*]\s+", line):
            story.append(safe_pdf_paragraph(f"- {line[2:]}", styles["bullet"], Paragraph))
            continue
        numbered = re.match(r"^(\d+)\.\s+(.*)$", line)
        if numbered:
            story.append(safe_pdf_paragraph(f"{numbered.group(1)}. {numbered.group(2)}", styles["bullet"], Paragraph))
            continue
        story.append(safe_pdf_paragraph(line, styles["body"], Paragraph))


def safe_pdf_paragraph(value: Any, style: Any, Paragraph: Any) -> Any:
    try:
        return Paragraph(pdf_inline(value), style)
    except Exception:
        return Paragraph(pdf_plain(value), style)


def pdf_inline(value: Any) -> str:
    escaped = html.escape(clean_text(value), quote=False)
    escaped = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"`([^`]+)`", r'<font name="Courier">\1</font>', escaped)
    return escaped


def pdf_plain(value: Any) -> str:
    return html.escape(clean_text(value), quote=False).replace("`", "")


def build_analyst_event_view(events_in: list[dict[str, Any]], limit: int = 500) -> list[dict[str, Any]]:
    enriched = [with_analyst_priority(event) for event in events_in]
    focused = [event for event in enriched if is_analyst_focus_event(event)]
    if len(focused) < 20:
        focused = enriched
    focused.sort(
        key=lambda event: (
            int(event.get("analyst_priority") or 0),
            int(event.get("severity_score") or 0),
            parse_time(event.get("time")),
        ),
        reverse=True,
    )
    return focused[:limit]


def with_analyst_priority(event: dict[str, Any]) -> dict[str, Any]:
    copy = dict(event)
    copy["analyst_priority"] = analyst_priority_score(copy)
    copy["importance"] = risk_label(copy["analyst_priority"])
    return copy


def is_analyst_focus_event(event: dict[str, Any]) -> bool:
    category = (event.get("category") or "").lower()
    if category in OSINT_CATEGORY_WEIGHTS:
        return True
    text = event_text(event)
    if any(keyword in text for keyword in ANALYST_KEYWORDS):
        return True
    if category in NATURAL_CATEGORIES:
        score = int(event.get("severity_score") or 0)
        return score >= 88 and re.search(r"\b(evacuation|emergency|infrastructure|government|airport|port|border|power|military|economic)\b", text, re.I)
    return False


def analyst_priority_score(event: dict[str, Any]) -> int:
    category = (event.get("category") or "").lower()
    severity = int(event.get("severity_score") or 0)
    score = severity + OSINT_CATEGORY_WEIGHTS.get(category, -18 if category in NATURAL_CATEGORIES else 0)
    text = event_text(event)
    score += min(18, sum(3 for keyword in ANALYST_KEYWORDS if keyword in text))
    if (event.get("source") or "").lower() in {"defense.gov news", "gdelt military watch", "gdelt geopolitical hotspots"}:
        score += 6
    if (event.get("source_type") or event.get("sourceType") or "").lower() == "official":
        score += 3
    score += max(0, int(event.get("source_credibility") or event.get("sourceCredibility") or 50) - 50) // 8
    score += min(8, max(0, int(event.get("source_count") or event.get("sourceCount") or 1) - 1) * 3)
    hours_old = max(0, (datetime.now(timezone.utc) - parse_time(event.get("time"))).total_seconds() / 3600)
    if hours_old <= 24:
        score += 8
    elif hours_old <= 72:
        score += 4
    return clamp(score, 1, 100)


def event_text(event: dict[str, Any]) -> str:
    return " ".join(
        clean_text(event.get(key)).lower()
        for key in ("title", "summary", "category", "source", "area")
        if event.get(key)
    )


def enrich_stored_event_row(row: dict[str, Any]) -> dict[str, Any]:
    raw = row.get("raw") if isinstance(row.get("raw"), dict) else {}
    if not row.get("summary") and raw:
        row["summary"] = clean_text(raw.get("summary") or raw.get("description") or "")
    source = row.get("source") or "Unknown source"
    source_type = row.get("source_type") or row.get("sourceType") or "stored"
    credibility = int(row.get("source_credibility") or row.get("sourceCredibility") or source_credibility_score(source, source_type))
    row["source_credibility"] = credibility
    row["source_credibility_label"] = row.get("source_credibility_label") or credibility_label(credibility)
    row["duplicate_group"] = row.get("duplicate_group") or event_duplicate_key(
        {
            "title": row.get("title"),
            "area": row.get("area"),
            "time": row.get("time"),
            "category": row.get("category"),
            "url": row.get("url"),
        }
    )
    row["duplicate_count"] = int(row.get("duplicate_count") or 1)
    row["source_count"] = int(row.get("source_count") or len(row.get("sources") or []) or 1)
    row["sources"] = row.get("sources") or ([source] if source else [])
    return row


def build_source_credibility_summary(events: list[dict[str, Any]]) -> dict[str, Any]:
    source_buckets: dict[str, dict[str, Any]] = {}
    for event in events:
        source = clean_text(event.get("source") or "Unknown source")
        score = int(event.get("source_credibility") or event.get("sourceCredibility") or source_credibility_score(source, event.get("source_type")))
        bucket = source_buckets.setdefault(
            source,
            {"source": source, "score": score, "count": 0, "type": event.get("source_type") or event.get("sourceType") or "source"},
        )
        bucket["score"] = max(bucket["score"], score)
        bucket["count"] += 1

    rows = sorted(source_buckets.values(), key=lambda item: (item["score"], item["count"]), reverse=True)
    average = round(sum(item["score"] for item in rows) / len(rows)) if rows else 0
    return {
        "average": average,
        "label": credibility_label(average),
        "sourceCount": len(rows),
        "highCredibilitySources": sum(1 for item in rows if item["score"] >= 82),
        "sources": [
            {**item, "label": credibility_label(item["score"])}
            for item in rows[:10]
        ],
    }


def build_duplicate_groups(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    for event in events:
        key = event.get("duplicate_group") or event.get("duplicateGroup") or event_duplicate_key(event)
        bucket = groups.setdefault(
            key,
            {
                "key": key,
                "title": event.get("title") or "Untitled event",
                "area": event.get("area") or "Global",
                "category": event.get("category") or "news",
                "maxPriority": 0,
                "count": 0,
                "sourceCount": 0,
                "sources": set(),
                "latest": event.get("time"),
            },
        )
        bucket["count"] += int(event.get("duplicate_count") or event.get("duplicateCount") or 1)
        bucket["maxPriority"] = max(bucket["maxPriority"], int(event.get("analyst_priority") or event.get("severity_score") or event.get("severityScore") or 0))
        for source in event.get("sources") or [event.get("source")]:
            if source:
                bucket["sources"].add(source)
        bucket["sourceCount"] = max(bucket["sourceCount"], int(event.get("source_count") or event.get("sourceCount") or len(bucket["sources"]) or 1))
        if parse_time(event.get("time")) > parse_time(bucket.get("latest")):
            bucket["latest"] = event.get("time")

    output = []
    for bucket in groups.values():
        if bucket["count"] <= 1 and bucket["sourceCount"] <= 1:
            continue
        sources = sorted(bucket.pop("sources"))
        output.append({**bucket, "sources": sources[:6], "sourceCount": max(bucket["sourceCount"], len(sources))})
    output.sort(key=lambda item: (item["sourceCount"], item["count"], item["maxPriority"]), reverse=True)
    return output[:12]


def build_map_intelligence(events: list[dict[str, Any]], hotspots: list[dict[str, Any]]) -> dict[str, Any]:
    mapped = [event for event in events if event.get("lat") is not None and event.get("lon") is not None]
    coverage = round((len(mapped) / len(events)) * 100) if events else 0
    layers = Counter(event.get("category") or "unknown" for event in mapped)
    return {
        "mapped": len(mapped),
        "unmapped": max(0, len(events) - len(mapped)),
        "coveragePct": coverage,
        "layers": dict(layers.most_common(8)),
        "hotspotCount": len(hotspots),
        "topHotspots": hotspots[:6],
        "center": map_center(mapped, hotspots),
    }


def map_center(mapped: list[dict[str, Any]], hotspots: list[dict[str, Any]]) -> dict[str, float]:
    if hotspots and hotspots[0].get("lat") is not None and hotspots[0].get("lon") is not None:
        return {"lat": float(hotspots[0]["lat"]), "lon": float(hotspots[0]["lon"])}
    if mapped:
        return {
            "lat": round(sum(float(event["lat"]) for event in mapped) / len(mapped), 4),
            "lon": round(sum(float(event["lon"]) for event in mapped) / len(mapped), 4),
        }
    return {"lat": 20.0, "lon": 0.0}


def build_dashboard_analytics(events: list[dict[str, Any]], reports: list[dict[str, Any]], days: int) -> dict[str, Any]:
    by_area = Counter(event.get("area") or "Global" for event in events)
    by_template = Counter(normalize_report_template(report.get("template") or "executive") for report in reports)
    avg_priority = round(sum(int(event.get("analyst_priority") or event.get("severity_score") or 0) for event in events) / len(events)) if events else 0
    return {
        "windowDays": days,
        "averagePriority": avg_priority,
        "topAreas": [{"name": name, "count": count} for name, count in by_area.most_common(8)],
        "templateCounts": {
            REPORT_TEMPLATES[key]["label"]: count
            for key, count in by_template.most_common()
        },
        "priorityBands": priority_bands(events),
    }


def priority_bands(events: list[dict[str, Any]]) -> dict[str, int]:
    bands = {"critical": 0, "high": 0, "moderate": 0, "low": 0}
    for event in events:
        score = int(event.get("analyst_priority") or event.get("severity_score") or event.get("severityScore") or 0)
        if score >= 85:
            bands["critical"] += 1
        elif score >= 68:
            bands["high"] += 1
        elif score >= 40:
            bands["moderate"] += 1
        else:
            bands["low"] += 1
    return bands


def build_trends(days: int) -> dict[str, Any]:
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    database = db()
    event_rows = list(
        database.events.find(
            {
                "$or": [
                    {"time": {"$gte": since}},
                    {"$and": [{"time": {"$in": [None, ""]}}, {"last_seen": {"$gte": since}}]},
                ]
            },
            {
                "_id": 0,
                "id": 1,
                "title": 1,
                "summary": 1,
                "category": 1,
                "severity": 1,
                "severity_score": 1,
                "source": 1,
                "source_type": 1,
                "time": 1,
                "area": 1,
                "lat": 1,
                "lon": 1,
                "url": 1,
                "source_credibility": 1,
                "source_credibility_label": 1,
                "duplicate_group": 1,
                "duplicate_count": 1,
                "source_count": 1,
                "sources": 1,
                "raw": 1,
            },
            sort=[("time", DESCENDING), ("severity_score", DESCENDING)],
            limit=MAX_STORED_EVENTS_PER_TREND,
        )
    )
    ioc_rows = list(
        database.ioc_lookups.find(
            {"created_at": {"$gte": since}},
            {"_id": 0, "id": 1, "value": 1, "type": 1, "risk_score": 1, "risk_level": 1, "verdict": 1, "created_at": 1},
            sort=[("created_at", DESCENDING)],
            limit=200,
        )
    )
    report_rows = list(
        database.analyst_reports.find(
            {"created_at": {"$gte": since}},
            {
                "_id": 0,
                "id": 1,
                "title": 1,
                "focus": 1,
                "days": 1,
                "template": 1,
                "template_label": 1,
                "model": 1,
                "ai_provider": 1,
                "summary": 1,
                "created_at": 1,
                "tags": 1,
                "event_count": 1,
                "high_priority_count": 1,
                "top_hotspot": 1,
                "credibility": 1,
            },
            sort=[("created_at", DESCENDING)],
            limit=100,
        )
    )

    all_events = [enrich_stored_event_row(dict(row)) for row in event_rows]
    events_out = build_analyst_event_view(all_events, MAX_ANALYST_EVENTS_PER_TREND)
    iocs = [dict(row) for row in ioc_rows]
    reports = [dict(row) for row in report_rows]
    category_counts = Counter(item.get("category") or "unknown" for item in events_out)
    severity_counts = Counter(item.get("severity") or "unknown" for item in events_out)
    source_counts = Counter(item.get("source") or "unknown" for item in events_out)
    daily_counts: dict[str, int] = defaultdict(int)
    ioc_daily: dict[str, int] = defaultdict(int)
    report_daily: dict[str, int] = defaultdict(int)

    for event in events_out:
        daily_counts[(event.get("time") or "")[:10] or "unknown"] += 1
    for lookup in iocs:
        ioc_daily[(lookup.get("created_at") or "")[:10] or "unknown"] += 1
    for report in reports:
        report_daily[(report.get("created_at") or "")[:10] or "unknown"] += 1

    hotspots = build_hotspots_from_rows(events_out)
    source_credibility = build_source_credibility_summary(events_out)
    duplicate_groups = build_duplicate_groups(events_out)
    map_intelligence = build_map_intelligence(events_out, hotspots)
    analytics = build_dashboard_analytics(events_out, reports, days)

    return {
        "days": days,
        "generatedAt": utc_now(),
        "totals": {
            "events": len(events_out),
            "allEvents": len(all_events),
            "highPriority": sum(1 for item in events_out if int(item.get("severity_score") or 0) >= 68),
            "critical": sum(1 for item in events_out if item.get("severity") == "critical"),
            "reports": len(reports),
            "iocLookups": len(iocs),
            "riskyIocs": sum(1 for item in iocs if int(item.get("risk_score") or 0) >= 45),
            "duplicateGroups": len(duplicate_groups),
            "confirmedItems": sum(1 for item in events_out if int(item.get("source_count") or item.get("sourceCount") or 1) > 1),
            "mappedPct": map_intelligence["coveragePct"],
            "avgCredibility": source_credibility["average"],
        },
        "categoryCounts": dict(category_counts.most_common()),
        "severityCounts": dict(severity_counts.most_common()),
        "sourceCounts": dict(source_counts.most_common(12)),
        "dailyCounts": dict(sorted(daily_counts.items())),
        "iocDailyCounts": dict(sorted(ioc_daily.items())),
        "reportDailyCounts": dict(sorted(report_daily.items())),
        "topEvents": events_out[:MAX_TOP_EVENTS_FOR_CHAT],
        "recentIocs": iocs[:12],
        "recentReports": reports[:8],
        "hotspots": hotspots,
        "sourceCredibilitySummary": source_credibility,
        "duplicateGroups": duplicate_groups,
        "mapIntelligence": map_intelligence,
        "analytics": analytics,
        "reportTemplates": report_template_options(),
        "providers": provider_status(),
        "ai": ai_status(),
    }


def build_report_snapshot(snapshot: dict[str, Any], focus: str = "", extra_events: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    focus_text = clean_text(focus)
    if not focus_text:
        return snapshot

    matching_events = select_relevant_events(snapshot, focus_text, limit=120, extra_events=extra_events, strict=True)
    focused = dict(snapshot)
    days = int(snapshot.get("days") or 7)
    reports = snapshot.get("recentReports", [])
    category_counts = Counter(item.get("category") or "unknown" for item in matching_events)
    severity_counts = Counter(item.get("severity") or risk_label(int(item.get("analyst_priority") or item.get("severity_score") or 0)) for item in matching_events)
    source_counts = Counter(item.get("source") or "unknown" for item in matching_events)
    daily_counts: dict[str, int] = defaultdict(int)
    for event in matching_events:
        daily_counts[(event.get("time") or "")[:10] or "unknown"] += 1

    hotspots = build_hotspots_from_rows(matching_events)
    source_credibility = build_source_credibility_summary(matching_events)
    duplicate_groups = build_duplicate_groups(matching_events)
    map_intelligence = build_map_intelligence(matching_events, hotspots)
    source_window_events = int((snapshot.get("totals") or {}).get("events") or len(snapshot.get("topEvents", [])))

    focused.update(
        {
            "focus": focus_text,
            "focusApplied": True,
            "days": days,
            "totals": {
                "events": len(matching_events),
                "allEvents": len(matching_events),
                "matchingEvents": len(matching_events),
                "sourceWindowEvents": source_window_events,
                "filteredOut": max(0, source_window_events - len(matching_events)),
                "highPriority": sum(1 for item in matching_events if int(item.get("analyst_priority") or item.get("severity_score") or 0) >= 68),
                "critical": sum(1 for item in matching_events if int(item.get("analyst_priority") or item.get("severity_score") or 0) >= 85),
                "reports": len(reports),
                "iocLookups": 0,
                "riskyIocs": 0,
                "duplicateGroups": len(duplicate_groups),
                "confirmedItems": sum(1 for item in matching_events if int(item.get("source_count") or item.get("sourceCount") or 1) > 1),
                "mappedPct": map_intelligence["coveragePct"],
                "avgCredibility": source_credibility["average"],
            },
            "categoryCounts": dict(category_counts.most_common()),
            "severityCounts": dict(severity_counts.most_common()),
            "sourceCounts": dict(source_counts.most_common(12)),
            "dailyCounts": dict(sorted(daily_counts.items())),
            "topEvents": matching_events,
            "recentIocs": [],
            "hotspots": hotspots,
            "sourceCredibilitySummary": source_credibility,
            "duplicateGroups": duplicate_groups,
            "mapIntelligence": map_intelligence,
            "analytics": build_dashboard_analytics(matching_events, reports, days),
        }
    )
    return focused


async def generate_analyst_report(snapshot: dict[str, Any], focus: str = "", template: str = "executive") -> tuple[str, dict[str, Any]]:
    focus = clean_text(focus)
    template_key = normalize_report_template(template)
    template_profile = REPORT_TEMPLATES[template_key]
    context = compact_snapshot_for_ai(snapshot, event_limit=50)
    if os.getenv("DEEPSEEK_API_KEY"):
        system = (
            "You are the GOD EYE OSINT incident analyst. Work only from the supplied open-source event context. "
            "Do not invent facts, casualty counts, attributions, or classified claims. Highlight uncertainty, "
            "source limits, and what a human analyst should collect next. Prioritize military, geopolitical, "
            "economic, cyber, and energy security developments over routine natural-disaster occurrences. "
            "Use source credibility, duplicate/source confirmation, and map/hotspot concentration when forming judgments. "
            "When a focus is supplied, every judgment must stay directly related to that focus. Exclude unrelated "
            "stories, regional background, and source-only matches where the requested country/person appears only "
            "in a publisher/source name. If the supplied context has no direct matches, say that clearly instead "
            "of filling the report with adjacent global news. "
            "Do not perform IOC/IP reputation lookup."
        )
        user = (
            f"Create a concise Markdown OSINT incident report using the {template_profile['label']} template.\n"
            f"Focus: {focus or 'overall geopolitical, military, cyber, disaster, and economic operating picture'}\n"
            f"Template emphasis: {template_profile['emphasis']}.\n"
            f"Use this structure: {template_profile['structure']}.\n"
            "Prefer source-backed observations. Mention when multiple sources appear to confirm the same event. "
            "Do not include any event unless its title, summary, area, or tags directly match the focus.\n\n"
            f"Context JSON:\n{json.dumps(context, ensure_ascii=True)}"
        )
        try:
            report, ai_meta = await call_deepseek(
                [{"role": "system", "content": system}, {"role": "user", "content": user}],
                max_tokens=1400,
            )
            ai_meta["template"] = template_key
            ai_meta["templateLabel"] = template_profile["label"]
            return report, ai_meta
        except Exception as exc:
            ai_meta = {
                "provider": "DeepSeek",
                "model": os.getenv("DEEPSEEK_MODEL", "deepseek-flash"),
                "configured": True,
                "used": False,
                "status": "fallback",
                "error": str(exc),
                "template": template_key,
                "templateLabel": template_profile["label"],
            }
            return build_local_analyst_report(snapshot, focus, ai_meta["error"], template_key), ai_meta

    ai_meta = {
        "provider": "Local",
        "model": "rule-based",
        "configured": False,
        "used": False,
        "status": "missing-key",
        "error": "",
        "template": template_key,
        "templateLabel": template_profile["label"],
    }
    return build_local_analyst_report(snapshot, focus, template=template_key), ai_meta


def build_local_analyst_report(snapshot: dict[str, Any], focus: str = "", fallback_error: str = "", template: str = "executive") -> str:
    template_key = normalize_report_template(template)
    template_profile = REPORT_TEMPLATES[template_key]
    totals = snapshot["totals"]
    top_category = top_item(snapshot["categoryCounts"])
    top_source = top_item(snapshot["sourceCounts"])
    top_hotspot = snapshot["hotspots"][0] if snapshot["hotspots"] else None
    focus_events = select_relevant_events(snapshot, focus, limit=10)
    lines = [
        "# GOD EYE v2 OSINT Incident Report",
        "",
        f"Generated: {snapshot['generatedAt']}",
        f"Window: Last {snapshot['days']} day(s)",
        f"Focus: {focus or 'Overall open-source incident picture'}",
        f"Template: {template_profile['label']}",
        "",
        "## Executive Summary",
        f"- {totals['events']} directly matching OSINT event(s) were available for this focus." if snapshot.get("focusApplied") else f"- {totals['events']} persisted OSINT events were available in the selected window.",
        f"- Focus filter excluded {totals.get('filteredOut', 0)} unrelated event(s) from the source window." if snapshot.get("focusApplied") else f"- {totals.get('allEvents', totals['events'])} total live/stored events were considered before analyst filtering.",
        f"- {totals['highPriority']} events are high-priority or critical; {totals['critical']} are critical.",
        f"- {totals.get('reports', 0)} analyst report(s) are stored for recent review.",
    ]
    if fallback_error:
        lines.append(f"- DeepSeek was configured, but this request used local fallback: {fallback_error}")
    if top_category:
        lines.append(f"- Busiest event category: {label_for_category(top_category[0])} ({top_category[1]} events).")
    if top_source:
        lines.append(f"- Most active source: {top_source[0]} ({top_source[1]} events).")
    if top_hotspot:
        lines.append(f"- Leading hotspot: {top_hotspot['name']} with {top_hotspot['count']} event(s).")
    credibility = snapshot.get("sourceCredibilitySummary") or {}
    if credibility:
        lines.append(f"- Source credibility average is {credibility.get('average', 0)}/100 across {credibility.get('sourceCount', 0)} visible sources.")

    lines.extend(["", "## Key Developments"])
    for event in focus_events[:8]:
        lines.append(f"- {format_event_line(event)}")
    if not focus_events:
        lines.append("- No direct matching stored events were found for this exact focus. Refresh the live feeds or broaden the focus slightly, then retry.")

    lines.extend(["", "## Hotspots"])
    if snapshot["hotspots"]:
        for hotspot in snapshot["hotspots"][:6]:
            categories = ", ".join(label_for_category(item) for item in hotspot.get("categories", [])[:4])
            lines.append(f"- {hotspot['name']}: {hotspot['count']} item(s), max score {hotspot['maxSeverity']}, categories {categories or 'mixed'}.")
    else:
        lines.append("- No geographic hotspot is available yet.")

    lines.extend(["", f"## {template_profile['label']} Focus"])
    lines.extend(template_focus_lines(template_key, snapshot, focus_events))

    lines.extend(
        [
            "",
            "## Analyst Assessment",
            f"- Current read: {build_assessment_sentence(focus_events, snapshot)}",
            "- Confidence is medium unless multiple independent sources describe the same development with matching time and location.",
            "- Collection gaps: exact chronology, official confirmation, local-language reporting, and impact on civilians, trade, energy, or military posture.",
            "- Suggested next action: refresh feeds, open source links for the top items, and generate a focused report for the most important hotspot.",
        ]
    )
    return "\n".join(lines)


def template_focus_lines(template: str, snapshot: dict[str, Any], events: list[dict[str, Any]]) -> list[str]:
    top_events = events[:5]
    if template == "military":
        return [
            f"- Military/security-relevant items visible: {sum(1 for item in events if (item.get('category') or '').lower() == 'military')}.",
            "- Watch for repeated reporting around force movement, strike activity, border posture, maritime activity, and air-defense claims.",
            *[f"- Indicator: {format_event_line(event)}" for event in top_events[:3]],
        ]
    if template == "geopolitical":
        return [
            "- Prioritize state behavior, diplomacy, sanctions, elections, protests, and alliance signaling.",
            f"- Most relevant hotspot: {(snapshot.get('hotspots') or [{'name': 'Global'}])[0].get('name')}.",
            *[f"- Political signal: {format_event_line(event)}" for event in top_events[:3]],
        ]
    if template == "economic":
        return [
            "- Review energy, shipping, trade, sanctions, inflation, currency, and supply-chain effects before operational conclusions.",
            f"- Economic/security categories visible: {sum(1 for item in events if (item.get('category') or '').lower() in {'economic', 'energy', 'geopolitical'})}.",
            *[f"- Impact lead: {format_event_line(event)}" for event in top_events[:3]],
        ]
    if template == "cyber":
        return [
            "- Track cyber/security items separately from physical incidents and avoid IOC judgments unless a source supplies technical indicators.",
            f"- Cyber/security items visible: {sum(1 for item in events if (item.get('category') or '').lower() == 'cyber')}.",
            *[f"- Security lead: {format_event_line(event)}" for event in top_events[:3]],
        ]
    if template == "daily":
        return [
            "- Daily read should emphasize what changed, what persists, and what needs watchlisting in the next 24 hours.",
            f"- Duplicate/confirmation groups visible: {len(snapshot.get('duplicateGroups') or [])}.",
            *[f"- Watch item: {format_event_line(event)}" for event in top_events[:4]],
        ]
    return [
        "- Executive read favors highest-confidence, highest-impact items first.",
        f"- Map coverage: {(snapshot.get('mapIntelligence') or {}).get('coveragePct', 0)}% of visible events have coordinates.",
        *[f"- Priority lead: {format_event_line(event)}" for event in top_events[:3]],
    ]


async def build_chat_reply(message: str, snapshot: dict[str, Any], reports: list[dict[str, Any]], live_events: list[dict[str, Any]] | None = None) -> tuple[str, dict[str, Any]]:
    if os.getenv("DEEPSEEK_API_KEY"):
        context = {
            "snapshot": compact_snapshot_for_ai(snapshot, event_limit=35),
            "liveSearchEvents": [
                {
                    "title": event.get("title"),
                    "category": event.get("category"),
                    "priority": event.get("analyst_priority") or event.get("severityScore") or event.get("severity_score"),
                    "source": event.get("source"),
                    "area": event.get("area"),
                    "time": event.get("time"),
                    "url": event.get("url"),
                }
                for event in (live_events or [])[:35]
            ],
            "recentReports": [
                {
                    "title": report["title"],
                    "focus": report.get("focus"),
                    "summary": report.get("summary"),
                    "createdAt": report.get("createdAt"),
                }
                for report in reports
            ],
        }
        system = (
            "You are the GOD EYE OSINT analyst chatbot. Use the supplied event/report context and answer as an "
            "analyst: concise, grounded, explicit about uncertainty, and focused on open-source incident analysis. "
            "Mention the specific stored or live-search event titles that support your answer. Be flexible with user "
            "questions: if they ask broad news, summarize the widest relevant picture from the live search and stored data. "
            "Prioritize military, geopolitical, economic, cyber, and energy security items, but include other important "
            "news when it answers the user's question. Do not run or recommend IOC/IP reputation lookup unless the user "
            "explicitly asks for cybersecurity IOC work."
        )
        user = (
            f"User question: {message}\n\n"
            "Answer with: Current read, Top supporting items, Confidence / gaps, Next collection steps.\n\n"
            f"Context JSON:\n{json.dumps(context, ensure_ascii=True)}"
        )
        try:
            reply, ai_meta = await call_deepseek(
                [{"role": "system", "content": system}, {"role": "user", "content": user}],
                max_tokens=1000,
            )
            return reply, ai_meta
        except Exception as exc:
            fallback = build_local_chat_reply(message, snapshot, reports)
            return (
                f"{fallback}\n\nDeepSeek fallback note: {exc}",
                {
                    "provider": "DeepSeek",
                    "model": os.getenv("DEEPSEEK_MODEL", "deepseek-flash"),
                    "configured": True,
                    "used": False,
                    "status": "fallback",
                    "error": str(exc),
                },
            )

    return (
        build_local_chat_reply(message, snapshot, reports, live_events or []),
        {
            "provider": "Local",
            "model": "rule-based",
            "configured": False,
            "used": False,
            "status": "missing-key",
            "error": "",
        },
    )


def build_local_chat_reply(message: str, snapshot: dict[str, Any], reports: list[dict[str, Any]], live_events: list[dict[str, Any]] | None = None) -> str:
    lower = message.lower()
    totals = snapshot["totals"]
    live_events = live_events or []

    if any(word in lower for word in ["report", "brief", "summary", "analysis"]):
        return build_local_analyst_report(snapshot, message)

    if any(word in lower for word in ["hotspot", "where", "location"]):
        return build_hotspot_reply(snapshot)

    if any(word in lower for word in ["trend", "history", "activity", "pattern"]):
        return build_trend_reply(snapshot)

    if any(word in lower for word in ["key", "api", "provider", "configured", "deepseek", "ai"]):
        status = ai_status()
        return (
            f"AI engine: {status['name']} using {status['model']}. "
            f"Status: {'configured' if status['configured'] else 'not configured'}. "
            "Set DEEPSEEK_API_KEY before starting the server to enable AI-powered analyst answers."
        )

    if any(phrase in lower for phrase in ["source status", "sources", "feeds", "data sources", "collection stack"]):
        catalog = source_catalog()
        source_lines = ", ".join(f"{item['name']} ({item['count']})" for item in catalog)
        top_sources = ", ".join(f"{name} ({count})" for name, count in list(snapshot["sourceCounts"].items())[:6])
        return (
            f"Current collection stack: {source_lines}.\n\n"
            f"Most active stored sources in this window: {top_sources or 'none yet'}.\n\n"
            "The v2 board now ranks military, geopolitical, economic, cyber, and energy stories ahead of routine natural-hazard items."
        )

    if any(word in lower for word in ["saved", "stored", "library"]):
        if not reports:
            return "No saved analyst reports yet. Generate an incident report from the left panel or ask chat for a brief."
        return "Recent saved reports:\n" + "\n".join(f"- #{item['id']} {item['title']}: {item['summary']}" for item in reports)

    events = select_relevant_events(snapshot, message, limit=10, extra_events=live_events)
    if not events:
        return (
            f"I do not have matching stored OSINT events for that question yet. Current v2 view has {totals['events']} analyst-prioritized "
            "events. Hit Refresh, then ask again with a region, topic, or category such as military, geopolitical, economic, cyber, or energy."
        )
    return build_event_readout(message, snapshot, events, len(live_events))


def wants_report(message: str) -> bool:
    lower = message.lower()
    return any(phrase in lower for phrase in ["generate report", "make report", "create report", "save report", "incident brief", "briefing report"])


def chat_search_days(message: str) -> int:
    lower = message.lower()
    if any(word in lower for word in ["today", "live", "breaking", "now", "latest"]):
        return 3
    if any(word in lower for word in ["month", "30 day", "30-day"]):
        return 30
    if any(word in lower for word in ["week", "weekly", "7 day", "7-day"]):
        return 7
    return 14


def build_dynamic_news_query(message: str) -> str:
    lower = clean_text(message).lower()
    if not lower:
        return ""
    if any(phrase in lower for phrase in ["api key", "deepseek", "configured", "saved report", "report library"]):
        return ""

    categories = detect_requested_categories(lower)
    terms = extract_focus_terms(lower)
    category_terms = {
        "military": ["military", "missile", "drone", "troops", "navy", "defense", "air force", "border"],
        "geopolitical": ["sanctions", "diplomacy", "protest", "election", "ceasefire", "border", "government", "unrest"],
        "economic": ["economy", "inflation", "central bank", "currency", "trade", "oil prices", "recession", "markets"],
        "cyber": ["cyberattack", "ransomware", "data breach", "malware", "phishing", "outage", "hackers"],
        "energy": ["energy", "oil", "gas", "pipeline", "power grid", "refinery", "shipping", "electricity"],
    }
    signals: list[str] = []
    for category in categories:
        signals.extend(category_terms.get(category, []))
    if not signals:
        signals = [
            "military", "geopolitical", "economy", "cyberattack", "energy", "sanctions",
            "protest", "election", "conflict", "security", "breaking news",
        ]

    topic = " ".join(terms[:8])
    signal_query = " OR ".join(dict.fromkeys(signals[:14]))
    if topic:
        return f"{topic} ({signal_query})"
    return f"({signal_query})"


def preferred_category_for_query(message: str) -> str:
    categories = detect_requested_categories(message.lower())
    for category in ["military", "geopolitical", "cyber", "economic", "energy"]:
        if category in categories:
            return category
    return "news"


def select_relevant_events(
    snapshot: dict[str, Any],
    message: str,
    limit: int = 6,
    extra_events: list[dict[str, Any]] | None = None,
    strict: bool = False,
) -> list[dict[str, Any]]:
    events = dedupe_events([*(extra_events or []), *snapshot.get("topEvents", [])])
    if not events:
        return []

    profile = build_focus_profile(message)
    threshold = focus_match_threshold(profile)
    scored: list[tuple[int, dict[str, Any]]] = []
    for event in events:
        score = event_focus_score(event, profile)
        if strict and profile["hasFocus"] and score < threshold:
            continue
        if score > 0:
            scored.append((score, event))

    if not scored and not strict:
        scored = [(int(event.get("analyst_priority") or event.get("severity_score") or 0), event) for event in events]
    scored.sort(key=lambda item: item[0], reverse=True)
    return [event for _, event in scored[:limit]]


def build_focus_profile(message: str) -> dict[str, Any]:
    lower = clean_text(message).lower()
    countries = detect_focus_countries(lower)
    country_words = focus_country_words(countries)
    terms = [term for term in extract_focus_terms(lower) if term not in country_words]
    categories = detect_requested_categories(lower)
    return {
        "lower": lower,
        "categories": categories,
        "countries": countries,
        "countryWords": country_words,
        "terms": terms,
        "hasFocus": bool(categories or countries or terms),
    }


def focus_match_threshold(profile: dict[str, Any]) -> int:
    if profile["countries"] and profile["terms"]:
        return 70
    if profile["countries"]:
        return 45
    if profile["terms"]:
        return 30
    if profile["categories"]:
        return 20
    return 1


def event_focus_score(event: dict[str, Any], profile: dict[str, Any]) -> int:
    score = 0
    category = (event.get("category") or "").lower()
    topic_text = event_topic_text(event)

    if profile["countries"]:
        if not any(text_has_term(topic_text, word) for word in profile["countryWords"]):
            return -100
        score += 55

    if profile["terms"]:
        term_hits = sum(1 for term in profile["terms"] if text_has_term(topic_text, term))
        if not term_hits:
            return -80 if profile["countries"] else -20
        score += 30 + term_hits * 15

    if profile["categories"]:
        score += 25 if category in profile["categories"] else -8

    if not profile["hasFocus"]:
        score += 1

    score += int(event.get("analyst_priority") or event.get("severity_score") or event.get("severityScore") or 0) // 15
    score += min(8, max(0, int(event.get("source_count") or event.get("sourceCount") or 1) - 1) * 2)
    return score


def event_topic_text(event: dict[str, Any]) -> str:
    raw = event.get("raw") if isinstance(event.get("raw"), dict) else {}
    tags = event.get("tags") or raw.get("tags") or []
    tag_text = " ".join(clean_text(tag) for tag in tags if tag)
    return " ".join(
        clean_text(value).lower()
        for value in [
            event.get("title") or raw.get("title"),
            event.get("summary") or raw.get("summary"),
            event.get("category") or raw.get("category"),
            event.get("area") or raw.get("area"),
            tag_text,
        ]
        if value
    )


def text_has_term(text: str, term: str) -> bool:
    clean_term = clean_text(term).lower()
    if not clean_term:
        return False
    if " " in clean_term:
        return clean_term in text
    return re.search(rf"(^|[^a-z0-9]){re.escape(clean_term)}([^a-z0-9]|$)", text, re.I) is not None


def detect_focus_countries(lower: str) -> set[str]:
    countries: set[str] = set()
    for name, code in COUNTRY_ALIASES.items():
        if text_has_term(lower, name):
            countries.add(code)
    for code, name in COUNTRY_NAMES.items():
        if text_has_term(lower, name.lower()):
            countries.add(code)
    return countries


def focus_country_words(countries: set[str]) -> set[str]:
    words = {COUNTRY_NAMES[code].lower() for code in countries if code in COUNTRY_NAMES}
    words.update(alias for alias, code in COUNTRY_ALIASES.items() if code in countries)
    return words


def detect_requested_categories(lower: str) -> set[str]:
    categories: set[str] = set()
    checks = {
        "military": ["military", "army", "navy", "air force", "missile", "drone", "troops", "war", "defense"],
        "geopolitical": ["geo", "geopolitical", "political", "sanction", "diplomacy", "election", "protest", "border"],
        "economic": ["economic", "economy", "market", "inflation", "currency", "trade", "recession", "central bank"],
        "cyber": ["cyber", "ransomware", "breach", "malware", "phishing", "hack", "outage"],
        "energy": ["energy", "oil", "gas", "pipeline", "power grid", "shipping", "refinery"],
    }
    for category, words in checks.items():
        if any(word in lower for word in words):
            categories.add(category)
    return categories


def extract_focus_terms(lower: str) -> list[str]:
    terms = []
    for token in re.findall(r"[a-z][a-z0-9-]{3,}", lower):
        if token not in CHAT_STOPWORDS and token not in OSINT_CATEGORY_WEIGHTS and token not in NATURAL_CATEGORIES:
            terms.append(token)
    return terms[:8]


def build_event_readout(message: str, snapshot: dict[str, Any], events: list[dict[str, Any]], live_count: int = 0) -> str:
    categories = Counter(event.get("category") or "unknown" for event in events)
    top_category = top_item(dict(categories))
    hotspot = first_relevant_hotspot(snapshot, events)
    lines = [
        f"Analyst readout for: {message}",
        "",
        f"Current read: {build_assessment_sentence(events, snapshot)}",
    ]
    if live_count:
        lines.append(f"Live search added {live_count} fresh matching item(s) before this answer.")
    if top_category:
        lines.append(f"Dominant category: {label_for_category(top_category[0])} ({top_category[1]} matching item(s)).")
    if hotspot:
        lines.append(f"Most relevant hotspot: {hotspot['name']} with {hotspot['count']} stored item(s).")

    lines.extend(["", "Top matching items:"])
    lines.extend(f"- {format_event_line(event)}" for event in events[:6])
    lines.extend(
        [
            "",
            "Next collection steps:",
            "- Open the source links for the first 2-3 items and confirm timestamps.",
            "- Check whether independent sources repeat the same location, actor, and impact claims.",
            "- Generate a saved incident report if this topic needs tracking over time.",
        ]
    )
    return "\n".join(lines)


def build_trend_reply(snapshot: dict[str, Any]) -> str:
    totals = snapshot["totals"]
    categories = list(snapshot["categoryCounts"].items())[:5]
    sources = list(snapshot["sourceCounts"].items())[:5]
    daily = list(snapshot["dailyCounts"].items())[-7:]
    category_text = ", ".join(f"{label_for_category(name)} {count}" for name, count in categories) or "none"
    source_text = ", ".join(f"{name} {count}" for name, count in sources) or "none"
    daily_text = ", ".join(f"{day}: {count}" for day, count in daily) or "no daily activity"
    return (
        f"Trend view, last {snapshot['days']} days:\n\n"
        f"- Analyst-prioritized OSINT events: {totals['events']} from {totals.get('allEvents', totals['events'])} total stored events.\n"
        f"- High-priority/critical: {totals['highPriority']} / {totals['critical']}.\n"
        f"- Category mix: {category_text}.\n"
        f"- Active sources: {source_text}.\n"
        f"- Recent daily activity: {daily_text}.\n\n"
        "Read: military/geopolitical/economic/cyber/energy items are now weighted above routine disaster occurrences."
    )


def build_hotspot_reply(snapshot: dict[str, Any]) -> str:
    hotspots = snapshot.get("hotspots", [])[:8]
    if not hotspots:
        return "No geographic hotspot is stored yet. Refresh live feeds, then ask again."
    lines = ["Current hotspots:"]
    for hotspot in hotspots:
        categories = ", ".join(label_for_category(item) for item in hotspot.get("categories", [])[:4])
        lines.append(f"- {hotspot['name']}: {hotspot['count']} item(s), max score {hotspot['maxSeverity']}, categories {categories or 'mixed'}.")
    lines.append("")
    lines.append("Use a focused prompt like `generate report on Ukraine military updates` to save a deeper brief.")
    return "\n".join(lines)


def build_assessment_sentence(events: list[dict[str, Any]], snapshot: dict[str, Any]) -> str:
    if not events:
        return "there is not enough matching open-source context yet."
    highest = events[0]
    area = highest.get("area") or "Global"
    category_text = label_for_category(highest.get("category") or "mixed OSINT")
    return (
        f"{category_text} reporting is the strongest visible signal, led by `{highest.get('title')}` "
        f"around {area}. Treat it as an open-source lead until confirmed by multiple sources."
    )


def first_relevant_hotspot(snapshot: dict[str, Any], events: list[dict[str, Any]]) -> dict[str, Any] | None:
    event_areas = {clean_text(event.get("area")).lower() for event in events if event.get("area")}
    for hotspot in snapshot.get("hotspots", []):
        if clean_text(hotspot.get("name")).lower() in event_areas:
            return hotspot
    return snapshot.get("hotspots", [None])[0] if snapshot.get("hotspots") else None


def format_event_line(event: dict[str, Any]) -> str:
    title = event.get("title") or "Untitled event"
    category = label_for_category(event.get("category") or "event")
    area = event.get("area") or "Global"
    source = event.get("source") or "unknown source"
    score = event.get("analyst_priority") or event.get("severity_score") or event.get("severityScore") or 0
    time_label = format_time_for_report(event.get("time"))
    return f"{title} | {category} | {area} | priority {score} | {source} | {time_label}"


def format_time_for_report(value: Any) -> str:
    parsed = parse_time(value)
    return parsed.strftime("%Y-%m-%d %H:%M UTC")


async def call_deepseek(messages: list[dict[str, str]], max_tokens: int = 1000) -> tuple[str, dict[str, Any]]:
    key = os.getenv("DEEPSEEK_API_KEY")
    if not key:
        raise RuntimeError("DEEPSEEK_API_KEY is not configured.")

    model = os.getenv("DEEPSEEK_MODEL", "deepseek-flash")
    base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": False,
        "temperature": 0.2,
        "max_tokens": max_tokens,
    }
    if model.startswith(("deepseek-v4", "deepseek-flash")):
        thinking_mode = os.getenv("DEEPSEEK_THINKING", "disabled").strip().lower()
        payload["thinking"] = {"type": "enabled" if thinking_mode == "enabled" else "disabled"}
        if thinking_mode == "enabled":
            payload["reasoning_effort"] = os.getenv("DEEPSEEK_REASONING_EFFORT", "high")

    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=AI_TIMEOUT_SECONDS, follow_redirects=True) as client:
        response = await client.post(f"{base_url}/chat/completions", headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()

    message = (data.get("choices") or [{}])[0].get("message") or {}
    content = clean_text(message.get("content") or "")
    if not content:
        raise RuntimeError("DeepSeek returned an empty response.")

    return (
        content,
        {
            "provider": "DeepSeek",
            "model": model,
            "configured": True,
            "used": True,
            "status": "ready",
            "usage": data.get("usage") or {},
        },
    )


def compact_snapshot_for_ai(snapshot: dict[str, Any], event_limit: int = 12) -> dict[str, Any]:
    return {
        "generatedAt": snapshot.get("generatedAt"),
        "windowDays": snapshot.get("days"),
        "focus": snapshot.get("focus"),
        "focusApplied": bool(snapshot.get("focusApplied")),
        "totals": snapshot.get("totals", {}),
        "categoryCounts": snapshot.get("categoryCounts", {}),
        "severityCounts": snapshot.get("severityCounts", {}),
        "topSources": snapshot.get("sourceCounts", {}),
        "dailyCounts": snapshot.get("dailyCounts", {}),
        "sourceCredibilitySummary": snapshot.get("sourceCredibilitySummary", {}),
        "duplicateGroups": snapshot.get("duplicateGroups", [])[:8],
        "mapIntelligence": snapshot.get("mapIntelligence", {}),
        "analytics": snapshot.get("analytics", {}),
        "hotspots": [
            {
                "name": item.get("name"),
                "count": item.get("count"),
                "maxSeverity": item.get("maxSeverity"),
                "categories": item.get("categories", []),
                "confirmed": item.get("confirmed", 0),
                "sourceCount": item.get("sourceCount", 0),
            }
            for item in snapshot.get("hotspots", [])[:8]
        ],
        "priorityEvents": [
            {
                "title": item.get("title"),
                "summary": clean_text(item.get("summary") or "")[:360],
                "category": item.get("category"),
                "severityScore": item.get("analyst_priority") or item.get("severity_score") or item.get("severityScore"),
                "source": item.get("source"),
                "sourceCredibility": item.get("source_credibility") or item.get("sourceCredibility"),
                "sourceCount": item.get("source_count") or item.get("sourceCount"),
                "area": item.get("area"),
                "time": item.get("time"),
                "url": item.get("url"),
            }
            for item in snapshot.get("topEvents", [])[:event_limit]
        ],
    }


def report_title(focus: str, snapshot: dict[str, Any], template: str = "executive") -> str:
    if focus:
        return clean_text(focus)[:90]
    top_hotspot = snapshot["hotspots"][0]["name"] if snapshot.get("hotspots") else "Global"
    top_category = top_item(snapshot.get("categoryCounts", {}))
    category = label_for_category(top_category[0]) if top_category else "OSINT"
    template_label = REPORT_TEMPLATES[normalize_report_template(template)]["label"]
    return f"{template_label} - {category} Watch - {top_hotspot}"


def summarize_report(report: str) -> str:
    for line in report.splitlines():
        text = clean_text(line.lstrip("-# "))
        if text and not text.lower().startswith(("generated:", "window:", "focus:")):
            return text[:280]
    return clean_text(report)[:280] or "Analyst report generated."


def normalize_ioc(value: str) -> dict[str, Any]:
    text = clean_text(value)
    stripped = text.strip("<>()[]{}'\"")
    if not stripped:
        raise HTTPException(status_code=400, detail="IOC value is empty.")

    try:
        ip = ipaddress.ip_address(stripped)
        return {
            "value": str(ip),
            "type": "ipv6" if ip.version == 6 else "ipv4",
            "displayType": "IP Address",
            "private": ip.is_private or ip.is_loopback or ip.is_reserved,
        }
    except ValueError:
        pass

    lower = stripped.lower()
    if re.fullmatch(r"[a-f0-9]{32}", lower):
        return {"value": lower, "type": "md5", "displayType": "MD5 Hash"}
    if re.fullmatch(r"[a-f0-9]{40}", lower):
        return {"value": lower, "type": "sha1", "displayType": "SHA1 Hash"}
    if re.fullmatch(r"[a-f0-9]{64}", lower):
        return {"value": lower, "type": "sha256", "displayType": "SHA256 Hash"}
    if re.match(r"^https?://", stripped, re.I):
        return {"value": stripped, "type": "url", "displayType": "URL"}
    if re.fullmatch(r"(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", lower):
        return {"value": lower, "type": "domain", "displayType": "Domain"}

    raise HTTPException(status_code=400, detail="Unsupported IOC. Enter a public IP, domain, URL, or MD5/SHA1/SHA256 hash.")


def extract_ioc_from_text(text: str) -> str | None:
    patterns = [
        r"\b(?:\d{1,3}\.){3}\d{1,3}\b",
        r"https?://[^\s]+",
        r"\b[a-fA-F0-9]{32}\b",
        r"\b[a-fA-F0-9]{40}\b",
        r"\b[a-fA-F0-9]{64}\b",
        r"\b(?=.{3,253}\b)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(0).rstrip(".,;)")
    return None


def virustotal_endpoint(indicator: dict[str, Any]) -> str | None:
    value = indicator["value"]
    if indicator["type"] in {"ipv4", "ipv6"}:
        return f"ip_addresses/{quote(value, safe='')}"
    if indicator["type"] == "domain":
        return f"domains/{quote(value, safe='')}"
    if indicator["type"] in {"md5", "sha1", "sha256"}:
        return f"files/{quote(value, safe='')}"
    if indicator["type"] == "url":
        encoded = base64.urlsafe_b64encode(value.encode()).decode().rstrip("=")
        return f"urls/{encoded}"
    return None


def otx_indicator_type(indicator: dict[str, Any]) -> str | None:
    return {
        "ipv4": "IPv4",
        "ipv6": "IPv6",
        "domain": "domain",
        "url": "URL",
        "md5": "FileHash-MD5",
        "sha1": "FileHash-SHA1",
        "sha256": "FileHash-SHA256",
    }.get(indicator["type"])


def aggregate_ioc_risk(indicator: dict[str, Any], providers: list[dict[str, Any]]) -> dict[str, Any]:
    active = [item for item in providers if item.get("ok")]
    scores = [int(item.get("score") or 0) for item in active]
    max_score = max(scores or [0])
    signals = sum(1 for score in scores if score >= 35)
    configured = sum(1 for item in providers if item.get("configured"))
    risk_score = clamp(max_score + max(0, signals - 1) * 8, 0, 100)
    risk_level = risk_label(risk_score)
    if configured == 0:
        verdict = "Needs API keys"
        summary = "No IOC provider keys are configured yet, so the lookup was stored but not externally correlated."
    elif risk_score >= 75:
        verdict = "Likely malicious"
        summary = f"{indicator['displayType']} shows strong malicious reputation across configured intelligence sources."
    elif risk_score >= 45:
        verdict = "Suspicious"
        summary = f"{indicator['displayType']} has moderate risk signals and should be reviewed before trusting."
    elif active:
        verdict = "No major signal"
        summary = f"{indicator['displayType']} did not show major malicious signals in configured provider responses."
    else:
        verdict = "Not enough data"
        summary = "Providers are configured, but no successful reputation response was returned."
    return {"riskScore": risk_score, "riskLevel": risk_level, "verdict": verdict, "summary": summary}


def provider_missing(provider: str, summary: str) -> dict[str, Any]:
    return {
        "provider": provider,
        "ok": False,
        "configured": False,
        "requiresKey": True,
        "score": 0,
        "status": "missing-key",
        "summary": summary,
        "raw": {},
    }


def provider_skipped(provider: str, summary: str) -> dict[str, Any]:
    return {
        "provider": provider,
        "ok": True,
        "configured": bool(provider_env(provider)),
        "requiresKey": False,
        "score": 0,
        "status": "skipped",
        "summary": summary,
        "raw": {},
    }


def provider_failed(provider: str, fetched: dict[str, Any]) -> dict[str, Any]:
    return {
        "provider": provider,
        "ok": False,
        "configured": True,
        "requiresKey": False,
        "score": 0,
        "status": "failed",
        "summary": fetched.get("error") or "Provider request failed.",
        "raw": {},
    }


def provider_status() -> list[dict[str, Any]]:
    providers = [
        {"name": "AbuseIPDB", "env": "ABUSEIPDB_API_KEY", "scope": "IP reputation"},
        {"name": "VirusTotal", "env": "VIRUSTOTAL_API_KEY", "scope": "IP, domain, URL, file hash"},
        {"name": "AlienVault OTX", "env": "OTX_API_KEY", "scope": "Pulse correlation"},
    ]
    return [{**item, "configured": bool(os.getenv(item["env"]))} for item in providers]


def ai_status() -> dict[str, Any]:
    return {
        "name": "DeepSeek",
        "env": "DEEPSEEK_API_KEY",
        "configured": bool(os.getenv("DEEPSEEK_API_KEY")),
        "model": os.getenv("DEEPSEEK_MODEL", "deepseek-flash"),
        "baseUrl": os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
    }


def source_catalog() -> list[dict[str, Any]]:
    return [
        {"name": "Official hazard/disaster feeds", "count": 4, "scope": "USGS, NASA EONET, NOAA/NWS, GDACS"},
        {"name": "Official government/security RSS", "count": BASE_RSS_FEED_COUNT, "scope": "Defense, FEMA, disaster/security updates"},
        {"name": "Shadowbroker OSINT source pack", "count": len(SHADOWBROKER_RSS_FEEDS) + 2, "scope": "specialist RSS, regional media, CISA KEV, abuse.ch cyber feeds"},
        {"name": "Google News OSINT feeds", "count": len(GOOGLE_NEWS_FEEDS), "scope": "military, geopolitical, economic, cyber, energy"},
        {"name": "GDELT global media feeds", "count": len(GDELT_FEEDS), "scope": "global news correlation and trend discovery"},
        {"name": "Live aviation feeds", "count": 2, "scope": "OpenSky civil traffic and Airplanes.live military traffic"},
    ]


def provider_env(provider: str) -> str | None:
    return {
        "AbuseIPDB": os.getenv("ABUSEIPDB_API_KEY"),
        "VirusTotal": os.getenv("VIRUSTOTAL_API_KEY"),
        "AlienVault OTX": os.getenv("OTX_API_KEY"),
    }.get(provider)


def parse_rss_items(xml_text: str) -> list[dict[str, str]]:
    try:
        root = ElementTree.fromstring(xml_text.encode("utf-8"))
    except ElementTree.ParseError:
        return []

    items = []
    for item in root.findall(".//item"):
        parsed: dict[str, str] = {}
        for child in list(item):
            tag = child.tag.split("}", 1)[-1]
            parsed[tag] = clean_text(child.text or "")
        items.append(parsed)
    return items


def health(source: str, ok: bool, count: int, fetched: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": source,
        "source": source,
        "ok": ok,
        "count": count,
        "generatedInMs": fetched.get("ms", 0),
        "error": fetched.get("error"),
        "refreshedAt": utc_now(),
    }


def clean_event(event: dict[str, Any]) -> dict[str, Any]:
    score = clamp(round(number_or_none(event.get("severityScore")) or 20), 1, 100)
    lat = number_or_none(event.get("lat"))
    lon = number_or_none(event.get("lon"))
    source = event.get("source") or "Unknown source"
    source_type = event.get("sourceType") or "open-source"
    credibility = source_credibility_score(source, source_type)
    return {
        "id": str(event.get("id") or hash_key(f"{event.get('source')}:{event.get('title')}:{event.get('time')}")),
        "title": clean_text(event.get("title") or "Untitled event"),
        "summary": clean_text(event.get("summary") or "No summary available from source."),
        "category": event.get("category") or "news",
        "source": source,
        "sourceType": source_type,
        "severity": event.get("severity") or score_to_severity(score),
        "severityScore": score,
        "confidence": clamp(float(event.get("confidence") or 0.5), 0, 1),
        "sourceCredibility": credibility,
        "sourceCredibilityLabel": credibility_label(credibility),
        "time": parse_date_or_now(event.get("time")),
        "updated": parse_date_or_none(event.get("updated")),
        "expires": parse_date_or_none(event.get("expires")),
        "lat": lat if lat is not None and abs(lat) <= 90 else None,
        "lon": lon if lon is not None and abs(lon) <= 180 else None,
        "area": clean_text(event.get("area") or "Global"),
        "url": event.get("url") or None,
        "image": event.get("image") or None,
        "tags": list(dict.fromkeys(clean_text(tag) for tag in event.get("tags", []) if clean_text(tag)))[:10],
    }


def dedupe_events(events_in: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, Any]] = {}
    for event in events_in:
        key = event_duplicate_key(event)
        existing = buckets.get(key)
        if not existing:
            copy = dict(event)
            copy["duplicateGroup"] = key
            copy["duplicateCount"] = 1
            copy["sourceCount"] = 1
            copy["sources"] = [copy.get("source")] if copy.get("source") else []
            buckets[key] = copy
            continue

        existing["duplicateCount"] = int(existing.get("duplicateCount") or 1) + 1
        sources = list(dict.fromkeys([*(existing.get("sources") or []), event.get("source")]))
        existing["sources"] = [source for source in sources if source]
        existing["sourceCount"] = len(existing["sources"]) or 1
        existing_score = int(existing.get("severityScore") or 0)
        event_score = int(event.get("severityScore") or 0)
        if event_score > existing_score:
            for field in ("title", "summary", "severity", "severityScore", "url", "lat", "lon", "area", "time", "updated"):
                if event.get(field):
                    existing[field] = event[field]
        existing["sourceCredibility"] = max(int(existing.get("sourceCredibility") or 0), int(event.get("sourceCredibility") or 0))
        existing["sourceCredibilityLabel"] = credibility_label(existing["sourceCredibility"])

    output = list(buckets.values())
    output.sort(key=lambda item: (int(item.get("severityScore") or 0), int(item.get("sourceCount") or 1), parse_time(item.get("time"))), reverse=True)
    return output


def event_duplicate_key(event: dict[str, Any]) -> str:
    if event.get("url"):
        return f"url:{hash_key(canonical_url(event.get('url')))}"
    title = normalize_event_title(event.get("title"))
    area = normalize_area(event.get("area") or "Global").lower()
    day = (event.get("time") or "")[:10]
    category = (event.get("category") or "event").lower()
    return f"evt:{hash_key(f'{title}:{area}:{day}:{category}')}"


def canonical_url(url: Any) -> str:
    text = clean_text(url).lower()
    text = re.sub(r"[?&](utm_[^=&]+|fbclid|gclid)=[^&]+", "", text)
    return text.rstrip("/")


def normalize_event_title(title: Any) -> str:
    text = clean_text(title).lower()
    text = re.sub(r"\s+-\s+[^-]{2,80}$", "", text)
    text = re.sub(r"[^\w\s]+", " ", text)
    words = [word for word in text.split() if word not in CHAT_STOPWORDS]
    return " ".join(words[:14]) or text[:80]


def source_credibility_score(source: Any, source_type: Any = "") -> int:
    source_name = clean_text(source).lower()
    type_name = clean_text(source_type).lower()
    score = 48
    if type_name == "official":
        score = 88
    elif "gdelt" in source_name:
        score = 72
    elif "google news" in source_name:
        score = 64
    elif type_name == "news":
        score = 62
    elif type_name in {"stored", "open-source"}:
        score = 56

    official_markers = ["defense.gov", "fema", "usgs", "nasa", "noaa", "nws", "gdacs", ".gov", "reliefweb"]
    if any(marker in source_name for marker in official_markers):
        score = max(score, 82)
    if any(marker in source_name for marker in ["blog", "social", "unknown"]):
        score = min(score, 46)
    return clamp(score, 1, 100)


def credibility_label(score: Any) -> str:
    value = int(number_or_none(score) or 0)
    if value >= 82:
        return "high"
    if value >= 65:
        return "medium"
    if value >= 45:
        return "developing"
    return "low"


def build_report(events_in: list[dict[str, Any]], source_health: list[dict[str, Any]]) -> dict[str, Any]:
    category_counts = Counter(event["category"] for event in events_in)
    source_counts = Counter(event["source"] for event in events_in)
    high_priority = [event for event in events_in if event["severityScore"] >= 68]
    critical = [event for event in events_in if event["severity"] == "critical"]
    mapped = [event for event in events_in if event["lat"] is not None and event["lon"] is not None]
    failed = [source for source in source_health if not source.get("ok")]
    hotspots = build_hotspots_from_events(events_in)
    credibility = build_source_credibility_summary(events_in)
    duplicate_groups = build_duplicate_groups(events_in)
    map_intelligence = build_map_intelligence(events_in, hotspots)
    top_category = category_counts.most_common(1)
    highest = events_in[0] if events_in else None
    latest = sorted(events_in, key=lambda item: parse_time(item["time"]), reverse=True)[0] if events_in else None
    return {
        "total": len(events_in),
        "mapped": len(mapped),
        "highPriority": len(high_priority),
        "critical": len(critical),
        "failedSources": len(failed),
        "categoryCounts": dict(category_counts),
        "sourceCounts": dict(source_counts),
        "hotspots": hotspots,
        "sourceCredibilitySummary": credibility,
        "duplicateGroups": duplicate_groups,
        "mapIntelligence": map_intelligence,
        "watchlist": high_priority[:10],
        "overview": [
            f"{len(events_in)} open-source items are active in this view, with {len(high_priority)} high-priority or critical items."
            if events_in else "No live items were returned for this view.",
            f"{label_for_category(top_category[0][0])} is the busiest category right now with {top_category[0][1]} items."
            if top_category else "No category concentration is visible yet.",
            f"{hotspots[0]['name']} is the leading hotspot by event density and severity."
            if hotspots else "No geographic hotspot is available yet.",
            f"Highest current priority: {highest['title']}." if highest else "",
            f"Latest item: {latest['title']}." if latest else "",
            f"{len(duplicate_groups)} duplicate/confirmation group(s) indicate repeated reporting across sources."
            if duplicate_groups else "No multi-source confirmation groups are visible yet.",
            f"Source credibility average: {credibility.get('average', 0)}/100."
            if credibility else "",
            f"{len(failed)} source{'s' if len(failed) != 1 else ''} failed this refresh; live data will retry automatically."
            if failed else "All configured live sources responded during this refresh.",
        ],
    }


def build_hotspots_from_events(events_in: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, Any]] = {}
    for event in events_in:
        name = normalize_area(event.get("area") or "Global")
        bucket = buckets.setdefault(
            name,
            {
                "name": name,
                "count": 0,
                "maxSeverity": 0,
                "categories": set(),
                "latest": None,
                "lat": None,
                "lon": None,
                "confirmed": 0,
                "sourceCount": 0,
            },
        )
        bucket["count"] += 1
        priority = int(event.get("analyst_priority") or event.get("severity_score") or event.get("severityScore") or 0)
        bucket["maxSeverity"] = max(bucket["maxSeverity"], priority)
        source_count = int(event.get("source_count") or event.get("sourceCount") or 1)
        bucket["sourceCount"] = max(bucket["sourceCount"], source_count)
        if source_count > 1:
            bucket["confirmed"] += 1
        bucket["categories"].add(event.get("category") or "unknown")
        if not bucket["latest"] or parse_time(event.get("time")) > parse_time(bucket["latest"]):
            bucket["latest"] = event.get("time")
        if event.get("lat") is not None and event.get("lon") is not None:
            bucket["lat"] = event.get("lat")
            bucket["lon"] = event.get("lon")
    return normalize_hotspot_buckets(buckets)


def build_hotspots_from_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    events_in = [
        {
            "area": row.get("area"),
            "severityScore": row.get("severity_score"),
            "analyst_priority": row.get("analyst_priority"),
            "category": row.get("category"),
            "time": row.get("time"),
            "lat": row.get("lat"),
            "lon": row.get("lon"),
            "source_count": row.get("source_count") or row.get("sourceCount"),
        }
        for row in rows
    ]
    return build_hotspots_from_events(events_in)


def normalize_hotspot_buckets(buckets: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    output = []
    for bucket in buckets.values():
        categories = sorted(bucket["categories"])
        output.append(
            {
                **bucket,
                "categories": categories,
                "score": bucket["count"] * 8 + bucket["maxSeverity"] + bucket.get("confirmed", 0) * 5,
            }
        )
    return sorted(output, key=lambda item: item["score"], reverse=True)[:12]


def earthquake_score(mag: float, alert: Any, tsunami: Any) -> int:
    score = 18
    if mag >= 7:
        score = 96
    elif mag >= 6:
        score = 84
    elif mag >= 5:
        score = 70
    elif mag >= 4:
        score = 52
    elif mag >= 2.5:
        score = 36
    if str(alert).lower() == "red":
        score += 8
    if str(alert).lower() == "orange":
        score += 5
    if tsunami:
        score += 8
    return clamp(score, 1, 100)


def natural_hazard_score(category: str) -> int:
    scores = {
        "wildfire": 68, "storm": 64, "volcano": 66, "flood": 70, "landslide": 62,
        "drought": 50, "dust": 38, "snow": 42, "ice": 36, "manmade": 58, "disaster": 56,
    }
    return scores.get(category, 52)


def nws_severity_score(severity: Any, urgency: Any, certainty: Any, event_name: str) -> int:
    score = {"Extreme": 94, "Severe": 82, "Moderate": 61, "Minor": 39, "Unknown": 32}.get(str(severity), 45)
    if urgency == "Immediate":
        score += 8
    if urgency == "Expected":
        score += 4
    if certainty == "Observed":
        score += 5
    if re.search(r"tornado|hurricane|flash flood|wildfire|evacuation", event_name, re.I):
        score += 7
    return clamp(score, 1, 100)


def gdelt_severity_score(category: str, title: str) -> int:
    base = {
        "military": 64,
        "geopolitical": 56,
        "economic": 52,
        "cyber": 62,
        "energy": 58,
    }.get(category, 48)
    escalators = len(extract_priority_keywords(title)) * 5
    major = 12 if re.search(r"\b(nuclear|missile|invasion|air strike|drone strike|coup|evacuation|ceasefire|sanction|earthquake|wildfire|flood|killed|dead|ransomware|blackout|currency crisis)\b", title, re.I) else 0
    return clamp(base + escalators + major, 1, 92)


def gdacs_category(item: dict[str, str], title: str) -> str:
    text = f"{item.get('eventtype', '')} {item.get('subject', '')} {title}".upper()
    if "EQ" in text or "EARTHQUAKE" in text:
        return "earthquake"
    if "WF" in text or re.search(r"wildfire|fire", text, re.I):
        return "wildfire"
    if "FL" in text or "FLOOD" in text:
        return "flood"
    if "TC" in text or re.search(r"CYCLONE|HURRICANE|TYPHOON|STORM", text, re.I):
        return "storm"
    if "VO" in text or "VOLCANO" in text:
        return "volcano"
    if "DR" in text or "DROUGHT" in text:
        return "drought"
    return "disaster"


def gdacs_severity_score(title: str, item: dict[str, str]) -> int:
    alert = f"{item.get('alertlevel', '')} {title}".lower()
    if "red" in alert:
        return 94
    if "orange" in alert:
        return 78
    if "green" in alert:
        return 48
    if re.search(r"magnitude\s*[7-9]|7\.\dM|8\.\dM|9\.\dM", title, re.I):
        return 90
    if re.search(r"magnitude\s*6|6\.\dM", title, re.I):
        return 76
    return natural_hazard_score(gdacs_category(item, title))


def gdacs_area(title: str) -> str:
    match = re.search(r"\bin\s+([^,]+?)(?:\s+\d{2}/|\s+\d{4}|\s+\(|,|$)", title or "", re.I)
    return clean_text(match.group(1) if match else "")


def classify_news_category(title: str, fallback: str = "news") -> str:
    if re.search(r"\b(cyberattack|ransomware|data breach|malware|phishing|ddos|outage|hacked|hackers?)\b", title, re.I):
        return "cyber"
    if re.search(r"\b(inflation|recession|central bank|interest rate|currency|stock market|trade|tariff|sanction|oil price|supply chain|economic)\b", title, re.I):
        return "economic"
    if re.search(r"\b(energy security|oil refinery|gas pipeline|power grid|blackout|electricity|lng|shipping disruption)\b", title, re.I):
        return "energy"
    if re.search(r"\b(military|missile|drone|troops|air strike|naval|artillery|rocket|defense ministry|army|navy|air force)\b", title, re.I):
        return "military"
    if re.search(r"\b(geopolitical|sanction|diplomacy|election|protest|border dispute|ceasefire|trade war|summit|embassy)\b", title, re.I):
        return "geopolitical"
    if re.search(r"\b(earthquake|wildfire|fire|flood|cyclone|volcano|landslide|humanitarian|evacuation|disaster)\b", title, re.I):
        return "news"
    return fallback


def nws_category(name: str) -> str:
    if re.search(r"fire|red flag", name, re.I):
        return "wildfire"
    if re.search(r"flood|flash flood", name, re.I):
        return "flood"
    if re.search(r"tornado|hurricane|cyclone|storm|thunderstorm|marine", name, re.I):
        return "storm"
    if re.search(r"winter|snow|ice|blizzard", name, re.I):
        return "snow"
    return "weather"


def normalize_eonet_category(value: Any) -> str:
    text = str(value or "").lower()
    if "wildfire" in text:
        return "wildfire"
    if "severe" in text or "storm" in text:
        return "storm"
    if "volcano" in text:
        return "volcano"
    if "flood" in text:
        return "flood"
    if "landslide" in text:
        return "landslide"
    if "drought" in text:
        return "drought"
    if "dust" in text or "haze" in text:
        return "dust"
    if "snow" in text:
        return "snow"
    if "ice" in text:
        return "ice"
    if "manmade" in text:
        return "manmade"
    return "disaster"


def infer_location(text: str) -> dict[str, Any]:
    haystack = f" {text.lower()} "
    aliases = sorted(COUNTRY_ALIASES.items(), key=lambda item: len(item[0]), reverse=True)
    for name, code in aliases:
        if re.search(rf"(^|[^a-z]){re.escape(name)}([^a-z]|$)", haystack, re.I):
            coords = COUNTRY_CENTROIDS[code]
            return {"lat": coords[0], "lon": coords[1], "area": COUNTRY_NAMES.get(code, code)}
    return {}


def opensky_state_to_aircraft(row: list[Any]) -> dict[str, Any]:
    speed = number_or_none(row[9]) if len(row) > 9 else None
    altitude = number_or_none(row[7]) if len(row) > 7 else None
    category = row[17] if len(row) > 17 else None
    return clean_traffic_asset(
        {
            "id": f"opensky:{row[0] if len(row) > 0 else hash_key(str(row))}",
            "hex": row[0] if len(row) > 0 else None,
            "callsign": clean_text(row[1] if len(row) > 1 else "") or (row[0] if len(row) > 0 else "Aircraft"),
            "label": clean_text(row[1] if len(row) > 1 else "") or (row[0] if len(row) > 0 else "Aircraft"),
            "type": "civil",
            "category": opensky_aircraft_category(category),
            "country": row[2] if len(row) > 2 else "Unknown",
            "lat": row[6] if len(row) > 6 else None,
            "lon": row[5] if len(row) > 5 else None,
            "altitudeFeet": round(altitude * 3.28084) if altitude is not None else None,
            "speedKnots": round(speed * 1.94384) if speed is not None else None,
            "track": row[10] if len(row) > 10 else None,
            "verticalRate": row[11] if len(row) > 11 else None,
            "squawk": row[14] if len(row) > 14 else None,
            "source": "OpenSky Network",
            "lastSeen": to_iso((row[4] if len(row) > 4 else None) * 1000 if len(row) > 4 and row[4] else None),
        }
    )


def airplanes_live_to_aircraft(item: dict[str, Any]) -> dict[str, Any]:
    altitude = item.get("alt_baro")
    return clean_traffic_asset(
        {
            "id": f"airplanes:{item.get('hex') or item.get('flight') or '{}:{}'.format(item.get('lat'), item.get('lon'))}",
            "hex": item.get("hex"),
            "callsign": clean_text(item.get("flight")) or item.get("hex") or "MIL",
            "label": clean_text(item.get("flight")) or item.get("r") or item.get("hex") or "MIL",
            "type": "military",
            "category": item.get("t") or item.get("type") or "Military",
            "registration": item.get("r"),
            "description": item.get("desc"),
            "country": item.get("ownOp") or item.get("operator") or "Unknown",
            "lat": item.get("lat"),
            "lon": item.get("lon"),
            "altitudeFeet": 0 if altitude == "ground" else number_or_none(altitude),
            "speedKnots": number_or_none(item.get("gs")),
            "track": item.get("track"),
            "squawk": item.get("squawk"),
            "source": "Airplanes.live",
            "lastSeen": utc_now(),
        }
    )


def traffic_payload(kind: str, source: str, region_key: str, region: dict[str, Any], aircraft: list[dict[str, Any]], fetched: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": True,
        "kind": kind,
        "source": source,
        "region": region_key,
        "regionLabel": region["label"],
        "refreshedAt": utc_now(),
        "generatedInMs": fetched.get("ms", 0),
        "cached": False,
        "count": len(aircraft),
        "aircraft": aircraft,
    }


def traffic_error_payload(kind: str, source: str, region_key: str, region: dict[str, Any], fetched: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": False,
        "kind": kind,
        "source": source,
        "region": region_key,
        "regionLabel": region["label"],
        "refreshedAt": utc_now(),
        "generatedInMs": fetched.get("ms", 0),
        "cached": False,
        "count": 0,
        "aircraft": [],
        "error": fetched.get("error") or "Traffic source failed",
    }


def has_traffic_coordinates(asset: dict[str, Any]) -> bool:
    lat = number_or_none(asset.get("lat"))
    lon = number_or_none(asset.get("lon"))
    return lat is not None and lon is not None and abs(lat) <= 90 and abs(lon) <= 180


def traffic_in_region(asset: dict[str, Any], region: dict[str, Any]) -> bool:
    if not region["flight_box"]:
        return True
    min_lat, min_lon, max_lat, max_lon = region["flight_box"]
    lat = number_or_none(asset.get("lat"))
    lon = number_or_none(asset.get("lon"))
    return lat is not None and lon is not None and min_lat <= lat <= max_lat and min_lon <= lon <= max_lon


def clean_traffic_asset(asset: dict[str, Any]) -> dict[str, Any]:
    return {key: clean_text(value) if isinstance(value, str) else value for key, value in asset.items()}


def opensky_aircraft_category(value: Any) -> str:
    return {
        0: "Unknown", 1: "Unknown", 2: "Light", 3: "Small", 4: "Large", 5: "High vortex",
        6: "Heavy", 7: "High performance", 8: "Rotorcraft", 9: "Glider", 10: "Lighter-than-air",
        11: "Parachutist", 12: "Ultralight", 14: "UAV", 15: "Space vehicle",
        16: "Emergency vehicle", 17: "Service vehicle",
    }.get(int(value) if str(value).isdigit() else -1, "Aircraft")


def centroid(geometry: dict[str, Any] | None) -> tuple[float | None, float | None]:
    if not geometry:
        return None, None
    coords: list[list[float]] = []
    collect_coordinate_pairs(geometry.get("coordinates"), coords)
    if not coords:
        return None, None
    lon_total = sum(pair[0] for pair in coords)
    lat_total = sum(pair[1] for pair in coords)
    return lat_total / len(coords), lon_total / len(coords)


def collect_coordinate_pairs(value: Any, output: list[list[float]]) -> None:
    if not isinstance(value, list) or not value:
        return
    if len(value) >= 2 and isinstance(value[0], (int, float)) and isinstance(value[1], (int, float)):
        output.append([float(value[0]), float(value[1])])
        return
    for child in value:
        collect_coordinate_pairs(child, output)


def label_for_category(category: str = "") -> str:
    return {
        "earthquake": "Earthquake", "wildfire": "Fire", "storm": "Storm", "volcano": "Volcano",
        "flood": "Flood", "landslide": "Landslide", "drought": "Drought", "dust": "Dust/Haze",
        "snow": "Snow/Ice", "ice": "Sea/Lake Ice", "manmade": "Manmade Hazard", "weather": "Weather",
        "geopolitical": "Geopolitical", "military": "Military", "news": "News", "disaster": "Natural Disaster",
        "economic": "Economic", "cyber": "Cyber", "energy": "Energy",
    }.get(category, category.replace("-", " ").title())


def score_to_severity(score: int) -> str:
    if score >= 86:
        return "critical"
    if score >= 68:
        return "high"
    if score >= 45:
        return "moderate"
    return "low"


def risk_label(score: int) -> str:
    if score >= 75:
        return "critical"
    if score >= 45:
        return "high"
    if score >= 20:
        return "moderate"
    return "low"


def normalize_area(area: str) -> str:
    text = clean_text(area)
    text = re.sub(r"\b\d+\s*(km|mi|miles|kilometers)\b", "", text, flags=re.I)
    text = re.sub(r"\b(N|S|E|W|NE|NW|SE|SW)\b", "", text)
    parts = re.split(r"\sof\s", text, flags=re.I)
    focus = parts[-1] if parts else text
    return ", ".join([part.strip() for part in focus.split(",")[-2:] if part.strip()]) or "Global"


def parse_gdelt_date(value: Any) -> str:
    text = str(value or "")
    match = re.match(r"^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$", text)
    if match:
        year, month, day, hour, minute, second = map(int, match.groups())
        return datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc).isoformat()
    return parse_date_or_now(text)


def parse_date_or_now(value: Any) -> str:
    parsed = parse_time(value)
    return parsed.isoformat()


def parse_date_or_none(value: Any) -> str | None:
    if value in (None, ""):
        return None
    return parse_date_or_now(value)


def parse_time(value: Any) -> datetime:
    if value in (None, ""):
        return datetime.now(timezone.utc)
    if isinstance(value, (int, float)):
        timestamp = float(value)
        if timestamp > 100000000000:
            timestamp /= 1000
        return datetime.fromtimestamp(timestamp, timezone.utc)
    text = str(value).strip()
    for fmt in ("%a, %d %b %Y %H:%M:%S %Z", "%a, %d %b %Y %H:%M:%S %z"):
        try:
            parsed = datetime.strptime(text, fmt)
            return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    text = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return datetime.now(timezone.utc)


def to_iso(value: Any) -> str | None:
    if value in (None, ""):
        return None
    return parse_time(value).isoformat()


def extract_trailing_publisher(title: str) -> str:
    parts = title.split(" - ")
    return clean_text(parts[-1]) if len(parts) > 1 else ""


def remove_trailing_publisher(title: str) -> str:
    parts = title.split(" - ")
    return clean_text(" - ".join(parts[:-1]) if len(parts) > 1 else title)


def extract_priority_keywords(text: str) -> list[str]:
    keywords = [
        "missile", "drone", "air strike", "troops", "naval", "border", "sanction", "ceasefire",
        "evacuation", "earthquake", "wildfire", "flood", "volcano", "coup", "nuclear", "killed",
        "inflation", "recession", "central bank", "oil", "pipeline", "cyberattack", "ransomware",
        "data breach", "outage", "supply chain",
    ]
    lower = text.lower()
    return [keyword for keyword in keywords if keyword in lower]


def strip_html(value: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", " ", value or ""))


def clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def number_or_none(value: Any) -> float | None:
    try:
        if value in (None, ""):
            return None
        number = float(value)
        return number if number == number else None
    except (TypeError, ValueError):
        return None


def clamp(value: float | int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, int(value)))


def hash_key(value: Any) -> str:
    return hashlib.sha1(str(value).encode("utf-8", errors="ignore")).hexdigest()[:16]


def compact_json(value: Any) -> Any:
    text = json.dumps(value, ensure_ascii=True)
    if len(text) <= 5000:
        return value
    return {"truncated": True, "preview": text[:5000]}


def json_loads(value: str, fallback: Any) -> Any:
    try:
        return json.loads(value)
    except Exception:
        return fallback


def top_item(mapping: dict[str, int]) -> tuple[str, int] | None:
    return next(iter(Counter(mapping).most_common(1)), None)


def get_cached(key: str, ttl: int) -> dict[str, Any] | None:
    cached = cache.get(key)
    if not cached:
        return None
    if time.time() - cached["created_at"] > ttl:
        cache.pop(key, None)
        return None
    return cached["payload"]


def set_cached(key: str, payload: dict[str, Any]) -> None:
    cache[key] = {"created_at": time.time(), "payload": payload}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def save_chat_message(role: str, message: str) -> None:
    message_id = next_sequence("chat_messages")
    db().chat_messages.insert_one(
        {
            "_id": message_id,
            "id": message_id,
            "role": role,
            "message": message,
            "created_at": utc_now(),
        }
    )


@app.get("/{requested_path:path}", include_in_schema=False, response_model=None)
async def static_files(requested_path: str):
    path = requested_path or "index.html"
    file_path = (PUBLIC_DIR / path).resolve()
    try:
        file_path.relative_to(PUBLIC_DIR.resolve())
    except ValueError:
        return PlainTextResponse("Forbidden", status_code=403)
    if file_path.is_dir():
        file_path = file_path / "index.html"
    if not file_path.exists():
        return PlainTextResponse("Not found", status_code=404)
    return FileResponse(file_path)

