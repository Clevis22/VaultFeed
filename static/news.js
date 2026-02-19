/* ── VaultFeed App ── */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;

  // ── Defaults ──
  const DEFAULT_FEEDS = [
    { id: "hn", name: "Hacker News", url: "https://hnrss.org/frontpage", topic: "Tech" },
    { id: "bbc", name: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", topic: "News" },
  ];

  // ── Topic helpers ──
  let collapsedTopics = []; // persisted topic names that are collapsed

  function getTopics() {
    const map = {};
    for (const f of feeds) {
      const t = f.topic || "Uncategorized";
      if (!map[t]) map[t] = [];
      map[t].push(f);
    }
    // Sort: alphabetical, but "Uncategorized" always last
    return Object.keys(map)
      .sort((a, b) => {
        if (a === "Uncategorized") return 1;
        if (b === "Uncategorized") return -1;
        return a.localeCompare(b);
      })
      .map((name) => ({ name, feeds: map[name] }));
  }

  function getTopicFeedIds(topicName) {
    return feeds.filter((f) => (f.topic || "Uncategorized") === topicName).map((f) => f.id);
  }

  // ── State ──
  let feeds = [];
  let articles = []; // { feedId, feedName, title, link, published, description, parsedDate }
  let savedArticles = []; // array of link strings
  let readArticles = []; // array of link strings
  let activeFeed = "all"; // "all" | "saved" | feedId
  let selectedArticle = null;
  let gridView = false;
  let sortOrder = "newest";
  let searchQuery = "";
  let autoRefreshTimer = null;
  let showUnreadOnly = false;
  let fontSize = 15; // px for reading pane
  let readingWidth = "normal"; // "narrow" | "normal" | "wide"

  // ── Persistence ──
  function load(key, fallback) {
    try {
      const raw = localStorage.getItem("nr_" + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem("nr_" + key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }

  function generateId() {
    return Math.random().toString(36).slice(2, 10);
  }

  // ── Load persisted state ──
  function loadState() {
    feeds = load("feeds", DEFAULT_FEEDS);
    savedArticles = load("saved", []);
    readArticles = load("read", []);
    gridView = load("gridView", false);
    sortOrder = load("sortOrder", "newest");
    collapsedTopics = load("collapsedTopics", []);
    showUnreadOnly = load("showUnreadOnly", false);
    fontSize = load("fontSize", 15);
    readingWidth = load("readingWidth", "normal");

    // Theme
    const savedTheme = load("theme", "dark");
    document.documentElement.setAttribute("data-theme", savedTheme);
    updateThemeIcon(savedTheme);

    // Migrate feeds that lack a topic field
    let migrated = false;
    feeds.forEach((f) => {
      if (!f.topic) {
        f.topic = "Uncategorized";
        migrated = true;
      }
    });
    if (migrated) save("feeds", feeds);

    // Accent color
    const accent = load("accent", null);
    if (accent) {
      root.style.setProperty("--accent", accent);
      const picker = $("accentColor");
      if (picker) picker.value = accent;
    }
  }

  // ── Accent color ──
  function initAccent() {
    const picker = $("accentColor");
    if (!picker) return;
    picker.addEventListener("input", () => {
      root.style.setProperty("--accent", picker.value);
      save("accent", picker.value);
    });
  }

  // ── Settings panel ──
  function initSettings() {
    const panel = $("settingsPanel");
    const openBtn = $("nrSettingsToggle");
    const closeBtn = $("settingsClose");
    if (!panel || !openBtn || !closeBtn) return;

    openBtn.addEventListener("click", () => {
      panel.classList.add("open");
      panel.setAttribute("aria-hidden", "false");
      renderFeedManager();
    });

    closeBtn.addEventListener("click", () => {
      panel.classList.remove("open");
      panel.setAttribute("aria-hidden", "true");
    });

    panel.addEventListener("click", (e) => {
      if (e.target === panel) {
        panel.classList.remove("open");
        panel.setAttribute("aria-hidden", "true");
      }
    });

    // Auto-refresh
    const arSelect = $("nrAutoRefresh");
    if (arSelect) {
      arSelect.value = load("autoRefresh", "5");
      arSelect.addEventListener("change", () => {
        save("autoRefresh", arSelect.value);
        setupAutoRefresh();
      });
    }

    // Theme select in settings
    const themeSelect = $("nrThemeSelect");
    if (themeSelect) {
      themeSelect.value = load("theme", "dark");
      themeSelect.addEventListener("change", () => {
        const theme = themeSelect.value;
        document.documentElement.setAttribute("data-theme", theme);
        save("theme", theme);
        updateThemeIcon(theme);
      });
    }

    // Font size select in settings
    const fontSelect = $("nrFontSizeSelect");
    if (fontSelect) {
      fontSelect.value = String(fontSize);
      fontSelect.addEventListener("change", () => {
        fontSize = parseInt(fontSelect.value);
        save("fontSize", fontSize);
        applyFontSize();
      });
    }

    // Width select in settings
    const widthSelect = $("nrWidthSelect");
    if (widthSelect) {
      widthSelect.value = readingWidth;
      widthSelect.addEventListener("change", () => {
        readingWidth = widthSelect.value;
        save("readingWidth", readingWidth);
        applyReadingWidth();
      });
    }

    // Article limit
    const alSelect = $("nrArticleLimit");
    if (alSelect) {
      alSelect.value = load("articleLimit", "20");
      alSelect.addEventListener("change", () => {
        save("articleLimit", alSelect.value);
        refreshAllFeeds();
      });
    }

    // Export / import
    const exportBtn = $("nrExportFeeds");
    const importBtn = $("nrImportFeeds");
    const importFile = $("nrImportFile");

    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        const data = JSON.stringify({ feeds, savedArticles }, null, 2);
        const blob = new Blob([data], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "vaultfeed-export.json";
        a.click();
      });
    }

    if (importBtn && importFile) {
      importBtn.addEventListener("click", () => importFile.click());
      importFile.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const data = JSON.parse(ev.target.result);
            if (Array.isArray(data.feeds)) {
              feeds = data.feeds;
              save("feeds", feeds);
            }
            if (Array.isArray(data.savedArticles)) {
              savedArticles = data.savedArticles;
              save("saved", savedArticles);
            }
            renderSidebar();
            refreshAllFeeds();
          } catch {
            alert("Invalid JSON file");
          }
        };
        reader.readAsText(file);
        importFile.value = "";
      });
    }
  }

  function renderFeedManager() {
    const container = $("nrFeedManager");
    if (!container) return;
    if (!feeds.length) {
      container.innerHTML = '<div class="muted" style="font-size:12px;padding:4px;">No feeds configured</div>';
      return;
    }

    const topics = getTopics();
    container.innerHTML = topics
      .map(
        (topic) => `
        <div class="nr-fm-topic-group">
          <div class="nr-fm-topic-label">${escapeHtml(topic.name)}</div>
          ${topic.feeds
            .map(
              (f) => `
            <div class="nr-feed-manager-item">
              <span class="nr-feed-manager-name" title="${escapeHtml(f.url)}">${escapeHtml(f.name)}</span>
              <select class="nr-fm-topic-select" data-feed-id="${f.id}" title="Change topic">
                ${[...new Set(feeds.map((x) => x.topic || "Uncategorized"))]
                  .sort()
                  .map((t) => `<option value="${escapeHtml(t)}"${t === (f.topic || "Uncategorized") ? " selected" : ""}>${escapeHtml(t)}</option>`)
                  .join("")}
                <option value="__new__">+ New topic…</option>
              </select>
              <button class="nr-feed-manager-delete" data-id="${f.id}" title="Remove feed"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
          `
            )
            .join("")}
        </div>
      `
      )
      .join("");

    // Delete handlers
    container.querySelectorAll(".nr-feed-manager-delete").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        feeds = feeds.filter((f) => f.id !== id);
        save("feeds", feeds);
        renderSidebar();
        renderFeedManager();
        if (activeFeed === id) {
          setActiveFeed("all");
        }
        refreshAllFeeds();
      });
    });

    // Topic change handlers
    container.querySelectorAll(".nr-fm-topic-select").forEach((sel) => {
      sel.addEventListener("change", () => {
        const feedId = sel.dataset.feedId;
        let newTopic = sel.value;

        if (newTopic === "__new__") {
          newTopic = prompt("Enter new topic name:");
          if (!newTopic || !newTopic.trim()) {
            // Reset selection
            const feed = feeds.find((f) => f.id === feedId);
            sel.value = feed ? feed.topic || "Uncategorized" : "Uncategorized";
            return;
          }
          newTopic = newTopic.trim();
        }

        const feed = feeds.find((f) => f.id === feedId);
        if (feed) {
          feed.topic = newTopic;
          save("feeds", feeds);
          renderSidebar();
          renderFeedManager();
          updateCounts();
        }
      });
    });
  }

  // ── Sidebar ──
  function renderSidebar() {
    const list = $("nrFeedList");
    if (!list) return;

    const topics = getTopics();

    list.innerHTML = topics
      .map((topic) => {
        const isCollapsed = collapsedTopics.includes(topic.name);
        const isTopicActive = activeFeed === "topic:" + topic.name;
        const chevronSvg = `<svg class="nr-topic-chevron${isCollapsed ? "" : " nr-topic-chevron-open"}" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;

        const feedButtons = topic.feeds
          .map(
            (f) => `
          <button class="nr-feed-btn${activeFeed === f.id ? " nr-feed-active" : ""}" data-feed="${f.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>
            <span>${escapeHtml(f.name)}</span>
            <span class="nr-feed-count" id="nrCount_${f.id}">0</span>
            <button class="nr-feed-delete" data-delete="${f.id}" title="Remove feed">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </button>
        `
          )
          .join("");

        return `
        <div class="nr-topic-group" data-topic="${escapeHtml(topic.name)}">
          <button class="nr-topic-header${isTopicActive ? " nr-topic-active" : ""}" data-topic-name="${escapeHtml(topic.name)}">
            ${chevronSvg}
            <span class="nr-topic-name">${escapeHtml(topic.name)}</span>
            <span class="nr-feed-count nr-topic-count nr-topic-filter" id="nrTopicCount_${topic.name.replace(/\s+/g, "_")}" title="Show all ${escapeHtml(topic.name)} articles">0</span>
          </button>
          <div class="nr-topic-feeds${isCollapsed ? " nr-topic-collapsed" : ""}">
            ${feedButtons}
          </div>
        </div>`;
      })
      .join("");

    // Topic header click handlers
    list.querySelectorAll(".nr-topic-header").forEach((header) => {
      header.addEventListener("click", (e) => {
        e.stopPropagation();
        const topicName = header.dataset.topicName;
        const chevron = header.querySelector(".nr-topic-chevron");
        const feedsDiv = header.nextElementSibling;

        // Clicking the chevron arrow → collapse/expand
        if (e.target === chevron || e.target.closest(".nr-topic-chevron")) {
          feedsDiv.classList.toggle("nr-topic-collapsed");
          chevron.classList.toggle("nr-topic-chevron-open");
          if (feedsDiv.classList.contains("nr-topic-collapsed")) {
            if (!collapsedTopics.includes(topicName)) collapsedTopics.push(topicName);
          } else {
            collapsedTopics = collapsedTopics.filter((t) => t !== topicName);
          }
          save("collapsedTopics", collapsedTopics);
        } else {
          // Clicking topic name or count → show all articles in this topic
          setActiveFeed("topic:" + topicName);
        }
      });
    });

    // Sidebar feed click handlers
    list.querySelectorAll(".nr-feed-btn[data-feed]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        if (e.target.closest("[data-delete]")) return;
        setActiveFeed(btn.dataset.feed);
      });
    });

    // Delete buttons
    list.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.delete;
        feeds = feeds.filter((f) => f.id !== id);
        save("feeds", feeds);
        renderSidebar();
        if (activeFeed === id) setActiveFeed("all");
        articles = articles.filter((a) => a.feedId !== id);
        renderArticles();
        updateCounts();
      });
    });
  }

  function setActiveFeed(id) {
    activeFeed = id;
    selectedArticle = null;

    // Update active states on feed buttons
    document.querySelectorAll(".nr-feed-btn").forEach((btn) => {
      btn.classList.toggle("nr-feed-active", btn.dataset.feed === id);
    });

    // Update active state on topic headers
    document.querySelectorAll(".nr-topic-header").forEach((header) => {
      header.classList.toggle("nr-topic-active", id === "topic:" + header.dataset.topicName);
    });

    // If a topic is selected, also highlight its feeds
    if (id.startsWith("topic:")) {
      const topicName = id.slice(6);
      const feedIds = getTopicFeedIds(topicName);
      document.querySelectorAll(".nr-feed-btn[data-feed]").forEach((btn) => {
        if (feedIds.includes(btn.dataset.feed)) {
          btn.classList.add("nr-feed-in-topic");
        } else {
          btn.classList.remove("nr-feed-in-topic");
        }
      });
    } else {
      document.querySelectorAll(".nr-feed-in-topic").forEach((el) => el.classList.remove("nr-feed-in-topic"));
    }

    // Update title
    const titleEl = $("nrCurrentFeedTitle");
    if (titleEl) {
      if (id === "all") titleEl.textContent = "All Feeds";
      else if (id === "saved") titleEl.textContent = "Saved Articles";
      else if (id.startsWith("topic:")) titleEl.textContent = id.slice(6);
      else {
        const feed = feeds.find((f) => f.id === id);
        titleEl.textContent = feed ? feed.name : "Feed";
      }
    }

    renderArticles();
    showReadingEmpty();
  }

  // ── Fetch feeds ──
  async function fetchFeed(feed) {
    const limit = load("articleLimit", 20);
    try {
      const params = new URLSearchParams({ url: feed.url, limit });
      const res = await fetch(`/api/news?${params}`);
      const data = await res.json();

      if (data.error) {
        console.warn(`Feed error (${feed.name}):`, data.error);
        return [];
      }

      return (data.items || []).map((item) => ({
        feedId: feed.id,
        feedName: feed.name,
        title: item.title || "(no title)",
        link: item.link || "",
        published: item.published || "",
        description: item.description || "",
        thumbnail: item.thumbnail || "",
        author: item.author || "",
        parsedDate: parseDate(item.published),
      }));
    } catch (e) {
      console.error(`Fetch error (${feed.name}):`, e);
      return [];
    }
  }

  async function refreshAllFeeds() {
    const articlesEl = $("nrArticles");
    if (articlesEl) {
      articlesEl.innerHTML = '<div class="nr-loading">Loading feeds…</div>';
    }

    const results = await Promise.all(feeds.map((f) => fetchFeed(f)));
    articles = results.flat();
    sortArticles();
    renderArticles();
    updateCounts();
  }

  function parseDate(dateStr) {
    if (!dateStr) return new Date(0);
    try {
      const d = new Date(dateStr);
      return isNaN(d.getTime()) ? new Date(0) : d;
    } catch {
      return new Date(0);
    }
  }

  function sortArticles() {
    articles.sort((a, b) => {
      const ta = a.parsedDate.getTime();
      const tb = b.parsedDate.getTime();
      return sortOrder === "newest" ? tb - ta : ta - tb;
    });
  }

  // ── Interleave articles from different sources (round-robin) ──
  function interleaveBySource(list) {
    // Group articles by feed, preserving each group's sort order
    const groups = {};
    const feedOrder = [];
    for (const a of list) {
      if (!groups[a.feedId]) {
        groups[a.feedId] = [];
        feedOrder.push(a.feedId);
      }
      groups[a.feedId].push(a);
    }
    if (feedOrder.length <= 1) return list;

    // Round-robin: take one from each feed in turn
    const result = [];
    const pointers = {};
    feedOrder.forEach((id) => (pointers[id] = 0));
    let remaining = list.length;
    while (remaining > 0) {
      for (const id of feedOrder) {
        if (pointers[id] < groups[id].length) {
          result.push(groups[id][pointers[id]++]);
          remaining--;
        }
      }
    }
    return result;
  }

  // ── Render articles ──
  function getFilteredArticles() {
    let list = articles;

    // Filter by feed or topic
    if (activeFeed === "saved") {
      list = list.filter((a) => savedArticles.includes(a.link));
    } else if (activeFeed.startsWith("topic:")) {
      const topicName = activeFeed.slice(6);
      const feedIds = getTopicFeedIds(topicName);
      list = list.filter((a) => feedIds.includes(a.feedId));
    } else if (activeFeed !== "all") {
      list = list.filter((a) => a.feedId === activeFeed);
    }

    // Filter by search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.feedName.toLowerCase().includes(q) ||
          (a.description && a.description.toLowerCase().includes(q))
      );
    }

    // Filter by unread
    if (showUnreadOnly) {
      list = list.filter((a) => !readArticles.includes(a.link));
    }

    // Interleave sources when viewing all feeds or a topic
    if (activeFeed === "all" || activeFeed === "saved" || activeFeed.startsWith("topic:")) {
      list = interleaveBySource(list);
    }

    return list;
  }

  function renderArticles() {
    const container = $("nrArticles");
    if (!container) return;

    const filtered = getFilteredArticles();

    if (!filtered.length) {
      const msg =
        activeFeed === "saved"
          ? "No saved articles yet"
          : searchQuery
          ? "No articles match your search"
          : "No articles found";
      container.innerHTML = `<div class="nr-empty"><p>${msg}</p></div>`;
      container.classList.toggle("nr-grid-view", false);
      return;
    }

    container.classList.toggle("nr-grid-view", gridView);

    container.innerHTML = filtered
      .map((a, i) => {
        const isSelected = selectedArticle && selectedArticle.link === a.link;
        const isRead = readArticles.includes(a.link);
        const isSaved = savedArticles.includes(a.link);
        const snippet = stripHtml(a.description).slice(0, 120);
        const timeAgo = formatTimeAgo(a.parsedDate);
        const readTime = estimateReadingTime(stripHtml(a.description));

        return `
        <div class="nr-article-card${isSelected ? " nr-article-selected" : ""}${isRead ? " nr-article-read" : ""}" data-idx="${i}">
          <div class="nr-article-card-source">${escapeHtml(a.feedName)}</div>
          <div class="nr-article-card-title">${escapeHtml(a.title)}</div>
          ${snippet ? `<div class="nr-article-card-snippet">${escapeHtml(snippet)}</div>` : ""}
          <div class="nr-article-card-meta">
            <span>${timeAgo}</span>
            ${readTime ? `<span class="nr-article-card-readtime">${readTime}</span>` : ""}
            ${isSaved ? '<span class="nr-article-card-saved">★</span>' : ""}
          </div>
        </div>
      `;
      })
      .join("");

    // Click handlers
    container.querySelectorAll(".nr-article-card").forEach((card) => {
      card.addEventListener("click", () => {
        const idx = parseInt(card.dataset.idx);
        const a = filtered[idx];
        if (a) selectArticle(a);
      });
    });
  }

  function selectArticle(article) {
    selectedArticle = article;

    // Mark as read
    if (!readArticles.includes(article.link)) {
      readArticles.push(article.link);
      // Keep read list manageable
      if (readArticles.length > 500) readArticles = readArticles.slice(-300);
      save("read", readArticles);
    }

    renderArticles(); // update selection highlight

    // Show in reading pane
    const empty = $("nrReadingEmpty");
    const content = $("nrReadingContent");
    if (empty) empty.style.display = "none";
    if (content) content.style.display = "block";

    const titleEl = $("nrReadingTitle");
    const sourceEl = $("nrReadingSource");
    const dateEl = $("nrReadingDate");
    const bodyEl = $("nrReadingBody");
    const openEl = $("nrOpenExternal");

    if (titleEl) titleEl.textContent = article.title;
    if (sourceEl) sourceEl.textContent = article.feedName;
    if (dateEl) dateEl.textContent = formatDate(article.parsedDate);
    if (openEl) openEl.href = article.link;

    // Bookmark button state
    updateBookmarkBtn();

    // Mobile: show reading pane
    const pane = $("nrReadingPane");
    if (pane) pane.classList.add("nr-pane-visible");

    // Apply font size and reading width
    applyFontSize();
    applyReadingWidth();

    // Show RSS description immediately as a preview, then fetch full article
    if (bodyEl) {
      // Show thumbnail if available
      const thumbHtml = article.thumbnail
        ? `<img src="${escapeHtml(article.thumbnail)}" class="nr-reading-hero" alt="" />`
        : "";

      // Show author if available
      const authorHtml = article.author
        ? `<div class="nr-reading-author">By ${escapeHtml(article.author)}</div>`
        : "";

      const previewHtml = article.description
        ? sanitizeHtml(article.description)
        : '<p class="nr-reading-muted">Loading full article…</p>';

      bodyEl.innerHTML = thumbHtml + authorHtml +
        '<div class="nr-reading-text">' + previewHtml + '</div>' +
        '<div class="nr-reading-loading" id="nrArticleLoading">' +
        '<div class="nr-loading-spinner"></div> Loading full article…</div>';

      // Fetch full article content from the backend
      if (article.link) {
        fetchFullArticle(article.link, bodyEl, article);
      }
    }
  }

  async function fetchFullArticle(url, bodyEl, article) {
    try {
      const params = new URLSearchParams({ url });
      const res = await fetch(`/api/article?${params}`);
      const data = await res.json();

      // Only update if this article is still selected
      if (!selectedArticle || selectedArticle.link !== url) return;

      const loadingEl = $("nrArticleLoading");
      if (loadingEl) loadingEl.remove();

      // Check if we actually got meaningful content
      const hasFullText = data.text && data.text.trim().length > 80;
      const hasHtml = data.html && data.html.trim().length > 80;
      const hasContent = hasFullText || hasHtml;

      if (data.error && !article.description) {
        bodyEl.innerHTML +=
          `<p class="nr-reading-muted">Could not load full article.</p>
           <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="nr-read-more-link">Read on original site →</a>`;
        return;
      }

      // Build rich article HTML
      let html = "";

      // Hero image – prefer the RSS thumbnail already shown in the preview;
      // fall back to the image extracted by the backend.
      const heroUrl = article.thumbnail || data.top_image;
      if (heroUrl) {
        html += `<img src="${escapeHtml(heroUrl)}" class="nr-reading-hero" alt="" />`;
      }

      // Authors
      if (data.authors && data.authors.length) {
        html += `<div class="nr-reading-author">By ${escapeHtml(data.authors.join(", "))}</div>`;
      } else if (article.author) {
        html += `<div class="nr-reading-author">By ${escapeHtml(article.author)}</div>`;
      }

      // Full article text as HTML paragraphs
      if (hasContent) {
        if (hasHtml) {
          html += `<div class="nr-reading-text">${sanitizeHtml(data.html)}</div>`;
        } else {
          const paragraphs = data.text.split(/\n\n+/).filter(p => p.trim());
          html += '<div class="nr-reading-text">' +
            paragraphs.map(p => `<p>${escapeHtml(p.trim())}</p>`).join("") +
            '</div>';
        }
      } else {
        // Extraction failed or returned too little — show RSS description + explanation
        if (article.description) {
          html += '<div class="nr-reading-text">' + sanitizeHtml(article.description) + '</div>';
          html += `<p class="nr-reading-muted" style="margin-top:16px;">Full article could not be extracted — the site may block automated reading. You can read the full version on the original site.</p>`;
        } else {
          html += `<p class="nr-reading-muted">Full article could not be extracted from this site.</p>`;
        }
      }

      // Read more link (always shown)
      html += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="nr-read-more-link">Read on original site →</a>`;

      bodyEl.innerHTML = html;
    } catch (e) {
      console.error("Article fetch error:", e);
      const loadingEl = $("nrArticleLoading");
      if (loadingEl) loadingEl.remove();

      // Show RSS description as fallback on network error
      if (!selectedArticle || selectedArticle.link !== url) return;
      let fallback = "";
      if (article.description) {
        fallback += '<div class="nr-reading-text">' + sanitizeHtml(article.description) + '</div>';
      }
      fallback += `<p class="nr-reading-muted">Could not connect to fetch the full article.</p>`;
      fallback += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="nr-read-more-link">Read on original site →</a>`;
      bodyEl.innerHTML += fallback;
    }
  }

  // ── AI Summarization ──
  async function requestSummary() {
    if (!selectedArticle) return;

    const bodyEl = $("nrReadingBody");
    if (!bodyEl) return;

    // Grab the article text from the reading pane
    const textEl = bodyEl.querySelector(".nr-reading-text");
    const articleText = textEl ? textEl.innerText.trim() : "";

    if (!articleText || articleText.length < 80) {
      showSummaryBox(bodyEl, "Not enough article content to summarize.");
      return;
    }

    // Remove any existing summary box
    const existing = bodyEl.querySelector(".nr-summary-box");
    if (existing) existing.remove();

    // Show loading state
    const box = document.createElement("div");
    box.className = "nr-summary-box nr-summary-loading";
    box.innerHTML =
      '<div class="nr-summary-header">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>' +
        ' AI Summary' +
      '</div>' +
      '<div class="nr-summary-body">' +
        '<div class="nr-loading-spinner"></div> Generating summary…' +
      '</div>';

    // Insert at the top of the reading body, after any hero image / author
    const readingText = bodyEl.querySelector(".nr-reading-text");
    if (readingText) {
      bodyEl.insertBefore(box, readingText);
    } else {
      bodyEl.prepend(box);
    }

    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: articleText }),
      });
      const data = await res.json();

      if (!selectedArticle) return; // user navigated away

      if (data.error) {
        box.classList.remove("nr-summary-loading");
        box.querySelector(".nr-summary-body").textContent = "Could not generate summary: " + data.error;
        return;
      }

      box.classList.remove("nr-summary-loading");
      box.querySelector(".nr-summary-body").textContent = data.summary;
    } catch (e) {
      console.error("Summarize error:", e);
      box.classList.remove("nr-summary-loading");
      box.querySelector(".nr-summary-body").textContent = "Failed to connect to summarization service.";
    }
  }

  function showSummaryBox(bodyEl, message) {
    const existing = bodyEl.querySelector(".nr-summary-box");
    if (existing) existing.remove();

    const box = document.createElement("div");
    box.className = "nr-summary-box";
    box.innerHTML =
      '<div class="nr-summary-header">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>' +
        ' AI Summary' +
      '</div>' +
      '<div class="nr-summary-body">' + escapeHtml(message) + '</div>';

    const readingText = bodyEl.querySelector(".nr-reading-text");
    if (readingText) {
      bodyEl.insertBefore(box, readingText);
    } else {
      bodyEl.prepend(box);
    }
  }

  function showReadingEmpty() {
    const empty = $("nrReadingEmpty");
    const content = $("nrReadingContent");
    if (empty) empty.style.display = "flex";
    if (content) content.style.display = "none";

    const pane = $("nrReadingPane");
    if (pane) pane.classList.remove("nr-pane-visible");
  }

  function updateBookmarkBtn() {
    const btn = $("nrBookmarkArticle");
    if (!btn || !selectedArticle) return;
    const isSaved = savedArticles.includes(selectedArticle.link);
    btn.classList.toggle("nr-bookmark-active", isSaved);
    btn.title = isSaved ? "Unsave" : "Save";
  }

  // ── Counts ──
  function updateCounts() {
    const allCount = $("nrCountAll");
    const savedCount = $("nrCountSaved");

    if (allCount) allCount.textContent = articles.length;
    if (savedCount)
      savedCount.textContent = articles.filter((a) =>
        savedArticles.includes(a.link)
      ).length;

    feeds.forEach((f) => {
      const el = $("nrCount_" + f.id);
      if (el) el.textContent = articles.filter((a) => a.feedId === f.id).length;
    });

    // Topic counts
    const topics = getTopics();
    topics.forEach((topic) => {
      const el = $("nrTopicCount_" + topic.name.replace(/\s+/g, "_"));
      if (el) {
        const feedIds = topic.feeds.map((f) => f.id);
        el.textContent = articles.filter((a) => feedIds.includes(a.feedId)).length;
      }
    });
  }

  // ── Add Feed Modal ──
  function initAddFeedModal() {
    const overlay = $("nrModalOverlay");
    const addBtn = $("nrAddFeed");
    const closeBtn = $("nrModalClose");
    const cancelBtn = $("nrModalCancel");
    const saveBtn = $("nrModalSave");
    const nameInput = $("nrFeedName");
    const urlInput = $("nrFeedUrl");
    const topicInput = $("nrFeedTopic");
    const topicList = $("nrTopicSuggestions");

    if (!overlay || !addBtn) return;

    function populateTopicSuggestions() {
      if (!topicList) return;
      const topics = [...new Set(feeds.map((f) => f.topic || "Uncategorized"))].sort();
      topicList.innerHTML = topics.map((t) => `<option value="${escapeHtml(t)}">`).join("");
    }

    function openModal() {
      if (nameInput) nameInput.value = "";
      if (urlInput) urlInput.value = "";
      if (topicInput) topicInput.value = "";
      populateTopicSuggestions();
      overlay.style.display = "flex";
    }

    function closeModal() {
      overlay.style.display = "none";
    }

    addBtn.addEventListener("click", openModal);
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (cancelBtn) cancelBtn.addEventListener("click", closeModal);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });

    // Preset chips
    document.querySelectorAll(".nr-preset-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        if (nameInput) nameInput.value = chip.dataset.name;
        if (urlInput) urlInput.value = chip.dataset.url;
        if (topicInput && chip.dataset.topic) topicInput.value = chip.dataset.topic;
      });
    });

    // Save
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        const name = (nameInput?.value || "").trim();
        const url = (urlInput?.value || "").trim();
        const topic = (topicInput?.value || "").trim() || "Uncategorized";

        if (!name || !url) {
          alert("Please enter both a name and URL");
          return;
        }

        // Check for duplicates
        if (feeds.some((f) => f.url === url)) {
          alert("This feed URL already exists");
          return;
        }

        const newFeed = { id: generateId(), name, url, topic };
        feeds.push(newFeed);
        save("feeds", feeds);

        closeModal();
        renderSidebar();

        // Fetch the new feed
        const newArticles = await fetchFeed(newFeed);
        articles = articles.concat(newArticles);
        sortArticles();
        renderArticles();
        updateCounts();
      });
    }
  }

  // ── Utilities ──
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function stripHtml(html) {
    if (!html) return "";
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.textContent || div.innerText || "";
  }

  function sanitizeHtml(html) {
    if (!html) return "";
    // Basic sanitization: allow safe tags, strip scripts
    const div = document.createElement("div");
    div.innerHTML = html;
    // Remove scripts and event handlers
    div.querySelectorAll("script, style, iframe, object, embed").forEach((el) => el.remove());
    div.querySelectorAll("*").forEach((el) => {
      for (const attr of [...el.attributes]) {
        if (attr.name.startsWith("on")) el.removeAttribute(attr.name);
      }
    });
    return div.innerHTML;
  }

  function formatTimeAgo(date) {
    if (!date || date.getTime() === 0) return "";
    const now = new Date();
    const diff = now - date;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function formatDate(date) {
    if (!date || date.getTime() === 0) return "";
    return date.toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  // ── Theme toggle ──
  const THEME_ORDER = ["dark", "light", "hacker", "retro", "nord", "eink", "paper"];

  function updateThemeIcon(theme) {
    const icon = $("nrThemeIcon");
    if (!icon) return;
    const icons = {
      light:     '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
      dark:      '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
      hacker:    '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><text x="7" y="13" font-size="7" fill="currentColor" stroke="none" font-family="monospace">&gt;_</text>',
      retro:     '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><circle cx="12" cy="10" r="3" fill="none"/>',
      nord:      '<path d="M12 2L2 19h20L12 2z" fill="none"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="16" r="0.5"/>',
      eink:      '<rect x="4" y="2" width="16" height="20" rx="2" fill="none"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="13" y2="14"/>',
      paper:     '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" fill="none"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" fill="none"/>',
    };
    icon.innerHTML = icons[theme] || icons.dark;

    // Sync the settings dropdown if open
    const sel = $("nrThemeSelect");
    if (sel && sel.value !== theme) sel.value = theme;
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    const idx = THEME_ORDER.indexOf(current);
    const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
    document.documentElement.setAttribute("data-theme", next);
    save("theme", next);
    updateThemeIcon(next);
  }

  function initThemeToggle() {
    const btn = $("nrThemeToggle");
    if (btn) btn.addEventListener("click", toggleTheme);
  }

  // ── Font size & reading width controls ──
  function applyFontSize() {
    const body = $("nrReadingBody");
    if (body) body.style.fontSize = fontSize + "px";
    const text = body ? body.querySelector(".nr-reading-text") : null;
    if (text) text.style.fontSize = fontSize + "px";
  }

  function applyReadingWidth() {
    const content = $("nrReadingContent");
    if (!content) return;
    content.classList.remove("nr-width-narrow", "nr-width-normal", "nr-width-wide");
    content.classList.add("nr-width-" + readingWidth);

    // Update button label
    const btn = $("nrWidthToggle");
    if (btn) {
      const labels = { narrow: "Narrow", normal: "Normal", wide: "Wide" };
      btn.textContent = labels[readingWidth] || "Normal";
      btn.classList.toggle("nr-width-active", readingWidth !== "normal");
    }
  }

  function initFontControls() {
    const smaller = $("nrFontSmaller");
    const larger = $("nrFontLarger");
    const widthBtn = $("nrWidthToggle");

    if (smaller) {
      smaller.addEventListener("click", () => {
        fontSize = Math.max(12, fontSize - 1);
        save("fontSize", fontSize);
        applyFontSize();
      });
    }
    if (larger) {
      larger.addEventListener("click", () => {
        fontSize = Math.min(24, fontSize + 1);
        save("fontSize", fontSize);
        applyFontSize();
      });
    }
    if (widthBtn) {
      widthBtn.addEventListener("click", () => {
        const widths = ["narrow", "normal", "wide"];
        const idx = widths.indexOf(readingWidth);
        readingWidth = widths[(idx + 1) % widths.length];
        save("readingWidth", readingWidth);
        applyReadingWidth();
      });
    }

    applyReadingWidth();
  }

  // ── Estimated reading time ──
  function estimateReadingTime(text) {
    if (!text) return "";
    const words = text.trim().split(/\s+/).length;
    const mins = Math.ceil(words / 220);
    return mins < 1 ? "1 min" : mins + " min";
  }

  // ── Keyboard shortcuts modal ──
  function initShortcutsModal() {
    const overlay = $("nrShortcutsOverlay");
    const openBtn = $("nrShortcutsBtn");
    const closeBtn = $("nrShortcutsClose");
    if (!overlay) return;

    function openShortcuts() {
      overlay.style.display = "flex";
    }

    function closeShortcuts() {
      overlay.style.display = "none";
    }

    if (openBtn) openBtn.addEventListener("click", openShortcuts);
    if (closeBtn) closeBtn.addEventListener("click", closeShortcuts);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeShortcuts();
    });

    // Expose for keyboard handler
    window._nrToggleShortcuts = () => {
      if (overlay.style.display === "flex") closeShortcuts();
      else openShortcuts();
    };
  }

  // ── Mark all read & Unread filter ──
  function initMarkAllRead() {
    const markBtn = $("nrMarkAllRead");
    const unreadBtn = $("nrUnreadToggle");

    if (markBtn) {
      markBtn.addEventListener("click", () => {
        const filtered = getFilteredArticles();
        filtered.forEach((a) => {
          if (!readArticles.includes(a.link)) {
            readArticles.push(a.link);
          }
        });
        // Keep read list manageable
        if (readArticles.length > 500) readArticles = readArticles.slice(-300);
        save("read", readArticles);
        renderArticles();
        updateCounts();
      });
    }

    if (unreadBtn) {
      // Set initial state
      unreadBtn.classList.toggle("nr-unread-active", showUnreadOnly);
      unreadBtn.addEventListener("click", () => {
        showUnreadOnly = !showUnreadOnly;
        save("showUnreadOnly", showUnreadOnly);
        unreadBtn.classList.toggle("nr-unread-active", showUnreadOnly);
        renderArticles();
      });
    }
  }

  // ── Event Wiring ──
  function initEvents() {
    // Refresh all
    const refreshBtn = $("nrRefreshAll");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", refreshAllFeeds);
    }

    // Search filter (desktop)
    const searchInput = $("nrSearch");
    if (searchInput) {
      let debounce = null;
      searchInput.addEventListener("input", () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          searchQuery = searchInput.value.trim();
          // Sync mobile search
          const mobileInput = $("nrMobileSearchInput");
          if (mobileInput) mobileInput.value = searchQuery;
          renderArticles();
        }, 200);
      });
    }

    // Search filter (mobile)
    const mobileSearchInput = $("nrMobileSearchInput");
    if (mobileSearchInput) {
      let debounce = null;
      mobileSearchInput.addEventListener("input", () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          searchQuery = mobileSearchInput.value.trim();
          // Sync desktop search
          if (searchInput) searchInput.value = searchQuery;
          renderArticles();
        }, 200);
      });
    }

    // Mobile search toggle
    const mobileSearchToggle = $("nrMobileSearchToggle");
    const mobileSearchBar = $("nrMobileSearch");
    if (mobileSearchToggle && mobileSearchBar) {
      mobileSearchToggle.addEventListener("click", () => {
        mobileSearchBar.classList.toggle("nr-search-visible");
        if (mobileSearchBar.classList.contains("nr-search-visible")) {
          const input = $("nrMobileSearchInput");
          if (input) input.focus();
        }
      });
    }

    // Hamburger sidebar toggle
    const hamburger = $("nrHamburger");
    const sidebar = $("nrSidebar");
    const overlay = $("nrSidebarOverlay");

    function openSidebar() {
      if (sidebar) sidebar.classList.add("nr-sidebar-open");
      if (overlay) overlay.classList.add("nr-overlay-visible");
      document.body.style.overflow = "hidden";
    }

    function closeSidebar() {
      if (sidebar) sidebar.classList.remove("nr-sidebar-open");
      if (overlay) overlay.classList.remove("nr-overlay-visible");
      document.body.style.overflow = "";
    }

    if (hamburger) {
      hamburger.addEventListener("click", () => {
        if (sidebar && sidebar.classList.contains("nr-sidebar-open")) {
          closeSidebar();
        } else {
          openSidebar();
        }
      });
    }

    if (overlay) {
      overlay.addEventListener("click", closeSidebar);
    }

    // Close sidebar when a feed is selected (mobile)
    const origSetActiveFeed = setActiveFeed;
    // We'll patch the sidebar feed click to also close sidebar on mobile
    document.addEventListener("click", (e) => {
      const feedBtn = e.target.closest(".nr-feed-btn[data-feed]");
      if (feedBtn && window.innerWidth <= 700) {
        setTimeout(closeSidebar, 150);
      }
    });

    // Back button (mobile reading pane)
    const backBtn = $("nrBackBtn");
    if (backBtn) {
      backBtn.addEventListener("click", () => {
        showReadingEmpty();
        selectedArticle = null;
        renderArticles();
      });
    }

    // Sort
    const sortSelect = $("nrSortSelect");
    if (sortSelect) {
      sortSelect.value = sortOrder;
      sortSelect.addEventListener("change", () => {
        sortOrder = sortSelect.value;
        save("sortOrder", sortOrder);
        sortArticles();
        renderArticles();
      });
    }

    // View toggle
    const viewBtn = $("nrViewToggle");
    if (viewBtn) {
      viewBtn.addEventListener("click", () => {
        gridView = !gridView;
        save("gridView", gridView);
        renderArticles();
      });
    }

    // Bookmark
    const bookmarkBtn = $("nrBookmarkArticle");
    if (bookmarkBtn) {
      bookmarkBtn.addEventListener("click", () => {
        if (!selectedArticle) return;
        const idx = savedArticles.indexOf(selectedArticle.link);
        if (idx >= 0) {
          savedArticles.splice(idx, 1);
        } else {
          savedArticles.push(selectedArticle.link);
        }
        save("saved", savedArticles);
        updateBookmarkBtn();
        updateCounts();
        renderArticles();
      });
    }

    // Sidebar "All" and "Saved" buttons
    document.querySelectorAll('.nr-feed-btn[data-feed="all"], .nr-feed-btn[data-feed="saved"]').forEach((btn) => {
      btn.addEventListener("click", () => setActiveFeed(btn.dataset.feed));
    });

    // Summarize button
    const summarizeBtn = $("nrSummarizeBtn");
    if (summarizeBtn) {
      summarizeBtn.addEventListener("click", () => {
        if (!selectedArticle) return;
        requestSummary();
      });
    }

    // Keyboard navigation
    document.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;

      // Shortcuts that don't need filtered articles
      if (e.key === "?") {
        e.preventDefault();
        if (window._nrToggleShortcuts) window._nrToggleShortcuts();
        return;
      }

      if (e.key === "t") {
        e.preventDefault();
        toggleTheme();
        return;
      }

      if (e.key === "u") {
        e.preventDefault();
        const unreadBtn = $("nrUnreadToggle");
        if (unreadBtn) unreadBtn.click();
        return;
      }

      if (e.key === "A" && e.shiftKey) {
        e.preventDefault();
        const markBtn = $("nrMarkAllRead");
        if (markBtn) markBtn.click();
        return;
      }

      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        fontSize = Math.min(24, fontSize + 1);
        save("fontSize", fontSize);
        applyFontSize();
        return;
      }

      if (e.key === "-") {
        e.preventDefault();
        fontSize = Math.max(12, fontSize - 1);
        save("fontSize", fontSize);
        applyFontSize();
        return;
      }

      // Close shortcuts modal on Escape
      const shortcutsOverlay = $("nrShortcutsOverlay");
      if (e.key === "Escape" && shortcutsOverlay && shortcutsOverlay.style.display === "flex") {
        shortcutsOverlay.style.display = "none";
        return;
      }

      const filtered = getFilteredArticles();
      if (!filtered.length) return;

      const currentIdx = selectedArticle
        ? filtered.findIndex((a) => a.link === selectedArticle.link)
        : -1;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = Math.min(currentIdx + 1, filtered.length - 1);
        selectArticle(filtered[next]);
        scrollArticleIntoView(next);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = Math.max(currentIdx - 1, 0);
        selectArticle(filtered[prev]);
        scrollArticleIntoView(prev);
      } else if (e.key === "o" || e.key === "Enter") {
        if (selectedArticle && selectedArticle.link) {
          window.open(selectedArticle.link, "_blank");
        }
      } else if (e.key === "s") {
        if (bookmarkBtn) bookmarkBtn.click();
      } else if (e.key === "r") {
        refreshAllFeeds();
      } else if (e.key === "Escape") {
        showReadingEmpty();
        selectedArticle = null;
        renderArticles();
      }
    });
  }

  function scrollArticleIntoView(idx) {
    const container = $("nrArticles");
    if (!container) return;
    const cards = container.querySelectorAll(".nr-article-card");
    if (cards[idx]) {
      cards[idx].scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  // ── Auto-refresh ──
  function setupAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    const mins = parseInt(load("autoRefresh", "5"));
    if (mins > 0) {
      autoRefreshTimer = setInterval(refreshAllFeeds, mins * 60 * 1000);
    }
  }

  // ── Init ──
  function init() {
    loadState();
    initAccent();
    initThemeToggle();
    initFontControls();
    initShortcutsModal();
    initMarkAllRead();
    initSettings();
    initAddFeedModal();
    initEvents();
    renderSidebar();
    refreshAllFeeds();
    setupAutoRefresh();
  }

  window.addEventListener("DOMContentLoaded", init);
})();
