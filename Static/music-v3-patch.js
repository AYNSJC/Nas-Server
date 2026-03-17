/* ═══════════════════════════════════════════════════════════════════
   MUSIC PLAYER v3 — JS Patch
   Load AFTER music-v2.js:  <script src="/static/music-v3-patch.js"></script>
   Adds: Downloads view, Unknown Artists view, Recommendations view,
         nav badges, graceful "artist not found" display.
═══════════════════════════════════════════════════════════════════ */

// ── Extend mp2 state ─────────────────────────────────────────────────
Object.assign(mp2, {
  downloads:      [],   // { id, title, artist, thumb, url, status, progress, format, addedAt, error }
  unknownEdits:   {},   // filename → proposed artist name
  bulkSelected:   new Set(),
  recInLibrary:   [],   // track objects
  recYT:          [],   // { id, title, artist, thumb, duration, url }
  recLoaded:      false,
});

// ── Extend mp2GoView to handle new views ─────────────────────────────
const _mp2GoViewOrig = mp2GoView;
mp2GoView = function(view, skipHistory) {
  const newViews = ['downloads', 'unknown-artists', 'recommendations'];
  if (!newViews.includes(view)) {
    _mp2GoViewOrig(view, skipHistory);
    return;
  }
  if (!skipHistory && mp2.currentView !== view) mp2.viewHistory.push(mp2.currentView);
  mp2.currentView = view;

  document.querySelectorAll('.mp2-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.mp2-nav-btn').forEach(b => b.classList.remove('active'));

  const viewMap = {
    'downloads':       'mp2ViewDownloads',
    'unknown-artists': 'mp2ViewUnknownArtists',
    'recommendations': 'mp2ViewRecommendations',
  };
  const navMap = {
    'downloads':       'mp2NavDownloads',
    'unknown-artists': 'mp2NavUnknown',
    'recommendations': 'mp2NavRecommend',
  };
  const viewEl = document.getElementById(viewMap[view]);
  if (viewEl) viewEl.classList.add('active');
  const navEl = document.getElementById(navMap[view]);
  if (navEl) navEl.classList.add('active');

  const vc = document.getElementById('mp2ViewContainer');
  if (vc) vc.scrollTop = 0;

  if (view === 'downloads')       mp2RenderDownloadsView();
  if (view === 'unknown-artists') mp2RenderUnknownArtistsView();
  if (view === 'recommendations') mp2RenderRecommendationsView();
};

// ── Hook into mp2Init to run extra setup ─────────────────────────────
const _mp2InitOrig = mp2Init;
mp2Init = async function() {
  await _mp2InitOrig();
  mp2UpdateNavBadges();
  mp2PollDownloads();
};

// ── Hook into mp2LoadTracks to update badges after reload ────────────
const _mp2LoadTracksOrig = mp2LoadTracks;
mp2LoadTracks = async function() {
  await _mp2LoadTracksOrig();
  mp2UpdateNavBadges();
};

// ════════════════════════════════════════════════════════════════════
//  NAV BADGES
// ════════════════════════════════════════════════════════════════════

function mp2UpdateNavBadges() {
  // Unknown artists badge
  const audioTracks = mp2.tracks.filter(t => !/\.(webp)$/i.test(t.name));
  const unknownCount = audioTracks.filter(t => !mp2GuessArtist(t.name)).length;
  const unknownBadge = document.getElementById('mp2UnknownBadge');
  if (unknownBadge) {
    unknownBadge.textContent = unknownCount;
    unknownBadge.style.display = unknownCount > 0 ? 'inline-flex' : 'none';
  }

  // Downloads badge (active count)
  const activeCount = mp2.downloads.filter(d => d.status === 'active' || d.status === 'queue').length;
  const dlBadge = document.getElementById('mp2DownloadBadge');
  if (dlBadge) {
    dlBadge.textContent = activeCount;
    dlBadge.style.display = activeCount > 0 ? 'inline-flex' : 'none';
  }
}

// ════════════════════════════════════════════════════════════════════
//  DOWNLOADS VIEW
// ════════════════════════════════════════════════════════════════════

// Register a new download so it appears in the Downloads tab
function mp2RegisterDownload(opts) {
  // opts: { title, artist, thumb, url, format }
  const id = 'dl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const item = {
    id,
    title:    opts.title   || 'Downloading…',
    artist:   opts.artist  || '',
    thumb:    opts.thumb   || '',
    url:      opts.url     || '',
    format:   opts.format  || 'mp3',
    status:   'queue',     // queue → active → done | fail
    progress: 0,
    addedAt:  Date.now(),
    error:    '',
  };
  mp2.downloads.unshift(item);
  mp2UpdateNavBadges();
  // If the downloads view is active, re-render
  if (mp2.currentView === 'downloads') mp2RenderDownloadsView();
  return id;
}

// Update an existing download's status/progress
function mp2UpdateDownload(id, patch) {
  const item = mp2.downloads.find(d => d.id === id);
  if (!item) return;
  Object.assign(item, patch);
  mp2UpdateNavBadges();
  if (mp2.currentView === 'downloads') mp2RenderDownloadsView();
}

// Poll server for live download status (every 2s while there are active downloads)
let _mp2PollTimer = null;
function mp2PollDownloads() {
  clearTimeout(_mp2PollTimer);
  _mp2PollTimer = setTimeout(async () => {
    try {
      const tok = window.token || localStorage.getItem('token') || '';
      const res = await fetch('/api/music/downloads', {
        headers: { Authorization: 'Bearer ' + tok }
      });
      if (res.ok) {
        const d = await res.json();
        if (d.downloads && Array.isArray(d.downloads)) {
          // Merge server state into mp2.downloads
          for (const sd of d.downloads) {
            const existing = mp2.downloads.find(x => x.id === sd.id || x.url === sd.url);
            if (existing) {
              Object.assign(existing, sd);
            } else {
              mp2.downloads.unshift(sd);
            }
          }
          mp2UpdateNavBadges();
          if (mp2.currentView === 'downloads') mp2RenderDownloadsView();
        }
      }
    } catch (e) {
      // Server might not support this endpoint yet — that's fine
    }
    // Keep polling if there are active/queued items
    const hasActive = mp2.downloads.some(d => d.status === 'active' || d.status === 'queue');
    if (hasActive) mp2PollDownloads();
    else _mp2PollTimer = setTimeout(mp2PollDownloads, 10000); // check less often when idle
  }, 2000);
}

function mp2ClearFinishedDownloads() {
  mp2.downloads = mp2.downloads.filter(d => d.status !== 'done' && d.status !== 'fail');
  mp2UpdateNavBadges();
  mp2RenderDownloadsView();
}

function mp2RenderDownloadsView() {
  const active  = mp2.downloads.filter(d => d.status === 'active');
  const queued  = mp2.downloads.filter(d => d.status === 'queue');
  const done    = mp2.downloads.filter(d => d.status === 'done');
  const failed  = mp2.downloads.filter(d => d.status === 'fail');

  _mp2SetCount('mp2DlActiveCount', active.length);
  _mp2SetCount('mp2DlQueueCount',  queued.length);
  _mp2SetCount('mp2DlDoneCount',   done.length);
  _mp2SetCount('mp2DlFailCount',   failed.length);

  _mp2RenderDlList('mp2DlActiveList', active,  'active',  'No active downloads');
  _mp2RenderDlList('mp2DlQueueList',  queued,  'queue',   'Queue is empty');
  _mp2RenderDlList('mp2DlDoneList',   done,    'done',    'No completed downloads yet');
  _mp2RenderDlList('mp2DlFailList',   failed,  'fail',    'No failed downloads');
}

function _mp2SetCount(id, n) {
  const el = document.getElementById(id);
  if (el) el.textContent = n;
}

function _mp2RenderDlList(containerId, items, statusClass, emptyMsg) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!items.length) {
    el.innerHTML = `<div class="mp2-dl-empty">${escapeHtml(emptyMsg)}</div>`;
    return;
  }
  el.innerHTML = items.map(item => {
    const initials = (item.title || '?').charAt(0).toUpperCase();
    const thumbHtml = item.thumb
      ? `<div class="mp2-dl-item-thumb"><img src="${escapeHtml(item.thumb)}" alt="" onerror="this.style.display='none'"></div>`
      : `<div class="mp2-dl-item-thumb">
           <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
             <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
           </svg>
         </div>`;

    const progressHtml = (statusClass === 'active' || statusClass === 'queue')
      ? `<div class="mp2-dl-item-progress">
           <div class="mp2-dl-item-progress-fill" style="width:${item.progress || (statusClass === 'queue' ? 0 : 45)}%"></div>
         </div>`
      : '';

    const statusLabel = {
      active: 'Downloading',
      queue:  'Queued',
      done:   'Complete',
      fail:   item.error || 'Failed',
    }[statusClass] || statusClass;

    const timeAgo = _mp2TimeAgo(item.addedAt);

    const actionHtml = statusClass === 'fail'
      ? `<div class="mp2-dl-item-actions">
           <button class="mp2-dl-item-btn" title="Retry" onclick="mp2RetryDownload('${escapeHtml(item.id)}')">
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
           </button>
         </div>`
      : statusClass === 'done'
      ? `<div class="mp2-dl-item-actions">
           <button class="mp2-dl-item-btn" title="Remove" onclick="mp2RemoveDlItem('${escapeHtml(item.id)}')">
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
           </button>
         </div>`
      : '';

    return `
      <div class="mp2-dl-item mp2-dl-item--${escapeHtml(statusClass)}" data-id="${escapeHtml(item.id)}">
        ${thumbHtml}
        <div class="mp2-dl-item-info">
          <div class="mp2-dl-item-title">${escapeHtml(item.title)}</div>
          <div class="mp2-dl-item-meta">
            ${item.artist ? `<span>${escapeHtml(item.artist)}</span> ·` : ''}
            <span>${escapeHtml(item.format?.toUpperCase() || 'MP3')}</span>
            · <span>${timeAgo}</span>
          </div>
          ${progressHtml}
        </div>
        <div class="mp2-dl-item-status">${escapeHtml(statusLabel)}</div>
        ${actionHtml}
      </div>
    `;
  }).join('');
}

function _mp2TimeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)  return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}

function mp2RetryDownload(id) {
  const item = mp2.downloads.find(d => d.id === id);
  if (!item) return;
  item.status = 'queue';
  item.progress = 0;
  item.error = '';
  mp2RenderDownloadsView();
  // Attempt re-download via existing mechanism
  if (item.url) {
    // Trigger via the DlYT path (simplified — app.js handles actual download)
    const fakeEvt = { url: item.url, artist: item.artist, format: item.format };
    mp2DlYTDirect(fakeEvt.url, fakeEvt.artist, fakeEvt.format, id);
  }
}

function mp2RemoveDlItem(id) {
  mp2.downloads = mp2.downloads.filter(d => d.id !== id);
  mp2UpdateNavBadges();
  mp2RenderDownloadsView();
}

// Override mp2DlYT to register in downloads tab
const _mp2DlYTOrig = typeof mp2DlYT === 'function' ? mp2DlYT : null;
window.mp2DlYT = async function() {
  const urlEl    = document.getElementById('mp2YTUrl');
  const artistEl = document.getElementById('mp2YTArtist');
  const fmtBtn   = document.querySelector('#mp2PaneYT .mp2-fmt-btn.active');
  const url    = urlEl?.value?.trim() || '';
  const artist = artistEl?.value?.trim() || '';
  const fmt    = fmtBtn?.dataset?.fmt || 'mp3';

  if (!url) return;

  // Register in downloads UI immediately
  const dlId = mp2RegisterDownload({ title: 'Fetching…', artist, url, format: fmt });
  mp2UpdateDownload(dlId, { status: 'active', progress: 10 });

  // Delegate to original implementation
  if (_mp2DlYTOrig) {
    const origStatus = document.getElementById('mp2YTStatus');
    const _origSet = origStatus ? (v => { origStatus.textContent = v; }) : () => {};
    await _mp2DlYTOrig();
    // After download completes, we can't easily intercept result here,
    // so we rely on polling. Mark done after delay as fallback.
    setTimeout(() => {
      const d = mp2.downloads.find(x => x.id === dlId);
      if (d && d.status === 'active') mp2UpdateDownload(dlId, { status: 'done', progress: 100 });
    }, 30000);
  }
};

// Standalone direct download (for retries)
async function mp2DlYTDirect(url, artist, fmt, dlId) {
  try {
    const tok = window.token || localStorage.getItem('token') || '';
    const body = { url, artist, format: fmt || 'mp3', quality: '192', save_thumb: true };
    mp2UpdateDownload(dlId, { status: 'active', progress: 20 });
    const res = await fetch('/api/music/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      mp2UpdateDownload(dlId, { status: 'done', progress: 100 });
      await mp2LoadTracks();
      mp2RenderAll();
    } else {
      const d = await res.json().catch(() => ({}));
      mp2UpdateDownload(dlId, { status: 'fail', error: d.error || 'Download failed' });
    }
  } catch(e) {
    mp2UpdateDownload(dlId, { status: 'fail', error: e.message || 'Network error' });
  }
}

// ════════════════════════════════════════════════════════════════════
//  UNKNOWN ARTISTS VIEW
// ════════════════════════════════════════════════════════════════════

function mp2RenderUnknownArtistsView() {
  const audioTracks = mp2.tracks.filter(t => !/\.(webp)$/i.test(t.name));
  const unknown = audioTracks.filter(t => !mp2GuessArtist(t.name));

  // Stats
  const statsEl = document.getElementById('mp2UnknownStats');
  if (statsEl) {
    const total = audioTracks.length;
    const knownCount = total - unknown.length;
    const pct = total > 0 ? Math.round((knownCount / total) * 100) : 100;
    statsEl.innerHTML = `
      <div class="mp2-unknown-stat">
        <div class="mp2-unknown-stat-val">${unknown.length}</div>
        <div class="mp2-unknown-stat-label">Unknown artists</div>
      </div>
      <div class="mp2-unknown-stat">
        <div class="mp2-unknown-stat-val">${total}</div>
        <div class="mp2-unknown-stat-label">Total tracks</div>
      </div>
      <div class="mp2-unknown-stat">
        <div class="mp2-unknown-stat-val">${pct}%</div>
        <div class="mp2-unknown-stat-label">Identified</div>
      </div>
    `;
  }

  const listEl = document.getElementById('mp2UnknownList');
  if (!listEl) return;

  if (!unknown.length) {
    listEl.innerHTML = `
      <div class="mp2-dl-empty" style="padding:48px 0;">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <p>All artists are identified! 🎉</p>
      </div>`;
    return;
  }

  listEl.innerHTML = unknown.map(t => {
    const title    = mp2GuessTitle(t.name);
    const filename = t.name;
    const savedArtist = (mp2.unknownEdits[filename] !== undefined)
      ? mp2.unknownEdits[filename]
      : '';

    const artId  = 'unk-art-' + btoa(filename).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
    const inpId  = 'unk-inp-' + btoa(filename).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);

    return `
      <div class="mp2-unknown-row" id="unk-row-${artId}" data-file="${escapeHtml(filename)}">
        <div class="mp2-unknown-row-art" id="${artId}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
        </div>
        <div class="mp2-unknown-row-info">
          <div class="mp2-unknown-row-title">${escapeHtml(title)}</div>
          <div class="mp2-unknown-row-filename">${escapeHtml(filename)}</div>
          <div class="mp2-unknown-artist-wrap">
            <input
              class="mp2-unknown-artist-input"
              id="${inpId}"
              type="text"
              placeholder="Enter artist name…"
              value="${escapeHtml(savedArtist)}"
              onkeydown="if(event.key==='Enter')mp2SaveUnknownArtist('${escapeHtml(filename)}','${inpId}')"
              oninput="mp2.unknownEdits['${escapeHtml(filename)}']=this.value"
            >
            <button class="mp2-unknown-save-btn"
              onclick="mp2SaveUnknownArtist('${escapeHtml(filename)}','${inpId}')">
              Save
            </button>
          </div>
        </div>
        <button class="mp2-unknown-play-btn" title="Preview" onclick="mp2PlayTrack('${escapeHtml(filename)}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>
      </div>
    `;
  }).join('');

  // Lazy load art
  unknown.forEach(async t => {
    const artId = 'unk-art-' + btoa(t.name).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
    const artEl = document.getElementById(artId);
    if (!artEl) return;
    const url = await mp2GetArt(t.name);
    if (url) {
      artEl.innerHTML = `<img src="${escapeHtml(url)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'">`;
    }
  });
}

async function mp2SaveUnknownArtist(filename, inputId) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  const artist = inp.value.trim();
  if (!artist) { inp.focus(); return; }

  const btn = inp.parentElement.querySelector('.mp2-unknown-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    const tok = window.token || localStorage.getItem('token') || '';
    // Compute new filename: Artist - Title.ext
    const ext   = filename.match(/\.(mp3|flac|wav|ogg|m4a|aac|opus|wma|webm)$/i)?.[0] || '.mp3';
    const title = mp2GuessTitle(filename);
    const newName = `${artist} - ${title}${ext}`;

    const res = await fetch('/api/music/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
      body: JSON.stringify({ old_name: filename, new_name: newName }),
    });

    if (res.ok) {
      // Mark row as saved
      const rowId = 'unk-row-unk-art-' + btoa(filename).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
      const row = document.getElementById(rowId) || inp.closest('.mp2-unknown-row');
      if (row) {
        row.classList.add('mp2-unknown-row--saved');
        const wrap = row.querySelector('.mp2-unknown-artist-wrap');
        if (wrap) wrap.innerHTML = `<span class="mp2-unknown-saved-tag">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          Saved as ${escapeHtml(artist)}
        </span>`;
      }
      // Reload library
      await mp2LoadTracks();
      mp2UpdateNavBadges();
      setTimeout(mp2RenderUnknownArtistsView, 600);
    } else {
      const d = await res.json().catch(() => ({}));
      alert('Could not rename: ' + (d.error || 'Unknown error'));
      if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    }
  } catch(e) {
    alert('Error: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
  }
}

function mp2BulkRenameUnknown() {
  const modal = document.getElementById('mp2BulkRenameModal');
  if (modal) {
    modal.style.display = 'flex';
    document.getElementById('mp2BulkArtistInput')?.focus();
  }
}

async function mp2ConfirmBulkRename() {
  const inp = document.getElementById('mp2BulkArtistInput');
  const artist = inp?.value?.trim();
  if (!artist) { inp?.focus(); return; }

  const statusEl = document.getElementById('mp2BulkStatus');
  if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Renaming…'; }

  const audioTracks = mp2.tracks.filter(t => !/\.(webp)$/i.test(t.name));
  const unknown = audioTracks.filter(t => !mp2GuessArtist(t.name));
  const tok = window.token || localStorage.getItem('token') || '';

  let success = 0, fail = 0;
  for (const t of unknown) {
    const ext   = t.name.match(/\.(mp3|flac|wav|ogg|m4a|aac|opus|wma|webm)$/i)?.[0] || '.mp3';
    const title = mp2GuessTitle(t.name);
    const newName = `${artist} - ${title}${ext}`;
    try {
      const res = await fetch('/api/music/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
        body: JSON.stringify({ old_name: t.name, new_name: newName }),
      });
      if (res.ok) success++; else fail++;
    } catch { fail++; }
  }

  if (statusEl) statusEl.textContent = `Done! ${success} renamed${fail ? ', ' + fail + ' failed' : ''}.`;
  await mp2LoadTracks();
  mp2UpdateNavBadges();
  setTimeout(() => {
    document.getElementById('mp2BulkRenameModal').style.display = 'none';
    mp2RenderUnknownArtistsView();
  }, 1500);
}

// ════════════════════════════════════════════════════════════════════
//  RECOMMENDATIONS VIEW
// ════════════════════════════════════════════════════════════════════

function mp2RenderRecommendationsView() {
  _mp2RenderRecInLibrary();
  _mp2RenderRecYT();
}

function _mp2RenderRecInLibrary() {
  const row = document.getElementById('mp2RecInLibRow');
  if (!row) return;
  const audioTracks = mp2.tracks.filter(t => !/\.(webp)$/i.test(t.name));
  if (!audioTracks.length) { row.innerHTML = '<div style="padding:0 28px;color:var(--mp2-text3);font-size:13px;">No tracks in library yet</div>'; return; }
  // Pick a random selection weighted toward recently-added
  const pool = [...audioTracks].sort((a,b) => b.modified - a.modified).slice(0, 40);
  const picks = _mp2shuffleArr(pool).slice(0, 12);
  row.innerHTML = '';
  picks.forEach(t => {
    const card = mp2MakeSongCard(t);
    row.appendChild(card);
  });
}

function _mp2shuffleArr(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function mp2RefreshRecommendations() {
  const btn = document.getElementById('mp2RecRefreshBtn');
  const loading = document.getElementById('mp2RecLoading');
  const ytRow   = document.getElementById('mp2RecYTRow');
  const empty   = document.getElementById('mp2RecEmpty');

  if (btn) btn.classList.add('loading');
  if (loading) loading.style.display = 'flex';
  if (ytRow)   ytRow.innerHTML = '';
  if (empty)   empty.style.display = 'none';

  // Refresh in-library section too
  _mp2RenderRecInLibrary();

  try {
    // Build a search query from known artists
    const audioTracks = mp2.tracks.filter(t => !/\.(webp)$/i.test(t.name));
    const artists = [...new Set(audioTracks.map(t => mp2GuessArtist(t.name)).filter(Boolean))];
    const seed = _mp2shuffleArr(artists).slice(0, 3);

    if (!seed.length) throw new Error('No artists to base recommendations on');

    // Search YouTube via the app's /api/music/search_yt or /api/music/list endpoint
    const tok = window.token || localStorage.getItem('token') || '';
    const queries = seed.map(a => encodeURIComponent(a + ' music'));

    const results = [];
    const seenIds = new Set();
    const inLibraryTitles = new Set(audioTracks.map(t => mp2GuessTitle(t.name).toLowerCase()));

    for (const q of queries.slice(0, 2)) {
      try {
        const res = await fetch(`/api/music/list?url=https://www.youtube.com/results?search_query=${q}&limit=8`, {
          headers: { Authorization: 'Bearer ' + tok }
        });
        if (!res.ok) continue;
        const d = await res.json();
        const vids = d.videos || [];
        for (const v of vids) {
          if (!seenIds.has(v.id)) {
            seenIds.add(v.id);
            results.push({
              ...v,
              inLibrary: inLibraryTitles.has((v.title || '').toLowerCase()),
            });
          }
        }
      } catch {}
    }

    mp2.recYT = results;
    mp2.recLoaded = true;

    if (ytRow) {
      ytRow.innerHTML = '';
      if (!results.length) {
        if (empty) { empty.style.display = 'block'; empty.textContent = 'No results found. Try adding more tracks to your library.'; }
      } else {
        results.slice(0, 16).forEach(v => {
          const card = _mp2MakeYTRecCard(v);
          ytRow.appendChild(card);
        });
      }
    }
  } catch(e) {
    if (empty) {
      empty.style.display = 'block';
      empty.textContent = e.message || 'Could not load recommendations.';
    }
  } finally {
    if (btn) btn.classList.remove('loading');
    if (loading) loading.style.display = 'none';
  }
}

function _mp2MakeYTRecCard(v) {
  const card = document.createElement('div');
  card.className = 'mp2-rec-yt-card';

  const thumbHtml = v.thumbnail
    ? `<img src="${escapeHtml(v.thumbnail)}" alt="" onerror="this.style.display='none'">`
    : `<div class="mp2-rec-yt-thumb-ph">
         <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
           <circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>
         </svg>
       </div>`;
  const durHtml = v.duration ? `<div class="mp2-rec-yt-dur">${escapeHtml(v.duration)}</div>` : '';

  const inLib = v.inLibrary;
  const dlBtn = inLib
    ? `<button class="mp2-rec-yt-btn in-library" disabled>
         <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
         In library
       </button>`
    : `<button class="mp2-rec-yt-btn" onclick="mp2RecDownload('${escapeHtml(v.url || '')}','${escapeHtml(v.title || '')}','${escapeHtml(v.uploader || '')}',this)">
         <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
         Download
       </button>`;

  card.innerHTML = `
    <div class="mp2-rec-yt-thumb">
      ${thumbHtml}
      <div class="mp2-rec-yt-play-overlay">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </div>
      ${durHtml}
    </div>
    <div class="mp2-rec-yt-info">
      <div class="mp2-rec-yt-title">${escapeHtml(v.title || 'Untitled')}</div>
      <div class="mp2-rec-yt-artist">${escapeHtml(v.uploader || '')}</div>
      <div class="mp2-rec-yt-actions">${dlBtn}</div>
    </div>
  `;

  // Open YouTube on thumb click
  card.querySelector('.mp2-rec-yt-play-overlay')?.addEventListener('click', () => {
    if (v.url) window.open(v.url, '_blank');
  });

  return card;
}

async function mp2RecDownload(url, title, artist, btnEl) {
  if (!url) return;
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg> Adding…';
  }
  // Navigate to downloads
  const dlId = mp2RegisterDownload({ title, artist, thumb: '', url, format: 'mp3' });
  mp2UpdateDownload(dlId, { status: 'active', progress: 15 });

  try {
    const tok = window.token || localStorage.getItem('token') || '';
    const res = await fetch('/api/music/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
      body: JSON.stringify({ url, artist, format: 'mp3', quality: '192', save_thumb: true }),
    });
    if (res.ok) {
      mp2UpdateDownload(dlId, { status: 'done', progress: 100 });
      await mp2LoadTracks();
      mp2RenderAll();
      if (btnEl) {
        btnEl.classList.add('in-library');
        btnEl.disabled = true;
        btnEl.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> In library';
      }
    } else {
      const d = await res.json().catch(() => ({}));
      mp2UpdateDownload(dlId, { status: 'fail', error: d.error || 'Failed' });
      if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = 'Retry'; }
    }
  } catch(e) {
    mp2UpdateDownload(dlId, { status: 'fail', error: e.message });
    if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = 'Retry'; }
  }
}

// ════════════════════════════════════════════════════════════════════
//  ENHANCED: ARTIST CARD — show even without photo
// ════════════════════════════════════════════════════════════════════

const _mp2MakeArtistCardOrig = typeof mp2MakeArtistCard === 'function' ? mp2MakeArtistCard : null;

mp2MakeArtistCard = function(artistName, tracks) {
  const card = document.createElement('div');
  card.className = 'mp2-artist-card';
  card.title = artistName;

  const initial = (artistName || '?').charAt(0).toUpperCase();

  const imgDiv = document.createElement('div');
  imgDiv.className = 'mp2-artist-card-img mp2-artist-card-nophoto';
  imgDiv.textContent = initial;

  const imgEl = document.createElement('img');
  imgEl.style.display = 'none';
  imgEl.style.position = 'absolute';
  imgEl.style.inset = '0';
  imgEl.style.width = '100%';
  imgEl.style.height = '100%';
  imgEl.style.objectFit = 'cover';
  imgEl.style.borderRadius = 'inherit';
  imgEl.alt = artistName;
  imgEl.onload = () => {
    imgEl.style.display = 'block';
    imgDiv.textContent = '';
    imgDiv.classList.remove('mp2-artist-card-nophoto');
  };
  imgDiv.style.position = 'relative';
  imgDiv.appendChild(imgEl);

  const nameDiv = document.createElement('div');
  nameDiv.className = 'mp2-artist-card-name';
  nameDiv.textContent = artistName;

  const countDiv = document.createElement('div');
  countDiv.className = 'mp2-artist-card-count';
  countDiv.textContent = tracks.length + (tracks.length === 1 ? ' song' : ' songs');

  card.appendChild(imgDiv);
  card.appendChild(nameDiv);
  card.appendChild(countDiv);

  card.onclick = () => {
    mp2.activeArtist = artistName;
    mp2GoView('artist-detail');
  };

  // Lazy load image
  mp2GetArtistPhoto(artistName).then(url => {
    if (url) imgEl.src = url;
  });

  return card;
};

// ════════════════════════════════════════════════════════════════════
//  ENHANCED: TRACK ROW — show song even without artist, badge unknown
// ════════════════════════════════════════════════════════════════════

const _mp2MakeTrackRowOrig = typeof mp2MakeTrackRow === 'function' ? mp2MakeTrackRow : null;

if (_mp2MakeTrackRowOrig) {
  mp2MakeTrackRow = function(t, idx, context) {
    const row = _mp2MakeTrackRowOrig(t, idx, context);
    if (!row) return row;

    const artist = mp2GuessArtist(t.name);
    if (!artist) {
      // Find the artist subtitle element inside the row and add badge
      const sub = row.querySelector('.mp2-track-row-artist, .mp2-track-sub');
      if (sub) {
        const badge = document.createElement('span');
        badge.className = 'mp2-track-unknown-badge';
        badge.title = 'Artist unknown — click to identify';
        badge.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17" stroke-width="3"/></svg> Unknown`;
        badge.onclick = (e) => {
          e.stopPropagation();
          mp2GoView('unknown-artists');
        };
        sub.appendChild(badge);
      }
    }
    return row;
  };
}

// ════════════════════════════════════════════════════════════════════
//  SAFE ESCAPE (re-declare only if not already present)
// ════════════════════════════════════════════════════════════════════
if (typeof escapeHtml !== 'function') {
  window.escapeHtml = function(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#039;');
  };
}

console.log('[Resonance v3] patch loaded ✓');
