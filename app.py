from __future__ import annotations

import os

from flask import Flask, jsonify, render_template, request, send_from_directory
import requests
import feedparser


app = Flask(__name__, static_folder="static", template_folder="templates")


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/news")
def news_feed():
    """Return a news feed from an RSS source using feedparser.

    Accepts query params:
      ?url=<rss-feed-url>  (defaults to Hacker News)
      ?limit=<number>      (defaults to 20, max 50)
    """
    feed_url = request.args.get("url") or os.environ.get(
        "NEWS_RSS_URL", "https://hnrss.org/frontpage"
    )
    limit = min(int(request.args.get("limit", 20)), 50)

    try:
        parsed = feedparser.parse(
            feed_url,
            agent="VaultFeed/1.0",
        )
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": str(e)}), 502

    if parsed.bozo and not parsed.entries:
        err = str(getattr(parsed, "bozo_exception", "Unknown parse error"))
        return jsonify({"error": f"Feed error: {err}"}), 502

    feed_title = getattr(parsed.feed, "title", "") or ""

    items: list[dict] = []
    for entry in parsed.entries[:limit]:
        title = getattr(entry, "title", "(no title)")
        link = getattr(entry, "link", "")

        # Published date – try multiple feedparser fields
        published = ""
        for attr in ("published", "updated", "created"):
            val = getattr(entry, attr, None)
            if val:
                published = val
                break

        # Description / summary – prefer content, fall back to summary
        description = ""
        if hasattr(entry, "content") and entry.content:
            description = entry.content[0].get("value", "")[:2000]
        elif hasattr(entry, "summary"):
            description = (entry.summary or "")[:2000]
        elif hasattr(entry, "description"):
            description = (entry.description or "")[:2000]

        # Media thumbnail (for images if available)
        thumbnail = ""
        if hasattr(entry, "media_thumbnail") and entry.media_thumbnail:
            thumbnail = entry.media_thumbnail[0].get("url", "")
        elif hasattr(entry, "media_content") and entry.media_content:
            thumbnail = entry.media_content[0].get("url", "")

        # Author
        author = getattr(entry, "author", "")

        items.append({
            "title": title,
            "link": link,
            "published": published,
            "description": description,
            "thumbnail": thumbnail,
            "author": author,
        })

    return jsonify({"items": items, "feed_title": feed_title})


@app.route("/api/article")
def fetch_article():
    """Fetch and extract the full readable content of an article URL.

    Uses newspaper3k to download and parse the article, returning
    the cleaned text, top image, and authors.  Falls back to
    readability-lxml + BeautifulSoup when newspaper fails to
    extract meaningful content.

    Query params:
      ?url=<article-url>
    """
    from newspaper import Article, ArticleException

    url = request.args.get("url", "").strip()
    if not url:
        return jsonify({"error": "url parameter is required"}), 400

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0.0.0 Safari/537.36"
        ),
    }

    text = ""
    html_content = ""
    title = ""
    authors: list[str] = []
    publish_date = ""
    top_image = ""

    # ── Attempt 1: newspaper3k ──
    try:
        article = Article(url, request_timeout=12)
        article.set_html(requests.get(url, headers=headers, timeout=12).text)
        article.parse()

        text = (article.text or "").strip()
        title = article.title or ""
        authors = article.authors or []
        publish_date = article.publish_date.isoformat() if article.publish_date else ""
        top_image = article.top_image or ""
    except (ArticleException, requests.RequestException):
        pass
    except Exception:  # noqa: BLE001
        pass

    # ── Attempt 2: readability + BeautifulSoup fallback ──
    if len(text) < 100:
        try:
            from readability import Document
            from bs4 import BeautifulSoup

            raw_html = requests.get(url, headers=headers, timeout=12).text

            doc = Document(raw_html)
            readable_html = doc.summary()
            readable_title = doc.short_title()

            soup = BeautifulSoup(readable_html, "html.parser")
            for tag in soup(["script", "style", "iframe", "object", "embed"]):
                tag.decompose()

            fallback_text = soup.get_text(separator="\n\n").strip()

            if len(fallback_text) > len(text):
                text = fallback_text
                html_content = str(soup)
                if not title:
                    title = readable_title or ""

                if not top_image:
                    img = soup.find("img", src=True)
                    if img:
                        src = img["src"]
                        if src.startswith("http"):
                            top_image = src
        except ImportError:
            pass
        except Exception:  # noqa: BLE001
            pass

    # Build HTML from text if we don't already have it
    if text and not html_content:
        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
        html_content = "".join(f"<p>{p}</p>" for p in paragraphs) if paragraphs else ""

    return jsonify({
        "title": title,
        "authors": authors,
        "publish_date": publish_date,
        "top_image": top_image,
        "text": text,
        "html": html_content,
        "source_url": url,
    })


@app.route("/favicon.ico")
def favicon():
    return send_from_directory(
        os.path.join(app.root_path, "static"), "favicon.ico", mimetype="image/x-icon"
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5001)), debug=True)
