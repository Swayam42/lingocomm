// ── Cursor ──────────────────────────────────────────────────────────
const cursor = document.getElementById('cursor');
document.addEventListener('mousemove', (e) => {
  cursor.style.left = e.clientX + 'px';
  cursor.style.top = e.clientY + 'px';
});

// ── Dot cluster ─────────────────────────────────────────────────────
const dc = document.getElementById('dotCluster');
for (let i = 0; i < 60; i++) {
  const s = document.createElement('span');
  s.style.animationDelay = (Math.random() * 3) + 's';
  dc.appendChild(s);
}

// ── Ticker ──────────────────────────────────────────────────────────
const tickerMessages = [
  { user:'@rahul', lang:'hi', msg:'यह बग कल से है, कोई solution है?' },
  { user:'@tanaka', lang:'ja', msg:'このバグは昨日からあります' },
  { user:'@carlos', lang:'pt', msg:'Alguém sabe como resolver esse problema?' },
  { user:'@hans', lang:'de', msg:'Hat jemand eine Lösung für diesen Bug?' },
  { user:'@minjun', lang:'ko', msg:'이 버그 어제부터 있었어요, 해결책 있나요?' },
  { user:'@omar', lang:'ar', msg:'هل يعرف أحد كيفية حل هذه المشكلة؟' },
  { user:'@claire', lang:'fr', msg:'Quelqu\'un a une solution pour ce bug?' },
  { user:'@alexei', lang:'ru', msg:'Кто-нибудь знает, как это исправить?' },
];

const ticker = document.getElementById('ticker');
const allMsgs = [...tickerMessages, ...tickerMessages]; // duplicate for seamless loop
allMsgs.forEach(m => {
  const el = document.createElement('div');
  el.className = 'ticker-item';
  el.innerHTML = `<span class="msg">${m.user}</span><span class="sep">·</span><span>${m.msg}</span>`;
  ticker.appendChild(el);
});

// ── Stats loading ───────────────────────────────────────────────────
async function loadStats() {
  try {
    // Try relative path first (same origin), works in both local and production
    const statsRes = await fetch('/api/stats');
    if (statsRes.ok) {
      const stats = await statsRes.json();
      // Stats counters
      animateCount('stat-translations', stats.totalTranslations || 0);
      animateCount('stat-users', stats.totalUsers || 0);
      animateCount('stat-groups', stats.totalGroups || 0);
      console.log('📊 Stats loaded:', stats);
    }
  } catch (e) {
    // API not running — silent fail
    console.log('⚠️ Stats API not available:', e.message);
  }
}

function animateCount(id, target) {
  const el = document.getElementById(id);
  if (!el || target === 0) { if (el) el.textContent = '0'; return; }
  let current = 0;
  const step = Math.ceil(target / 30);
  const timer = setInterval(() => {
    current = Math.min(current + step, target);
    el.textContent = current.toLocaleString();
    if (current >= target) clearInterval(timer);
  }, 30);
}

loadStats();
setInterval(loadStats, 30000); // Refresh every 30 seconds