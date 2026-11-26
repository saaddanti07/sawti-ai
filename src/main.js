import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Keyboard } from '@capacitor/keyboard';
import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { SAWTI_API_BASE_URL } from './config.js';

const isNativeStatic = Capacitor.isNativePlatform();
function isNativePlatform() {
  try {
    return Capacitor.isNativePlatform();
  } catch (_) {
    return isNativeStatic;
  }
}
const isNative = isNativeStatic; // keep for backward compat where used synchronously, but prefer isNativePlatform() at call time

// Native Download helper — MediaStore/Downloads for Android 10+ (no permission), legacy for older
const NabraDownload = Capacitor.registerPlugin('NabraDownload');
let isSaving = false;
function generateDownloadFileName() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  return `NABRA_AI_${y}${m}${d}_${hh}${mm}${ss}.mp3`;
}

// ---------------------------------------------------------------------------
// Theme — dark / light with localStorage + system preference
// ---------------------------------------------------------------------------
function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('nabra-theme', t); } catch (_) {}
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'light' ? '#F5F6FC' : '#080D1B');
  // Update toggle icons is handled via CSS [data-theme] selectors
  // Update settings switcher active state
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-theme') === t);
  });
  // Update StatusBar for native
  if (isNativePlatform()) {
    try {
      const bg = t === 'light' ? '#F5F6FC' : '#080D1B';
      StatusBar.setBackgroundColor({ color: bg });
      StatusBar.setStyle({ style: t === 'light' ? Style.Light : Style.Dark });
    } catch (_) {}
  }
  console.log('[NABRA] theme', t);
}
function initTheme() {
  // Already set via inline script, but ensure switcher reflects
  const saved = (() => { try { return localStorage.getItem('nabra-theme'); } catch { return null; } })();
  const systemLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  const initial = saved || (systemLight ? 'light' : 'dark');
  applyTheme(initial);
  // Listen to system changes only if user hasn't chosen
  try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
      try {
        if (!localStorage.getItem('nabra-theme')) applyTheme(e.matches ? 'light' : 'dark');
      } catch (_) {}
    });
  } catch (_) {}
}
// Init early
initTheme();

// ---------------------------------------------------------------------------
// Premium Splash Screen — animated startup experience
// ---------------------------------------------------------------------------
// Visible immediately via HTML; hides native splash quickly to reveal in-app splash,
// then keeps in-app splash for a premium minimum duration regardless of backend.
const splashEl = document.getElementById('splash');
const SPLASH_MIN_MS = 1700;   // premium feel, lightweight
const SPLASH_MAX_MS = 3200;   // safety: never block app if Render sleeping
let splashStart = Date.now();
let splashHidden = false;
let splashTimers = [];

function hideSplash(reason = 'ready') {
  if (splashHidden || !splashEl) return;
  splashHidden = true;
  try { console.log('[NABRA] splash hide', reason); } catch {}
  try { splashEl.classList.add('hidden'); } catch {}
  try { splashEl.setAttribute('aria-hidden', 'true'); } catch {}
  // Clean up animation resources after CSS transition (0.48s)
  const t = setTimeout(() => {
    try { splashEl.style.display = 'none'; } catch {}
    // remove glow animations to free GPU
    try { splashEl.querySelectorAll('*').forEach(n => { n.style.animation = 'none'; }); } catch {}
    splashTimers.forEach(clearTimeout);
    splashTimers = [];
  }, 600);
  splashTimers.push(t);
  // Ensure native splash also hidden
  try { SplashScreen.hide(); } catch {}
}

function scheduleSplashHide(reason = 'ready') {
  if (splashHidden) return;
  const elapsed = Date.now() - splashStart;
  const remainMin = Math.max(0, SPLASH_MIN_MS - elapsed);
  const t = setTimeout(() => hideSplash(reason), remainMin);
  splashTimers.push(t);
  // Hard max timeout — hide regardless even if called late
  const remainMax = Math.max(0, SPLASH_MAX_MS - elapsed);
  const t2 = setTimeout(() => hideSplash('max-timeout'), remainMax);
  splashTimers.push(t2);
}

function initSplash() {
  splashStart = Date.now();
  // Hide native Capacitor splash quickly to reveal branded in-app splash (avoids white flash behind).
  // If launchAutoHide is false, native stays until we call hide().
  const hideNative = () => { try { SplashScreen.hide(); } catch {} };
  if (isNativePlatform()) {
    // slight delay ensures webview rendered behind native before hide → no white flash
    const tn = setTimeout(hideNative, 120);
    splashTimers.push(tn);
  } else {
    // web: ensure native hide not needed, just ensure splash visible
    try { SplashScreen.hide(); } catch {}
  }
  // Always schedule branded splash hide after premium minimum, independent of voices fetch
  scheduleSplashHide('init');
}

initSplash();


// ---------------------------------------------------------------------------
// API base URL — centralized single source of truth
// ---------------------------------------------------------------------------
// SAWTI_API_BASE_URL in src/config.js is the single configurable value:
//   https://sawti-ai.onrender.com
// Android WebView (capacitor:// or https://localhost) MUST use absolute URLs
// because relative paths resolve to the local WebView (https://localhost/api/... → 404).
// The production website at https://sawti-ai.onrender.com uses same-origin
// relative paths (or absolute to same host) — both work. We detect native
// at call time (not only import time) for robustness if the bridge loads late.
const API_BASE_CANONICAL = SAWTI_API_BASE_URL.replace(/\/+$/, '');

function getApiBase() {
  // Re-evaluate native status at call time for robustness (bridge may load late).
  let native = isNativePlatform();
  // Fallback: WebView with localhost/capacitor origin is definitely native
  if (!native) {
    try {
      const origin = window.location.origin || '';
      const href = window.location.href || '';
      if (
        origin.includes('capacitor://') ||
        origin.includes('ionic://') ||
        (origin.includes('localhost') && window.Capacitor) ||
        href.includes('capacitor://')
      ) {
        native = true;
      }
    } catch (_) {}
  }
  // Centralized decision: native → absolute production URL, web → relative (same-origin)
  // Both paths are derived from the single SAWTI_API_BASE_URL constant.
  return native ? API_BASE_CANONICAL : '';
}

function isApiConfigured() {
  // On web, relative paths are always considered configured.
  // On native, verify the absolute URL is a valid https://*.onrender.com.
  const base = getApiBase();
  if (!base) return true; // web → relative, ok
  try {
    const u = new URL(base);
    return u.protocol === 'https:' && u.hostname.endsWith('.onrender.com') && (u.pathname === '/' || u.pathname === '');
  } catch {
    return false;
  }
}

function apiUrl(path) {
  const base = getApiBase();
  const full = `${base}${path}`;
  // Diagnostic log for Android WebView console (chrome://inspect)
  try {
    console.log(`[NABRA API] ${full} (platform=${Capacitor.getPlatform()} native=${Capacitor.isNativePlatform()} origin=${window.location.origin})`);
  } catch (_) {
    console.log(`[NABRA API] ${full}`);
  }
  return full;
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const textEl = document.getElementById('text');
const count = document.getElementById('count');
const voiceEl = document.getElementById('voice');
const voiceMeta = document.getElementById('voiceMeta');
const rate = document.getElementById('rate');
const pitch = document.getElementById('pitch');
const statusEl = document.getElementById('status');
const generate = document.getElementById('generate');
const clearBtn = document.getElementById('clear');
const result = document.getElementById('result');
const player = document.getElementById('player');
const saveBtn = document.getElementById('save');
const shareBtn = document.getElementById('share');
const offlineBanner = document.getElementById('offlineBanner');
const settingsBtn = document.getElementById('settingsBtn');

// Custom player elements
const playPauseBtn = document.getElementById('playPause');
const progressFill = document.getElementById('progressFill');
const seekBar = document.getElementById('seekBar');
const currentTimeEl = document.getElementById('currentTime');
const durationEl = document.getElementById('duration');
const waveformEl = document.getElementById('waveform');

const GENERATE_LABEL_HTML = '<span class="btn-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="white" stroke-width="2"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8Z"/></svg></span><span class="btn-label">إنشاء الصوت</span>';
const TTS_TIMEOUT_MS = 120000; // Render free tier may need time to wake up
const VOICES_TIMEOUT_MS = 30000;

let currentUrl = null; // object URL for <audio>
let currentBlob = null; // last generated MP3 blob
let nativeFileUri = null; // cached file:// URI written via Filesystem
let nativeFileName = 'nabra-ai.mp3';
let currentFileName = null; // last generated timestamped filename for display/download

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.className = isError ? 'status error' : 'status';
}

function setOffline(offline) {
  offlineBanner.classList.toggle('show', offline);
}

function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function updateVoiceMeta() {
  if (!voiceMeta || !voiceEl) return;
  const opt = voiceEl.options[voiceEl.selectedIndex];
  if (!opt) return;
  const text = opt.textContent.trim();
  const id = voiceEl.value; // ar-DZ-AminaNeural
  const eng = id.split('-').pop().replace('Neural','');
  const parts = text.split(' — ');
  if (parts.length >= 2) {
    const name = parts[0];
    const rest = parts[1]; // "جزائرية (أنثى)"
    const accent = rest.split(' (')[0];
    const gender = rest.includes('(') ? rest.split('(')[1].replace(')','') : '';
    voiceMeta.textContent = `${name} · ${accent} · ${gender}`;
  } else {
    voiceMeta.textContent = text;
  }
  // Premium avatar — color by gender, initial letter
  const avatar = document.getElementById('voiceAvatar');
  if (avatar) {
    const isFemale = voiceMeta.textContent.includes('أنثى');
    const bg = isFemale ? '#8B5CF6' : '#4F83FF';
    const name = parts[0] ? parts[0].trim().charAt(0) : 'A';
    avatar.style.background = bg;
    avatar.style.color = '#FFFFFF';
    const img = avatar.querySelector('img');
    if (img) {
      avatar.innerHTML = `<span style="font:700 14px Tahoma">${name}</span>`;
      avatar.style.display = 'inline-flex';
      avatar.style.alignItems = 'center';
      avatar.style.justifyContent = 'center';
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers — with diagnostics
// ---------------------------------------------------------------------------
function logApiDiagnostic(label, details) {
  try {
    console.log(`[NABRA][${label}]`, details);
  } catch (_) {}
  // Also log to remote if needed, but never expose secrets.
}

async function fetchWithTimeout(url, options = {}, timeoutMs = TTS_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const method = (options && options.method) || 'GET';
  logApiDiagnostic('fetch-start', { url, method, timeoutMs });
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    logApiDiagnostic('fetch-response', { url, method, status: resp.status, ok: resp.ok, contentType: resp.headers.get('content-type') });
    return resp;
  } catch (err) {
    logApiDiagnostic('fetch-error', { url, method, error: err && err.message, name: err && err.name, stack: err && err.stack && String(err.stack).slice(0, 600) });
    if (err && err.name === 'AbortError') {
      throw new Error('timeout');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function getHttpArabicMessage(status, detail) {
  if (detail && typeof detail === 'string' && detail.trim()) return detail;
  if (status === 400) return 'البيانات المدخلة غير صحيحة. تحقق من النص والصوت المختار ثم حاول مجدداً. (400)';
  if (status === 404) return 'خدمة الصوت غير متاحة مؤقتاً. حاول مجدداً بعد قليل. (404)';
  if (status === 429) return 'تم تجاوز الحد المسموح. انتظر قليلاً ثم حاول. (429)';
  if (status === 502 || status === 503 || status === 504) return 'الخادم مشغول حالياً أو يستيقظ من وضع النوم. انتظر 30 ثانية وحاول مجدداً. (5xx)';
  if (status >= 500) return `خطأ في الخادم. حاول مجدداً بعد قليل. (${status})`;
  if (status >= 400) return `تعذر إتمام الطلب. (${status})`;
  return 'حدث خطأ أثناء إنشاء الصوت.';
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function cleanupPreviousAudio() {
  player.pause();
  // reset custom player UI
  if (playPauseBtn) {
    playPauseBtn.querySelector('.icon-play').style.display = '';
    playPauseBtn.querySelector('.icon-pause').style.display = 'none';
  }
  if (waveformEl) waveformEl.classList.remove('playing');
  if (progressFill) progressFill.style.width = '0%';
  if (seekBar) seekBar.value = '0';
  if (currentTimeEl) currentTimeEl.textContent = '0:00';
  if (durationEl) durationEl.textContent = '0:00';
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
  if (isNativePlatform() && nativeFileUri) {
    try {
      await Filesystem.deleteFile({ path: nativeFileName, directory: Directory.Data });
    } catch (e) {
      // best-effort cleanup
    }
    nativeFileUri = null;
  }
  currentBlob = null;
}

// ---------------------------------------------------------------------------
// Voices — loaded from GET /api/voices (centralized absolute URL on Android)
// Uses apiUrl('/api/voices') which resolves to https://sawti-ai.onrender.com/api/voices on native.
// ---------------------------------------------------------------------------
async function loadVoices() {
  if (!isApiConfigured()) {
    const msg = 'تنبيه: لم يتم ضبط رابط الخادم بعد. افتح ملف src/config.js وضع رابط Render الفعلي في SAWTI_API_BASE_URL.';
    setStatus(msg);
    console.error('[NABRA] API not configured', { base: API_BASE_CANONICAL, origin: window.location.origin });
    return;
  }
  const url = apiUrl('/api/voices');
  try {
    const response = await fetchWithTimeout(url, { method: 'GET', headers: { 'Accept': 'application/json' } }, VOICES_TIMEOUT_MS);
    if (!response.ok) {
      let detail = '';
      try { const data = await response.json(); detail = data && data.detail; } catch (_) {}
      const msg = getHttpArabicMessage(response.status, detail);
      console.error('[NABRA] voices HTTP error', { url, status: response.status, detail });
      throw new Error(msg);
    }
    const voices = await response.json();
    if (Array.isArray(voices) && voices.length > 0) {
      const previous = voiceEl.value;
      voiceEl.innerHTML = '';
      for (const v of voices) {
        const option = document.createElement('option');
        option.value = v.id;
        option.textContent = `${v.name} — ${v.accent} (${v.gender})`;
        voiceEl.appendChild(option);
      }
      if (previous) voiceEl.value = previous;
      updateVoiceMeta();
      console.log('[NABRA] voices loaded', voices.length);
    }
  } catch (err) {
    // Keep the built-in voice list so the UI stays usable offline.
    // Diagnostics: distinguish network/CORS vs HTTP
    const isTimeout = err && err.message === 'timeout';
    const isTypeError = err instanceof TypeError;
    const urlInfo = url;
    if (isTimeout) {
      console.error('[NABRA] voices timeout', { url: urlInfo, error: err.message });
      setStatus('انتهت مهلة تحميل الأصوات. قد يكون الخادم يستيقظ — حاول مجدداً. يتم استخدام القائمة الافتراضية.');
    } else if (isTypeError) {
      // CORS or network failure on Android WebView
      console.error('[NABRA] voices network/CORS error', { url: urlInfo, error: String(err), name: err.name });
      setStatus('تعذر الاتصال بالخادم لتحميل الأصوات (قد يكون السبب الشبكة أو CORS). يتم استخدام القائمة الافتراضية — تحقق من الإنترنت.', true);
    } else {
      console.error('[NABRA] voices error', { url: urlInfo, error: err && err.message });
      // HTTP error message already Arabic
      const msg = (err && err.message && err.message.includes('(')) ? err.message : 'تعذر تحميل الأصوات من الخادم. يتم استخدام القائمة الافتراضية — تحقق من الاتصال.';
      setStatus(msg);
    }
  }
}

// ---------------------------------------------------------------------------
// Generate speech — POST /api/tts (uses centralized absolute URL on Android)
// Exact request: POST https://sawti-ai.onrender.com/api/tts
// Body: { text, voice, rate, pitch }  Headers: Content-Type application/json
// Response: audio/mpeg blob.
// ---------------------------------------------------------------------------
async function generateSpeech() {
  const text = textEl.value.trim();
  if (!text) {
    setStatus('اكتب النص الذي تريد تحويله أولاً.', true);
    textEl.focus();
    return;
  }
  if (!isApiConfigured()) {
    const msg = 'لم يتم ضبط رابط الخادم بعد. افتح ملف src/config.js وضع رابط Render الفعلي في SAWTI_API_BASE_URL ثم أعد بناء التطبيق.';
    setStatus(msg, true);
    console.error('[NABRA] API not configured', { base: API_BASE_CANONICAL, origin: window.location.origin });
    return;
  }
  if (navigator.onLine === false) {
    setStatus('لا يوجد اتصال بالإنترنت. يتطلب التحويل اتصالاً بالإنترنت — تحقق من الاتصال وحاول مجدداً.', true);
    return;
  }

  if (isNativePlatform()) {
    try { await Keyboard.hide(); } catch (e) { /* ignore */ }
  }

  generate.disabled = true;
  generate.innerHTML = '<span class="spinner"></span> جارٍ إنشاء الصوت...';
  setStatus('قد يستغرق التحويل بضع ثوانٍ حسب طول النص وسرعة الإنترنت. إذا كان الخادم نائماً فقد يستغرق أول طلب وقتاً أطول.');
  result.classList.remove('show');
  result.setAttribute('aria-hidden', 'true');
  await cleanupPreviousAudio();

  const url = apiUrl('/api/tts');
  const payload = {
    text,
    voice: voiceEl.value,
    rate: Number(rate.value),
    pitch: Number(pitch.value),
  };
  logApiDiagnostic('tts-request', { url, voice: payload.voice, textLength: payload.text.length, rate: payload.rate, pitch: payload.pitch });

  try {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'audio/mpeg, application/json' },
      body: JSON.stringify(payload),
    }, TTS_TIMEOUT_MS);

    if (!response.ok) {
      let detail = '';
      let status = response.status;
      const ct = response.headers.get('content-type') || '';
      try {
        if (ct.includes('application/json')) {
          const data = await response.json();
          detail = (data && data.detail) || '';
        } else {
          const txt = await response.text();
          detail = txt.slice(0, 400);
        }
      } catch (e) { /* ignore */ }
      console.error('[NABRA] tts HTTP error', { url, status, detail, contentType: ct });
      const msg = getHttpArabicMessage(status, detail);
      throw new Error(msg);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('audio')) {
      console.warn('[NABRA] tts unexpected content-type', { url, contentType });
    }
    const blob = await response.blob();
    if (!blob || blob.size === 0) {
      console.error('[NABRA] tts empty blob', { url, size: blob && blob.size, type: blob && blob.type });
      throw new Error('الخادم أعاد استجابة فارغة. حاول مجدداً.');
    }
    logApiDiagnostic('tts-blob', { url, size: blob.size, type: blob.type });
    currentBlob = blob;
    currentUrl = URL.createObjectURL(blob);
    player.src = currentUrl;
    // Handle audio playback errors explicitly
    player.onerror = (e) => {
      console.error('[NABRA] audio playback error', { url, error: e, code: player.error && player.error.code, message: player.error && player.error.message });
      setStatus('حدث خطأ أثناء تشغيل الصوت. حاول حفظ الملف وتشغيله ببرنامج خارجي.', true);
    };
    player.load();
    // Ensure home tab is visible so player is reachable without excessive scroll
    try { if (typeof switchTab === 'function') switchTab('home'); } catch (_) {}
    result.classList.add('show');
    result.setAttribute('aria-hidden', 'false');
    // Set displayed filename for premium result card
    currentFileName = generateDownloadFileName();
    const fileEl = document.getElementById('playerFileName');
    if (fileEl) fileEl.textContent = currentFileName;
    const badge = document.getElementById('playerBadge');
    if (badge) badge.textContent = `MP3 · ${(currentBlob.size/1024).toFixed(0)}KB`;
    setTimeout(() => result.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 120);
    setStatus('تم إنشاء الصوت بنجاح. استمع الآن أو احفظه أو شاركه.');
    try { await player.play(); } catch (e) {
      console.warn('[NABRA] autoplay blocked', e);
    }
  } catch (err) {
    const isTimeout = err && err.message === 'timeout';
    const isTypeError = err instanceof TypeError;
    const urlInfo = url;
    if (isTimeout) {
      console.error('[NABRA] tts timeout', { url: urlInfo, timeoutMs: TTS_TIMEOUT_MS });
      setStatus('انتهت مهلة الطلب. قد يكون الخادم يستيقظ من وضع النوم — انتظر 30 ثانية وحاول مجدداً.', true);
    } else if (isTypeError) {
      // Network failure or CORS block in WebView — the most common Android issue
      const msg = String(err && err.message || err);
      const isCorsHint = msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Load failed');
      console.error('[NABRA] tts network/CORS error', { url: urlInfo, error: msg, name: err.name, stack: err.stack && String(err.stack).slice(0, 800) });
      if (isCorsHint) {
        setStatus('تعذر الاتصال بالخادم (فشل الشبكة أو حجب CORS). تحقق من الإنترنت وأن الخادم يسمح بطلبات https://localhost. افتح chrome://inspect لمزيد التفاصيل.', true);
      } else {
        setStatus('تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت وحاول مجدداً.', true);
      }
    } else {
      // HTTP 400/500 already mapped to Arabic via getHttpArabicMessage
      console.error('[NABRA] tts error', { url: urlInfo, error: err && err.message });
      setStatus(err.message || 'تعذر الاتصال بالخادم. حاول مرة أخرى.', true);
    }
  } finally {
    generate.disabled = false;
    generate.innerHTML = GENERATE_LABEL_HTML;
  }
}

// ---------------------------------------------------------------------------
// Save / Share MP3 via native Filesystem + Share
// ---------------------------------------------------------------------------
async function ensureNativeFile() {
  if (!currentBlob) return null;
  if (nativeFileUri) return nativeFileUri;
  const base64 = await blobToBase64(currentBlob);
  const written = await Filesystem.writeFile({
    path: nativeFileName,
    data: base64,
    directory: Directory.Data,
  });
  nativeFileUri = written.uri;
  return nativeFileUri;
}

async function saveMp3() {
  if (isSaving) {
    console.log('[NABRA] download already in progress, ignoring duplicate tap');
    return;
  }
  if (!currentBlob) {
    setStatus('لا يوجد صوت لحفظه بعد. حوّل النص إلى صوت أولاً.', true);
    return;
  }
  // Validate that blob is actual audio, not JSON/HTML error
  if (currentBlob.size === 0) {
    console.error('[NABRA] saveMp3 empty blob', { size: currentBlob.size, type: currentBlob.type });
    setStatus('الملف الصوتي فارغ. حاول توليد الصوت مرة أخرى.', true);
    return;
  }
  if (currentBlob.type && !currentBlob.type.includes('audio') && currentBlob.type.includes('json')) {
    console.error('[NABRA] saveMp3 wrong mime', { type: currentBlob.type, size: currentBlob.size });
    setStatus('الملف ليس صوتاً صالحاً. حاول توليد الصوت مرة أخرى.', true);
    return;
  }
  // WebView Blob URLs may have type '' — allow if size > 1KB
  if (currentBlob.size < 1024) {
    console.warn('[NABRA] saveMp3 small file, may be error', { size: currentBlob.size, type: currentBlob.type });
  }

  isSaving = true;
  const originalBtnHTML = saveBtn.innerHTML;
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> جاري الحفظ...';
  // Also disable generate to avoid race? Keep generate enabled

  try {
    if (isNativePlatform()) {
      // Native Android: save directly to public Downloads via MediaStore — reuse displayed filename if exists
      const fileName = currentFileName || generateDownloadFileName();
      if (!currentFileName) currentFileName = fileName;
      console.log('[NABRA] saveMp3 native start', { fileName, blobSize: currentBlob.size, blobType: currentBlob.type });
      const base64 = await blobToBase64(currentBlob);
      // Verify base64 decodes to reasonable size
      if (!base64 || base64.length < 100) {
        throw new Error('Base64 conversion failed or file too small');
      }
      try {
        const result = await NabraDownload.saveToDownloads({
          data: base64,
          fileName: fileName,
          mimeType: 'audio/mpeg'
        });
        console.log('[NABRA] saveToDownloads success', result);
        setStatus('تم حفظ الملف الصوتي في مجلد التنزيلات', false);
      } catch (nativeErr) {
        console.error('[NABRA] NabraDownload.saveToDownloads failed', {
          error: nativeErr && nativeErr.message,
          code: nativeErr && nativeErr.code,
          stack: nativeErr && nativeErr.stack && String(nativeErr.stack).slice(0, 800)
        });
        // Fallback 1: try Filesystem ExternalStorage/Download (legacy)
        // Fallback 2: try Documents (app-scoped but visible on Android 11+)
        let savedViaFallback = false;
        let fallbackError = null;
        const fallbackFileName = fileName;
        // Try ExternalStorage Download first (Android 9 and below, or if plugin misconfigured)
        try {
          console.log('[NABRA] saveMp3 fallback ExternalStorage Download', fallbackFileName);
          const w = await Filesystem.writeFile({
            path: `Download/${fallbackFileName}`,
            data: base64,
            directory: Directory.ExternalStorage
          });
          console.log('[NABRA] fallback ExternalStorage success', w);
          savedViaFallback = true;
          setStatus('تم حفظ الملف الصوتي في مجلد التنزيلات', false);
        } catch (e1) {
          fallbackError = e1;
          console.warn('[NABRA] fallback ExternalStorage failed', e1 && e1.message);
          // Fallback 2: Documents (always writable, files appear in Documents)
          try {
            console.log('[NABRA] saveMp3 fallback Documents', fallbackFileName);
            const w2 = await Filesystem.writeFile({
              path: fallbackFileName,
              data: base64,
              directory: Directory.Documents
            });
            console.log('[NABRA] fallback Documents success', w2);
            savedViaFallback = true;
            setStatus('تم حفظ الملف الصوتي في مجلد المستندات', false);
          } catch (e2) {
            console.error('[NABRA] fallback Documents failed', e2 && e2.message);
            fallbackError = e2;
          }
        }
        if (!savedViaFallback) {
          const tech = (nativeErr && nativeErr.message) || (fallbackError && fallbackError.message) || 'unknown';
          throw new Error('فشل الحفظ في التنزيلات: ' + tech);
        }
      }
    } else {
      // Web fallback: anchor download with proper filename
      if (!currentUrl) {
        // Recreate URL if missing
        currentUrl = URL.createObjectURL(currentBlob);
        player.src = currentUrl;
      }
      const fileName = currentFileName || generateDownloadFileName();
      if (!currentFileName) currentFileName = fileName;
      console.log('[NABRA] saveMp3 web download', { fileName, size: currentBlob.size });
      const a = document.createElement('a');
      a.href = currentUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus('بدأ تنزيل ملف MP3.', false);
    }
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    console.error('[NABRA] saveMp3 error', { error: msg, stack: err && err.stack && String(err.stack).slice(0, 800) });
    if (msg.toLowerCase().includes('cancel')) {
      setStatus('تم إلغاء الحفظ.');
    } else if (msg.includes('تم حفظ')) {
      setStatus(msg, true);
    } else {
      // Keep user-friendly Arabic, log technical details
      setStatus('تعذر حفظ الملف. تحقق من المساحة وحاول مرة أخرى. (' + msg.slice(0, 120) + ')', true);
    }
  } finally {
    isSaving = false;
    saveBtn.disabled = false;
    saveBtn.innerHTML = originalBtnHTML;
  }
}

async function shareMp3() {
  if (!currentBlob) {
    setStatus('لا يوجد صوت لمشاركته بعد. حوّل النص إلى صوت أولاً.', true);
    return;
  }
  if (isNativePlatform()) {
    try {
      const uri = await ensureNativeFile();
      await Share.share({
        title: 'NABRA AI',
        text: 'استمع إلى هذا الصوت من NABRA AI — نَبْرَة AI',
        url: uri,
        dialogTitle: 'مشاركة MP3',
      });
    } catch (err) {
      if (err && (err.message || '').toLowerCase().includes('cancel')) {
        setStatus('تم إلغاء المشاركة.');
      } else {
        setStatus('تعذر مشاركة الملف. حاول مرة أخرى.', true);
      }
    }
  } else if (navigator.share) {
    try {
      const file = new File([currentBlob], 'nabra-ai.mp3', { type: 'audio/mpeg' });
      await navigator.share({ title: 'NABRA AI', files: [file] });
    } catch (err) {
      if (err && err.name !== 'AbortError') {
        setStatus('تعذر مشاركة الملف. يمكنك تنزيله بدلاً من ذلك.', true);
      }
    }
  } else {
    setStatus('المشاركة المباشرة غير مدعومة في هذا المتصفح. يمكنك تنزيل ملف MP3 بدلاً من ذلك.', true);
  }
}

// ---------------------------------------------------------------------------
// Custom audio player logic
// ---------------------------------------------------------------------------
function setupCustomPlayer() {
  if (!player || !playPauseBtn) return;

  function updatePlayState(isPlaying) {
    const playIcon = playPauseBtn.querySelector('.icon-play');
    const pauseIcon = playPauseBtn.querySelector('.icon-pause');
    if (isPlaying) {
      playIcon.style.display = 'none';
      pauseIcon.style.display = '';
      if (waveformEl) waveformEl.classList.add('playing');
      playPauseBtn.setAttribute('aria-label', 'إيقاف مؤقت');
    } else {
      playIcon.style.display = '';
      pauseIcon.style.display = 'none';
      if (waveformEl) waveformEl.classList.remove('playing');
      playPauseBtn.setAttribute('aria-label', 'تشغيل');
    }
  }

  playPauseBtn.addEventListener('click', async () => {
    if (!player.src) return;
    if (player.paused) {
      try { await player.play(); } catch (e) { setStatus('تعذر التشغيل. حاول مرة أخرى.', true); }
    } else {
      player.pause();
    }
  });

  player.addEventListener('play', () => updatePlayState(true));
  player.addEventListener('pause', () => updatePlayState(false));
  player.addEventListener('ended', () => {
    updatePlayState(false);
    if (progressFill) progressFill.style.width = '0%';
    if (seekBar) seekBar.value = '0';
    if (currentTimeEl) currentTimeEl.textContent = formatTime(0);
  });

  player.addEventListener('loadedmetadata', () => {
    if (durationEl) durationEl.textContent = formatTime(player.duration);
    if (seekBar) seekBar.max = String(Math.floor(player.duration * 10) / 10 || 100);
  });

  player.addEventListener('timeupdate', () => {
    const current = player.currentTime;
    const duration = player.duration || 0;
    const pct = duration ? (current / duration) * 100 : 0;
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (seekBar && !seekBar.matches(':active')) {
      seekBar.value = String(current);
      seekBar.max = String(duration || 100);
    }
    if (currentTimeEl) currentTimeEl.textContent = formatTime(current);
    if (durationEl && isFinite(duration)) durationEl.textContent = formatTime(duration);
  });

  if (seekBar) {
    seekBar.addEventListener('input', () => {
      const val = parseFloat(seekBar.value);
      if (isFinite(val)) {
        player.currentTime = val;
        const pct = player.duration ? (val / player.duration) * 100 : 0;
        if (progressFill) progressFill.style.width = `${pct}%`;
        if (currentTimeEl) currentTimeEl.textContent = formatTime(val);
      }
    });
  }

  // Also allow tapping progress track
  const progressTrack = document.getElementById('progressTrack');
  if (progressTrack) {
    progressTrack.addEventListener('click', (e) => {
      const rect = progressTrack.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = x / rect.width;
      const duration = player.duration;
      if (isFinite(duration) && duration > 0) {
        player.currentTime = pct * duration;
      }
    });
  }
}

// ---------------------------------------------------------------------------
// UI events — premium native behavior
// ---------------------------------------------------------------------------
textEl.addEventListener('input', () => {
  count.textContent = `${textEl.value.length} / 5000`;
});
function updateSettingsHint() {
  const hint = document.getElementById('settingsHint');
  if (hint) hint.textContent = `السرعة ${rate.value}% · الحدة ${pitch.value}`;
}
rate.addEventListener('input', () => {
  document.getElementById('rateVal').textContent = `${rate.value}%`;
  updateSettingsHint();
});
pitch.addEventListener('input', () => {
  document.getElementById('pitchVal').textContent = pitch.value;
  updateSettingsHint();
});
voiceEl.addEventListener('change', updateVoiceMeta);

if (clearBtn) {
  clearBtn.addEventListener('click', async () => {
    textEl.value = '';
    count.textContent = '0 / 5000';
    setStatus('');
    result.classList.remove('show');
    result.setAttribute('aria-hidden', 'true');
    await cleanupPreviousAudio();
    textEl.focus();
  });
}

// Collapsible settings card
const settingsToggle = document.getElementById('settingsToggle');
const settingsPanel = document.getElementById('settingsPanel');
if (settingsToggle && settingsPanel) {
  settingsToggle.addEventListener('click', () => {
    const expanded = settingsToggle.getAttribute('aria-expanded') === 'true';
    const next = !expanded;
    settingsToggle.setAttribute('aria-expanded', String(next));
    if (next) {
      settingsPanel.hidden = false;
      settingsPanel.style.opacity = '0';
      settingsPanel.style.transform = 'translateY(-4px)';
      requestAnimationFrame(() => {
        settingsPanel.style.opacity = '1';
        settingsPanel.style.transform = 'translateY(0)';
      });
    } else {
      settingsPanel.style.opacity = '0';
      settingsPanel.style.transform = 'translateY(-4px)';
      setTimeout(() => { settingsPanel.hidden = true; }, 180);
    }
  });
}

// Bottom navigation — native app style (home / recordings / settings)
const navItems = document.querySelectorAll('.bottom-nav .nav-item');
const tabPanels = document.querySelectorAll('.tab-panel');
function switchTab(tabName) {
  navItems.forEach(btn => {
    const isActive = btn.getAttribute('data-nav') === tabName;
    btn.classList.toggle('active', isActive);
    if (isActive) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
  });
  tabPanels.forEach(panel => {
    const isTarget = panel.getAttribute('data-tab') === tabName;
    panel.hidden = !isTarget;
    if (isTarget) panel.classList.add('active'); else panel.classList.remove('active');
  });
  // Scroll to top when switching tabs for native feel
  const activePanel = document.getElementById(`tab-${tabName}`);
  if (activePanel) activePanel.scrollTop = 0;
  // Also scroll window to top on mobile
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
navItems.forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.getAttribute('data-nav');
    if (tab) switchTab(tab);
  });
});

// Top settings icon → open Settings tab
if (settingsBtn) {
  settingsBtn.addEventListener('click', () => {
    switchTab('settings');
  });
}

// Theme toggle — header and settings switcher
const themeToggle = document.getElementById('themeToggle');
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  });
}
document.querySelectorAll('.theme-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const t = btn.getAttribute('data-theme');
    if (t) applyTheme(t);
  });
})

generate.addEventListener('click', generateSpeech);
saveBtn.addEventListener('click', saveMp3);
shareBtn.addEventListener('click', shareMp3);

// Init custom player
setupCustomPlayer();
// Init voice meta and settings hint on load
updateVoiceMeta();
updateSettingsHint();

// ---------------------------------------------------------------------------
// Native: network, back button, status bar, splash
// ---------------------------------------------------------------------------
async function initNative() {
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#0B1020' });
  } catch (e) { /* ignore */ }

  try {
    const status = await Network.getStatus();
    setOffline(!status.connected);
  } catch (e) { /* ignore */ }

  try {
    await Network.addListener('networkStatusChange', (status) => {
      setOffline(!status.connected);
      if (!status.connected) {
        setStatus('لا يوجد اتصال بالإنترنت. يتطلب التطبيق اتصالاً بالإنترنت لتحويل النص إلى صوت.', true);
      }
    });
  } catch (e) { /* ignore */ }

  window.addEventListener('offline', () => setOffline(true));
  window.addEventListener('online', () => setOffline(false));

  try {
    await App.addListener('backButton', ({ canGoBack }) => {
      // Handle bottom nav: if not on home, go home first
      const activeNav = document.querySelector('.bottom-nav .nav-item.active');
      const activeTab = activeNav ? activeNav.getAttribute('data-nav') : 'home';
      if (activeTab && activeTab !== 'home') {
        try { switchTab('home'); } catch (_) {}
        return;
      }
      if (!player.paused) {
        player.pause();
        return;
      }
      if (result.classList.contains('show')) {
        result.classList.remove('show');
        result.setAttribute('aria-hidden', 'true');
        return;
      }
      if (!canGoBack) {
        App.exitApp();
      }
    });
  } catch (e) { /* ignore */ }

  try {
    await SplashScreen.hide();
  } catch (e) { /* ignore */ }
}

if (isNativePlatform()) {
  initNative();
} else {
  if (navigator.onLine === false) setOffline(true);
}

loadVoices();
