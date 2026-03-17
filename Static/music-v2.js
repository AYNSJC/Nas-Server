/* ═══════════════════════════════════════════════════════════════════
   MUSIC PLAYER v2  ·  music-v2.js
   Load AFTER app.js:  <script src="/static/music-v2.js"></script>
   Overrides the music section of app.js with new UI + features.
═══════════════════════════════════════════════════════════════════ */

// ── State ────────────────────────────────────────────────────────────
const mp2 = {
  tracks:      [],
  playlists:   [],
  favorites:   new Set(),
  currentTrack: null,
  queue:        [],
  queueIdx:     -1,
  queueContext: 'all',   // 'all' | 'playlist:{id}' | 'artist:{name}' | 'liked'
  shuffle:      false,
  loop:         0,        // 0=off, 1=all, 2=one
  volume:       0.8,
  muted:        false,
  artCache:     {},       // filename → art URL
  artistArtCache: {},     // artist name → photo URL
  addSongsForPlId: null,
  addSongsSelected: new Set(),
  browseType:   'videos',
  chType:       'videos',
  ytFmt:        'mp3',
  chFmt:        'mp3',
  viewHistory:  [],
  currentView:  'home',
  activeArtist: null,
  activePl:     null,
};

const mpAudio2 = document.getElementById('mpAudio') || (() => {
  const a = document.createElement('audio');
  a.id = 'mpAudio';
  a.preload = 'metadata';
  document.body.appendChild(a);
  return a;
})();

// ── Override old enterMusicMode ──────────────────────────────────────
window.enterMusicMode = function () {
  const ov = document.getElementById('musicOverlay');
  if (!ov) return;
  ov.style.display = 'flex';
  ov.style.pointerEvents = '';
  ov.style.zIndex = '999';
  ov.classList.add('open');
  const mb = document.getElementById('mpMiniBar');
  if (mb) mb.style.display = 'none';
  document.body.classList.remove('mp-mini-active');
  mp2Init();
};

window.exitMusicMode = mp2Close;

// ── PWA: inject manifest + theme-color into <head> if not already present ────
(function mp2InjectPWAMeta() {
  if (!document.querySelector('link[rel="manifest"]')) {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = '/manifest.json';
    document.head.appendChild(link);
  }
  if (!document.querySelector('meta[name="theme-color"]')) {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = '#7c3aed';
    document.head.appendChild(meta);
  }
  if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
    const m1 = document.createElement('meta');
    m1.name = 'apple-mobile-web-app-capable';
    m1.content = 'yes';
    document.head.appendChild(m1);
    const m2 = document.createElement('meta');
    m2.name = 'apple-mobile-web-app-status-bar-style';
    m2.content = 'black-translucent';
    document.head.appendChild(m2);
    const m3 = document.createElement('meta');
    m3.name = 'apple-mobile-web-app-title';
    m3.content = 'Resonance';
    document.head.appendChild(m3);
  }
  // Apple touch icon
  if (!document.querySelector('link[rel="apple-touch-icon"]')) {
    const icon = document.createElement('link');
    icon.rel = 'apple-touch-icon';
    icon.href = '/static/icons/icon-192.png';
    document.head.appendChild(icon);
  }
  // Generate icons if they haven't been created yet (one-time background fetch)
  fetch('/static/icons/icon-192.png', { method: 'HEAD' }).then(r => {
    if (!r.ok) fetch('/generate-icons').catch(() => {});
  }).catch(() => {});
})();

// ── Init ─────────────────────────────────────────────────────────────
let _mp2Initialized = false;
let _mp2IsAdmin = false;

async function mp2CheckAdmin() {
  try {
    const tok = window.token || localStorage.getItem('token') || '';
    const res = await fetch('/api/music/is_admin', {
      headers: { Authorization: 'Bearer ' + tok }
    });
    if (res.ok) {
      const d = await safeJson(res);
      _mp2IsAdmin = d.is_admin || false;
    } else {
      console.warn('[Resonance] is_admin check failed:', res.status);
    }
  } catch (e) {
    console.warn('[Resonance] is_admin fetch error:', e);
  }
}

function mp2ApplyAdminUI() {
  document.querySelectorAll('.mp2-admin-only').forEach(el => {
    if (_mp2IsAdmin) {
      // Header icon buttons are display:flex; inline items are inline-flex
      // Use the tag's natural display based on what it is
      const tag = el.tagName.toLowerCase();
      if (tag === 'button' || tag === 'div') {
        // Check CSS to decide: header buttons use flex, inline chips use inline-flex
        const cs = window.getComputedStyle(el);
        // If it was hidden by inline style, restore based on class
        if (el.classList.contains('mp2-btn-icon') || el.classList.contains('mp2-btn-add')) {
          el.style.display = 'flex';
        } else {
          el.style.display = 'inline-flex';
        }
      } else {
        el.style.display = '';
      }
    } else {
      el.style.display = 'none';
    }
  });
}

async function mp2Init() {
  if (_mp2Initialized) { mp2RenderAll(); return; }
  _mp2Initialized = true;
  await mp2LoadPrefs();
  await mp2LoadTracks();
  await mp2CheckAdmin();
  mp2SetVolume(mp2.volume);
  mp2BindAudio();
  mp2RenderAll();
  mp2SetGreeting();
  mp2ApplyAdminUI();
}

async function mp2LoadPrefs() {
  try {
    const res = await fetch('/api/music/prefs', { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return;
    const d = await safeJson(res);
    mp2.playlists = d.playlists || [];
    mp2.favorites = new Set(d.favorites || []);
  } catch {}
}

async function mp2SavePrefs() {
  try {
    await fetch('/api/music/prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ playlists: mp2.playlists, favorites: [...mp2.favorites] })
    });
  } catch {}
}

async function mp2LoadTracks() {
  try {
    const res = await fetch('/api/music/tracks', { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return;
    const d = await safeJson(res);
    const allTracks = d.tracks || [];

    // Identify and delete tracks with artist "NA" or "N/A" from server
    const naTracks = allTracks.filter(t => {
      const artist = mp2GuessArtist(t.name);
      return artist === 'NA' || artist === 'N/A';
    });
    if (naTracks.length > 0) {
      console.log(`[Geet] Removing ${naTracks.length} NA-artist tracks from server...`);
      for (const t of naTracks) {
        try {
          await fetch('/api/music/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ name: t.name })
          });
          // Also remove matching webp
          const base = t.name.replace(/\.(mp3|flac|wav|ogg|m4a|aac|opus|wma|webm)$/i, '');
          await fetch('/api/music/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ name: base + '.webp' })
          }).catch(() => {});
        } catch {}
      }
    }

    // Keep only non-NA tracks
    mp2.tracks = allTracks.filter(t => {
      const artist = mp2GuessArtist(t.name);
      return artist !== 'NA' && artist !== 'N/A';
    });
    // Also sync to old mp state so other parts of app still work
    if (window.mp) mp.tracks = mp2.tracks;
  } catch {}
}

// ── Greeting ────────────────────────────────────────────────────────
function mp2SetGreeting() {
  const h = new Date().getHours();
  const g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const el = document.getElementById('mp2Greeting');
  if (el) el.innerHTML = `${g}, <span>${escapeHtml(currentUser || 'music lover')}</span> 🎵`;
}

// ── Close ─────────────────────────────────────────────────────────────
function mp2Close() {
  const ov = document.getElementById('musicOverlay');
  if (ov) {
    ov.style.display = 'none';
    ov.classList.remove('open');
    // Reset z-index so it doesn't block storage UI
    ov.style.zIndex = '';
    ov.style.pointerEvents = 'none';
  }
  // Also close CD modal if open
  const cd = document.getElementById('mp2CDModal');
  if (cd) { cd.style.display = 'none'; cd.classList.remove('open'); }

  // Show mini bar if playing
  if (mp2.currentTrack && !mpAudio2.paused) {
    const mb = document.getElementById('mpMiniBar');
    if (mb) {
      mb.style.display = 'flex';
      document.body.classList.add('mp-mini-active');
      const mt = document.getElementById('mpMiniTitle');
      const ms = document.getElementById('mpMiniSub');
      if (mt) mt.textContent = mp2GuessTitle(mp2.currentTrack);
      if (ms) ms.textContent = mp2GuessArtist(mp2.currentTrack) || '—';
    }
  }
}

// ── Navigation ────────────────────────────────────────────────────────
function mp2GoView(view, skipHistory) {
  if (!skipHistory && mp2.currentView !== view) mp2.viewHistory.push(mp2.currentView);
  mp2.currentView = view;

  document.querySelectorAll('.mp2-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.mp2-nav-btn').forEach(b => b.classList.remove('active'));

  const viewMap = {
    home: 'mp2ViewHome',
    songs: 'mp2ViewSongs',
    artists: 'mp2ViewArtists',
    'artist-detail': 'mp2ViewArtistDetail',
    playlists: 'mp2ViewPlaylists',
    'playlist-detail': 'mp2ViewPlaylistDetail',
    liked: 'mp2ViewLiked',
  };
  const navMap = {
    home: 'mp2NavHome',
    songs: 'mp2NavSongs',
    artists: 'mp2NavArtists',
    playlists: 'mp2NavPlaylists',
    liked: 'mp2NavLiked',
  };
  const viewEl = document.getElementById(viewMap[view]);
  if (viewEl) viewEl.classList.add('active');
  const navEl = document.getElementById(navMap[view]);
  if (navEl) navEl.classList.add('active');
  else if (navMap[view.split('-')[0]]) {
    document.getElementById(navMap[view.split('-')[0]])?.classList.add('active');
  }

  // Scroll to top
  const vc = document.getElementById('mp2ViewContainer');
  if (vc) vc.scrollTop = 0;

  // Render the view
  const renders = {
    home: mp2RenderHome,
    songs: mp2RenderSongsView,
    artists: mp2RenderArtistsView,
    'artist-detail': mp2RenderArtistDetail,
    playlists: mp2RenderPlaylistsView,
    'playlist-detail': mp2RenderPlaylistDetail,
    liked: mp2RenderLikedView,
  };
  if (renders[view]) renders[view]();
}

function mp2NavBack() {
  if (mp2.viewHistory.length > 0) mp2GoView(mp2.viewHistory.pop(), true);
}
function mp2NavFwd() {} // optional: implement forward stack

// ── Render All ────────────────────────────────────────────────────────
function mp2RenderAll() {
  mp2GoView(mp2.currentView, true);
  mp2RenderNavPlaylists();
  mp2UpdateBottomBar();
  mp2UpdatePlayState();
}

// ── ART FETCHING ──────────────────────────────────────────────────────
// Uses server .webp sidecars first, then falls back to iTunes Search API

function mp2ThumbUrl(trackName) {
  const base = trackName.replace(/\.(mp3|flac|wav|ogg|m4a|aac|opus|wma|webm)$/i, '');
  return '/api/music/stream/' + encodeURIComponent(base + '.webp') + '?token=' + encodeURIComponent(token);
}

function mp2TrackHasThumb(trackName) {
  const base = trackName.replace(/\.(mp3|flac|wav|ogg|m4a|aac|opus|wma|webm)$/i, '');
  return mp2.tracks.some(t => t.name === base + '.webp');
}

async function mp2GetArt(trackName) {
  if (mp2.artCache[trackName]) return mp2.artCache[trackName];
  // 1. Server-side .webp
  if (mp2TrackHasThumb(trackName)) {
    const url = mp2ThumbUrl(trackName);
    mp2.artCache[trackName] = url;
    return url;
  }
  // 2. iTunes Search API (CORS-friendly, no key needed)
  try {
    const title  = mp2GuessTitle(trackName);
    const artist = mp2GuessArtist(trackName);
    const q = encodeURIComponent(artist ? `${artist} ${title}` : title);
    const res = await fetch(`https://itunes.apple.com/search?term=${q}&media=music&limit=1`);
    if (!res.ok) throw new Error('iTunes fail');
    const d = await res.json();
    if (d.results && d.results.length > 0) {
      const url = d.results[0].artworkUrl100.replace('100x100bb', '600x600bb');
      mp2.artCache[trackName] = url;
      return url;
    }
  } catch {}
  mp2.artCache[trackName] = null;
  return null;
}

async function mp2GetArtistPhoto(artistName, forceRefresh) {
  if (!artistName || artistName === 'Unknown Artist') return null;
  if (!forceRefresh && mp2.artistArtCache[artistName] !== undefined) return mp2.artistArtCache[artistName];

  // Check localStorage cache first — skip network unless forceRefresh
  if (!forceRefresh) {
    try {
      const cached = localStorage.getItem('mp2_artist_' + artistName);
      if (cached !== null) {
        mp2.artistArtCache[artistName] = cached || null;
        return cached || null;
      }
    } catch {}
  }

  // Try to find from a track's thumbnail first (always use this — it's local)
  const artistTracks = mp2.tracks.filter(t =>
    !/\.(webp)$/i.test(t.name) && mp2GuessArtist(t.name) === artistName
  );
  for (const t of artistTracks) {
    if (mp2TrackHasThumb(t.name)) {
      const url = mp2ThumbUrl(t.name);
      mp2.artistArtCache[artistName] = url;
      try { localStorage.setItem('mp2_artist_' + artistName, url); } catch {}
      return url;
    }
  }

  // Only fetch from iTunes if forceRefresh is set (admin triggered)
  if (!forceRefresh) {
    // Return null — don't fetch externally on every page load
    mp2.artistArtCache[artistName] = null;
    return null;
  }

  // Primary: iTunes track search (much more reliable for artwork than artist entity search)
  try {
    const q = encodeURIComponent(artistName);
    const res = await fetch(`https://itunes.apple.com/search?term=${q}&media=music&entity=song&limit=5`);
    if (!res.ok) throw new Error();
    const d = await res.json();
    if (d.results && d.results.length > 0) {
      // Pick best result that matches artist name
      let best = d.results[0];
      for (const r of d.results) {
        if ((r.artistName || '').toLowerCase().includes(artistName.toLowerCase()) ||
            artistName.toLowerCase().includes((r.artistName || '').toLowerCase())) {
          best = r; break;
        }
      }
      if (best.artworkUrl100) {
        const url = best.artworkUrl100.replace('100x100bb', '600x600bb');
        mp2.artistArtCache[artistName] = url;
        try { localStorage.setItem('mp2_artist_' + artistName, url); } catch {}
        return url;
      }
    }
  } catch {}
  // Fallback: try art from local track sidecars or cached art
  try {
    for (const t of artistTracks.slice(0, 3)) {
      const url = await mp2GetArt(t.name);
      if (url) {
        mp2.artistArtCache[artistName] = url;
        try { localStorage.setItem('mp2_artist_' + artistName, url); } catch {}
        return url;
      }
    }
  } catch {}
  mp2.artistArtCache[artistName] = null;
  try { localStorage.setItem('mp2_artist_' + artistName, ''); } catch {}
  return null;
}

// Load art lazily into an img element
async function mp2LoadArt(trackName, imgEl, phEl) {
  const url = await mp2GetArt(trackName);
  if (url && imgEl) {
    imgEl.src = url;
    imgEl.style.display = 'block';
    if (phEl) phEl.style.display = 'none';
  }
}

// ── Name helpers ──────────────────────────────────────────────────────
function mp2GuessTitle(filename) {
  let n = filename.replace(/\.(mp3|flac|wav|ogg|m4a|aac|opus|wma|webm)$/i, '');
  if (n.includes(' - ')) {
    const artistPart = n.split(' - ')[0].trim();
    const titlePart  = n.split(' - ').slice(1).join(' - ').trim();
    if (/^(na|n\/a|none|unknown|unknown artist)$/i.test(artistPart)) {
      // NA prefix — title is everything after it; strip any detected artist name from title
      return _mp2StripArtistFromTitle(titlePart);
    }
    return titlePart;
  }
  // No separator — try to strip any known artist name that appears inside the stem
  return _mp2StripArtistFromTitle(n);
}

// Remove a detected artist name from a title string so lyrics search gets a clean song title
function _mp2StripArtistFromTitle(title) {
  const detect = typeof mp2DetectArtistInTitle === 'function' ? mp2DetectArtistInTitle : null;
  if (!detect) return title;
  const artist = detect(title);
  if (!artist) return title;
  // Build all aliases for this artist and remove them from the title
  const aliases = _mp2ArtistAliases
    .filter(([, canonical]) => canonical === artist)
    .map(([alias]) => alias);
  let t = title;
  for (const alias of aliases) {
    const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp('(?<![a-z0-9])' + esc + '(?![a-z0-9])', 'gi'), '').trim();
  }
  // Clean up leftover separators: " - ", " | ", leading/trailing punctuation
  t = t.replace(/^\s*[-|,·]+\s*|\s*[-|,·]+\s*$/g, '').replace(/\s{2,}/g, ' ').trim();
  return t || title; // fallback to original if we stripped everything
}

function mp2GuessArtist(filename) {
  const n = filename.replace(/\.(mp3|flac|wav|ogg|m4a|aac|opus|wma|webm)$/i, '');
  if (n.includes(' - ')) {
    const artist = n.split(' - ')[0].trim();
    // Treat NA / N/A / None / Unknown as no artist
    if (/^(na|n\/a|none|unknown|unknown artist)$/i.test(artist)) {
      // Artist part is NA — try to detect from the title side
      const titlePart = n.split(' - ').slice(1).join(' - ').trim();
      return mp2DetectArtistInTitle ? (mp2DetectArtistInTitle(titlePart) || mp2DetectArtistInTitle(n) || '') : '';
    }
    return artist;
  }
  // No " - " separator — try to detect artist anywhere in the full stem
  // mp2DetectArtistInTitle is defined later in this file; use window fallback for safety
  const detect = typeof mp2DetectArtistInTitle === 'function' ? mp2DetectArtistInTitle : null;
  return detect ? (detect(n) || '') : '';
}

// ── HOME VIEW ─────────────────────────────────────────────────────────
function mp2RenderHome() {
  const el = document.getElementById('mp2ViewHome');
  if (!el) return;
  const audioTracks = mp2.tracks.filter(t => !/\.(webp)$/i.test(t.name));
  if (!audioTracks.length) {
    el.innerHTML = `
      <div class="mp2-home-greeting" id="mp2Greeting"></div>
      <div class="mp2-empty-state" style="margin-top:40px;">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        <h3>Your library is empty</h3>
        <p>Add songs from YouTube, a channel,<br>or upload your own audio files.</p>
        <button class="mp2-empty-cta" onclick="mp2OpenAddPanel()">+ Add Music</button>
      </div>`;
    mp2SetGreeting();
    return;
  }

  const recent = [...audioTracks].sort((a, b) => b.modified - a.modified).slice(0, 12);
  const liked  = audioTracks.filter(t => mp2.favorites.has(t.name)).slice(0, 8);

  // Group artists
  const artistMap = {};
  audioTracks.forEach(t => {
    const a = mp2GuessArtist(t.name) || 'Unknown Artist';
    if (!artistMap[a]) artistMap[a] = [];
    artistMap[a].push(t);
  });
  const artistList = Object.entries(artistMap).sort((a,b) => a[0].localeCompare(b[0])).slice(0, 12);

  el.innerHTML = `
    <div class="mp2-home-greeting" id="mp2Greeting"></div>

    <div class="mp2-section" id="mp2SecRecent">
      <div class="mp2-section-header">
        <div class="mp2-section-title">Recently Added</div>
        <button class="mp2-section-see-all" onclick="mp2GoView('songs')">See all</button>
      </div>
      <div class="mp2-scroll-row" id="mp2RecentRow"></div>
    </div>

    ${liked.length > 0 ? `
    <div class="mp2-section" id="mp2SecLiked">
      <div class="mp2-section-header">
        <div class="mp2-section-title">❤️ Liked Songs</div>
        <button class="mp2-section-see-all" onclick="mp2GoView('liked')">See all</button>
      </div>
      <div class="mp2-scroll-row" id="mp2LikedRow"></div>
    </div>` : ''}

    <div class="mp2-section" id="mp2SecArtists">
      <div class="mp2-section-header">
        <div class="mp2-section-title">Artists</div>
        <button class="mp2-section-see-all" onclick="mp2GoView('artists')">See all</button>
      </div>
      <div class="mp2-scroll-row" id="mp2ArtistRow"></div>
    </div>

    ${mp2.playlists.length > 0 ? `
    <div class="mp2-section" id="mp2SecPls">
      <div class="mp2-section-header">
        <div class="mp2-section-title">Your Playlists</div>
        <button class="mp2-section-see-all" onclick="mp2GoView('playlists')">See all</button>
      </div>
      <div class="mp2-scroll-row" id="mp2PlRow"></div>
    </div>` : ''}
  `;

  mp2SetGreeting();

  // Populate rows
  const recentRow = document.getElementById('mp2RecentRow');
  if (recentRow) recent.forEach(t => {
    const card = mp2MakeSongCard(t);
    recentRow.appendChild(card);
  });

  if (liked.length > 0) {
    const likedRow = document.getElementById('mp2LikedRow');
    if (likedRow) liked.forEach(t => {
      const card = mp2MakeSongCard(t);
      likedRow.appendChild(card);
    });
  }

  const artistRow = document.getElementById('mp2ArtistRow');
  if (artistRow) artistList.forEach(([artist, tracks]) => {
    const card = mp2MakeArtistCard(artist, tracks);
    artistRow.appendChild(card);
  });

  if (mp2.playlists.length > 0) {
    const plRow = document.getElementById('mp2PlRow');
    if (plRow) mp2.playlists.forEach(pl => {
      const card = mp2MakePlCard(pl);
      plRow.appendChild(card);
    });
  }
}

function mp2MakeSongCard(t) {
  const div = document.createElement('div');
  div.className = 'mp2-song-card' + (t.name === mp2.currentTrack ? ' playing' : '');
  div.title = mp2GuessTitle(t.name);

  const artDiv  = document.createElement('div');
  artDiv.className = 'mp2-card-art';
  const img = document.createElement('img');
  img.style.display = 'none';
  const ph = document.createElement('div');
  ph.className = 'mp2-card-art-placeholder';
  ph.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
  const playBtn = document.createElement('div');
  playBtn.className = 'mp2-card-play';
  playBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  artDiv.appendChild(img);
  artDiv.appendChild(ph);
  artDiv.appendChild(playBtn);

  const info = document.createElement('div');
  info.className = 'mp2-card-info';
  info.innerHTML = `<div class="mp2-card-name">${escapeHtml(mp2GuessTitle(t.name))}</div>
    <div class="mp2-card-artist">${escapeHtml(mp2GuessArtist(t.name) || 'Unknown Artist')}</div>`;

  div.appendChild(artDiv);
  div.appendChild(info);
  div.onclick = () => mp2PlayTrack(t.name, 'all');

  mp2LoadArt(t.name, img, ph);
  return div;
}

function mp2MakeArtistCard(artist, tracks) {
  const div = document.createElement('div');
  div.className = 'mp2-artist-card';
  div.innerHTML = `
    <div class="mp2-artist-photo" id="mp2APhoto_${CSS.escape(artist)}">
      ${escapeHtml(artist.charAt(0))}
    </div>
    <div class="mp2-artist-card-name">${escapeHtml(artist === 'Unknown Artist' ? 'Unknown' : artist)}</div>
    <div class="mp2-artist-card-count">${tracks.length} song${tracks.length !== 1 ? 's' : ''}</div>`;
  div.onclick = () => { mp2.activeArtist = artist; mp2GoView('artist-detail'); };

  // Load artist photo async
  if (artist !== 'Unknown Artist') {
    mp2GetArtistPhoto(artist).then(url => {
      if (url) {
        const ph = document.getElementById(`mp2APhoto_${CSS.escape(artist)}`);
        if (ph) {
          ph.innerHTML = `<img src="${url}" alt="${escapeHtml(artist)}" onerror="this.style.display='none'">`;
        }
      }
    });
  }
  return div;
}

function mp2MakePlCard(pl) {
  const div = document.createElement('div');
  div.className = 'mp2-playlist-card';

  const coverDiv = document.createElement('div');
  coverDiv.className = 'mp2-pl-cover';
  const playBtn = document.createElement('div');
  playBtn.className = 'mp2-card-play';
  playBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;

  // Build collage from first 4 tracks - use webp sidecars if available, else iTunes
  const audioTracks = pl.tracks.filter(tn => mp2.tracks.some(t => t.name === tn));
  const top4 = audioTracks.slice(0, 4);

  if (top4.length >= 1) {
    const coll = document.createElement('div');
    coll.className = 'mp2-pl-cover-collage';
    // Create 4 slots, fill async
    const slots = [];
    for (let i = 0; i < 4; i++) {
      const slot = document.createElement('div');
      slot.className = 'mp2-pl-collage-slot';
      if (top4[i]) {
        const img = document.createElement('img');
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
        img.loading = 'lazy';
        slot.appendChild(img);
        // Load art: webp sidecar first, else iTunes
        const tn = top4[i];
        if (mp2TrackHasThumb(tn)) {
          img.src = mp2ThumbUrl(tn);
        } else {
          img.src = ''; // placeholder
          mp2GetArt(tn).then(url => {
            if (url) img.src = url;
            else slot.style.background = 'var(--mp2-bg3)';
          });
        }
      } else {
        slot.style.background = 'var(--mp2-bg3)';
      }
      slots.push(slot);
      coll.appendChild(slot);
    }
    coverDiv.appendChild(coll);
  } else {
    // Empty playlist
    const single = document.createElement('div');
    single.className = 'mp2-pl-cover-single';
    single.innerHTML = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
    coverDiv.appendChild(single);
  }
  coverDiv.appendChild(playBtn);

  div.innerHTML = `<div class="mp2-pl-card-info">
    <div class="mp2-pl-card-name">${escapeHtml(pl.name)}</div>
    <div class="mp2-pl-card-count">${pl.tracks.length} song${pl.tracks.length !== 1 ? 's' : ''}</div>
  </div>`;
  div.insertBefore(coverDiv, div.firstChild);

  div.querySelector('.mp2-pl-cover').onclick = (e) => {
    mp2.activePl = pl.id;
    mp2GoView('playlist-detail');
  };
  playBtn.onclick = (e) => {
    e.stopPropagation();
    mp2PlayPlaylist(pl.id);
  };
  return div;
}

// ── SONGS VIEW ────────────────────────────────────────────────────────
function mp2RenderSongsView() {
  const el = document.getElementById('mp2SongsList');
  if (!el) return;
  const sort = document.getElementById('mp2SortSelect')?.value || 'name';
  const q    = document.getElementById('mp2SearchInput')?.value?.toLowerCase() || '';

  let list = mp2.tracks.filter(t => !/\.(webp)$/i.test(t.name));
  if (q) list = list.filter(t => t.name.toLowerCase().includes(q));
  if (sort === 'recent') list = [...list].sort((a, b) => b.modified - a.modified);
  else list = [...list].sort((a, b) => a.name.localeCompare(b.name));

  if (!list.length) {
    el.innerHTML = `<div class="mp2-empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <h3>No songs found</h3><p>Try a different search term.</p>
    </div>`;
    return;
  }

  el.innerHTML = '';
  list.forEach((t, i) => {
    const row = mp2MakeTrackRow(t, i + 1, 'all');
    el.appendChild(row);
  });
}

function mp2MakeTrackRow(t, num, context, plId) {
  const isActive = t.name === mp2.currentTrack;
  const isFav    = mp2.favorites.has(t.name);
  const title    = mp2GuessTitle(t.name);
  const artist   = mp2GuessArtist(t.name);

  const row = document.createElement('div');
  row.className = 'mp2-track-row' + (isActive ? ' playing' : '');
  row.dataset.track = t.name;

  if (isActive && !mpAudio2.paused) {
    row.innerHTML = `<div class="mp2-tr-num"><div class="mp2-bars"><span></span><span></span><span></span></div></div>`;
  } else {
    row.innerHTML = `<div class="mp2-tr-num">${num}</div>`;
  }

  const artDiv = document.createElement('div');
  artDiv.className = 'mp2-tr-art';
  const img = document.createElement('img');
  img.style.display = 'none';
  img.loading = 'lazy';
  img.alt = '';
  const ph = document.createElement('div');
  ph.className = 'mp2-tr-art-ph';
  ph.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
  const overlay = document.createElement('div');
  overlay.className = 'mp2-tr-art-overlay';
  overlay.innerHTML = isActive
    ? `<div class="mp2-bars"><span></span><span></span><span></span></div>`
    : `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  artDiv.appendChild(img);
  artDiv.appendChild(ph);
  artDiv.appendChild(overlay);
  row.appendChild(artDiv);

  const infoDiv = document.createElement('div');
  infoDiv.className = 'mp2-tr-info';
  infoDiv.innerHTML = `<div class="mp2-tr-title${isActive ? ' playing' : ''}">${escapeHtml(title)}</div>
    <div class="mp2-tr-artist">${artist ? escapeHtml(artist) : '<span style="opacity:.4">Unknown Artist</span>'}</div>`;
  row.appendChild(infoDiv);

  const favBtn = document.createElement('button');
  favBtn.className = 'mp2-tr-fav' + (isFav ? ' liked' : '');
  favBtn.title = isFav ? 'Unlike' : 'Like';
  favBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="${isFav ? 'var(--mp2-pink)' : 'none'}" stroke="${isFav ? 'var(--mp2-pink)' : 'currentColor'}" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
  favBtn.onclick = (e) => { e.stopPropagation(); mp2ToggleFav(t.name); };
  row.appendChild(favBtn);

  const moreBtn = document.createElement('button');
  moreBtn.className = 'mp2-tr-more';
  moreBtn.innerHTML = '⋯';
  moreBtn.title = 'More options';
  moreBtn.onclick = (e) => { e.stopPropagation(); mp2ShowCtx(e, t.name); };
  row.appendChild(moreBtn);

  row.onclick = () => {
    if (context === 'pl' && plId) mp2PlayTrack(t.name, 'playlist:' + plId);
    else if (context === 'artist') mp2PlayTrack(t.name, 'artist:' + mp2.activeArtist);
    else if (context === 'liked') mp2PlayTrack(t.name, 'liked');
    else mp2PlayTrack(t.name, 'all');
  };

  // Load art async
  mp2LoadArt(t.name, img, ph);

  return row;
}

// ── ARTISTS VIEW ─────────────────────────────────────────────────────
function mp2RenderArtistsView() {
  const el = document.getElementById('mp2ArtistsGrid');
  if (!el) return;
  el.innerHTML = '';
  const groups = {};
  mp2.tracks.filter(t => !/\.(webp)$/i.test(t.name)).forEach(t => {
    const a = mp2GuessArtist(t.name) || 'Unknown Artist';
    if (!groups[a]) groups[a] = [];
    groups[a].push(t);
  });
  const sorted = Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  if (!sorted.length) {
    el.innerHTML = `<div class="mp2-empty-state" style="width:100%;">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      <h3>No artists found</h3>
      <p>Name your files as <code>Artist - Song Title.mp3</code> for automatic artist detection.</p>
    </div>`;
    return;
  }
  sorted.forEach(([artist, tracks]) => {
    const card = mp2MakeArtistCard(artist, tracks);
    el.appendChild(card);
  });
}

// ── ARTIST DETAIL VIEW ────────────────────────────────────────────────
function mp2RenderArtistDetail() {
  const artist = mp2.activeArtist;
  if (!artist) return;
  const tracks = mp2.tracks.filter(t => !/\.(webp)$/i.test(t.name) && (mp2GuessArtist(t.name) || 'Unknown Artist') === artist);

  const hero = document.getElementById('mp2ArtistHero');
  if (hero) {
    hero.innerHTML = `
      <div class="mp2-artist-hero-photo" id="mp2ArtistHeroPhoto">
        ${escapeHtml(artist.charAt(0))}
      </div>
      <div>
        <div class="mp2-artist-hero-name">${escapeHtml(artist)}</div>
        <div class="mp2-artist-hero-stats">${tracks.length} song${tracks.length !== 1 ? 's' : ''}</div>
      </div>`;
    mp2GetArtistPhoto(artist).then(url => {
      if (url) {
        const ph = document.getElementById('mp2ArtistHeroPhoto');
        if (ph) ph.innerHTML = `<img src="${url}" alt="${escapeHtml(artist)}" onerror="this.style.display='none'">`;
      }
    });
  }

  const list = document.getElementById('mp2ArtistTracks');
  if (list) {
    list.innerHTML = '';
    tracks.forEach((t, i) => {
      const row = mp2MakeTrackRow(t, i + 1, 'artist');
      list.appendChild(row);
    });
  }
}

function mp2PlayArtist() {
  const artist = mp2.activeArtist;
  if (!artist) return;
  const tracks = mp2.tracks.filter(t => !/\.(webp)$/i.test(t.name) && (mp2GuessArtist(t.name) || 'Unknown Artist') === artist);
  if (tracks.length) mp2PlayTrack(tracks[0].name, 'artist:' + artist);
}

// ── PLAYLISTS VIEW ────────────────────────────────────────────────────
function mp2RenderPlaylistsView() {
  const el = document.getElementById('mp2PlaylistsGrid');
  if (!el) return;
  el.innerHTML = '';
  if (!mp2.playlists.length) {
    el.innerHTML = `<div class="mp2-empty-state" style="width:100%;">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/></svg>
      <h3>No playlists yet</h3>
      <p>Create your first playlist to organize your music.</p>
      <button class="mp2-empty-cta" onclick="mp2CreatePlaylist()">Create Playlist</button>
    </div>`;
    return;
  }
  mp2.playlists.forEach(pl => {
    const card = mp2MakePlCard(pl);
    el.appendChild(card);
  });
}

// ── PLAYLIST DETAIL VIEW ──────────────────────────────────────────────
function mp2RenderPlaylistDetail() {
  const pl = mp2.playlists.find(p => p.id === mp2.activePl);
  if (!pl) return;

  // Cover
  const coverEl = document.getElementById('mp2PlDetailCover');
  if (coverEl) {
    coverEl.innerHTML = '';
    const audioTracks = pl.tracks.filter(tn => mp2.tracks.some(t => t.name === tn));
    if (audioTracks.length >= 1) {
      const top4 = audioTracks.slice(0, 4);
      const coll = document.createElement('div');
      coll.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;width:100%;height:100%;';
      top4.forEach((tn, i) => {
        const slot = document.createElement('div');
        slot.style.cssText = 'background:var(--mp2-bg3);overflow:hidden;';
        if (top4.length === 1) slot.style.gridColumn = '1/-1';
        const img = document.createElement('img');
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
        img.loading = 'lazy';
        slot.appendChild(img);
        if (mp2TrackHasThumb(tn)) {
          img.src = mp2ThumbUrl(tn);
        } else {
          mp2GetArt(tn).then(url => { if (url) img.src = url; });
        }
        coll.appendChild(slot);
      });
      // Pad to 4 if fewer tracks
      for (let i = top4.length; i < 4 && top4.length > 1; i++) {
        const slot = document.createElement('div');
        slot.style.background = 'var(--mp2-bg3)';
        coll.appendChild(slot);
      }
      coverEl.appendChild(coll);
    } else {
      coverEl.style.background = 'linear-gradient(135deg, var(--mp2-accent), #1e1a3a)';
      coverEl.innerHTML = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1.5" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/></svg>`;
    }
  }

  const nameEl = document.getElementById('mp2PlDetailName');
  if (nameEl) nameEl.textContent = pl.name;
  const countEl = document.getElementById('mp2PlDetailCount');
  if (countEl) countEl.textContent = `${pl.tracks.length} song${pl.tracks.length !== 1 ? 's' : ''}`;

  const listEl = document.getElementById('mp2PlDetailTracks');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (!pl.tracks.length) {
    listEl.innerHTML = `<div class="mp2-empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      <h3>Playlist is empty</h3>
      <p>Click "+ Add Songs" to add tracks.</p>
    </div>`;
    return;
  }

  pl.tracks.forEach((tn, i) => {
    const t = mp2.tracks.find(x => x.name === tn);
    if (!t) return;
    const row = mp2MakeTrackRow(t, i + 1, 'pl', pl.id);

    // Add drag-to-reorder handle
    const handle = document.createElement('div');
    handle.className = 'mp2-drag-handle';
    handle.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="16" x2="20" y2="16"/></svg>`;
    handle.title = 'Drag to reorder';
    row.insertBefore(handle, row.firstChild);

    // Remove btn - always visible on mobile
    const removeBtn = document.createElement('button');
    removeBtn.className = 'mp2-pl-remove-btn';
    removeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    removeBtn.title = 'Remove from playlist';
    removeBtn.onclick = (e) => {
      e.stopPropagation();
      pl.tracks.splice(i, 1);
      mp2SavePrefs();
      mp2RenderPlaylistDetail();
      mp2RenderNavPlaylists();
      showToast('Removed from playlist', 'success');
    };
    row.appendChild(removeBtn);

    // Drag-to-reorder (mouse + touch)
    mp2MakeDraggable(row, listEl, pl.id);

    listEl.appendChild(row);
  });
}

function mp2PlayActivePlaylist() {
  if (!mp2.activePl) return;
  const pl = mp2.playlists.find(p => p.id === mp2.activePl);
  if (!pl || !pl.tracks.length) return;
  mp2PlayTrack(pl.tracks[0], 'playlist:' + mp2.activePl);
}

async function mp2DeleteActivePl() {
  if (!mp2.activePl) return;
  const pl = mp2.playlists.find(p => p.id === mp2.activePl);
  if (!pl) return;
  const ok = await mp2Confirm({ icon: '🗑️', title: `Delete "${pl.name}"?`, msg: 'This cannot be undone.', okLabel: 'Delete', danger: true });
  if (!ok) return;
  mp2.playlists = mp2.playlists.filter(p => p.id !== mp2.activePl);
  mp2.activePl = null;
  mp2SavePrefs();
  mp2RenderNavPlaylists();
  mp2GoView('playlists');
  showToast('Playlist deleted', 'success');
}

// ── DRAG TO REORDER (playlist tracks) ────────────────────────────────
let _mp2DragSrc = null;
function mp2MakeDraggable(row, container, plId) {
  // Mouse drag
  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    _mp2DragSrc = row;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    container.querySelectorAll('.mp2-track-row').forEach(r => r.classList.remove('drag-over'));
    _mp2DragSrc = null;
    mp2SaveReorderFromDOM(container, plId);
  });
  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (_mp2DragSrc && _mp2DragSrc !== row) {
      container.querySelectorAll('.mp2-track-row').forEach(r => r.classList.remove('drag-over'));
      row.classList.add('drag-over');
    }
  });
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    if (_mp2DragSrc && _mp2DragSrc !== row) {
      const rows = [...container.querySelectorAll('.mp2-track-row')];
      const srcIdx = rows.indexOf(_mp2DragSrc);
      const tgtIdx = rows.indexOf(row);
      if (srcIdx < tgtIdx) container.insertBefore(_mp2DragSrc, row.nextSibling);
      else container.insertBefore(_mp2DragSrc, row);
    }
  });

  // Touch drag (long press + move)
  let touchTimeout = null;
  let touchDragging = false;
  let ghostEl = null;
  row.addEventListener('touchstart', (e) => {
    touchTimeout = setTimeout(() => {
      touchDragging = true;
      _mp2DragSrc = row;
      row.classList.add('dragging');
      // Create ghost
      ghostEl = row.cloneNode(true);
      ghostEl.style.cssText = 'position:fixed;opacity:0.7;pointer-events:none;z-index:9999;width:' + row.offsetWidth + 'px;background:var(--mp2-surface2);border-radius:8px;';
      document.body.appendChild(ghostEl);
    }, 300);
  }, { passive: true });

  row.addEventListener('touchmove', (e) => {
    if (!touchDragging) { clearTimeout(touchTimeout); return; }
    e.preventDefault();
    const touch = e.touches[0];
    if (ghostEl) { ghostEl.style.left = (touch.clientX - 80) + 'px'; ghostEl.style.top = (touch.clientY - 20) + 'px'; }
    const els = document.elementsFromPoint(touch.clientX, touch.clientY);
    const target = els.find(el => el.classList.contains('mp2-track-row') && el !== row);
    container.querySelectorAll('.mp2-track-row').forEach(r => r.classList.remove('drag-over'));
    if (target) target.classList.add('drag-over');
  }, { passive: false });

  row.addEventListener('touchend', (e) => {
    clearTimeout(touchTimeout);
    if (!touchDragging) return;
    touchDragging = false;
    if (ghostEl) { ghostEl.remove(); ghostEl = null; }
    row.classList.remove('dragging');
    const touch = e.changedTouches[0];
    const els = document.elementsFromPoint(touch.clientX, touch.clientY);
    const target = els.find(el => el.classList.contains('mp2-track-row') && el !== row);
    container.querySelectorAll('.mp2-track-row').forEach(r => r.classList.remove('drag-over'));
    if (target) {
      const rows = [...container.querySelectorAll('.mp2-track-row')];
      const srcIdx = rows.indexOf(row);
      const tgtIdx = rows.indexOf(target);
      if (srcIdx < tgtIdx) container.insertBefore(row, target.nextSibling);
      else container.insertBefore(row, target);
    }
    _mp2DragSrc = null;
    mp2SaveReorderFromDOM(container, plId);
  });
}

function mp2SaveReorderFromDOM(container, plId) {
  const pl = mp2.playlists.find(p => p.id === plId);
  if (!pl) return;
  const rows = [...container.querySelectorAll('.mp2-track-row')];
  pl.tracks = rows.map(r => r.dataset.track).filter(Boolean);
  mp2SavePrefs();
  mp2RenderNavPlaylists();
  showToast('Playlist reordered', 'success');
}

function mp2SavePlName() {
  const el = document.getElementById('mp2PlDetailName');
  if (!el || !mp2.activePl) return;
  const pl = mp2.playlists.find(p => p.id === mp2.activePl);
  if (!pl) return;
  const name = el.textContent.trim();
  if (name && name !== pl.name) {
    pl.name = name;
    mp2SavePrefs();
    mp2RenderNavPlaylists();
    showToast('Playlist renamed', 'success');
  }
}

// ── LIKED SONGS VIEW ──────────────────────────────────────────────────
function mp2RenderLikedView() {
  const list = mp2.tracks.filter(t => !/\.(webp)$/i.test(t.name) && mp2.favorites.has(t.name));
  const countEl = document.getElementById('mp2LikedCount');
  if (countEl) countEl.textContent = `${list.length} song${list.length !== 1 ? 's' : ''}`;

  const el = document.getElementById('mp2LikedList');
  if (!el) return;
  el.innerHTML = '';

  if (!list.length) {
    el.innerHTML = `<div class="mp2-empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      <h3>No liked songs yet</h3>
      <p>Press the ♥ on any track to add it here.</p>
    </div>`;
    return;
  }
  list.forEach((t, i) => {
    const row = mp2MakeTrackRow(t, i + 1, 'liked');
    el.appendChild(row);
  });
}

function mp2PlayLiked() {
  const list = mp2.tracks.filter(t => !/\.(webp)$/i.test(t.name) && mp2.favorites.has(t.name));
  if (list.length) mp2PlayTrack(list[0].name, 'liked');
}

// ── NAV PLAYLISTS ─────────────────────────────────────────────────────
function mp2RenderNavPlaylists() {
  const el = document.getElementById('mp2NavPlaylistList');
  if (!el) return;
  el.innerHTML = '';
  mp2.playlists.forEach(pl => {
    const isActive = pl.id === mp2.activePl && mp2.currentView === 'playlist-detail';
    const item = document.createElement('div');
    item.className = 'mp2-pl-sidebar-item' + (isActive ? ' active' : '');
    item.onclick = () => { mp2.activePl = pl.id; mp2GoView('playlist-detail'); };

    // Build thumb - try webp first, then async iTunes
    const thumb = document.createElement('div');
    thumb.className = 'mp2-pl-sidebar-thumb';
    const audioTracks = pl.tracks.filter(tn => mp2.tracks.some(t => t.name === tn));
    const withThumb = audioTracks.filter(tn => mp2TrackHasThumb(tn));
    if (withThumb.length >= 2) {
      const coll = document.createElement('div');
      coll.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;width:100%;height:100%;overflow:hidden;';
      withThumb.slice(0, 4).forEach(tn => {
        const img = document.createElement('img');
        img.src = mp2ThumbUrl(tn);
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        img.loading = 'lazy';
        coll.appendChild(img);
      });
      thumb.appendChild(coll);
    } else if (audioTracks.length > 0) {
      // Single or async - start with icon, replace async
      thumb.style.cssText = 'background:linear-gradient(135deg,var(--mp2-accent),#1e1a3a);display:flex;align-items:center;justify-content:center;';
      thumb.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/></svg>`;
      // Load art for first track async
      const firstTrack = audioTracks[0];
      mp2GetArt(firstTrack).then(url => {
        if (url) {
          thumb.style.cssText = '';
          thumb.innerHTML = '';
          const img = document.createElement('img');
          img.src = url;
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:4px;';
          thumb.appendChild(img);
        }
      });
    } else {
      thumb.style.cssText = 'background:linear-gradient(135deg,var(--mp2-accent),#1e1a3a);display:flex;align-items:center;justify-content:center;';
      thumb.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/></svg>`;
    }

    const name = document.createElement('span');
    name.className = 'mp2-pl-sidebar-name';
    name.textContent = pl.name;
    const count = document.createElement('span');
    count.className = 'mp2-pl-sidebar-count';
    count.textContent = pl.tracks.length;

    item.appendChild(thumb);
    item.appendChild(name);
    item.appendChild(count);
    el.appendChild(item);
  });
}

// ── SEARCH ────────────────────────────────────────────────────────────
function mp2OnSearch() {
  const q = document.getElementById('mp2SearchInput')?.value || '';
  if (q && mp2.currentView !== 'songs') mp2GoView('songs');
  else if (!q && mp2.currentView === 'songs') { /* stay */ }
  if (mp2.currentView === 'songs') mp2RenderSongsView();
}

// ── PLAYBACK ──────────────────────────────────────────────────────────
function mp2BuildQueue(startName, context) {
  let list;
  if (context === 'liked') {
    list = mp2.tracks.filter(t => !/\.(webp)$/i.test(t.name) && mp2.favorites.has(t.name)).map(t => t.name);
  } else if (context && context.startsWith('playlist:')) {
    const plId = context.slice(9);
    const pl = mp2.playlists.find(p => p.id === plId);
    list = pl ? pl.tracks : [startName];
  } else if (context && context.startsWith('artist:')) {
    const artist = context.slice(7);
    list = mp2.tracks.filter(t => !/\.(webp)$/i.test(t.name) && (mp2GuessArtist(t.name) || 'Unknown Artist') === artist).map(t => t.name);
  } else {
    list = mp2.tracks.filter(t => !/\.(webp)$/i.test(t.name)).sort((a, b) => a.name.localeCompare(b.name)).map(t => t.name);
  }

  if (mp2.shuffle) {
    const idx = list.indexOf(startName);
    const rest = list.filter(n => n !== startName);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    mp2.queue = [startName, ...rest];
  } else {
    mp2.queue = list;
  }
  mp2.queueIdx = mp2.queue.indexOf(startName);
  mp2.queueContext = context;
}

function mp2PlayTrack(trackName, context) {
  mp2BuildQueue(trackName, context || 'all');
  mp2Load(trackName);
  // CD modal only opens when user explicitly clicks the album art / bar
  // (do NOT auto-open here)
}

function mp2Load(trackName) {
  mp2.currentTrack = trackName;
  const url = '/api/music/stream/' + encodeURIComponent(trackName) + '?token=' + encodeURIComponent(token);
  mpAudio2.src = url;
  mpAudio2.play().catch(() => {});
  mp2UpdateBottomBar();
  mp2UpdatePlayState();
  mp2UpdateCDInfo();
  // Refresh view to show active state
  mp2RefreshTrackHighlights();
  // Fetch lyrics for CD modal
  if (window.mpFetchLyrics) mpFetchLyrics(trackName);
  // Update lock screen / notification media session
  mp2UpdateMediaSession(trackName);
}

// ── MEDIA SESSION (lock screen + swipe-down notification) ──────────────
function mp2UpdateMediaSession(trackName) {
  if (!('mediaSession' in navigator)) return;
  const title  = mp2GuessTitle(trackName);
  const artist = mp2GuessArtist(trackName) || 'Unknown Artist';

  navigator.mediaSession.metadata = new MediaMetadata({
    title,
    artist,
    album: 'Resonance',
    artwork: [] // filled in async below
  });

  // Handlers for lock screen / notification controls
  navigator.mediaSession.setActionHandler('play',         () => { mpAudio2.play(); });
  navigator.mediaSession.setActionHandler('pause',        () => { mpAudio2.pause(); });
  navigator.mediaSession.setActionHandler('previoustrack',() => { mp2Prev(); });
  navigator.mediaSession.setActionHandler('nexttrack',    () => { mp2Next(); });
  navigator.mediaSession.setActionHandler('seekbackward', (d) => { mpAudio2.currentTime = Math.max(0, mpAudio2.currentTime - (d.seekOffset || 10)); });
  navigator.mediaSession.setActionHandler('seekforward',  (d) => { mpAudio2.currentTime = Math.min(mpAudio2.duration || Infinity, mpAudio2.currentTime + (d.seekOffset || 10)); });

  // Load artwork async and update metadata once we have a URL
  mp2GetArt(trackName).then(artUrl => {
    if (!artUrl) return;
    // Use full absolute URL for MediaMetadata artwork
    const abs = artUrl.startsWith('http') ? artUrl : (window.location.origin + artUrl);
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album: 'Resonance',
      artwork: [
        { src: abs, sizes: '512x512', type: 'image/jpeg' },
        { src: abs, sizes: '256x256', type: 'image/jpeg' },
        { src: abs, sizes: '96x96',   type: 'image/jpeg' },
      ]
    });
  });
}

// Keep media session playback state in sync
mpAudio2.addEventListener('play',  () => {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
});
mpAudio2.addEventListener('pause', () => {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
});


function mp2Next() {
  if (!mp2.queue.length) return;
  if (mp2.loop === 2) { mpAudio2.currentTime = 0; mpAudio2.play().catch(()=>{}); return; }
  let next = mp2.queueIdx + 1;
  if (next >= mp2.queue.length) {
    if (mp2.loop === 1) {
      next = 0; // wrap around
    } else {
      return; // no loop, stop
    }
  }
  mp2.queueIdx = next;
  mp2Load(mp2.queue[next]);
}

function mp2Prev() {
  if (!mp2.queue.length) return;
  if (mpAudio2.currentTime > 3) { mpAudio2.currentTime = 0; return; }
  let prev = mp2.queueIdx - 1;
  if (prev < 0) prev = mp2.loop === 1 ? mp2.queue.length - 1 : 0;
  mp2.queueIdx = prev;
  mp2Load(mp2.queue[prev]);
}

function mp2TogglePlay() {
  if (!mp2.currentTrack) return;
  if (mpAudio2.paused) mpAudio2.play();
  else mpAudio2.pause();
}

function mp2ToggleShuffle() {
  mp2.shuffle = !mp2.shuffle;
  document.getElementById('mp2BtnShuffle')?.classList.toggle('active', mp2.shuffle);
  document.getElementById('mp2CDShuffle')?.classList.toggle('active', mp2.shuffle);
}

function mp2ToggleLoop() {
  mp2.loop = (mp2.loop + 1) % 3;
  const labels = ['Loop off', 'Loop all', 'Loop one'];
  // SVG for loop-all (repeat arrows)
  const svgAll = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`;
  // SVG for loop-one (repeat with "1" badge)
  const svgOne = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg><span style="position:absolute;top:-3px;right:-3px;font-size:9px;font-weight:800;background:var(--mp2-accent);color:white;width:14px;height:14px;border-radius:50%;display:flex;align-items:center;justify-content:center;line-height:1;">1</span>`;
  const svgOff = svgAll;

  ['mp2BtnLoop', 'mp2CDLoop'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.toggle('active', mp2.loop > 0);
      el.title = labels[mp2.loop];
      el.style.position = 'relative';
      if (mp2.loop === 2) {
        el.innerHTML = svgOne;
      } else {
        el.innerHTML = svgOff;
      }
    }
  });
}

function mp2ToggleFav(trackName) {
  if (mp2.favorites.has(trackName)) {
    mp2.favorites.delete(trackName);
    showToast('Removed from liked songs');
  } else {
    mp2.favorites.add(trackName);
    showToast('Added to liked songs ♥', 'success');
  }
  mp2SavePrefs();
  mp2UpdateFavButtons(trackName);
  // Refresh current view
  if (mp2.currentView === 'liked') mp2RenderLikedView();
}

function mp2ToggleFavCurrent() {
  if (mp2.currentTrack) mp2ToggleFav(mp2.currentTrack);
}

function mp2UpdateFavButtons(trackName) {
  const isFav = mp2.favorites.has(trackName);
  // Bottom bar
  const barFav = document.getElementById('mp2BarFav');
  if (barFav && mp2.currentTrack === trackName) {
    barFav.classList.toggle('liked', isFav);
    barFav.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${isFav ? 'var(--mp2-pink)' : 'none'}" stroke="${isFav ? 'var(--mp2-pink)' : 'currentColor'}" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
  }
  // CD modal
  const cdFavSvg = document.getElementById('mp2CDFavSvg');
  if (cdFavSvg && mp2.currentTrack === trackName) {
    cdFavSvg.setAttribute('fill', isFav ? 'var(--mp2-pink)' : 'none');
    cdFavSvg.setAttribute('stroke', isFav ? 'var(--mp2-pink)' : 'currentColor');
    document.getElementById('mp2CDFav')?.classList.toggle('liked', isFav);
  }
}

// ── VOLUME ────────────────────────────────────────────────────────────
function mp2SetVolume(v) {
  mp2.volume = Math.max(0, Math.min(1, v));
  mpAudio2.volume = mp2.volume;
  mpAudio2.muted = mp2.muted;
  const pct = (mp2.muted ? 0 : mp2.volume) * 100 + '%';
  document.getElementById('mp2VolFill') && (document.getElementById('mp2VolFill').style.width = pct);
  document.getElementById('mp2CDVolFill') && (document.getElementById('mp2CDVolFill').style.width = pct);
}

function mp2ToggleMute() {
  mp2.muted = !mp2.muted;
  mp2SetVolume(mp2.volume);
}

function mp2VolClick(e) {
  const bar = e.currentTarget;
  const rect = bar.getBoundingClientRect();
  const v = (e.clientX - rect.left) / rect.width;
  mp2.muted = false;
  mp2SetVolume(v);
}

// ── SEEK ──────────────────────────────────────────────────────────────
function mp2SeekClick(e) {
  if (!mp2.currentTrack || !mpAudio2.duration) return;
  const bar = e.currentTarget;
  const rect = bar.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  mpAudio2.currentTime = pct * mpAudio2.duration;
}

// ── AUDIO EVENTS ──────────────────────────────────────────────────────
function mp2BindAudio() {
  mpAudio2.addEventListener('ended', () => {
    if (mp2.loop === 2) {
      // Loop one: restart current track
      mpAudio2.currentTime = 0;
      mpAudio2.play().catch(()=>{});
    } else {
      mp2Next();
    }
  });
  mpAudio2.addEventListener('play',  () => mp2UpdatePlayState());
  mpAudio2.addEventListener('pause', () => mp2UpdatePlayState());
  mpAudio2.addEventListener('timeupdate', mp2OnTimeUpdate);
  mpAudio2.addEventListener('loadedmetadata', mp2OnMeta);
}

function mp2OnTimeUpdate() {
  const cur = mpAudio2.currentTime;
  const dur = mpAudio2.duration || 0;
  const pct = dur > 0 ? (cur / dur) * 100 + '%' : '0%';
  document.getElementById('mp2BarFill') && (document.getElementById('mp2BarFill').style.width = pct);
  document.getElementById('mp2CDFill') && (document.getElementById('mp2CDFill').style.width = pct);
  document.getElementById('mp2BarCurTime') && (document.getElementById('mp2BarCurTime').textContent = mp2Fmt(cur));
  document.getElementById('mp2CDCurTime') && (document.getElementById('mp2CDCurTime').textContent = mp2Fmt(cur));
}

function mp2OnMeta() {
  const dur = mpAudio2.duration || 0;
  document.getElementById('mp2BarDuration') && (document.getElementById('mp2BarDuration').textContent = mp2Fmt(dur));
  document.getElementById('mp2CDDuration') && (document.getElementById('mp2CDDuration').textContent = mp2Fmt(dur));
}

function mp2Fmt(s) {
  const m = Math.floor(s / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, '0');
  return `${m}:${sec}`;
}

// ── UPDATE UI ─────────────────────────────────────────────────────────
function mp2UpdatePlayState() {
  const playing = mp2.currentTrack && !mpAudio2.paused;
  const pauseIcon = `<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>`;
  const playIcon  = `<polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/>`;
  const icon = playing ? pauseIcon : playIcon;
  const sv1 = document.getElementById('mp2PlayBtnSvg');
  if (sv1) sv1.innerHTML = icon;
  const sv2 = document.getElementById('mp2CDPlayBtnSvg');
  if (sv2) sv2.innerHTML = icon;

  // Vinyl spin
  const vinyl = document.getElementById('mp2Vinyl');
  if (vinyl) vinyl.classList.toggle('spinning', !!playing);

  // Music nav badge
  const badge = document.getElementById('musicNavBadge');
  if (badge) badge.style.display = playing ? 'inline' : 'none';

  // Mini bar play button
  const miniPlay = document.getElementById('mpMiniPlay');
  if (miniPlay) miniPlay.textContent = playing ? '⏸' : '▶';

  // Refresh any visible track rows
  mp2RefreshTrackHighlights();
}

function mp2RefreshTrackHighlights() {
  document.querySelectorAll('.mp2-track-row').forEach(row => {
    const tn = row.dataset.track;
    const isActive = tn === mp2.currentTrack;
    row.classList.toggle('playing', isActive);
    const titleEl = row.querySelector('.mp2-tr-title');
    if (titleEl) titleEl.classList.toggle('playing', isActive);
  });
}

function mp2UpdateBottomBar() {
  if (!mp2.currentTrack) return;
  const title  = mp2GuessTitle(mp2.currentTrack);
  const artist = mp2GuessArtist(mp2.currentTrack);
  document.getElementById('mp2BarTitle') && (document.getElementById('mp2BarTitle').textContent = title);
  document.getElementById('mp2BarArtist') && (document.getElementById('mp2BarArtist').textContent = artist || '—');

  // Art
  const img = document.getElementById('mp2BarArtImg');
  const ph  = document.getElementById('mp2BarArtPh');
  if (img) {
    mp2GetArt(mp2.currentTrack).then(url => {
      if (url) {
        img.src = url;
        img.style.display = 'block';
        if (ph) ph.style.display = 'none';
      }
    });
  }

  // Fav
  const isFav = mp2.favorites.has(mp2.currentTrack);
  const barFav = document.getElementById('mp2BarFav');
  if (barFav) {
    barFav.classList.toggle('liked', isFav);
    barFav.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${isFav ? 'var(--mp2-pink)' : 'none'}" stroke="${isFav ? 'var(--mp2-pink)' : 'currentColor'}" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
  }
  // Mini bar
  const mt = document.getElementById('mpMiniTitle');
  const ms = document.getElementById('mpMiniSub');
  if (mt) mt.textContent = title;
  if (ms) ms.textContent = artist || '—';
}

// ── CD MODAL ──────────────────────────────────────────────────────────
function mp2OpenCD() {
  const modal = document.getElementById('mp2CDModal');
  if (modal) { modal.style.display = 'flex'; modal.classList.add('open'); }
  mp2UpdateCDInfo();
}

function mp2CloseCD() {
  const modal = document.getElementById('mp2CDModal');
  if (modal) { modal.style.display = 'none'; modal.classList.remove('open'); }
}

function mp2UpdateCDInfo() {
  if (!mp2.currentTrack) return;
  const title  = mp2GuessTitle(mp2.currentTrack);
  const artist = mp2GuessArtist(mp2.currentTrack);
  document.getElementById('mp2CDTitle') && (document.getElementById('mp2CDTitle').textContent = title);
  document.getElementById('mp2CDArtist') && (document.getElementById('mp2CDArtist').textContent = artist || '—');

  // Reset lyrics state for new track
  if (mp2Lyrics && mp2Lyrics.loadedFor !== mp2.currentTrack) {
    mp2StopLyricSync && mp2StopLyricSync();
    const lyricsContent = document.getElementById('mpLyricsContent');
    if (lyricsContent) {
      lyricsContent.innerHTML = '<div class="mp2-lyrics-loading"><span class="mp2-lyrics-spinner"></span>Searching for lyrics…</div>';
    }
    const badge = document.getElementById('mp2LyricsSyncBadge');
    if (badge) badge.style.display = 'none';
  }

  // Vinyl label art
  mp2GetArt(mp2.currentTrack).then(url => {
    const label = document.getElementById('mp2VinylLabel');
    const ph = document.getElementById('mp2VinylLabelPh');
    if (label && url) {
      label.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;" alt="">`;
    } else if (ph) { ph.style.display = 'flex'; }

    // Background
    const bg = document.getElementById('mp2CDBgImg');
    if (bg && url) bg.style.backgroundImage = `url(${url})`;
  });

  // Fav
  const isFav = mp2.favorites.has(mp2.currentTrack);
  const cdFavSvg = document.getElementById('mp2CDFavSvg');
  if (cdFavSvg) {
    cdFavSvg.setAttribute('fill', isFav ? 'var(--mp2-pink)' : 'none');
    cdFavSvg.setAttribute('stroke', isFav ? 'var(--mp2-pink)' : 'currentColor');
  }
  document.getElementById('mp2CDFav')?.classList.toggle('liked', isFav);
}

// ── PLAYLIST MANAGEMENT ───────────────────────────────────────────────
async function mp2CreatePlaylist() {
  const name = await mp2Prompt({ icon: '🎵', title: 'New Playlist', placeholder: 'Playlist name…', okLabel: 'Create' });
  if (!name || !name.trim()) return;
  const pl = { id: 'pl_' + Date.now(), name: name.trim(), tracks: [] };
  mp2.playlists.push(pl);
  mp2.activePl = pl.id;
  mp2SavePrefs();
  mp2RenderNavPlaylists();
  mp2GoView('playlist-detail');
  showToast('Playlist created 🎵', 'success');
}

function mp2PlayPlaylist(plId) {
  const pl = mp2.playlists.find(p => p.id === plId);
  if (!pl || !pl.tracks.length) { showToast('Playlist is empty', 'error'); return; }
  mp2PlayTrack(pl.tracks[0], 'playlist:' + plId);
}

function mp2OpenAddToPlaylist() {
  if (!mp2.activePl) return;
  const pl = mp2.playlists.find(p => p.id === mp2.activePl);
  if (!pl) return;
  mp2.addSongsForPlId = mp2.activePl;
  mp2.addSongsSelected = new Set();

  document.getElementById('mp2AddSongsTitle').textContent = `Add to "${pl.name}"`;
  document.getElementById('mp2AddSongsSearch').value = '';
  mp2FilterAddSongs('');
  document.getElementById('mp2AddSongsModal').style.display = 'flex';
}

function mp2FilterAddSongs() {
  const q  = document.getElementById('mp2AddSongsSearch')?.value?.toLowerCase() || '';
  const pl = mp2.playlists.find(p => p.id === mp2.addSongsForPlId);
  if (!pl) return;
  const available = mp2.tracks.filter(t => !/\.(webp)$/i.test(t.name) && !pl.tracks.includes(t.name));
  const filtered  = q ? available.filter(t => t.name.toLowerCase().includes(q)) : available;

  const el = document.getElementById('mp2AddSongsList');
  if (!el) return;
  el.innerHTML = '';
  filtered.forEach(t => {
    const item = document.createElement('div');
    item.className = 'mp2-add-song-item';
    const checked = mp2.addSongsSelected.has(t.name);
    item.innerHTML = `
      <input type="checkbox" ${checked ? 'checked' : ''}>
      <div class="mp2-tr-art" style="width:36px;height:36px;">
        <div class="mp2-tr-art-ph"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
      </div>
      <div class="mp2-tr-info">
        <div class="mp2-tr-title">${escapeHtml(mp2GuessTitle(t.name))}</div>
        <div class="mp2-tr-artist">${escapeHtml(mp2GuessArtist(t.name) || 'Unknown Artist')}</div>
      </div>`;
    const cb = item.querySelector('input');
    item.onclick = () => {
      cb.checked = !cb.checked;
      if (cb.checked) mp2.addSongsSelected.add(t.name);
      else mp2.addSongsSelected.delete(t.name);
    };
    cb.onclick = e => e.stopPropagation();
    // Load art
    const artDiv = item.querySelector('.mp2-tr-art');
    const imgEl  = document.createElement('img');
    imgEl.style.cssText = 'display:none;position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
    artDiv.style.position = 'relative';
    artDiv.appendChild(imgEl);
    mp2LoadArt(t.name, imgEl, artDiv.querySelector('.mp2-tr-art-ph'));
    el.appendChild(item);
  });
}

function mp2ConfirmAddSongs() {
  const pl = mp2.playlists.find(p => p.id === mp2.addSongsForPlId);
  if (!pl || !mp2.addSongsSelected.size) { document.getElementById('mp2AddSongsModal').style.display = 'none'; return; }
  mp2.addSongsSelected.forEach(tn => { if (!pl.tracks.includes(tn)) pl.tracks.push(tn); });
  mp2SavePrefs();
  mp2RenderPlaylistDetail();
  mp2RenderNavPlaylists();
  document.getElementById('mp2AddSongsModal').style.display = 'none';
  showToast(`Added ${mp2.addSongsSelected.size} song${mp2.addSongsSelected.size !== 1 ? 's' : ''}`, 'success');
  mp2.addSongsSelected = new Set();
}

// ── CONTEXT MENU ──────────────────────────────────────────────────────
function mp2ShowCtx(e, trackName) {
  e.stopPropagation();
  const menu = document.getElementById('mp2Ctx');
  if (!menu) return;
  const plItems = mp2.playlists.map(pl =>
    `<button class="mp2-ctx-item" onclick="mp2AddToPlFromCtx('${escapeHtml(pl.id)}','${escapeHtml(trackName)}')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Add to ${escapeHtml(pl.name)}
    </button>`
  ).join('');

  menu.innerHTML = `
    <button class="mp2-ctx-item" onclick="mp2PlayTrack('${escapeHtml(trackName)}','all')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      Play
    </button>
    <button class="mp2-ctx-item" onclick="mp2ToggleFav('${escapeHtml(trackName)}')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="${mp2.favorites.has(trackName)?'var(--mp2-pink)':'none'}" stroke="${mp2.favorites.has(trackName)?'var(--mp2-pink)':'currentColor'}" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      ${mp2.favorites.has(trackName) ? 'Unlike' : 'Like'}
    </button>
    ${plItems.length ? `<div class="mp2-ctx-sep"></div>${plItems}` : ''}
    <div class="mp2-ctx-sep"></div>
    <button class="mp2-ctx-item" onclick="mp2OpenTrackEditor('${escapeHtml(trackName)}')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      Edit Title / Artwork
    </button>
    <button class="mp2-ctx-item danger" onclick="mp2DeleteTrack('${escapeHtml(trackName)}')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
      Delete
    </button>`;

  menu.style.display = 'block';
  const x = Math.min(e.clientX, window.innerWidth - 200);
  const y = Math.min(e.clientY, window.innerHeight - (menu.offsetHeight + 20));
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';

  const hide = () => { menu.style.display = 'none'; document.removeEventListener('click', hide); };
  setTimeout(() => document.addEventListener('click', hide), 10);
}

function mp2AddToPlFromCtx(plId, trackName) {
  const pl = mp2.playlists.find(p => p.id === plId);
  if (!pl) return;
  if (pl.tracks.includes(trackName)) { showToast('Already in playlist', 'error'); return; }
  pl.tracks.push(trackName);
  mp2SavePrefs();
  mp2RenderNavPlaylists();
  showToast(`Added to ${pl.name}`, 'success');
}

async function mp2DeleteTrack(trackName) {
  const ok = await mp2Confirm({ icon: '🗑️', title: 'Delete track?', msg: `"${mp2GuessTitle(trackName)}" will be permanently removed.`, okLabel: 'Delete', danger: true });
  if (!ok) return;
  try {
    const res = await fetch('/api/music/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ name: trackName })
    });
    if (!res.ok) throw new Error((await safeJson(res)).msg || 'Delete failed');
    if (mp2.currentTrack === trackName) { mpAudio2.pause(); mp2.currentTrack = null; }
    await mp2LoadTracks();
    mp2RenderAll();
    showToast('Track deleted', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

// ── SCAN ──────────────────────────────────────────────────────────────
async function mp2ScanLibrary() {
  showToast('Scanning library…', 'info');
  try {
    const res = await fetch('/api/music/scan', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    const d = await safeJson(res);
    if (!res.ok) throw new Error(d.msg || 'Scan failed');
    await mp2LoadTracks();
    mp2RenderAll();
    showToast(`Library refreshed — ${d.count} tracks`, 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

async function mp2EnrichArtists() {
  if (!_mp2IsAdmin) { showToast('Admin only', 'error'); return; }
  showToast('🔍 Refreshing artist images… this may take a minute', 'info');
  // Clear existing localStorage cache so we fetch fresh images
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('mp2_artist_')) keysToRemove.push(k);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch {}
  mp2.artistArtCache = {};

  // Force-fetch for all artists
  const groups = {};
  mp2.tracks.filter(t => !/\.(webp)$/i.test(t.name)).forEach(t => {
    const a = mp2GuessArtist(t.name);
    if (a && a !== 'Unknown Artist') groups[a] = true;
  });
  let found = 0;
  for (const artist of Object.keys(groups)) {
    const url = await mp2GetArtistPhoto(artist, true); // forceRefresh
    if (url) {
      found++;
      // Update any visible artist cards
      const phEl = document.getElementById(`mp2APhoto_${CSS.escape(artist)}`);
      if (phEl) phEl.innerHTML = `<img src="${url}" alt="${escapeHtml(artist)}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" onerror="this.style.display='none'">`;
    }
    await new Promise(r => setTimeout(r, 300)); // rate limit
  }
  // Also update artist hero if on artist detail view
  if (mp2.currentView === 'artist-detail' && mp2.activeArtist) {
    mp2GetArtistPhoto(mp2.activeArtist, true).then(url => {
      if (url) {
        const ph = document.getElementById('mp2ArtistHeroPhoto');
        if (ph) ph.innerHTML = `<img src="${url}" alt="${escapeHtml(mp2.activeArtist)}" onerror="this.style.display='none'">`;
      }
    });
  }
  showToast(`Artist images refreshed! (${found} found)`, 'success');
}

// ── ADD MUSIC PANEL ───────────────────────────────────────────────────
function mp2OpenAddPanel() {
  document.getElementById('mp2AddPanel').style.display = 'flex';
}
function mp2CloseAddPanel() {
  document.getElementById('mp2AddPanel').style.display = 'none';
}

function mp2SwitchAddTab(tab) {
  ['yt','ch','browse','file'].forEach(t => {
    document.getElementById(`mp2AddTab${t.charAt(0).toUpperCase()+t.slice(1)}`)?.classList.toggle('active', t === tab);
    document.getElementById(`mp2Pane${t.charAt(0).toUpperCase()+t.slice(1)}`)?.style && (document.getElementById(`mp2Pane${t.charAt(0).toUpperCase()+t.slice(1)}`).style.display = t === tab ? 'block' : 'none');
  });
}

function mp2SelFmt(ctx, fmt, btn) {
  if (ctx === 'yt') mp2.ytFmt = fmt;
  else mp2.chFmt = fmt;
  btn.closest('.mp2-fmt-row').querySelectorAll('.mp2-fmt-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function mp2ChType(type, btn) {
  mp2.chType = type;
  btn.closest('.mp2-type-btns').querySelectorAll('.mp2-type-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function mp2BrType(type, btn) {
  mp2.browseType = type;
  btn.closest('.mp2-type-btns').querySelectorAll('.mp2-type-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function mp2ShowStatus(id, msg, isErr, isPersist) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'mp2-status-bar show';
  el.innerHTML = isErr
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> ${escapeHtml(msg)}`
    : `<div class="mp2-status-spin"></div> ${escapeHtml(msg)}`;
  if (!isPersist && !isErr) setTimeout(() => { if (el.className.includes('show')) el.className = 'mp2-status-bar'; }, 8000);
}

// ── TAB SWITCHING ──────────────────────────────────────────────────────
function mp2SwitchAddTab(tab) {
  const paneMap = { search: 'mp2PaneSearch', yt: 'mp2PaneYT', ch: 'mp2PaneCh', file: 'mp2PaneFile' };
  const btnMap  = { search: 'mp2AddTabSearch', yt: 'mp2AddTabYT', ch: 'mp2AddTabCh', file: 'mp2AddTabFile' };
  Object.values(paneMap).forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  document.querySelectorAll('.mp2-panel-tab').forEach(b => b.classList.remove('active'));
  const pane = document.getElementById(paneMap[tab]);
  const btn  = document.getElementById(btnMap[tab]);
  if (pane) pane.style.display = '';
  if (btn)  btn.classList.add('active');
}

// Mobile nav active state
function mp2MobNavActive(btn) {
  document.querySelectorAll('.mp2-mob-nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ── YOUTUBE SINGLE DOWNLOAD ────────────────────────────────────────────
async function mp2DlYT() {
  const url    = document.getElementById('mp2YTUrl')?.value.trim();
  const name   = document.getElementById('mp2YTName')?.value.trim();
  const artist = document.getElementById('mp2YTArtist')?.value.trim();
  const thumb  = document.getElementById('mp2YTThumb')?.checked;
  if (!url) { showToast('Enter a YouTube URL', 'error'); return; }

  const btn = document.getElementById('mp2YTBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Downloading…'; }
  mp2ShowStatus('mp2YTStatus', 'Starting download…', false, true);

  try {
    const res = await fetch('/api/music/youtube', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ url, name: name || null, artist: artist || null, format: mp2.ytFmt, thumbnail: !!thumb })
    });
    const d = await safeJson(res);
    if (!res.ok) throw new Error(d.msg || d.error || 'Download failed');
    showToast('Download started! 🎵', 'success');
    const jobId = d.download_id || d.job_id;
    mp2ShowStatus('mp2YTStatus', 'Downloading…', false, true);
    if (jobId) mp2PollDownload(jobId, 'mp2YTStatus');
  } catch (e) {
    mp2ShowStatus('mp2YTStatus', e.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Download Track'; }
  }
}

// ── CHANNEL DOWNLOAD (all) ─────────────────────────────────────────────
async function mp2DlChannel() {
  const url    = document.getElementById('mp2ChUrl')?.value.trim();
  const artist = document.getElementById('mp2ChArtist')?.value.trim();
  if (!url) { showToast('Enter a channel URL', 'error'); return; }

  const btn = document.getElementById('mp2ChBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Starting…'; }
  mp2ShowStatus('mp2ChStatus', 'Starting channel download…', false, true);

  try {
    const res = await fetch('/api/music/channel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ url, artist: artist || null, type: mp2.chType, format: mp2.chFmt, limit: 0, thumbnail: true })
    });
    const d = await safeJson(res);
    if (!res.ok) throw new Error(d.msg || d.error || 'Failed');
    showToast('Channel download started! 🎵', 'success');
    const jobId = d.download_id || d.job_id;
    mp2ShowStatus('mp2ChStatus', 'Running in background…', false, true);
    if (jobId) mp2PollDownload(jobId, 'mp2ChStatus');
  } catch (e) {
    mp2ShowStatus('mp2ChStatus', e.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇ Download All'; }
  }
}

// ── STATUS POLLER ──────────────────────────────────────────────────────
async function mp2PollDownload(jobId, statusId) {
  if (!jobId) return;
  // Try both status endpoints
  const statusUrls = [
    `/api/music/youtube/status/${jobId}`,
    `/api/music/channel/status/${jobId}`,
  ];
  const timer = setInterval(async () => {
    try {
      let d = null;
      for (const sUrl of statusUrls) {
        const res = await fetch(sUrl, { headers: { Authorization: 'Bearer ' + token } });
        if (res.ok) { d = await safeJson(res); break; }
      }
      if (!d) return;
      const done = d.status === 'done' || d.status === 'error';
      if (done) {
        clearInterval(timer);
        const isErr = d.status === 'error';
        const msg   = isErr ? (d.error || 'Error') : (d.filename || `${d.count || 0} track(s) downloaded`);
        if (statusId) mp2ShowStatus(statusId, msg, isErr);
        if (!isErr) {
          showToast('Download complete! 🎵', 'success');
          await mp2LoadTracks(); mp2RenderAll();
        }
      } else {
        const cnt   = d.count || 0;
        const total = d.total;
        const msg   = total ? `Downloading… ${cnt}/${total} tracks` : `Downloading… ${cnt} done`;
        if (statusId) mp2ShowStatus(statusId, msg, false, true);
      }
    } catch { clearInterval(timer); }
  }, 3000);
}

// ── CHANNEL BROWSE & SELECT ────────────────────────────────────────────
let _mp2BrowseVideos    = [];
let _mp2BrowseSelected  = new Set();
let _mp2BrowseContainer = null; // 'ch' = channel pane

async function mp2ChBrowseFetch() {
  const url = document.getElementById('mp2ChUrl')?.value.trim();
  if (!url) { showToast('Enter a channel URL first', 'error'); return; }

  const btn = document.getElementById('mp2ChBrowseBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Fetching…'; }

  const resultsEl = document.getElementById('mp2ChBrowseResults');
  if (resultsEl) resultsEl.innerHTML = '<div class="mp2-browse-loading"><div class="mp2-status-spin"></div> Fetching video list from channel…</div>';
  _mp2BrowseSelected = new Set();
  _mp2BrowseContainer = 'ch';

  try {
    const res = await fetch('/api/music/channel/browse?' + new URLSearchParams({ url, type: mp2.chType }), {
      headers: { Authorization: 'Bearer ' + token }
    });
    const d = await safeJson(res);
    if (!res.ok) throw new Error(d.error || d.msg || 'Fetch failed');
    _mp2BrowseVideos = d.videos || [];
    mp2RenderBrowseResults('mp2ChBrowseResults', _mp2BrowseVideos, url);
  } catch (e) {
    if (resultsEl) resultsEl.innerHTML = `<div class="mp2-empty-state"><div style="font-size:28px">😕</div><p>${escapeHtml(e.message)}</p></div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Browse &amp; Select'; }
  }
}

function mp2RenderBrowseResults(containerId, videos, channelUrl) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!videos.length) {
    el.innerHTML = '<div class="mp2-empty-state"><div style="font-size:28px">🎵</div><p>No videos found. Try a different URL or source type.</p></div>';
    return;
  }

  el.innerHTML = `
    <div class="mp2-browse-bar">
      <label class="mp2-browse-sel-all">
        <input type="checkbox" id="mp2BrowseSelAll" onchange="mp2BrowseToggleAll(this.checked)" style="accent-color:var(--mp2-accent);width:14px;height:14px;">
        <span>Select all</span>
      </label>
      <span class="mp2-browse-count" id="mp2BrowseCount">${videos.length} videos · 0 selected</span>
      <button class="mp2-browse-dl-btn" id="mp2BrowseDlBtn" onclick="mp2BrowseDownload('${escapeHtml(channelUrl)}')" disabled>⬇ Download Selected</button>
    </div>
    <div class="mp2-browse-list" id="mp2BrowseList"></div>`;

  const listEl = el.querySelector('#mp2BrowseList');
  videos.forEach(v => {
    const row = document.createElement('div');
    row.className = 'mp2-browse-row';
    row.dataset.vid = v.id;
    row.innerHTML = `
      <input type="checkbox" class="mp2-browse-cb" data-url="${escapeHtml(v.url)}" data-id="${escapeHtml(v.id)}" style="accent-color:var(--mp2-accent);width:15px;height:15px;flex-shrink:0;cursor:pointer;">
      ${v.thumbnail ? `<img class="mp2-browse-thumb" src="${escapeHtml(v.thumbnail)}" loading="lazy" alt="" onerror="this.style.display='none'">` : `<div class="mp2-browse-thumb mp2-browse-thumb-ph"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg></div>`}
      <div class="mp2-browse-row-info">
        <div class="mp2-browse-row-title">${escapeHtml(v.title)}</div>
        <div class="mp2-browse-row-meta">${v.uploader ? escapeHtml(v.uploader) + ' · ' : ''}${v.duration || ''}${v.type === 'release' ? ' · Release' : ''}</div>
      </div>`;

    const cb = row.querySelector('.mp2-browse-cb');
    row.onclick = e => {
      if (e.target === cb) return;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change'));
    };
    cb.addEventListener('change', () => {
      if (cb.checked) { _mp2BrowseSelected.add(v.id); row.classList.add('selected'); }
      else { _mp2BrowseSelected.delete(v.id); row.classList.remove('selected'); }
      mp2UpdateBrowseCount(videos.length);
    });
    listEl.appendChild(row);
  });
}

function mp2BrowseToggleAll(checked) {
  document.querySelectorAll('.mp2-browse-cb').forEach(cb => {
    cb.checked = checked;
    cb.dispatchEvent(new Event('change'));
  });
}

function mp2UpdateBrowseCount(total) {
  const cnt = document.getElementById('mp2BrowseCount');
  if (cnt) cnt.textContent = `${total} videos · ${_mp2BrowseSelected.size} selected`;
  const btn = document.getElementById('mp2BrowseDlBtn');
  if (btn) btn.disabled = _mp2BrowseSelected.size === 0;
}

async function mp2BrowseDownload(channelUrl) {
  if (!_mp2BrowseSelected.size) return;
  const rows = document.querySelectorAll('.mp2-browse-row');
  const urls = [];
  rows.forEach(row => {
    if (_mp2BrowseSelected.has(row.dataset.vid)) {
      const cb = row.querySelector('.mp2-browse-cb');
      if (cb) urls.push(cb.dataset.url);
    }
  });
  if (!urls.length) return;

  const artist = document.getElementById('mp2ChArtist')?.value.trim() || '';
  const btn = document.getElementById('mp2BrowseDlBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Starting…'; }

  try {
    const res = await fetch('/api/music/download/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ urls, artist: artist || null, format: mp2.chFmt, thumbnail: true })
    });
    const d = await safeJson(res);
    if (!res.ok) throw new Error(d.msg || d.error || 'Failed');
    showToast(`Downloading ${urls.length} tracks in background 🎵`, 'success');
    mp2ShowStatus('mp2ChStatus', `Downloading ${urls.length} selected tracks…`, false, true);
    const jobId = d.job_id || d.download_id;
    if (jobId) mp2PollDownload(jobId, 'mp2ChStatus');
    _mp2BrowseSelected = new Set();
    document.querySelectorAll('.mp2-browse-cb').forEach(cb => { cb.checked = false; cb.closest('.mp2-browse-row')?.classList.remove('selected'); });
    mp2UpdateBrowseCount(document.querySelectorAll('.mp2-browse-row').length);
  } catch (e) {
    showToast(e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '⬇ Download Selected'; }
  }
}

// ── YOUTUBE SEARCH ─────────────────────────────────────────────────────
let _mp2SearchTimer = null;
let _mp2SearchFmt   = 'mp3';

function mp2SearchDebounce() {
  clearTimeout(_mp2SearchTimer);
  _mp2SearchTimer = setTimeout(mp2SearchYT, 600);
}

async function mp2SearchYT() {
  const q = document.getElementById('mp2SearchQuery')?.value.trim();
  if (!q || q.length < 2) return;

  const resultsEl = document.getElementById('mp2SearchResults');
  const statusEl  = document.getElementById('mp2SearchStatus');
  if (resultsEl) resultsEl.innerHTML = '<div class="mp2-browse-loading"><div class="mp2-status-spin"></div> Searching YouTube…</div>';
  if (statusEl)  statusEl.className = 'mp2-status-bar';

  try {
    const res = await fetch('/api/music/search?' + new URLSearchParams({ q, limit: 10 }), {
      headers: { Authorization: 'Bearer ' + token }
    });
    const d = await safeJson(res);
    if (!res.ok) throw new Error(d.error || d.msg || 'Search failed');
    mp2RenderSearchResults(d.results || []);
  } catch (e) {
    if (resultsEl) resultsEl.innerHTML = `<div class="mp2-empty-state"><div style="font-size:28px">😕</div><p>${escapeHtml(e.message)}</p></div>`;
  }
}

function mp2RenderSearchResults(results) {
  const el = document.getElementById('mp2SearchResults');
  if (!el) return;
  if (!results.length) {
    el.innerHTML = '<div class="mp2-empty-state"><div style="font-size:28px">🔍</div><p>No results found. Try different keywords.</p></div>';
    return;
  }
  el.innerHTML = '';
  results.forEach(v => {
    const row = document.createElement('div');
    row.className = 'mp2-search-result-row';
    row.innerHTML = `
      ${v.thumbnail ? `<img class="mp2-browse-thumb" src="${escapeHtml(v.thumbnail)}" loading="lazy" alt="" onerror="this.style.display='none'">` : `<div class="mp2-browse-thumb mp2-browse-thumb-ph"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>`}
      <div class="mp2-browse-row-info">
        <div class="mp2-browse-row-title">${escapeHtml(v.title)}</div>
        <div class="mp2-browse-row-meta">${v.uploader ? escapeHtml(v.uploader) + ' · ' : ''}${v.duration || ''}</div>
      </div>
      <button class="mp2-search-dl-btn" onclick="mp2SearchDownloadOne('${escapeHtml(v.url)}','${escapeHtml(v.title)}',this)" title="Download">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download
      </button>`;
    el.appendChild(row);
  });
}

async function mp2SearchDownloadOne(url, title, btn) {
  if (!url) return;
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = '…';

  try {
    const res = await fetch('/api/music/youtube', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ url, format: _mp2SearchFmt, thumbnail: true })
    });
    const d = await safeJson(res);
    if (!res.ok) throw new Error(d.msg || d.error || 'Failed');
    btn.textContent = '✓';
    btn.style.background = '#22c55e';
    const jobId = d.download_id || d.job_id;
    if (jobId) mp2PollDownload(jobId, null);
    showToast(`Downloading: ${title} 🎵`, 'success');
    setTimeout(() => { btn.disabled = false; btn.innerHTML = origHtml; btn.style.background = ''; }, 4000);
  } catch (e) {
    btn.textContent = '✗';
    btn.style.background = '#ef4444';
    showToast(e.message, 'error');
    setTimeout(() => { btn.disabled = false; btn.innerHTML = origHtml; btn.style.background = ''; }, 3000);
  }
}

function mp2SelFmt(ctx, fmt, btn) {
  if (ctx === 'search') _mp2SearchFmt = fmt;
  else if (ctx === 'yt') mp2.ytFmt = fmt;
  else if (ctx === 'ch') mp2.chFmt = fmt;
  btn.closest('.mp2-fmt-row')?.querySelectorAll('.mp2-fmt-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

async function mp2UploadFiles(input) {
  const files = Array.from(input.files);
  if (!files.length) return;
  const artist = document.getElementById('mp2FileArtist')?.value.trim() || '';
  mp2ShowStatus('mp2FileStatus', `Uploading ${files.length} file(s)…`);

  for (const file of files) {
    const fd = new FormData();
    fd.append('file', file);
    if (artist) fd.append('artist', artist);
    try {
      const res = await fetch('/api/music/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
      if (!res.ok) throw new Error((await safeJson(res)).msg || 'Upload failed');
    } catch (e) { showToast(`Failed: ${file.name}`, 'error'); }
  }
  await mp2LoadTracks();
  mp2RenderAll();
  mp2ShowStatus('mp2FileStatus', 'Upload complete!');
  showToast(`${files.length} track${files.length !== 1 ? 's' : ''} uploaded 🎵`, 'success');
  input.value = '';
}

// ══════════════════════════════════════════════════════════════════
//  CUSTOM MODAL SYSTEM — replaces all browser prompt() / confirm()
// ══════════════════════════════════════════════════════════════════

// Inject modal CSS once
(function _mp2InjectModalCSS() {
  if (document.getElementById('mp2ModalStyle')) return;
  const s = document.createElement('style');
  s.id = 'mp2ModalStyle';
  s.textContent = `
  .mp2-modal-overlay {
    position: fixed; inset: 0; z-index: 19999;
    background: rgba(0,0,0,0.72);
    backdrop-filter: blur(8px);
    display: flex; align-items: center; justify-content: center;
    animation: mp2MoFadeIn .18s ease;
  }
  @keyframes mp2MoFadeIn { from { opacity:0 } to { opacity:1 } }
  .mp2-modal-box {
    background: #13141f;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 18px;
    padding: 28px 28px 22px;
    width: 360px; max-width: 92vw;
    box-shadow: 0 24px 60px rgba(0,0,0,0.8);
    animation: mp2MoSlideIn .2s cubic-bezier(.34,1.56,.64,1);
  }
  @keyframes mp2MoSlideIn { from { transform: scale(.92) translateY(12px); opacity:0 } to { transform: none; opacity:1 } }
  .mp2-modal-icon { font-size: 28px; margin-bottom: 10px; }
  .mp2-modal-title {
    font-family: 'Outfit', sans-serif;
    font-size: 17px; font-weight: 700;
    color: #f1f0ff; margin-bottom: 6px;
  }
  .mp2-modal-msg {
    font-size: 13.5px; color: #a09dc0;
    line-height: 1.55; margin-bottom: 18px;
  }
  .mp2-modal-input {
    width: 100%; box-sizing: border-box;
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.13);
    border-radius: 10px;
    color: #f1f0ff; font-family: 'Figtree', sans-serif;
    font-size: 14px; padding: 10px 14px;
    outline: none; margin-bottom: 18px;
    transition: border-color .15s;
  }
  .mp2-modal-input:focus { border-color: #7c3aed; }
  .mp2-modal-btns { display: flex; gap: 10px; justify-content: flex-end; }
  .mp2-modal-btn {
    padding: 9px 20px; border-radius: 10px; border: none;
    font-family: 'Figtree', sans-serif;
    font-size: 13.5px; font-weight: 600; cursor: pointer;
    transition: all .15s;
  }
  .mp2-modal-btn-cancel {
    background: rgba(255,255,255,0.08);
    color: #a09dc0;
  }
  .mp2-modal-btn-cancel:hover { background: rgba(255,255,255,0.14); color: #f1f0ff; }
  .mp2-modal-btn-ok {
    background: #7c3aed; color: #fff;
    box-shadow: 0 4px 14px rgba(124,58,237,.4);
  }
  .mp2-modal-btn-ok:hover { background: #8b47f5; }
  .mp2-modal-btn-danger {
    background: #ef4444; color: #fff;
    box-shadow: 0 4px 14px rgba(239,68,68,.3);
  }
  .mp2-modal-btn-danger:hover { background: #f87171; }
  `;
  document.head.appendChild(s);
})();

/**
 * mp2Confirm(opts) → Promise<boolean>
 * opts: { title, msg, icon, okLabel, cancelLabel, danger }
 */
function mp2Confirm(opts = {}) {
  return new Promise(resolve => {
    _mp2InjectModalCSS && _mp2InjectModalCSS();
    const overlay = document.createElement('div');
    overlay.className = 'mp2-modal-overlay';
    overlay.innerHTML = `
      <div class="mp2-modal-box">
        ${opts.icon ? `<div class="mp2-modal-icon">${opts.icon}</div>` : ''}
        <div class="mp2-modal-title">${opts.title || 'Are you sure?'}</div>
        ${opts.msg ? `<div class="mp2-modal-msg">${opts.msg}</div>` : ''}
        <div class="mp2-modal-btns">
          <button class="mp2-modal-btn mp2-modal-btn-cancel">${opts.cancelLabel || 'Cancel'}</button>
          <button class="mp2-modal-btn ${opts.danger ? 'mp2-modal-btn-danger' : 'mp2-modal-btn-ok'}">${opts.okLabel || 'OK'}</button>
        </div>
      </div>`;
    const [cancelBtn, okBtn] = overlay.querySelectorAll('.mp2-modal-btn');
    const done = (val) => { overlay.remove(); resolve(val); };
    cancelBtn.onclick = () => done(false);
    okBtn.onclick     = () => done(true);
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') done(false); if (e.key === 'Enter') done(true); });
    document.body.appendChild(overlay);
    okBtn.focus();
  });
}

/**
 * mp2Prompt(opts) → Promise<string|null>
 * opts: { title, msg, icon, placeholder, defaultValue, okLabel, cancelLabel }
 */
function mp2Prompt(opts = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'mp2-modal-overlay';
    overlay.innerHTML = `
      <div class="mp2-modal-box">
        ${opts.icon ? `<div class="mp2-modal-icon">${opts.icon}</div>` : ''}
        <div class="mp2-modal-title">${opts.title || 'Enter value'}</div>
        ${opts.msg ? `<div class="mp2-modal-msg">${opts.msg}</div>` : ''}
        <input class="mp2-modal-input" type="text"
          placeholder="${opts.placeholder || ''}"
          value="${escapeHtml(opts.defaultValue || '')}">
        <div class="mp2-modal-btns">
          <button class="mp2-modal-btn mp2-modal-btn-cancel">${opts.cancelLabel || 'Cancel'}</button>
          <button class="mp2-modal-btn mp2-modal-btn-ok">${opts.okLabel || 'OK'}</button>
        </div>
      </div>`;
    const input     = overlay.querySelector('.mp2-modal-input');
    const cancelBtn = overlay.querySelector('.mp2-modal-btn-cancel');
    const okBtn     = overlay.querySelector('.mp2-modal-btn-ok');
    const done = (val) => { overlay.remove(); resolve(val); };
    cancelBtn.onclick = () => done(null);
    okBtn.onclick     = () => done(input.value);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') done(input.value); if (e.key === 'Escape') done(null); });
    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}

/**
 * mp2PromptChoose(opts) → Promise<'ok'|'manual'|null>
 * Three-option modal: primary action, secondary action, cancel
 */
function mp2PromptChoose(opts = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'mp2-modal-overlay';
    overlay.innerHTML = `
      <div class="mp2-modal-box">
        ${opts.icon ? `<div class="mp2-modal-icon">${opts.icon}</div>` : ''}
        <div class="mp2-modal-title">${opts.title || ''}</div>
        ${opts.msg ? `<div class="mp2-modal-msg">${opts.msg}</div>` : ''}
        <div class="mp2-modal-btns" style="flex-direction:column;gap:8px;">
          <button class="mp2-modal-btn mp2-modal-btn-ok" style="width:100%;text-align:center;">${opts.okLabel || 'Use this'}</button>
          <button class="mp2-modal-btn mp2-modal-btn-cancel" style="width:100%;text-align:center;">${opts.manualLabel || 'Enter manually'}</button>
          <button class="mp2-modal-btn mp2-modal-btn-cancel" style="width:100%;text-align:center;opacity:.6;">${opts.cancelLabel || 'Skip'}</button>
        </div>
      </div>`;
    const [okBtn, manualBtn, cancelBtn] = overlay.querySelectorAll('.mp2-modal-btn');
    const done = (val) => { overlay.remove(); resolve(val); };
    okBtn.onclick     = () => done('ok');
    manualBtn.onclick = () => done('manual');
    cancelBtn.onclick = () => done(null);
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') done(null); });
    document.body.appendChild(overlay);
    okBtn.focus();
  });
}

// ── OVERRIDE OLD HOOKS ────────────────────────────────────────────────
// Keep old functions working for compatibility
window.mpTogglePlay = mp2TogglePlay;
window.mpNext = mp2Next;
window.mpPrev = mp2Prev;
window.openMusicAddPanel = mp2OpenAddPanel;
window.closeMusicAddPanel = mp2CloseAddPanel;
window.mpInit = mp2Init;
window.mpRenderAll = mp2RenderAll;

// ── KEYBOARD SHORTCUTS ────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  const overlay = document.getElementById('musicOverlay');
  if (!overlay || overlay.style.display === 'none') return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
  if (e.code === 'Space') { e.preventDefault(); mp2TogglePlay(); }
  if (e.code === 'ArrowRight') { e.preventDefault(); mpAudio2.currentTime += 10; }
  if (e.code === 'ArrowLeft')  { e.preventDefault(); mpAudio2.currentTime -= 10; }
  if (e.code === 'KeyS') mp2ToggleShuffle();
  if (e.code === 'KeyL') mp2ToggleLoop();
  if (e.code === 'Escape') {
    const cd = document.getElementById('mp2CDModal');
    if (cd && cd.classList.contains('open')) { mp2CloseCD(); return; }
    mp2Close();
  }
});

// Drag-over drop zone
const dz = document.getElementById('mp2DropZone');
if (dz) {
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('over');
    const input = document.getElementById('mp2FileInput');
    if (input && e.dataTransfer.files.length) {
      Object.defineProperty(input, 'files', { value: e.dataTransfer.files, writable: true });
      mp2UploadFiles(input);
    }
  });
}

// Progress bar drag (mouse + touch)
function mp2MakeProgressDraggable(barId) {
  const bar = document.getElementById(barId);
  if (!bar) return;
  let dragging = false;

  function seekFromEvent(clientX) {
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    if (mpAudio2.duration) mpAudio2.currentTime = pct * mpAudio2.duration;
  }

  // Mouse
  bar.addEventListener('mousedown', (e) => { dragging = true; seekFromEvent(e.clientX); });
  document.addEventListener('mousemove', (e) => { if (!dragging) return; seekFromEvent(e.clientX); });
  document.addEventListener('mouseup', () => dragging = false);

  // Touch
  bar.addEventListener('touchstart', (e) => { dragging = true; seekFromEvent(e.touches[0].clientX); e.preventDefault(); }, { passive: false });
  bar.addEventListener('touchmove', (e) => { if (!dragging) return; seekFromEvent(e.touches[0].clientX); e.preventDefault(); }, { passive: false });
  bar.addEventListener('touchend', () => dragging = false);
}
mp2MakeProgressDraggable('mp2BarProgress');
mp2MakeProgressDraggable('mp2CDProgress');

// Volume bar touch support
function mp2MakeVolumeTouchable(barId) {
  const bar = document.getElementById(barId);
  if (!bar) return;
  function setVol(clientX) {
    const rect = bar.getBoundingClientRect();
    const v = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    mp2.muted = false;
    mp2SetVolume(v);
  }
  let dragging = false;
  bar.addEventListener('mousedown', (e) => { dragging = true; setVol(e.clientX); });
  document.addEventListener('mousemove', (e) => { if (!dragging) return; setVol(e.clientX); });
  document.addEventListener('mouseup', () => dragging = false);
  bar.addEventListener('touchstart', (e) => { dragging = true; setVol(e.touches[0].clientX); e.preventDefault(); }, { passive: false });
  bar.addEventListener('touchmove', (e) => { if (!dragging) return; setVol(e.touches[0].clientX); e.preventDefault(); }, { passive: false });
  bar.addEventListener('touchend', () => dragging = false);
}
mp2MakeVolumeTouchable('mp2VolBar');
mp2MakeVolumeTouchable('mp2CDVolBar');

// ══════════════════════════════════════════════════════════════════
//  LYRICS — fetch, render, sync (v2 — writes to #mpLyricsContent
//  inside the CD modal lyrics panel)
// ══════════════════════════════════════════════════════════════════

const mp2Lyrics = {
  lines:      [],
  plain:      '',
  synced:     false,
  activeLine: -1,
  syncTimer:  null,
  loadedFor:  null,
};

function mp2ToggleLyricsPanel() {
  const panel = document.getElementById('mp2CDLyricsPanel');
  const btn   = document.getElementById('mp2CDLyricsBtn');
  if (!panel) return;
  const isOpen = panel.classList.toggle('open');
  if (btn) btn.classList.toggle('active', isOpen);
  // If opening, always fetch/show lyrics for current track
  if (isOpen) {
    const track = mp2.currentTrack || mp2Lyrics._pendingTrack;
    if (track) {
      if (mp2Lyrics.loadedFor !== track) {
        // Not yet loaded at all — fetch now
        mp2FetchLyrics(track);
      } else if (mp2Lyrics._preloaded) {
        // Was background-fetched — render it to DOM now
        mp2RenderPreloadedLyrics();
      } else {
        // Loaded and rendered already — restart sync if needed
        if (mp2Lyrics.synced && !mpAudio2.paused) mp2StartLyricSync();
      }
    }
  } else {
    mp2StopLyricSync();
  }
}

// Render lyrics data that was already fetched in background
function mp2RenderPreloadedLyrics() {
  const content = document.getElementById('mpLyricsContent');
  if (!content) return;

  // If nothing was actually fetched, fall back to a fresh fetch
  if (!mp2Lyrics.plain && !(mp2Lyrics.lines && mp2Lyrics.lines.length)) {
    const track = mp2.currentTrack || mp2Lyrics._pendingTrack;
    if (track) mp2FetchLyrics(track);
    return;
  }

  const title    = mp2Lyrics._cachedTitle  || mp2GuessTitle(mp2.currentTrack || '');
  const artist   = mp2Lyrics._cachedArtist || mp2GuessArtist(mp2.currentTrack || '') || '';

  const header = `<div class="mp-lyrics-meta" style="padding:16px 16px 8px;border-bottom:1px solid var(--mp2-border);margin-bottom:4px;">
    <div style="font-weight:700;font-size:14px;color:var(--mp2-text);">${escapeHtml(title)}</div>
    ${artist ? `<div style="font-size:12px;color:var(--mp2-text3);margin-top:2px;">${escapeHtml(artist)}</div>` : ''}
    <div style="margin-top:6px;">
      ${mp2Lyrics.synced
        ? '<span style="font-size:10px;background:rgba(124,58,237,0.2);color:var(--mp2-accent2);padding:2px 8px;border-radius:10px;font-weight:600;letter-spacing:.5px;">🎵 SYNCED</span>'
        : '<span style="font-size:10px;background:rgba(255,255,255,0.06);color:var(--mp2-text3);padding:2px 8px;border-radius:10px;">PLAIN TEXT</span>'}
    </div>
  </div>`;

  if (mp2Lyrics.synced && mp2Lyrics.lines && mp2Lyrics.lines.length > 0) {
    const linesHtml = mp2Lyrics.lines.map((l, i) =>
      `<div class="mp-lyric-line" id="mpl${i}" data-ms="${l.time_ms}"
            onclick="mpAudio2.currentTime=${l.time_ms / 1000}">${escapeHtml(l.text)}</div>`
    ).join('');
    content.innerHTML = header + `<div class="mp-lyric-lines" id="mpLyricLines" style="padding:8px 0;">${linesHtml}</div>`;
    const badge = document.getElementById('mp2LyricsSyncBadge');
    if (badge) badge.style.display = 'inline';
    const badge2 = document.getElementById('mp2LyricsSyncBadge2');
    if (badge2) badge2.style.display = 'inline';
    if (!mpAudio2.paused) mp2StartLyricSync();
  } else if (mp2Lyrics.plain) {
    const plainHtml = mp2Lyrics.plain.split('\n').map(l =>
      l.trim()
        ? `<div class="mp-lyric-line-plain">${escapeHtml(l)}</div>`
        : `<div style="height:12px;"></div>`
    ).join('');
    content.innerHTML = header + `<div class="mp-lyric-plain" style="padding:8px 0;">${plainHtml}</div>`;
  } else {
    // Preloaded but empty — do a fresh fetch
    const track = mp2.currentTrack || mp2Lyrics._pendingTrack;
    if (track) mp2FetchLyrics(track);
  }
  mp2Lyrics._preloaded = false; // mark as fully rendered
}


async function mp2FetchLyricsBackground(filename) {
  if (!filename) return;
  const stem   = filename.replace(/\.(mp3|flac|wav|ogg|m4a|aac|opus|wma|webm)$/i, '');
  const title  = mp2GuessTitle(filename);
  const artist = mp2GuessArtist(filename) ||
    (typeof mp2DetectArtistInTitle === 'function' ? mp2DetectArtistInTitle(stem) : null) || '';
  const cleanTitle = title.replace(/\s*[\(\[].*?[\)\]]/gi, '').replace(/\s*(official|video|audio|lyrics|hd|4k|mv|music|full\s*song|ft\.?|feat\.?).*$/gi, '').trim() || title;
  const titleNoArtist = artist ? _mp2StripArtistFromTitle(cleanTitle) : cleanTitle;
  // Try most specific first
  const attempts = [];
  if (artist && titleNoArtist !== cleanTitle) attempts.push({ track_name: titleNoArtist, artist_name: artist });
  if (artist && cleanTitle) attempts.push({ track_name: cleanTitle, artist_name: artist });
  attempts.push({ track_name: cleanTitle });
  if (title !== cleanTitle) attempts.push({ track_name: title });
  try {
    for (const attempt of attempts) {
      const params = new URLSearchParams({ ...attempt, filename });
      const res = await fetch('/api/music/lyrics?' + params, { headers: { Authorization: 'Bearer ' + (token || localStorage.getItem('token') || '') } });
      const data = await res.json();
      if (data && data.found) {
        mp2Lyrics.loadedFor    = filename;
        mp2Lyrics.synced       = data.synced || false;
        mp2Lyrics.lines        = data.lines  || [];
        mp2Lyrics.plain        = data.lyrics || '';
        mp2Lyrics._preloaded   = true;
        mp2Lyrics._cachedTitle  = data.title  || title;
        mp2Lyrics._cachedArtist = data.artist || artist;
        break;
      }
    }
  } catch {}
}

async function mp2FetchLyrics(filename) {
  if (!filename) return;
  mp2Lyrics.loadedFor = filename;
  const content = document.getElementById('mpLyricsContent');
  if (!content) return;

  content.innerHTML = '<div class="mp2-lyrics-loading" style="display:flex;align-items:center;gap:10px;padding:32px 20px;color:var(--mp2-text3);"><span class="mp2-lyrics-spinner"></span>Searching for lyrics…</div>';

  const rawTitle  = mp2GuessTitle(filename);
  const rawArtist = mp2GuessArtist(filename);

  // If mp2GuessArtist returned nothing, try detecting artist from the raw stem too
  const stem = filename.replace(/\.(mp3|flac|wav|ogg|m4a|aac|opus|wma|webm)$/i, '');
  const detectedArtist = rawArtist || (typeof mp2DetectArtistInTitle === 'function' ? mp2DetectArtistInTitle(stem) : null) || '';

  // Clean title: remove [Official Video], (Lyrics), feat. etc.
  const cleanTitle = rawTitle
    .replace(/\s*[\(\[].*?[\)\]]/gi, '')
    .replace(/\s*(official|video|audio|lyrics|hd|4k|mv|music|lyric video|full\s*song|ft\.?|feat\.?).*$/gi, '')
    .trim();

  // Also try title without the artist name embedded (e.g. "Song Arijit Singh" → "Song")
  const titleNoArtist = detectedArtist ? _mp2StripArtistFromTitle(cleanTitle) : cleanTitle;

  // Build search attempts in priority order: most specific first
  const attempts = [];
  if (detectedArtist && titleNoArtist && titleNoArtist !== cleanTitle) {
    attempts.push({ track_name: titleNoArtist, artist_name: detectedArtist });
  }
  if (detectedArtist && cleanTitle) attempts.push({ track_name: cleanTitle, artist_name: detectedArtist });
  if (detectedArtist && rawTitle && rawTitle !== cleanTitle) attempts.push({ track_name: rawTitle, artist_name: detectedArtist });
  if (titleNoArtist && titleNoArtist !== cleanTitle) attempts.push({ track_name: titleNoArtist });
  if (cleanTitle) attempts.push({ track_name: cleanTitle });
  if (rawTitle && rawTitle !== cleanTitle) attempts.push({ track_name: rawTitle });

  let data = null;
  for (const attempt of attempts) {
    try {
      const params = new URLSearchParams({ ...attempt, filename });
      const res = await fetch('/api/music/lyrics?' + params, {
        headers: { Authorization: 'Bearer ' + (token || localStorage.getItem('token') || '') }
      });
      if (!res.ok) continue;
      const d = await res.json();
      if (d && d.found) { data = d; break; }
    } catch {}
  }

  if (!data || !data.found) {
    content.innerHTML = `
      <div class="mp2-lyrics-empty" style="display:flex;flex-direction:column;align-items:center;padding:40px 20px;text-align:center;color:var(--mp2-text3);gap:8px;">
        <div style="font-size:32px;">🎵</div>
        <div style="font-weight:600;color:var(--mp2-text2);">No lyrics found</div>
        <div style="font-size:12px;opacity:.6;">"${escapeHtml(cleanTitle)}"${rawArtist ? ' · ' + escapeHtml(rawArtist) : ''}</div>
        <div style="font-size:11px;opacity:.45;margin-top:8px;">Tip: name files as<br><code style="background:rgba(255,255,255,.07);padding:2px 6px;border-radius:4px;">Artist - Song.mp3</code></div>
      </div>`;
    mp2Lyrics.synced = false; mp2Lyrics.lines = [];
    return;
  }

  mp2Lyrics.synced = data.synced || false;
  mp2Lyrics.lines  = data.lines  || [];
  mp2Lyrics.plain  = data.lyrics || '';
  mp2Lyrics.activeLine = -1;

  const header = `<div class="mp-lyrics-meta" style="padding:16px 16px 8px;border-bottom:1px solid var(--mp2-border);margin-bottom:4px;">
    <div style="font-weight:700;font-size:14px;color:var(--mp2-text);">${escapeHtml(data.title || cleanTitle)}</div>
    ${data.artist ? `<div style="font-size:12px;color:var(--mp2-text3);margin-top:2px;">${escapeHtml(data.artist)}</div>` : ''}
    <div style="margin-top:6px;">
      ${data.synced
        ? '<span style="font-size:10px;background:rgba(124,58,237,0.2);color:var(--mp2-accent2);padding:2px 8px;border-radius:10px;font-weight:600;letter-spacing:.5px;">🎵 SYNCED</span>'
        : '<span style="font-size:10px;background:rgba(255,255,255,0.06);color:var(--mp2-text3);padding:2px 8px;border-radius:10px;">PLAIN TEXT</span>'}
    </div>
  </div>`;

  if (data.synced && data.lines && data.lines.length > 0) {
    const linesHtml = data.lines.map((l, i) =>
      `<div class="mp-lyric-line" id="mpl${i}" data-ms="${l.time_ms}"
            onclick="mpAudio2.currentTime=${l.time_ms / 1000}">${escapeHtml(l.text)}</div>`
    ).join('');
    content.innerHTML = header + `<div class="mp-lyric-lines" id="mpLyricLines" style="padding:8px 0;">${linesHtml}</div>`;
    const badge = document.getElementById('mp2LyricsSyncBadge');
    if (badge) badge.style.display = 'inline';
    if (!mpAudio2.paused) mp2StartLyricSync();
  } else if (data.lyrics) {
    const plainHtml = data.lyrics.split('\n').map(l =>
      l.trim()
        ? `<div class="mp-lyric-line-plain">${escapeHtml(l)}</div>`
        : `<div style="height:12px;"></div>`
    ).join('');
    content.innerHTML = header + `<div class="mp-lyric-plain" style="padding:8px 0;">${plainHtml}</div>`;
  }
}

function mp2StartLyricSync() {
  mp2StopLyricSync();
  if (!mp2Lyrics.synced || !mp2Lyrics.lines.length) return;
  const badge = document.getElementById('mp2LyricsSyncBadge');
  if (badge) badge.style.display = 'inline';
  mp2Lyrics.syncTimer = setInterval(() => {
    if (mpAudio2.paused) return;
    const nowMs = mpAudio2.currentTime * 1000;
    let idx = -1;
    for (let i = mp2Lyrics.lines.length - 1; i >= 0; i--) {
      if (nowMs >= mp2Lyrics.lines[i].time_ms) { idx = i; break; }
    }
    if (idx === mp2Lyrics.activeLine) return;
    mp2Lyrics.activeLine = idx;
    document.querySelectorAll('#mpLyricLines .mp-lyric-line').forEach((el, i) => {
      el.classList.remove('active', 'past');
      if (i < idx) el.classList.add('past');
    });
    if (idx >= 0) {
      const el = document.getElementById('mpl' + idx);
      if (el) {
        el.classList.add('active');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, 150);
}

function mp2StopLyricSync() {
  if (mp2Lyrics.syncTimer) { clearInterval(mp2Lyrics.syncTimer); mp2Lyrics.syncTimer = null; }
  const badge = document.getElementById('mp2LyricsSyncBadge');
  if (badge) badge.style.display = 'none';
}

// Hook into audio events
mpAudio2.addEventListener('play',  () => { if (mp2Lyrics.synced) mp2StartLyricSync(); });
mpAudio2.addEventListener('pause', () => mp2StopLyricSync());
mpAudio2.addEventListener('seeked', () => { mp2Lyrics.activeLine = -1; });

// Override the window.mpFetchLyrics hook that mp2Load() calls
window.mpFetchLyrics = function(trackName) {
  // ── CRITICAL: immediately clear old state so stale lines never animate ──
  mp2StopLyricSync();
  mp2Lyrics.loadedFor = null;
  mp2Lyrics.lines     = [];
  mp2Lyrics.plain     = '';
  mp2Lyrics.synced    = false;
  mp2Lyrics.activeLine = -1;
  mp2Lyrics._pendingTrack = trackName;
  // Clear the rendered lines from DOM so nothing bounces during load
  const linesEl = document.getElementById('mpLyricLines');
  if (linesEl) linesEl.querySelectorAll('.mp-lyric-line').forEach(l => l.classList.remove('active','past'));
  // Hide LIVE badge
  document.getElementById('mp2LyricsSyncBadge')  && (document.getElementById('mp2LyricsSyncBadge').style.display  = 'none');
  document.getElementById('mp2LyricsSyncBadge2') && (document.getElementById('mp2LyricsSyncBadge2').style.display = 'none');

  const panel = document.getElementById('mp2CDLyricsPanel');
  if (panel && panel.classList.contains('open')) {
    mp2FetchLyrics(trackName);
  }
  // Pre-fetch silently in background so lyrics are ready when user opens panel
  else {
    setTimeout(() => {
      if (mp2Lyrics.loadedFor !== trackName) {
        mp2FetchLyricsBackground(trackName);
      }
    }, 800);
  }
};

/* --- UX UPGRADES --- */
window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    const a = document.getElementById('mpAudio');
    if(e.code==='Space'){ e.preventDefault(); mp2TogglePlay(); }
    if(e.code==='ArrowRight') a.currentTime += 10;
    if(e.code==='ArrowLeft') a.currentTime -= 10;
});
function triggerHaptic() { if (navigator.vibrate) navigator.vibrate(12); }
const _origPlay = window.mp2TogglePlay;
window.mp2TogglePlay = function() { triggerHaptic(); return _origPlay(); };

// ── ADMIN TRACKS MANAGER ─────────────────────────────────────────────────

function mp2OpenAdminPanel() {
  if (!_mp2IsAdmin) {
    showToast('Admin access required to manage the Tracks folder', 'error');
    return;
  }
  const panel = document.getElementById('mp2AdminPanel');
  if (panel) {
    panel.style.display = 'flex';
    mp2AdminLoadFiles();
    // Show/hide admin-only buttons inside panel
    panel.querySelectorAll('.mp2-admin-panel-only').forEach(el => {
      el.style.display = '';
    });
  }
}

function mp2CloseAdminPanel() {
  const panel = document.getElementById('mp2AdminPanel');
  if (panel) panel.style.display = 'none';
}

let _mp2AdminFiles = [];
let _mp2AdminSearch = '';

async function mp2AdminLoadFiles() {
  const listEl = document.getElementById('mp2AdminFileList');
  if (!listEl) return;
  listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--mp2-text3)"><div class="mp2-status-spin"></div> Loading…</div>';
  try {
    const res = await fetch('/api/music/admin/tracks', { headers: { Authorization: 'Bearer ' + token } });
    const d = await safeJson(res);
    _mp2AdminFiles = d.files || [];
    mp2AdminRenderFiles();
    const countEl = document.getElementById('mp2AdminFileCount');
    if (countEl) countEl.textContent = `${_mp2AdminFiles.filter(f=>f.is_audio).length} tracks, ${_mp2AdminFiles.length} total files`;
  } catch (e) {
    listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#f87171;">${escapeHtml(e.message)}</div>`;
  }
}

function mp2AdminRenderFiles() {
  const listEl = document.getElementById('mp2AdminFileList');
  if (!listEl) return;
  const q = _mp2AdminSearch.toLowerCase();
  const filtered = q ? _mp2AdminFiles.filter(f => f.name.toLowerCase().includes(q)) : _mp2AdminFiles;

  if (!filtered.length) {
    listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--mp2-text3);">No files found</div>';
    return;
  }

  listEl.innerHTML = '';
  filtered.forEach(f => {
    const row = document.createElement('div');
    row.className = 'mp2-admin-file-row';
    const isAudio = f.is_audio;
    const isNA = isAudio && /^(na|n\/a)\s*-\s*/i.test(f.name);
    row.innerHTML = `
      <div class="mp2-admin-file-icon">${isAudio
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mp2-accent)" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mp2-text3)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>'
      }</div>
      <div class="mp2-admin-file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}${isNA ? ' <span style="font-size:9px;background:#ef4444;color:white;padding:1px 5px;border-radius:4px;font-weight:700;vertical-align:middle;">NA</span>' : ''}</div>
      <div class="mp2-admin-file-size">${f.size_fmt}</div>
      <div class="mp2-admin-file-actions">
        ${isAudio ? `<button class="mp2-admin-btn" onclick="mp2OpenTrackEditor('${escapeHtml(f.name)}')" title="Edit title/thumbnail" style="color:var(--mp2-accent2);">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
        <button class="mp2-admin-btn" onclick="mp2AdminFindArtistForTrack('${escapeHtml(f.name)}')" title="Find / fix artist name (works on ANY track)" style="color:var(--mp2-accent);font-size:12px;padding:3px 7px;line-height:1.4;">
          🔎
        </button>` : ''}
        <button class="mp2-admin-btn" onclick="mp2AdminRenameFile('${escapeHtml(f.name)}')" title="Rename">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="mp2-admin-btn danger" onclick="mp2AdminDeleteFile('${escapeHtml(f.name)}')" title="Delete">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div>`;
    listEl.appendChild(row);
  });
}

function mp2AdminFilterFiles() {
  _mp2AdminSearch = document.getElementById('mp2AdminSearch')?.value || '';
  mp2AdminRenderFiles();
}

async function mp2AdminRenameFile(oldName) {
  const newName = await mp2Prompt({ icon: '✏️', title: 'Rename file', msg: `Current: <code style="background:rgba(255,255,255,.07);padding:1px 6px;border-radius:4px;font-size:12px;">${escapeHtml(oldName)}</code>`, placeholder: 'New filename…', defaultValue: oldName, okLabel: 'Rename' });
  if (!newName || newName === oldName) return;
  try {
    const res = await fetch('/api/music/admin/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ old_name: oldName, new_name: newName })
    });
    const d = await safeJson(res);
    if (!res.ok) throw new Error(d.error || d.msg || 'Rename failed');
    showToast(`Renamed to ${d.new_name}`, 'success');
    await mp2AdminLoadFiles();
    await mp2LoadTracks();
    mp2RenderAll();
  } catch (e) { showToast(e.message, 'error'); }
}

async function mp2AdminDeleteFile(filename) {
  const ok = await mp2Confirm({ icon: '🗑️', title: 'Delete file?', msg: `<code style="background:rgba(255,255,255,.07);padding:1px 6px;border-radius:4px;font-size:12px;">${escapeHtml(filename)}</code><br><br>This cannot be undone.`, okLabel: 'Delete', danger: true });
  if (!ok) return;
  try {
    const res = await fetch('/api/music/admin/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ filename })
    });
    const d = await safeJson(res);
    if (!res.ok) throw new Error(d.error || d.msg || 'Delete failed');
    showToast('File deleted', 'success');
    await mp2AdminLoadFiles();
    await mp2LoadTracks();
    mp2RenderAll();
  } catch (e) { showToast(e.message, 'error'); }
}

async function mp2AdminFixNANames() {
  const defaultArtist = await mp2Prompt({ icon: '🔧', title: 'Fix Unknown Artist Names', msg: 'Enter a fallback artist name for all unrecognised tracks, or leave blank to use "Unknown Artist".', placeholder: 'e.g. Unknown Artist', okLabel: 'Fix Names' });
  if (defaultArtist === null) return; // cancelled
  try {
    const res = await fetch('/api/music/admin/fix_artist_names', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ default_artist: defaultArtist })
    });
    const d = await safeJson(res);
    if (!res.ok) throw new Error(d.error || 'Failed');
    showToast(`Fixed ${d.count} filename(s)`, 'success');
    await mp2AdminLoadFiles();
    await mp2LoadTracks();
    mp2RenderAll();
  } catch (e) { showToast(e.message, 'error'); }
}

// ── ARTIST NAME DETECTION DATABASE ───────────────────────────────────────────
// Used to auto-detect artist from song title when file is "NA - Song Title.mp3"
const _mp2ArtistDB = [
  // Each entry: [canonical name, ...aliases] — sorted longest-first at runtime
  // ── Bollywood / Hindi ────────────────────────────────
  ["Yo Yo Honey Singh",  "yo yo honey singh","yoyo honey singh"],
  ["Honey Singh",        "honey singh"],
  ["Badshah",            "badshah"],
  ["Raftaar",            "raftaar"],
  ["Divine",             "divine"],
  ["Emiway Bantai",      "emiway bantai","emiway"],
  ["MC Stan",            "mc stan"],
  ["Arijit Singh",       "arijit singh","arijit"],
  ["Atif Aslam",         "atif aslam","atif"],
  ["Shreya Ghoshal",     "shreya ghoshal","shreya"],
  ["Sonu Nigam",         "sonu nigam"],
  ["Kumar Sanu",         "kumar sanu"],
  ["Udit Narayan",       "udit narayan"],
  ["Alka Yagnik",        "alka yagnik"],
  ["Lata Mangeshkar",    "lata mangeshkar","lata"],
  ["Asha Bhosle",        "asha bhosle","asha bhonsle"],
  ["Mohammed Rafi",      "mohammed rafi","md rafi","mohammad rafi"],
  ["Kishore Kumar",      "kishore kumar","kishore"],
  ["A. R. Rahman",       "a r rahman","ar rahman","a.r. rahman"],
  ["Pritam",             "pritam"],
  ["Amit Trivedi",       "amit trivedi"],
  ["Shaan",              "shaan"],
  ["KK",                 "k.k."],
  ["Sunidhi Chauhan",    "sunidhi chauhan"],
  ["Neha Kakkar",        "neha kakkar"],
  ["Tony Kakkar",        "tony kakkar"],
  ["Darshan Raval",      "darshan raval"],
  ["B Praak",            "b praak","b. praak"],
  ["Jubin Nautiyal",     "jubin nautiyal","jubin"],
  ["Armaan Malik",       "armaan malik"],
  ["Mika Singh",         "mika singh","mika"],
  ["Nucleya",            "nucleya"],
  ["Krsna",              "krsna"],
  ["Bohemia",            "bohemia"],
  ["Imran Khan",         "imran khan"],
  // ── Aditya Rikhari & similar ───────────────────────
  ["Aditya Rikhari",     "aditya rikhari"],
  ["Prateek Kuhad",      "prateek kuhad"],
  ["Ritviz",             "ritviz"],
  ["Papon",              "papon"],
  ["Mohit Chauhan",      "mohit chauhan"],
  ["Lucky Ali",          "lucky ali"],
  // ── Punjabi ───────────────────────────────────────
  ["Diljit Dosanjh",     "diljit dosanjh","diljit"],
  ["Sidhu Moosewala",    "sidhu moosewala","moosewala"],
  ["AP Dhillon",         "ap dhillon"],
  ["Hardy Sandhu",       "hardy sandhu","harrdy sandhu"],
  ["Karan Aujla",        "karan aujla"],
  ["Mankirt Aulakh",     "mankirt aulakh"],
  ["Garry Sandhu",       "garry sandhu"],
  ["Ammy Virk",          "ammy virk"],
  ["Prabh Gill",         "prabh gill"],
  ["Jassie Gill",        "jassie gill"],
  ["Sharry Maan",        "sharry maan"],
  ["Gippy Grewal",       "gippy grewal"],
  ["Sunanda Sharma",     "sunanda sharma"],
  ["Satinder Sartaaj",   "satinder sartaaj","satinder sartaj"],
  ["R Nait",             "r nait"],
  // ── Sufi / Qawwali ────────────────────────────────
  ["Nusrat Fateh Ali Khan","nusrat fateh ali khan","nusrat"],
  ["Rahat Fateh Ali Khan", "rahat fateh ali khan","rahat"],
  ["Abida Parveen",      "abida parveen"],
  ["Kaifi Khalil",       "kaifi khalil"],
  ["Rabbi Shergill",     "rabbi shergill","rabbi"],
  // ── Tamil / South ─────────────────────────────────
  ["Sid Sriram",         "sid sriram"],
  ["Anirudh Ravichander","anirudh ravichander","anirudh"],
  ["Yuvan Shankar Raja", "yuvan shankar raja","yuvan"],
  ["Harris Jayaraj",     "harris jayaraj","harris"],
  ["Devi Sri Prasad",    "devi sri prasad","dsp"],
  ["Shankar Mahadevan",  "shankar mahadevan"],
  ["S. P. Balasubrahmanyam","sp balasubrahmanyam","spb"],
  // ── International ─────────────────────────────────
  ["Drake",              "drake"],
  ["Eminem",             "eminem"],
  ["Kanye West",         "kanye west","ye"],
  ["Kendrick Lamar",     "kendrick lamar"],
  ["Travis Scott",       "travis scott"],
  ["Post Malone",        "post malone"],
  ["The Weeknd",         "the weeknd"],
  ["Billie Eilish",      "billie eilish"],
  ["Taylor Swift",       "taylor swift"],
  ["Ed Sheeran",         "ed sheeran"],
  ["Dua Lipa",           "dua lipa"],
  ["Ariana Grande",      "ariana grande"],
  ["Bad Bunny",          "bad bunny"],
  ["Coldplay",           "coldplay"],
  ["Imagine Dragons",    "imagine dragons"],
  ["Linkin Park",        "linkin park"],
  ["BTS",                "bts"],
  ["BLACKPINK",          "blackpink"],
];

// Flatten into alias→canonical map, sorted by alias length descending
const _mp2ArtistAliases = [];
_mp2ArtistDB.forEach(([canonical, ...aliases]) => {
  aliases.forEach(alias => _mp2ArtistAliases.push([alias, canonical]));
});
_mp2ArtistAliases.sort((a, b) => b[0].length - a[0].length);

function mp2DetectArtistInTitle(title) {
  if (!title) return null;
  // Remove feat./ft./prod.by so they don't block detection
  const clean = title.toLowerCase().replace(/\b(feat\.?|ft\.?|featuring|prod\.? by|×|x|vs\.?)\b/g, ' ');
  for (const [alias, canonical] of _mp2ArtistAliases) {
    // Word-boundary: alias surrounded by non-alphanumeric or string edge
    const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pat = new RegExp('(?<![a-z0-9])' + esc + '(?![a-z0-9])', 'i');
    if (pat.test(clean)) return canonical;
  }
  return null;
}

// ── TRACK EDITOR — thumbnail + title ─────────────────────────────────────────
function mp2OpenTrackEditor(filename) {
  const existing = document.getElementById('mp2TrackEditor');
  if (existing) existing.remove();

  const rawArtist = mp2GuessArtist(filename);
  const title     = mp2GuessTitle(filename);
  const ext       = filename.match(/\.[^.]+$/)?.[0] || '.mp3';
  const isNA      = /^(na|n\/a)$/i.test(rawArtist) || rawArtist === '';

  // Auto-detect artist from title if filename has NA/empty artist
  const detected  = isNA ? (mp2DetectArtistInTitle(title) || '') : rawArtist;

  const overlay = document.createElement('div');
  overlay.id = 'mp2TrackEditor';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:10000;display:flex;align-items:center;justify-content:center;';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  overlay.innerHTML = `
    <div style="background:var(--mp2-bg2);border-radius:16px;padding:28px;width:440px;max-width:95vw;max-height:90vh;overflow-y:auto;box-shadow:0 24px 60px rgba(0,0,0,.8);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <h3 style="margin:0;font-size:16px;color:var(--mp2-text);">✏️ Edit Track</h3>
        <button onclick="document.getElementById('mp2TrackEditor').remove()" style="background:none;border:none;color:var(--mp2-text3);cursor:pointer;font-size:20px;line-height:1;">×</button>
      </div>

      <!-- Thumbnail upload -->
      <div style="margin-bottom:18px;">
        <label style="font-size:12px;font-weight:600;color:var(--mp2-text2);letter-spacing:.5px;display:block;margin-bottom:8px;">ARTWORK</label>
        <div style="display:flex;align-items:flex-start;gap:14px;">
          <div id="mp2TeThumbPreview" onclick="document.getElementById('mp2TeThumbInput').click()" title="Click to change"
            style="width:80px;height:80px;flex-shrink:0;border-radius:10px;background:var(--mp2-surface2);overflow:hidden;cursor:pointer;border:2px dashed var(--mp2-border);display:flex;align-items:center;justify-content:center;position:relative;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--mp2-text3)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.5);font-size:9px;color:white;text-align:center;padding:2px;">Click to change</div>
          </div>
          <div style="font-size:12px;color:var(--mp2-text3);padding-top:4px;">
            Upload a JPG, PNG or WEBP image to use as album art for this track.<br><br>
            <span style="color:var(--mp2-accent2);font-size:11px;">Tip: Square images look best (e.g. 500×500 px)</span>
          </div>
        </div>
        <input type="file" id="mp2TeThumbInput" accept="image/*" style="display:none;" onchange="mp2TePreviewThumb(this)">
      </div>

      <!-- Title -->
      <div style="margin-bottom:12px;">
        <label style="font-size:12px;font-weight:600;color:var(--mp2-text2);letter-spacing:.5px;display:block;margin-bottom:6px;">TITLE</label>
        <input id="mp2TeTitle" type="text" value="${escapeHtml(title)}"
          style="width:100%;background:var(--mp2-surface2);border:1px solid var(--mp2-border);border-radius:8px;color:var(--mp2-text);padding:9px 12px;font-size:14px;outline:none;box-sizing:border-box;">
      </div>

      <!-- Artist -->
      <div style="margin-bottom:20px;">
        <label style="font-size:12px;font-weight:600;color:var(--mp2-text2);letter-spacing:.5px;display:block;margin-bottom:6px;">
          ARTIST
          ${detected && isNA ? `<span style="font-size:10px;background:rgba(124,58,237,0.25);color:var(--mp2-accent2);padding:1px 6px;border-radius:8px;margin-left:6px;">🔍 auto-detected</span>` : ''}
        </label>
        <input id="mp2TeArtist" type="text" value="${escapeHtml(detected)}" placeholder="Artist name (leave blank if unknown)"
          style="width:100%;background:var(--mp2-surface2);border:1px solid var(--mp2-border);border-radius:8px;color:var(--mp2-text);padding:9px 12px;font-size:14px;outline:none;box-sizing:border-box;">
        ${isNA && !detected ? `<div style="margin-top:6px;font-size:11px;color:var(--mp2-text3);">Artist not auto-detected — type it manually above.</div>` : ''}
      </div>

      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button onclick="document.getElementById('mp2TrackEditor').remove()"
          style="background:var(--mp2-surface2);border:1px solid var(--mp2-border);border-radius:8px;color:var(--mp2-text2);padding:9px 18px;cursor:pointer;font-size:13px;">Cancel</button>
        <button onclick="mp2TeSubmit('${escapeHtml(filename)}', '${ext}')"
          style="background:var(--mp2-accent);border:none;border-radius:8px;color:white;padding:9px 20px;cursor:pointer;font-size:13px;font-weight:600;">Save Changes</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  // Load existing thumbnail preview if available
  if (mp2TrackHasThumb(filename)) {
    const img = document.createElement('img');
    img.src = mp2ThumbUrl(filename);
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
    const prev = document.getElementById('mp2TeThumbPreview');
    if (prev) {
      prev.innerHTML = '';
      prev.appendChild(img);
      const badge = document.createElement('div');
      badge.style.cssText = 'position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.5);font-size:9px;color:white;text-align:center;padding:2px;';
      badge.textContent = 'Click to change';
      prev.appendChild(badge);
    }
  }
}

function mp2TePreviewThumb(input) {
  if (!input.files || !input.files[0]) return;
  const reader = new FileReader();
  reader.onload = e => {
    const prev = document.getElementById('mp2TeThumbPreview');
    if (prev) {
      prev.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
    }
  };
  reader.readAsDataURL(input.files[0]);
}

async function mp2TeSubmit(oldFilename, ext) {
  const newTitle  = document.getElementById('mp2TeTitle')?.value.trim() || '';
  const newArtist = document.getElementById('mp2TeArtist')?.value.trim() || '';
  const thumbFile = document.getElementById('mp2TeThumbInput')?.files[0];

  if (!newTitle) { showToast('Title cannot be empty', 'error'); return; }

  // Build new filename
  const newFilename = newArtist
    ? `${newArtist} - ${newTitle}${ext}`
    : `${newTitle}${ext}`;

  let anyChange = false;

  // 1. Rename if filename changed
  if (newFilename !== oldFilename) {
    try {
      const res = await fetch('/api/music/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ old_name: oldFilename, new_name: newFilename })
      });
      const d = await safeJson(res);
      if (!res.ok) throw new Error(d.error || 'Rename failed');
      anyChange = true;
    } catch (e) { showToast(e.message, 'error'); return; }
  }

  // 2. Upload thumbnail if provided
  if (thumbFile) {
    try {
      const fd = new FormData();
      fd.append('track_name', newFilename);
      fd.append('file', thumbFile);
      const res = await fetch('/api/music/cover', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: fd
      });
      const d = await safeJson(res);
      if (!res.ok) throw new Error(d.error || 'Thumbnail upload failed');
      // Clear art cache for old and new filenames
      delete mp2.artCache[oldFilename];
      delete mp2.artCache[newFilename];
      anyChange = true;
    } catch (e) { showToast(e.message, 'error'); return; }
  }

  if (anyChange) {
    showToast('Track updated ✓', 'success');
    document.getElementById('mp2TrackEditor')?.remove();
    await mp2AdminLoadFiles();
    await mp2LoadTracks();
    mp2RenderAll();
  } else {
    showToast('No changes to save');
    document.getElementById('mp2TrackEditor')?.remove();
  }
}

// ── SWIPE GESTURES ON CD MODAL ────────────────────────────────────────
(function() {
  let touchStartX = 0, touchStartY = 0;
  const modal = document.getElementById('mp2CDModal');
  if (!modal) return;

  modal.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  modal.addEventListener('touchend', (e) => {
    // Ignore if touch was on progress/volume bars
    if (e.target.closest('.mp2-progress, .mp2-vol, .mp2-cd-lyrics-panel')) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) < Math.abs(dy)) return; // Vertical swipe, ignore
    if (Math.abs(dx) < 50) return; // Too small
    if (dx < 0) { triggerHaptic(); mp2Next(); }   // Swipe left = next
    else { triggerHaptic(); mp2Prev(); }            // Swipe right = prev
  }, { passive: true });
})();

// ─────────────────────────────────────────────────────────────────────────────
//  ADMIN UTILITY FUNCTIONS  (Refresh Everything, Find Artist per-track & bulk)
// ─────────────────────────────────────────────────────────────────────────────

async function mp2RefreshEverything() {
  if (!_mp2IsAdmin) { showToast('Admin only', 'error'); return; }
  showToast('⚡ Refreshing everything…', 'info');
  try {
    // 1. Scan disk for new files
    await fetch('/api/music/scan', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    // 2. Reload prefs + tracks
    await mp2LoadPrefs();
    await mp2LoadTracks();
    // 3. Refresh admin file list if panel is open
    const panel = document.getElementById('mp2AdminPanel');
    if (panel && panel.style.display !== 'none') await mp2AdminLoadFiles();
    // 4. Re-render
    mp2RenderAll();
    // 5. Refresh artist images in background (non-blocking)
    mp2EnrichArtists();
    showToast('⚡ Everything refreshed!', 'success');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
}

// ── FIND ARTIST FOR A SINGLE TRACK  (works on any track, not just NA) ────────
async function mp2AdminFindArtistForTrack(filename) {
  const ext          = (filename.match(/\.[^.]+$/) || [''])[0];
  const stem         = filename.replace(/\.[^.]+$/, '');
  // If "Artist - Title" format, search the title part; otherwise search whole stem
  const titlePart    = stem.includes(' - ') ? stem.split(' - ').slice(1).join(' - ').trim() : stem;
  const currentArtist = stem.includes(' - ') ? stem.split(' - ')[0].trim() : '';

  // Clean search title
  const cleanTitle = titlePart
    .replace(/\s*[\(\[].*?[\)\]]/gi, '')
    .replace(/\s*(official|video|audio|lyrics|hd|4k|mv|music|full\s*song|ft\.?|feat\.?).*$/gi, '')
    .trim() || titlePart;

  showToast(`🔎 Looking up artist for "${cleanTitle}"…`, 'info');

  // 1. Try local artist database first (instant)
  const localArtist = typeof mp2DetectArtistInTitle === 'function'
    ? (mp2DetectArtistInTitle(titlePart) || mp2DetectArtistInTitle(stem) || null)
    : null;

  // 2. Ask backend detect_artist (also uses the server-side DB + title scan)
  let serverArtist = null;
  try {
    const r = await fetch('/api/music/detect_artist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ title: cleanTitle })
    });
    const d = await safeJson(r);
    serverArtist = d.artist || null;
  } catch {}

  const detected = localArtist || serverArtist;

  let chosenArtist;
  if (detected) {
    const choice = await mp2PromptChoose({
      icon: '🎤',
      title: 'Artist detected',
      msg: `<b style="color:#f1f0ff">${escapeHtml(detected)}</b><br><span style="opacity:.6;font-size:12px;">for "${escapeHtml(titlePart)}"</span>`,
      okLabel: `Use "${escapeHtml(detected)}"`,
      manualLabel: 'Enter manually',
      cancelLabel: 'Skip'
    });
    if (choice === null) { showToast('Skipped', 'info'); return; }
    if (choice === 'ok') {
      chosenArtist = detected;
    } else {
      chosenArtist = await mp2Prompt({ icon: '✏️', title: 'Enter artist name', msg: `Track: <span style="opacity:.7">"${escapeHtml(titlePart)}"</span>`, placeholder: 'Artist name…', defaultValue: detected, okLabel: 'Rename' });
    }
  } else {
    chosenArtist = await mp2Prompt({
      icon: '🔍',
      title: 'No artist found',
      msg: `Could not auto-detect an artist for:<br><span style="opacity:.7">"${escapeHtml(cleanTitle)}"</span>`,
      placeholder: 'Artist name (or cancel to skip)…',
      defaultValue: currentArtist || '',
      okLabel: 'Rename'
    });
  }

  if (!chosenArtist || !chosenArtist.trim()) { showToast('Skipped', 'info'); return; }
  chosenArtist = chosenArtist.trim();

  const newName = `${chosenArtist} - ${titlePart}${ext}`;
  if (newName === filename) { showToast('No change needed', 'info'); return; }

  try {
    const res = await fetch('/api/music/admin/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ old_name: filename, new_name: newName })
    });
    const d = await safeJson(res);
    if (!res.ok) { showToast(d.error || 'Rename failed', 'error'); return; }
    showToast(`✅ Renamed to: ${d.new_name || newName}`, 'success');
    await mp2AdminLoadFiles();
    await mp2LoadTracks();
    mp2RenderAll();
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
}

// ── FIND ALL ARTISTS (bulk MusicBrainz — works on any track) ─────────────────
async function mp2AdminFindAllArtists() {
  if (!_mp2IsAdmin) { showToast('Admin only', 'error'); return; }

  const scope = await mp2PromptChoose({
    icon: '🔎',
    title: 'Find Artists via MusicBrainz',
    msg: 'Which tracks should be searched?',
    okLabel: 'All tracks',
    manualLabel: 'Only tracks missing an artist',
    cancelLabel: 'Cancel'
  });
  if (scope === null) return;
  const all = (scope === 'ok');

  const defaultArtist = await mp2Prompt({
    icon: '🎤',
    title: 'Fallback artist name',
    msg: 'For any track where no artist is found. Leave blank to skip unresolved tracks.',
    placeholder: 'e.g. Unknown Artist',
    okLabel: 'Start search'
  });
  if (defaultArtist === null) return;

  showToast('🔎 Running artist search… this may take a while', 'info');

  try {
    const res = await fetch('/api/music/admin/fix_artist_names', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ default_artist: defaultArtist.trim(), scan_all: all })
    });
    const d = await safeJson(res);
    if (!res.ok) throw new Error(d.error || 'Failed');
    const errCount = d.errors?.length || 0;
    showToast(`✅ Renamed ${d.count} track(s)${errCount ? `. ${errCount} skipped.` : '.'}`, 'success');
    await mp2AdminLoadFiles();
    await mp2LoadTracks();
    mp2RenderAll();
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
}
