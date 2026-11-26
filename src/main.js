import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Keyboard } from '@capacitor/keyboard';
import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { SAWTI_API_BASE_URL } from './config.js';

const isNative = Capacitor.isNativePlatform();

// ---------------------------------------------------------------------------
// API base URL
// ---------------------------------------------------------------------------
// On the web (Render) the app uses relative paths (/api/...) so the original
// website keeps working unchanged. Inside the Android app the UI is served
// from https://localhost, so absolute URLs pointing at the Render backend
// (SAWTI_API_BASE_URL in config.js) are required.
const API_BASE = isNative ? SAWTI_API_BASE_URL.replace(/\/+$/, '') : '';
// Android must have a real https://*.onrender.com URL; web uses relative paths.
const API_CONFIGURED = isNative
  ? (() => {
      try {
        const u = new URL(API_BASE);
        return u.protocol === 'https:' && u.hostname.endsWith('.onrender.com') && (u.pathname === '/' || u.pathname === '');
      } catch {
        return false;
      }
    })()
  : true;

function apiUrl(path) {
  return `${API_BASE}${path}`;
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

const GENERATE_LABEL_HTML = '<span class="btn-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="white" stroke-width="2"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8Z"/></svg></span><span class="btn-label">تحويل النص إلى صوت</span>';
const TTS_TIMEOUT_MS = 120000; // Render free tier may need time to wake up
const VOICES_TIMEOUT_MS = 30000;

let currentUrl = null; // object URL for <audio>
let currentBlob = null; // last generated MP3 blob
let nativeFileUri = null; // cached file:// URI written via Filesystem
let nativeFileName = 'nabra-ai.mp3';

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
  // opt.text is like "أمينة — جزائرية (أنثى)"
  const text = opt.textContent.trim();
  // Extract for meta: keep as is but shorten
  // Show as "جزائرية · أنثى · Amina" - derive English id for hint
  const id = voiceEl.value; // ar-DZ-AminaNeural
  const eng = id.split('-').pop().replace('Neural','');
  const parts = text.split(' — ');
  if (parts.length >= 2) {
    const name = parts[0];
    const rest = parts[1]; // "جزائرية (أنثى)"
    const accent = rest.split(' (')[0];
    const gender = rest.includes('(') ? rest.split('(')[1].replace(')','') : '';
    voiceMeta.textContent = `${accent} · ${gender} · ${eng}`;
  } else {
    voiceMeta.textContent = text;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function fetchWithTimeout(url, options = {}, timeoutMs = TTS_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error('timeout');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
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
  if (isNative && nativeFileUri) {
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
// Voices — loaded from GET /api/voices (fallback: built-in list)
// ---------------------------------------------------------------------------
async function loadVoices() {
  if (!API_CONFIGURED) {
    setStatus('تنبيه: لم يتم ضبط رابط الخادم بعد. افتح ملف src/config.js وضع رابط Render الفعلي في SAWTI_API_BASE_URL.');
    return;
  }
  try {
    const response = await fetchWithTimeout(apiUrl('/api/voices'), {}, VOICES_TIMEOUT_MS);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
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
    }
  } catch (err) {
    // Keep the built-in voice list so the UI stays usable offline.
    setStatus('تعذر تحميل الأصوات من الخادم. يتم استخدام قائمة الأصوات الافتراضية — تحقق من الاتصال بالإنترنت.');
  }
}

// ---------------------------------------------------------------------------
// Generate speech — POST /api/tts
// ---------------------------------------------------------------------------
async function generateSpeech() {
  const text = textEl.value.trim();
  if (!text) {
    setStatus('اكتب النص الذي تريد تحويله أولاً.', true);
    textEl.focus();
    return;
  }
  if (!API_CONFIGURED) {
    setStatus('لم يتم ضبط رابط الخادم بعد. افتح ملف src/config.js وضع رابط Render الفعلي في SAWTI_API_BASE_URL ثم أعد بناء التطبيق.', true);
    return;
  }
  if (navigator.onLine === false) {
    setStatus('لا يوجد اتصال بالإنترنت. يتطلب التحويل اتصالاً بالإنترنت — تحقق من الاتصال وحاول مجدداً.', true);
    return;
  }

  if (isNative) {
    try { await Keyboard.hide(); } catch (e) { /* ignore */ }
  }

  generate.disabled = true;
  generate.innerHTML = '<span class="spinner"></span> جارٍ إنشاء الصوت...';
  setStatus('قد يستغرق التحويل بضع ثوانٍ حسب طول النص وسرعة الإنترنت. إذا كان الخادم نائماً فقد يستغرق أول طلب وقتاً أطول.');
  result.classList.remove('show');
  result.setAttribute('aria-hidden', 'true');
  await cleanupPreviousAudio();

  try {
    const response = await fetchWithTimeout(apiUrl('/api/tts'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voice: voiceEl.value,
        rate: Number(rate.value),
        pitch: Number(pitch.value),
      }),
    }, TTS_TIMEOUT_MS);

    if (!response.ok) {
      let msg = 'حدث خطأ أثناء إنشاء الصوت.';
      try {
        const data = await response.json();
        if (data && data.detail) msg = data.detail;
      } catch (e) { /* keep default message */ }
      throw new Error(msg);
    }

    const blob = await response.blob();
    currentBlob = blob;
    currentUrl = URL.createObjectURL(blob);
    player.src = currentUrl;
    // Load metadata for duration
    player.load();
    result.classList.add('show');
    result.setAttribute('aria-hidden', 'false');
    // scroll player into view on mobile
    setTimeout(() => result.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 120);
    setStatus('تم إنشاء الصوت بنجاح. استمع الآن أو احفظه أو شاركه.');
    try { await player.play(); } catch (e) { /* autoplay may be blocked; user can press play */ }
  } catch (err) {
    if (err && err.message === 'timeout') {
      setStatus('انتهت مهلة الطلب. قد يكون الخادم يستيقظ من وضع النوم — انتظر قليلاً وحاول مجدداً.', true);
    } else if (err instanceof TypeError) {
      setStatus('تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت وحاول مجدداً.', true);
    } else {
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
  if (!currentBlob) {
    setStatus('لا يوجد صوت لحفظه بعد. حوّل النص إلى صوت أولاً.', true);
    return;
  }
  if (isNative) {
    try {
      const uri = await ensureNativeFile();
      // Open the native share sheet so the user can save the file
      // to Downloads / Drive / etc. (no storage permission needed).
      await Share.share({
        title: 'NABRA AI',
        url: uri,
        dialogTitle: 'حفظ ملف MP3',
      });
      setStatus('تم تجهيز الملف للحفظ. اختر مكان الحفظ من القائمة.');
    } catch (err) {
      if (err && (err.message || '').toLowerCase().includes('cancel')) {
        setStatus('تم إلغاء الحفظ.');
      } else {
        setStatus('تعذر حفظ الملف. حاول مرة أخرى.', true);
      }
    }
  } else {
    // Web fallback: normal browser download.
    const a = document.createElement('a');
    a.href = currentUrl;
    a.download = 'nabra-ai.mp3';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setStatus('بدأ تنزيل ملف MP3.');
  }
}

async function shareMp3() {
  if (!currentBlob) {
    setStatus('لا يوجد صوت لمشاركته بعد. حوّل النص إلى صوت أولاً.', true);
    return;
  }
  if (isNative) {
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
// UI events
// ---------------------------------------------------------------------------
textEl.addEventListener('input', () => {
  count.textContent = `${textEl.value.length} / 5000`;
});
rate.addEventListener('input', () => {
  document.getElementById('rateVal').textContent = `${rate.value}%`;
});
pitch.addEventListener('input', () => {
  document.getElementById('pitchVal').textContent = pitch.value;
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

if (settingsBtn) {
  settingsBtn.addEventListener('click', () => {
    setStatus('الإعدادات قريباً — يتم تطويرها حالياً.');
    setTimeout(() => { if (statusEl.textContent.includes('الإعدادات')) setStatus(''); }, 2200);
  });
}

generate.addEventListener('click', generateSpeech);
saveBtn.addEventListener('click', saveMp3);
shareBtn.addEventListener('click', shareMp3);

// Init custom player
setupCustomPlayer();
// Init voice meta on load
updateVoiceMeta();

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

if (isNative) {
  initNative();
} else {
  window.addEventListener('offline', () => setOffline(true));
  window.addEventListener('online', () => setOffline(false));
  if (navigator.onLine === false) setOffline(true);
}

loadVoices();
