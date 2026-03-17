/* ═══════════════════════════════════════════════════════════════════
   MUSIC PLAYER v4 — JS Patch
   Load AFTER music-v3-patch.js
   - Theme switcher (Midnight / AMOLED / Pearl / Linen) in sidebar
   - Generic fallback art when no thumbnail
   - NO MutationObserver (that caused an infinite loop freezing the UI)
     Instead wraps window.enterMusicMode safely.
═══════════════════════════════════════════════════════════════════ */

var MP2_THEMES = {
  midnight: { label:'Midnight', dark:true,  emoji:'🌙', vars:{ '--mp2-bg':'#0f0f14','--mp2-bg2':'#16161e','--mp2-bg3':'#1e1e2a','--mp2-surface':'#1e1e2a','--mp2-surface2':'#252535','--mp2-border':'#2a2a38','--mp2-accent':'#7c3aed','--mp2-accent2':'#a78bfa','--mp2-text':'#f1f0ff','--mp2-text2':'#c4c0e8','--mp2-text3':'#a8a5c4','--mp2-text4':'#5f5c7a' }},
  amoled:   { label:'AMOLED',   dark:true,  emoji:'⚫', vars:{ '--mp2-bg':'#000000','--mp2-bg2':'#080808','--mp2-bg3':'#111111','--mp2-surface':'#111111','--mp2-surface2':'#181818','--mp2-border':'#222222','--mp2-accent':'#e040fb','--mp2-accent2':'#ce93d8','--mp2-text':'#ffffff','--mp2-text2':'#dddddd','--mp2-text3':'#aaaaaa','--mp2-text4':'#555555' }},
  pearl:    { label:'Pearl',    dark:false, emoji:'🤍', vars:{ '--mp2-bg':'#f5f4fb','--mp2-bg2':'#ffffff','--mp2-bg3':'#ededf6','--mp2-surface':'#ededf6','--mp2-surface2':'#e2e0f5','--mp2-border':'#d0cef0','--mp2-accent':'#6d28d9','--mp2-accent2':'#8b5cf6','--mp2-text':'#1a1730','--mp2-text2':'#2e2a55','--mp2-text3':'#4a4670','--mp2-text4':'#9390b8' }},
  linen:    { label:'Linen',    dark:false, emoji:'🌸', vars:{ '--mp2-bg':'#faf7f2','--mp2-bg2':'#ffffff','--mp2-bg3':'#f0ebe2','--mp2-surface':'#f0ebe2','--mp2-surface2':'#e8e0d5','--mp2-border':'#ddd5c8','--mp2-accent':'#b45309','--mp2-accent2':'#d97706','--mp2-text':'#1c1410','--mp2-text2':'#3b2f22','--mp2-text3':'#6b5443','--mp2-text4':'#b09a87' }}
};

function mp2v4GetTheme() { return localStorage.getItem('mp2-theme') || 'midnight'; }

window.mp2ApplyTheme = function(key) {
  var t = MP2_THEMES[key]; if (!t) return;
  var ov = document.getElementById('musicOverlay'); if (!ov) return;
  for (var k in t.vars) ov.style.setProperty(k, t.vars[k]);
  ov.setAttribute('data-mp2-dark', t.dark ? '1' : '0');
  localStorage.setItem('mp2-theme', key);
  document.querySelectorAll('.mp2v4-chip').forEach(function(c){
    c.classList.toggle('active', c.getAttribute('data-theme') === key);
  });
};

function mp2v4InjectPicker() {
  if (document.getElementById('mp2v4Picker')) return;
  var nav = document.getElementById('mp2Nav'); if (!nav) return;
  var saved = mp2v4GetTheme();
  var chips = '';
  Object.keys(MP2_THEMES).forEach(function(key) {
    var t = MP2_THEMES[key];
    chips += '<button class="mp2v4-chip'+(saved===key?' active':'')+'" data-theme="'+key+'" onclick="mp2ApplyTheme(\''+key+'\')"><span class="mp2v4-dot" data-theme="'+key+'"></span>'+t.emoji+' '+t.label+'</button>';
  });
  var wrap = document.createElement('div');
  wrap.id = 'mp2v4Picker';
  wrap.innerHTML = '<div class="mp2-nav-section-title" style="margin-top:8px">Theme</div><div class="mp2v4-grid">'+chips+'</div>';
  var btn = nav.querySelector('.mp2-nav-add-pl');
  btn ? nav.insertBefore(wrap, btn) : nav.appendChild(wrap);
}

/* Generic art fallback */
window.MP2_GENERIC_ART = 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#2a1f4e"/><stop offset="100%" stop-color="#120b28"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)" rx="12"/><path d="M72 140L72 72L145 60L145 128" stroke="#a78bfa" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="60" cy="140" r="20" fill="#7c3aed"/><circle cx="60" cy="140" r="9" fill="#c4b5fd"/><circle cx="133" cy="128" r="20" fill="#7c3aed"/><circle cx="133" cy="128" r="9" fill="#c4b5fd"/></svg>');
(function(){ var o=window.mp2GetArt; if(typeof o!=='function') return; window.mp2GetArt=async function(n){ return (await o(n))||window.MP2_GENERIC_ART; }; })();

/* Hook enterMusicMode — NO MutationObserver, no infinite loop */
(function(){
  var _orig = window.enterMusicMode;
  window.enterMusicMode = function() {
    if (typeof _orig === 'function') _orig.apply(this, arguments);
    mp2ApplyTheme(mp2v4GetTheme());
    var tries = 0;
    (function tryP(){ mp2v4InjectPicker(); if (!document.getElementById('mp2v4Picker') && tries++<20) setTimeout(tryP,150); })();
  };
})();

console.log('[v4] loaded — enterMusicMode hook, no observer');
