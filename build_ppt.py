# -*- coding: utf-8 -*-
"""GOD EYE project deck — polished build with embedded diagrams and app screenshots."""
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from PIL import Image
import os

# ---------- Theme ----------
BG      = RGBColor(0x0A, 0x0E, 0x1A)
PANEL   = RGBColor(0x14, 0x1C, 0x2E)
PANEL2  = RGBColor(0x1B, 0x26, 0x3C)
CYAN    = RGBColor(0x22, 0xD3, 0xEE)
TEAL    = RGBColor(0x2D, 0xD4, 0xBF)
AMBER   = RGBColor(0xF5, 0x9E, 0x0B)
PURPLE  = RGBColor(0x8B, 0x5C, 0xF6)
WHITE   = RGBColor(0xE6, 0xED, 0xF7)
MUTED   = RGBColor(0x9C, 0xAB, 0xBE)
DARKTXT = RGBColor(0x0A, 0x0E, 0x1A)
RED     = RGBColor(0xF8, 0x71, 0x71)

FONT = "Segoe UI"
FONT_LIGHT = "Segoe UI Light"

prs = Presentation()
prs.slide_width  = Inches(13.333)
prs.slide_height = Inches(7.5)
SW, SH = prs.slide_width, prs.slide_height
BLANK = prs.slide_layouts[6]
DIAG = "C:/Users/racha/OneDrive/Documents/OSINT-2/diagrams/"
PHOTOS = "D:/Project Sem-9/photos/"

def bg(slide, color=BG):
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = color

def rect(slide, x, y, w, h, fill, line=None, shape=MSO_SHAPE.RECTANGLE):
    shp = slide.shapes.add_shape(shape, x, y, w, h)
    shp.fill.solid()
    shp.fill.fore_color.rgb = fill
    if line is None:
        shp.line.fill.background()
    else:
        shp.line.color.rgb = line
        shp.line.width = Pt(1.4)
    shp.shadow.inherit = False
    return shp

def txt(slide, x, y, w, h, text, size=18, color=WHITE, bold=False, align=PP_ALIGN.LEFT,
        font=FONT, anchor=MSO_ANCHOR.TOP, line_spacing=1.0, space_after=0):
    tb = slide.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    for i, ln in enumerate(text.split("\n")):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = line_spacing
        if space_after:
            p.space_after = Pt(space_after)
        r = p.add_run()
        r.text = ln
        r.font.size = Pt(size)
        r.font.color.rgb = color
        r.font.bold = bold
        r.font.name = font
    return tb

def set_run(r, text, size, color, bold=False, font=FONT, italic=False):
    r.text = text
    r.font.size = Pt(size)
    r.font.color.rgb = color
    r.font.bold = bold
    r.font.italic = italic
    r.font.name = font

def title_bar(slide, text, kicker=None):
    rect(slide, Inches(0), Inches(0), Inches(0.18), SH, CYAN)
    txt(slide, Inches(0.55), Inches(0.3), Inches(12.4), Inches(0.55),
        text, size=29, bold=True, color=WHITE)
    if kicker:
        txt(slide, Inches(0.57), Inches(0.9), Inches(12.4), Inches(0.35),
            kicker, size=12.5, color=CYAN, bold=True)
    rect(slide, Inches(0.57), Inches(1.32), Inches(2.1), Pt(2.4), CYAN)

def bullets(slide, items, x, y, w, h, size=16, color=WHITE, gap=8,
            bullet_color=CYAN, line_spacing=1.05):
    tb = slide.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame
    tf.word_wrap = True
    first = True
    for it in items:
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        p.line_spacing = line_spacing
        p.space_after = Pt(gap)
        r0 = p.add_run(); set_run(r0, "\u25B8  ", size, bullet_color, bold=True)
        r = p.add_run(); set_run(r, it, size, color)
    return tb

def card(slide, x, y, w, h, title, body, title_color=CYAN, size=13.5, fill=PANEL):
    rect(slide, x, y, w, h, fill, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    txt(slide, x + Inches(0.24), y + Inches(0.16), w - Inches(0.48), Inches(0.4),
        title, size=15, bold=True, color=title_color)
    tb = slide.shapes.add_textbox(x + Inches(0.24), y + Inches(0.62),
                                  w - Inches(0.48), h - Inches(0.78))
    tf = tb.text_frame; tf.word_wrap = True
    first = True
    for ln in body:
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        p.line_spacing = 1.02
        p.space_after = Pt(5)
        r = p.add_run(); set_run(r, "\u2013  " + ln, size, MUTED)
    return

def badge_w(text, size):
    return Inches(0.5 + len(text) * size * 0.0076)

def badge(slide, x, y, text, color=CYAN, size=13, fill=PANEL2):
    w = badge_w(text, size)
    shp = rect(slide, x, y, w, Inches(0.46), fill, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    tf = shp.text_frame
    tf.word_wrap = False
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    tf.margin_left = Inches(0.08); tf.margin_right = Inches(0.08)
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
    r = p.add_run(); set_run(r, text, size, color, bold=True)
    return w

def badge_row(slide, items, x, y, color=CYAN, size=13, gap=0.24, max_w=Inches(11.7)):
    cx = x; cy = y
    for t in items:
        w = badge_w(t, size)
        if cx + w > x + max_w:
            cx = x
            cy += Inches(0.6)
        badge(slide, cx, cy, t, color=color, size=size)
        cx += w + Inches(gap)
    return cy + Inches(0.6)

def tech_row(slide, y, label, items, color, size=12.5, gap=0.2):
    txt(slide, Inches(0.9), y, Inches(2.55), Inches(0.46), label,
        size=14, bold=True, color=color, anchor=MSO_ANCHOR.MIDDLE)
    return badge_row(slide, items, Inches(3.7), y, color=color, size=size,
                     gap=gap, max_w=Inches(8.7))

def add_diagram(slide, name, x, y, max_w, max_h, center_horiz=True):
    path = DIAG + name + ".png"
    im = Image.open(path)
    w, h = im.size
    aspect = h / w
    dw = max_w
    dh = dw * aspect
    if dh > max_h:
        dh = max_h
        dw = dh / aspect
    if center_horiz:
        x = Emu(int((SW - Emu(Inches(dw))) / 2))
    else:
        x = Inches(x)
    slide.shapes.add_picture(path, x, Inches(y), width=Inches(dw), height=Inches(dh))
    return dw, dh

def footer(slide, n):
    txt(slide, Inches(12.35), Inches(7.06), Inches(0.8), Inches(0.35),
        str(n), size=11, color=MUTED, align=PP_ALIGN.RIGHT)

def reticle(slide, cx, cy, r1, r2):
    for r, lw in [(r1, 2.0), (r2, 1.2)]:
        o = slide.shapes.add_shape(MSO_SHAPE.OVAL, cx - r, cy - r, 2 * r, 2 * r)
        o.fill.background(); o.line.color.rgb = CYAN; o.line.width = Pt(lw)
        o.shadow.inherit = False
    ln = slide.shapes.add_connector(1, cx - r1, cy, cx + r1, cy)
    ln.line.color.rgb = CYAN; ln.line.width = Pt(1.2)
    ln2 = slide.shapes.add_connector(1, cx, cy - r1, cx, cy + r1)
    ln2.line.color.rgb = CYAN; ln2.line.width = Pt(1.2)
    dot = slide.shapes.add_shape(MSO_SHAPE.OVAL, cx - 3, cy - 3, 6, 6)
    dot.fill.solid(); dot.fill.fore_color.rgb = CYAN; dot.line.fill.background()
    dot.shadow.inherit = False

# =====================================================================
# SLIDE 1 — Title
# =====================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
rect(s, Inches(0), Inches(6.9), SW, Inches(0.6), CYAN)
rect(s, Inches(0), Inches(0), Inches(0.5), SH, CYAN)
reticle(s, Emu(Inches(11.2)), Emu(Inches(1.75)), Emu(Inches(1.35)), Emu(Inches(0.9)))

txt(s, Inches(1.0), Inches(1.5), Inches(9.5), Inches(0.5),
    "FINAL YEAR PROJECT PRESENTATION", size=14, color=CYAN, bold=True)
txt(s, Inches(1.0), Inches(2.0), Inches(11.0), Inches(1.8),
    "GOD EYE", size=72, bold=True, color=WHITE, font=FONT_LIGHT)
txt(s, Inches(1.0), Inches(3.2), Inches(11.0), Inches(0.95),
    "Cloud-Native OSINT Intelligence Dashboard\nwith 3D Geospatial Globe Companion",
    size=21, color=MUTED)
rect(s, Inches(1.05), Inches(4.35), Inches(2.4), Pt(2.6), CYAN)

txt(s, Inches(1.0), Inches(4.6), Inches(11.0), Inches(0.5),
    "Prepared by:  Prerak Hardik Thaker", size=20, bold=True, color=WHITE)
txt(s, Inches(1.0), Inches(5.2), Inches(11.0), Inches(0.45),
    "Center for Professional Courses (CPC), Gujarat University", size=16, color=TEAL)
txt(s, Inches(1.0), Inches(5.75), Inches(11.0), Inches(0.45),
    "Guided by:  ______________________________", size=16, color=WHITE)
footer(s, 1)

# =====================================================================
# SLIDE 2 — Agenda
# =====================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
title_bar(s, "Agenda", "WHAT THIS PRESENTATION COVERS")
items = [
    "Introduction & Problem Statement",
    "Objectives",
    "System Architecture",
    "Technologies Used",
    "Key Features",
    "Data Sources & OSINT Collection",
    "AI-Powered Intelligence (DeepSeek)",
    "Reporting & Analytics",
    "3D Geospatial Companion",
    "Database Design (MongoDB Atlas)",
    "Cloud Deployment on AWS",
    "CI/CD Pipeline",
    "Security Design",
    "Conclusion & Future Scope",
    "Application Walkthrough (Screenshots)",
]
for col, start in [(0.9, 0), (6.95, 7), (13.0, 14)]:
    if start >= len(items): continue
    tb = s.shapes.add_textbox(Inches(col), Inches(1.7), Inches(5.6), Inches(5.3))
    tf = tb.text_frame; tf.word_wrap = True
    for j, it in enumerate(items[start:start + 7]):
        p = tf.paragraphs[0] if j == 0 else tf.add_paragraph()
        p.space_after = Pt(14)
        r = p.add_run(); set_run(r, "%02d   " % (start + j + 1), 17, CYAN, bold=True)
        r = p.add_run(); set_run(r, it, 18, WHITE)
footer(s, 2)

# =====================================================================
# SLIDE 3 — Introduction
# =====================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
title_bar(s, "Introduction", "OVERVIEW OF GOD EYE")
txt(s, Inches(0.9), Inches(1.6), Inches(11.5), Inches(1.0),
    "GOD EYE is a cloud-native OSINT intelligence dashboard that collects, stores, analyzes, "
    "and visualizes open-source global incident data from live public feeds.",
    size=19, color=WHITE, line_spacing=1.15)
card(s, Inches(0.9), Inches(2.85), Inches(3.8), Inches(3.5), "COLLECT",
     ["Aggregates many live public feeds", "Global incident & intelligence coverage"], CYAN)
card(s, Inches(4.95), Inches(2.85), Inches(3.8), Inches(3.5), "ANALYZE",
     ["Severity & credibility scoring", "Duplicate event merging", "Trend & hotspot analytics"], TEAL)
card(s, Inches(9.0), Inches(2.85), Inches(3.8), Inches(3.5), "PRESENT",
     ["Interactive map dashboard", "3D geospatial globe", "AI analyst reports & PDFs"], AMBER)
footer(s, 3)

# =====================================================================
# SLIDE 4 — Problem Statement
# =====================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
title_bar(s, "Problem Statement", "THE GAP THIS PROJECT FILLS")
rect(s, Inches(0.9), Inches(1.7), Inches(5.7), Inches(4.95), PANEL, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, Inches(1.15), Inches(1.9), Inches(5.2), Inches(0.45), "THE PROBLEM",
    size=16, bold=True, color=RED)
bullets(s, [
    "Open-source incident data is scattered across many unrelated feeds",
    "No single view for geopolitical, military, economic, cyber & hazard events",
    "Manual aggregation is slow, unstructured, hard to analyze",
    "Hard to separate strong signals from weak or duplicate reports",
], Inches(1.15), Inches(2.5), Inches(5.2), Inches(4.0), size=14.5, gap=12, bullet_color=RED)

rect(s, Inches(6.9), Inches(1.7), Inches(5.7), Inches(4.95), PANEL, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, Inches(7.15), Inches(1.9), Inches(5.2), Inches(0.45), "THE SOLUTION",
    size=16, bold=True, color=TEAL)
bullets(s, [
    "One searchable, filterable intelligence dashboard",
    "Map-based event visualization with hotspots",
    "Credibility scoring and duplicate merging",
    "AI-generated analyst briefs and downloadable PDF reports",
], Inches(7.15), Inches(2.5), Inches(5.2), Inches(4.0), size=14.5, gap=12, bullet_color=TEAL)
footer(s, 4)

# =====================================================================
# SLIDE 5 — Objectives
# =====================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
title_bar(s, "Objectives", "WHAT THE SYSTEM ACHIEVES")
objs = [
    ("Centralize", "Combine multiple live OSINT feeds into a single dashboard"),
    ("Analyze", "Score source credibility and merge duplicate events"),
    ("Visualize", "Map-based intelligence with hotspots and a 3D globe"),
    ("Report", "DeepSeek-powered analyst reports with styled PDF export"),
    ("Deploy", "Production-ready AWS architecture with CI/CD automation"),
]
y = 1.75
for i, (h, d) in enumerate(objs, 1):
    c = rect(s, Inches(0.9), Inches(y), Inches(0.62), Inches(0.62), CYAN, shape=MSO_SHAPE.OVAL)
    tf = c.text_frame; tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
    r = p.add_run(); set_run(r, str(i), 20, DARKTXT, bold=True)
    txt(s, Inches(1.75), Inches(y - 0.03), Inches(3.0), Inches(0.5), h,
        size=19, bold=True, color=CYAN)
    txt(s, Inches(4.85), Inches(y + 0.02), Inches(7.7), Inches(0.75), d,
        size=16, color=MUTED, line_spacing=1.0)
    y += 0.98
footer(s, 5)

# =====================================================================
# SLIDE 6 — System Architecture (embedded diagram)
# =====================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
title_bar(s, "System Architecture", "END-TO-END DATA PIPELINE")
dw, dh = add_diagram(s, "system_arch", 0, 1.6, 12.0, 4.9)
rect(s, Inches(0.9), Inches(1.6 + dh + 0.15), Inches(11.55), Inches(0.55),
     PANEL2, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, Inches(1.15), Inches(1.6 + dh + 0.26), Inches(11.2), Inches(0.4),
    "Live feeds flow through a single FastAPI pipeline into MongoDB Atlas, where DeepSeek turns them "
    "into analyst intelligence and the dashboard visualizes them.",
    size=13, color=MUTED)
footer(s, 6)

# =====================================================================
# SLIDE 7 — Technologies Used
# =====================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
title_bar(s, "Technologies Used", "THE BUILDING BLOCKS")

groups = [
    ("BACKEND", ["Python", "FastAPI", "Uvicorn", "ReportLab"], CYAN),
    ("FRONTEND", ["HTML", "CSS", "JavaScript", "CesiumJS"], TEAL),
    ("DATABASE", ["MongoDB Atlas"], AMBER),
    ("AI ENGINE", ["DeepSeek API"], PURPLE),
    ("DATA & GEO", ["OSINT APIs", "RSS Feeds", "GDELT", "Google Maps"], TEAL),
    ("CLOUD & DEVOPS",
     ["EC2", "Auto Scaling", "ALB", "VPC", "S3", "CodeDeploy", "IAM",
      "Secrets Manager", "Route 53", "CloudWatch", "SNS", "GitHub Actions"], CYAN),
]

y = Inches(1.6)
for label, items, color in groups:
    y = tech_row(s, y, label, items, color) + Inches(0.12)
footer(s, 7)

# =====================================================================
# SLIDE 8 — Key Features
# =====================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
title_bar(s, "Key Features", "CAPABILITIES OF THE DASHBOARD")
left = [
    "Real-time OSINT dashboard for global incidents",
    "Geopolitical, military, economic, cyber & hazard monitoring",
    "DeepSeek-powered analyst chatbot & incident reports",
    "MongoDB Atlas storage for events, reports & chat",
    "Multiple AI report templates",
    "Downloadable styled PDF intelligence reports",
    "Saved report library with search, tags & filters",
    "Source credibility scoring",
]
right = [
    "Duplicate event merging with confirmation counts",
    "Dashboard analytics (totals, priorities, hotspots, feed quality)",
    "Interactive map intelligence with severity concentration",
    "Expanded Shadowbroker-inspired source pack",
    "3D geospatial globe companion launcher",
    "Google Maps Platform globe rendering",
    "GitHub Actions CI verification & AWS deployment",
    "Load-balanced, auto-scaled, secure cloud deployment",
]
for colx, items, color in [(0.9, left, CYAN), (7.0, right, TEAL)]:
    tb = s.shapes.add_textbox(Inches(colx), Inches(1.7), Inches(5.6), Inches(5.3))
    tf = tb.text_frame; tf.word_wrap = True
    for i, it in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.space_after = Pt(11)
        r = p.add_run(); set_run(r, "\u25B8  ", 16, color, bold=True)
        r = p.add_run(); set_run(r, it, 15, WHITE)
footer(s, 8)

# =====================================================================
# SLIDE 9 — Data Sources & Collection
# =====================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
title_bar(s, "Data Sources & Collection", "LIVE OPEN-SOURCE INTELLIGENCE FEEDS")
srcs = [
    "USGS Earthquake GeoJSON Feeds",
    "NASA EONET Natural Events",
    "NOAA / NWS Active Alerts",
    "GDACS Disaster RSS",
    "Defense.gov & FEMA RSS",
    "Google News RSS / Search",
    "GDELT 2.1 Document API",
    "OpenSky Aircraft States",
    "Airplanes.live Military Aviation",
    "CISA Known Exploited Vulnerabilities",
    "abuse.ch Feodo Tracker / URLhaus",
    "World & Regional News (BBC, Al Jazeera, SCMP, DW ...)",
]
cols, rows = 3, 4
cw = Inches(3.95); ch = Inches(0.82); gapx = Inches(0.15); gapy = Inches(0.2)
x0 = Inches(0.9); y0 = Inches(1.7)
for i, src in enumerate(srcs):
    cx = x0 + (i % cols) * (cw + gapx)
    cy = y0 + (i // cols) * (ch + gapy)
    shp = rect(s, cx, cy, cw, ch, PANEL, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    tf = shp.text_frame; tf.word_wrap = True; tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    tf.margin_left = Inches(0.15); tf.margin_right = Inches(0.1)
    p = tf.paragraphs[0]
    r = p.add_run(); set_run(r, "\u25B8  ", 13, CYAN, bold=True)
    r = p.add_run(); set_run(r, src, 12.5, WHITE)
footer(s, 9)

# =====================================================================
# SLIDE 10 — AI Integration (DeepSeek)
# =====================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
title_bar(s, "AI-Powered Intelligence", "DEEPSEEK API AS THE ANALYST ENGINE")
card(s, Inches(0.9), Inches(1.7), Inches(5.7), Inches(2.5), "WHAT DEEPSEEK DOES",
     ["Analyst-style summaries from OSINT context", "Incident briefs and report templates",
      "Chatbot Q&A over collected intelligence", "Structured, template-driven outputs"], CYAN, size=13.5)
card(s, Inches(6.85), Inches(1.7), Inches(5.7), Inches(2.5), "AI REPORT TEMPLATES",
     ["Executive Brief", "Military SITREP", "Geopolitical Risk", "Economic Impact",
      "Cyber / Security Brief", "Daily Intelligence Summary"], TEAL, size=13.5)
rect(s, Inches(0.9), Inches(4.5), Inches(11.65), Inches(1.0), PANEL2, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, Inches(1.2), Inches(4.66), Inches(5.0), Inches(0.7),
    "Model: deepseek-v4-flash\nBase URL: api.deepseek.com", size=13, color=WHITE, line_spacing=1.2)
txt(s, Inches(5.7), Inches(4.66), Inches(6.7), Inches(0.7),
    "Configured via secrets \u2014 never hard-coded in source\nThinking mode disabled; reasoning effort: high",
    size=13, color=MUTED, line_spacing=1.2)
txt(s, Inches(0.9), Inches(5.7), Inches(11.5), Inches(0.6),
    "DeepSeek remains the single AI engine for chatbot responses and report generation across the platform.",
    size=14, color=MUTED, line_spacing=1.1)
footer(s, 10)

# =====================================================================
# SLIDE 11 — Reporting & Analytics
# =====================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
title_bar(s, "Reporting & Analytics", "FROM RAW FEEDS TO DECISIONS")
card(s, Inches(0.9), Inches(1.7), Inches(3.8), Inches(3.3), "ANALYTICS",
     ["Event totals & priority levels", "Mapped vs. unmapped coverage", "Category & hotspot breakdown",
      "Feed quality & source health"], CYAN, size=13)
card(s, Inches(4.95), Inches(1.7), Inches(3.8), Inches(3.3), "REPORT LIBRARY",
     ["Search & template filtering", "Metadata, tags, event counts",
      "Priority & hotspot counts", "Credibility labels"], TEAL, size=13)
card(s, Inches(9.0), Inches(1.7), Inches(3.8), Inches(3.3), "PDF EXPORT",
     ["ReportLab styled PDF reports", "Template, summary & metrics",
      "Priority intelligence & hotspots", "Collection gaps where found"], AMBER, size=13)
rect(s, Inches(0.9), Inches(5.25), Inches(11.65), Inches(1.05), PANEL2, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, Inches(1.2), Inches(5.4), Inches(11.1), Inches(0.8),
    "Credibility scoring separates strong signals from weak or incomplete sources; duplicate-event "
    "merging groups repeated reports while preserving source-confirmation counts.",
    size=14, color=WHITE, line_spacing=1.15)
footer(s, 11)

# =====================================================================
# SLIDE 12 — 3D Geospatial Companion
# =====================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
title_bar(s, "3D Geospatial Companion", "RICHER SPATIAL AWARENESS")
txt(s, Inches(0.9), Inches(1.6), Inches(11.6), Inches(0.7),
    "A photorealistic 3D globe runs beside the main dashboard to add live geospatial context \u2014 "
    "the main GOD EYE app remains the intelligence and reporting system.",
    size=16, color=WHITE, line_spacing=1.15)
badge_row(s, ["Live aircraft & military ADS-B layers", "Satellites & vessels",
              "Active fires & CCTV context", "Terrain & geospatial overlays"],
          Inches(0.9), Inches(2.5), color=CYAN, size=13, max_w=Inches(11.7))
rect(s, Inches(0.9), Inches(3.85), Inches(11.65), Inches(2.85), PANEL, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, Inches(1.2), Inches(4.05), Inches(11.0), Inches(0.4), "HOW IT RUNS",
    size=15, bold=True, color=TEAL)
bullets(s, [
    "Main dashboard on port 4173  \u2014  3D globe companion on port 4174",
    "Dedicated 3D Globe page launches the companion and shows provider status",
    "Optional Google Maps Platform (Map Tiles API) for photorealistic rendering",
    "Disabled by default in AWS \u2014 enabled via GLOBE_ENABLED=true after billing controls",
], Inches(1.2), Inches(4.55), Inches(11.1), Inches(2.0), size=14, gap=10)
footer(s, 12)

# =====================================================================
# SLIDE 13 — Database Design
# =====================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
title_bar(s, "Database Design", "MONGODB ATLAS \u2014 DATABASE: gods_eye")
rows = [
    ("Collection", "Purpose"),
    ("events", "Stored OSINT events from live feeds"),
    ("analyst_reports", "Saved reports + PDF report source data"),
    ("chat_messages", "Analyst chatbot conversation history"),
    ("ioc_lookups", "Legacy IOC lookup history"),
    ("provider_results", "Provider lookup history"),
    ("counters", "Application counters"),
]
gtbl = s.shapes.add_table(len(rows), 2, Inches(0.9), Inches(1.8),
                          Inches(11.65), Inches(3.7)).table
gtbl.columns[0].width = Inches(3.7)
gtbl.columns[1].width = Inches(7.95)
for r, (c0, c1) in enumerate(rows):
    gtbl.rows[r].height = Inches(0.52)
    a = gtbl.cell(r, 0); b = gtbl.cell(r, 1)
    a.text = c0; b.text = c1
    for cell in (a, b):
        cell.fill.solid()
        cell.fill.fore_color.rgb = PANEL2 if r == 0 else PANEL
        cell.margin_left = Inches(0.18); cell.margin_top = Inches(0.06)
        cell.vertical_anchor = MSO_ANCHOR.MIDDLE
        for p in cell.text_frame.paragraphs:
            for run in p.runs:
                run.font.name = FONT
                run.font.size = Pt(15 if r == 0 else 14)
                run.font.color.rgb = CYAN if r == 0 else WHITE
                run.font.bold = (r == 0)
rect(s, Inches(0.9), Inches(5.7), Inches(11.65), Inches(0.75), PANEL2, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, Inches(1.2), Inches(5.84), Inches(11.0), Inches(0.5),
    "MongoDB Atlas keeps reports, events, chats, and source history available across deployments.",
    size=14, color=MUTED)
footer(s, 13)

# =====================================================================
# SLIDE 14 — AWS Deployment (embedded diagram)
# =====================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
title_bar(s, "Cloud Deployment on AWS", "SECURE, LOAD-BALANCED, AUTO-SCALED")
dw, dh = add_diagram(s, "aws_arch", 0, 1.55, 12.6, 5.3)
footer(s, 14)

# =====================================================================
# SLIDE 15 — CI/CD Pipeline (embedded diagram)
# =====================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
title_bar(s, "CI/CD Pipeline", "GIT-BASED AUTOMATED DEPLOYMENT")
dw, dh = add_diagram(s, "cicd", 0, 1.6, 12.2, 4.6)
rect(s, Inches(0.9), Inches(1.6 + dh + 0.15), Inches(11.65), Inches(0.55),
     PANEL2, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
txt(s, Inches(1.15), Inches(1.6 + dh + 0.26), Inches(11.2), Inches(0.4),
    "GitHub OIDC assumes an IAM role \u2014 no long-lived AWS access keys are ever stored in the repository.",
    size=13, color=MUTED)
footer(s, 15)

# =====================================================================
# SLIDE 16 — Security Design
# =====================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
title_bar(s, "Security Design", "DEFENSE IN DEPTH")
sec = [
    ("Network", "App instances run in private subnets; only the ALB is publicly exposed"),
    ("Access", "EC2 app port 4173 reachable only from the ALB security group"),
    ("Data", "MongoDB Atlas accessed through the NAT Gateway Elastic IP"),
    ("Secrets", "Keys & DB credentials never stored in code; AWS Secrets Manager holds prod secrets"),
    ("Identity", "GitHub OIDC assumes an IAM role instead of static access keys"),
    ("Keys", "Google Maps keys restricted by API and HTTP referrer before public use"),
]
y = 1.7
for h, d in sec:
    rect(s, Inches(0.9), Inches(y), Inches(2.3), Inches(0.66), PANEL2, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    txt(s, Inches(0.9), Inches(y + 0.16), Inches(2.3), Inches(0.4), h,
        size=15, bold=True, color=CYAN, align=PP_ALIGN.CENTER)
    txt(s, Inches(3.45), Inches(y + 0.06), Inches(9.2), Inches(0.75), d,
        size=14, color=MUTED, line_spacing=1.02)
    y += 0.82
footer(s, 16)

# =====================================================================
# SLIDE 17 — Conclusion
# =====================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
title_bar(s, "Conclusion", "WHAT WAS DELIVERED")
txt(s, Inches(0.9), Inches(1.6), Inches(11.5), Inches(1.3),
    "GOD EYE delivers a production-ready, cloud-native OSINT intelligence dashboard that turns "
    "scattered open-source feeds into a single, searchable, AI-assisted intelligence platform.",
    size=19, color=WHITE, line_spacing=1.2)
pts = [
    "DeepSeek-powered analysis and report generation",
    "MongoDB Atlas persistence with a rich saved-report library",
    "Credibility scoring, duplicate merging, and map intelligence",
    "3D geospatial globe companion for spatial awareness",
    "Secure AWS networking with load balancing and auto scaling",
    "Git-based CI/CD with monitoring and secrets management",
]
tb = s.shapes.add_textbox(Inches(0.9), Inches(3.05), Inches(11.5), Inches(3.2))
tf = tb.text_frame; tf.word_wrap = True
for i, p in enumerate(pts):
    para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
    para.space_after = Pt(13)
    r = para.add_run(); set_run(r, "\u25B8  ", 17, CYAN, bold=True)
    r = para.add_run(); set_run(r, p, 17, WHITE)
footer(s, 17)

# =====================================================================
# SLIDE 18 — Future Scope
# =====================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
title_bar(s, "Future Scope", "WHERE THE PROJECT CAN GO NEXT")
future = [
    ("More Intelligence", "Additional specialist feeds, threat-intel providers, and language coverage"),
    ("Deeper ML", "Automated event classification and anomaly detection"),
    ("Real-time Alerting", "SNS/email push alerts for high-severity events"),
    ("Public Globe", "Hosted 3D globe with separate subdomain and CDN"),
    ("Multi-tenant SaaS", "Role-based access and multi-organization support"),
    ("Advanced Visuals", "Timeline, network graph, and relationship views"),
]
y = 1.7
for h, d in future:
    rect(s, Inches(0.9), Inches(y), Inches(3.4), Inches(0.78), PANEL, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    txt(s, Inches(1.05), Inches(y + 0.19), Inches(3.1), Inches(0.45), h,
        size=15, bold=True, color=TEAL)
    txt(s, Inches(4.5), Inches(y + 0.12), Inches(8.1), Inches(0.7), d,
        size=14, color=MUTED, line_spacing=1.02)
    y += 0.87
footer(s, 18)

# =====================================================================
# SLIDE 19 — Application Walkthrough
# =====================================================================
screenshots = [
    ("Screenshot 2026-09-07 110032.png", "Main Intelligence Dashboard\nShowing global incident aggregation and severity hotspots."),
    ("Screenshot 2026-09-07 110303.png", "AI Analyst Report\nDeepSeek-generated intelligence summary with professional styling."),
    ("Screenshot 2026-09-07 111343.png", "3D Geospatial Companion\nInteractive 3D globe rendering for spatial situational awareness."),
]

for i, (img_name, desc) in enumerate(screenshots):
    s = prs.slides.add_slide(BLANK)
    bg(s)
    title_bar(s, "Application Walkthrough", f"LIVE SYSTEM PREVIEW {i+1}/{len(screenshots)}")
    
    img_path = PHOTOS + img_name
    # Center image
    img_w = Inches(10.0)
    img_h = Inches(4.5)
    s.shapes.add_picture(img_path, (SW - img_w)/2, Inches(1.8), width=img_w, height=img_h)
    
    # Description card
    rect(s, Inches(1.6), Inches(6.4), Inches(10.1), Inches(0.8), PANEL2, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    txt(s, Inches(1.8), Inches(6.55), Inches(9.7), Inches(0.5), 
        desc, size=16, color=WHITE, align=PP_ALIGN.CENTER)
    
    footer(s, 19 + i)

# =====================================================================
# SLIDE 22 — Thank You
# =====================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
rect(s, Inches(0), Inches(6.9), SW, Inches(0.6), CYAN)
rect(s, Inches(0), Inches(0), Inches(0.5), SH, CYAN)
reticle(s, Emu(Inches(6.66)), Emu(Inches(1.55)), Emu(Inches(1.05)), Emu(Inches(0.7)))
txt(s, Inches(1.0), Inches(2.35), Inches(11.3), Inches(1.4),
    "Thank You", size=64, bold=True, color=WHITE, font=FONT_LIGHT, align=PP_ALIGN.CENTER)
txt(s, Inches(1.0), Inches(3.95), Inches(11.3), Inches(0.7),
    "Questions & Discussion", size=22, color=CYAN, align=PP_ALIGN.CENTER)
txt(s, Inches(1.0), Inches(4.95), Inches(11.3), Inches(0.5),
    "Prerak Hardik Thaker  \u00B7  Center for Professional Courses (CPC), Gujarat University",
    size=15, color=MUTED, align=PP_ALIGN.CENTER)
footer(s, 19 + len(screenshots))

# ---------- save ----------
out = "C:/Users/racha/OneDrive/Documents/OSINT-2/GOD_EYE_Project_Presentation.pptx"
prs.save(out)
print("Saved:", out)
print("Slides:", len(prs.slides._sldIdLst))
