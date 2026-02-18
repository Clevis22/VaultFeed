# VaultFeed

A self-hosted RSS reader with a clean, Apple-inspired UI and dark/light themes. Aggregate multiple RSS/Atom feeds, read full articles inline, save bookmarks, and organize feeds by topic — all from your browser.

![VaultFeed](https://img.shields.io/badge/VaultFeed-RSS%20Reader-0a84ff)

## Features

- **Multi-feed aggregation** — Add unlimited RSS/Atom feeds, organized by topic
- **Full article extraction** — Read articles inline without leaving the app (newspaper3k + readability fallback)
- **Dark / Light theme** — Toggle between themes with one click or press `t`
- **Saved articles** — Bookmark articles for later reading
- **Search & filter** — Quickly find articles across all feeds
- **Unread filter & mark all read** — Focus on new content
- **Keyboard navigation** — `j`/`k` to move, `o` to open, `s` to save, `?` for all shortcuts
- **Reading controls** — Adjustable font size and reading width
- **Estimated reading time** — See how long each article takes to read
- **Topic organization** — Group feeds by topic with collapsible sections
- **Auto-refresh** — Configurable refresh interval (5, 10, 15, or 30 minutes)
- **Import/Export** — Back up and restore your feed list as JSON
- **Customizable** — Accent color picker, grid/list view toggle, sort order
- **Responsive** — Works on desktop, tablet, and mobile
- **No accounts or tracking** — All preferences stored in browser `localStorage`

## Quick Start

### Prerequisites

- Python 3.10+

### Setup

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/vaultfeed.git
cd vaultfeed

# Create a virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run the app
python app.py
```

Open [http://localhost:5001](http://localhost:5001) in your browser.

### Environment Variables

| Variable       | Default                           | Description                |
| -------------- | --------------------------------- | -------------------------- |
| `PORT`         | `5001`                            | Port to run the server on  |
| `NEWS_RSS_URL` | `https://hnrss.org/frontpage`     | Default RSS feed URL       |

## Project Structure

```
vaultfeed/
├── app.py                  # Flask backend (API routes)
├── requirements.txt        # Python dependencies
├── .gitignore
├── static/
│   ├── style.css           # Base styles & CSS variables
│   ├── news.css            # VaultFeed component styles
│   └── news.js             # Frontend application logic
└── templates/
    └── index.html          # Main HTML template
```

## API Endpoints

| Endpoint        | Method | Description                                       |
| --------------- | ------ | ------------------------------------------------- |
| `/`             | GET    | Serves the VaultFeed UI                           |
| `/api/news`     | GET    | Fetches and parses an RSS feed (`?url=...&limit=`) |
| `/api/article`  | GET    | Extracts full article content (`?url=...`)         |

## Deployment

### With Gunicorn (production)

```bash
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:8000 app:app
```

### With systemd

Create `/etc/systemd/system/vaultfeed.service`:

```ini
[Unit]
Description=VaultFeed
After=network.target

[Service]
User=www-data
WorkingDirectory=/path/to/vaultfeed
ExecStart=/path/to/vaultfeed/venv/bin/gunicorn -w 4 -b 127.0.0.1:8000 app:app
Restart=always

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vaultfeed
```

### With Nginx reverse proxy

```nginx
server {
    listen 80;
    server_name reader.example.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Built With

- [Flask](https://flask.palletsprojects.com/) — Python web framework
- [feedparser](https://feedparser.readthedocs.io/) — RSS/Atom feed parsing
- [newspaper3k](https://newspaper.readthedocs.io/) — Article content extraction
- [readability-lxml](https://github.com/buriy/python-readability) — Fallback article extraction
- [Beautiful Soup](https://www.crummy.com/software/BeautifulSoup/) — HTML parsing

## License

MIT
