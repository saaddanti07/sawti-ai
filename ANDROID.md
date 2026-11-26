# NABRA AI (نَبْرَة AI) — دليل تطبيق أندرويد (Capacitor)

هذا الدليل يشرح كيف تحوّل مشروع **NABRA AI (نَبْرَة AI)** الحالي إلى تطبيق أندرويد حقيقي باستخدام Capacitor، وكيف تبني ملف APK عبر GitHub Actions بدون الحاجة إلى Android Studio على جهازك.

---

## 1. نظرة عامة

- **اسم التطبيق:** NABRA AI — الاسم العربي: نَبْرَة AI
- **العلامة:** NABRA AI (نَبْرَة AI) — "حوّل كلماتك إلى صوت ينبض بالحياة." / "Turn Your Words Into Living Voices."
- **معرّف الحزمة:** `com.sawti.ai`
- **التقنية:** Capacitor 8.6.3 + Vite 6 + Web (HTML/CSS/JS)
- **الخادم:** يبقى على Render كما هو (`app.py` + Edge TTS). التطبيق مجرد عميل يتصل بالخادم عبر الإنترنت.
- **الواجهة:** نفس هوية الموقع (خلفية داكنة، تدرجات بنفسجية/زرقاء، RTL عربي) لكن محسّنة للهاتف: تملأ الشاشة، تمنع التمرير الأفقي، تتجاوب مع لوحة المفاتيح، وتشعر كتطبيق أصلي وليس موقع داخل متصفح.

---

## 2. الملفات التي تم إنشاؤها أو تعديلها

### تم تعديلها
| الملف | التعديل |
|------|---------|
| `app.py` | إضافة `CORSMiddleware` للسماح فقط لأصول Capacitor (`https://localhost`, `http://localhost`, `capacitor://localhost`) مع `GET` و`POST` ورؤوس `Content-Type`/`Accept`. لم يتم تعطيل الحماية ولم تُكشف أي أسرار. |
| `.gitignore` | إضافة تجاهل `node_modules/`, `www/`, مخرجات بناء أندرويد (`android/app/build/`, `android/.gradle/`...), و`*.apk`/`*.aab`. |

### تم إنشاؤها
| الملف | الغرض |
|------|-------|
| `package.json` | تعريف مشروع NABRA AI Node/Capacitor مع سكربتات `build`, `sync`, `assets` واعتماديات Capacitor 8.6.3 والبلجنات. |
| `package-lock.json` | قفل إصدارات npm لضمان بناء متطابق على GitHub Actions (`npm ci`). |
| `capacitor.config.ts` | إعداد Capacitor: `appId: com.sawti.ai` (محفوظ), `appName: NABRA AI`, `webDir: www`, `androidScheme: https`, إعدادات SplashScreen #0B1020 و spinner #8065F5 والـ StatusBar. |
| `vite.config.ts` | إعداد Vite: جذر المشروع `src/` والمخرجات `www/` (الذي يشير إليه `capacitor.config.ts`). |
| `src/config.js` | **القيمة القابلة للإعداد** `SAWTI_API_BASE_URL` — رابط خادم Render بدون `/` نهائية. يحتوي على تعليقات عربية وشروحات الأمثلة الصحيحة/الخاطئة. |
| `src/index.html` | واجهة NABRA AI — هيدر NABRA AI / نَبْرَة AI مع الشعار الجديد والشعار "حوّل كلماتك إلى صوت ينبض بالحياة."، RTL محسّنة للهاتف. |
| `src/style.css` | هوية NABRA البصرية — #8065F5 / #4F83FF / #0B1020 / #17223A / #FFFFFF / #AAB6D3، تدرجات خفيفة، تباعد وطباعة محسّنة. |
| `src/main.js` | منطق NABRA AI: تحميل الأصوات من `/api/voices` (مع fallback)، إرسال `/api/tts` مع timeout 120ث، تشغيل MP3، استخدام Filesystem/Share لحفظ/مشاركة MP3، معالجة الأخطاء بالعربية، لافتة عدم الاتصال، معالجة زر الرجوع، إخفاء لوحة المفاتيح، وتنظيف object URLs/الملفات المؤقتة. |
| `assets/icon.png` (1024×1024) | أيقونة NABRA AI — حرف N مع موجة صوتية، تدرج #8065F5 → #4F83FF، تصميم هندسي نظيف. |
| `assets/splash.png` (2732×2732) | شاشة البداية — خلفية #0B1020 + بلاط بتدرج #8065F5→#4F83FF مع شعار NABRA. |
| `android/` | مشروع أندرويد الأصلي الذي أنشأه `npx cap add android` وتم توليد الأيقونات/شاشات البداية فيه عبر `npx @capacitor/assets generate --android` (87 ملف في `mipmap-*` و`drawable-*`). تم ضبط `android/app/src/main/AndroidManifest.xml` (تمت إضافة `windowSoftInputMode="adjustResize"` لوعي لوحة المفاتيح). تم ضبط `android/app/build.gradle` لدعم توقيع release عبر `gradle.properties` المحقون من الأسرار. |
| `.github/workflows/build-android.yml` | سير عمل GitHub Actions: يبني debug APK ويرفعه كـ artifact، ويدعم فصل بناء release موقّع عبر أسرار دون اختراع مفاتيح. |

**لم يتم المساس بها:** `static/index.html` (موقع الويب الأصلي على Render يبقى كما هو)، `app.py` (الخادم)، `render.yaml`, `requirements.txt`, `render.yaml` — بقيت كما هي.

---

## 3. إعداد رابط الخادم SAWTI_API_BASE_URL

هذا هو **أهم خطوة** قبل بناء التطبيق.

1. افتح الملف `src/config.js` — هو المكان الوحيد لتغيير رابط الخادم.
2. ستجد السطر:

```js
export const SAWTI_API_BASE_URL = 'https://sawti-ai.onrender.com';
```

   هذا هو رابط الإنتاج الحالي. لا تغيره إلا إذا انتقل الخادم إلى عنوان آخر.

   - ✅ صحيح: `https://sawti-ai.onrender.com`
   - ❌ خطأ: `https://sawti-ai.onrender.com/` (شرطة نهائية)
   - ❌ خطأ: `https://YOUR-RENDER-URL.onrender.com` (رابط وهمي)

3. إذا انتقل الخادم مستقبلاً، استبدل القيمة بالرابط الجديد **بدون** شرطة مائلة في النهاية ثم أعد البناء (انظر القسم 5).

> **لماذا رابط مطلق؟** تطبيق أندرويد يُشغّل واجهته من `https://localhost` داخل WebView، لذا لا تعمل المسارات النسبية `/api/...`. يجب أن تكون الطلبات مطلقة مثل `https://sawti-ai.onrender.com/api/voices` و `https://sawti-ai.onrender.com/api/tts`. موقع الويب الأصلي على Render لا يزال يستخدم مسارات نسبية كما كان.

---

## 4. المتطلبات

- Node.js 20 أو 22 (يستخدم سير العمل 22)
- Python 3.10+ للخادم (محلياً)
- لا تحتاج Android Studio أو Java محلياً إذا استخدمت GitHub Actions

---

## 5. التطوير والاختبار المحلي

```bash
# تثبيت اعتماديات الويب/أندرويد
npm install

# تشغيل الخادم الخلفي (في طرفية منفصلة)
pip install -r requirements.txt
uvicorn app:app --reload
# افتح http://127.0.0.1:8000 — تحقق أن /api/voices يعيد 8 أصوات

# بناء واجهة التطبيق
npm run build

# مزامنة الملفات إلى مشروع أندرويد
npx cap sync android

# (اختياري) توليد الأيقونات/شاشات البداية بعد تغيير assets/icon.png أو splash.png
npm run assets
```

للمعاينة على الهاتف بدون بناء APK: شغّل `npx cap open android` إذا كان لديك Android Studio/SDK محلياً.

---

## 6. رفع المشروع إلى GitHub (ويندوز 7/10/11 أو أي نظام)

```bash
# داخل مجلد المشروع
git status
git add app.py .gitignore package.json package-lock.json capacitor.config.ts vite.config.ts src/ assets/ android/ .github/
git status   # تأكد أن www/ و node_modules/ و android/app/build/ غير مضافة (مُتجاهلة)
git commit -m "feat: NABRA AI — rebrand + UI + حفظ/مشاركة MP3 + CI"

# أنشئ مستودعاً فارغاً على github.com (بدون README)
# ثم اربطه:
git remote add origin https://github.com/USERNAME/REPO.git
# إذا كان origin موجوداً مسبقاً:
# git remote set-url origin https://github.com/USERNAME/REPO.git

git branch -M main
git push -u origin main
```

> إذا كنت تعمل على فرع `arena/b8fd4dca-sawti-ai` حالياً، يمكنك أيضاً دفع هذا الفرع ثم دمجه إلى `main` عبر Pull Request على GitHub.

---

## 7. تنزيل APK من GitHub Actions

1. بعد `git push`، افتح مستودعك على GitHub → تبويب **Actions**.
2. سترى تشغيل **Build Android APK** قيد التقدم (يستغرق 3-6 دقائق).
3. عند اكتماله، ادخل إلى التشغيل → قسم **Artifacts** → حمّل `sawti-ai-debug-apk`.
4. فك الضغط وستجد `app-debug.apk`.
5. انقل الملف إلى هاتف أندرويد وافتحه لتثبيته. قد تحتاج إلى السماح بـ "تثبيت التطبيقات من مصادر غير معروفة".

### بناء نسخة موقعة (اختياري — للنشر على Play Store)

لا تُخترع مفاتيح. أنشئ keystore حقيقي مرة واحدة:

```bash
keytool -genkeypair -v -keystore release.keystore -alias sawti -keyalg RSA -keysize 2048 -validity 10000
base64 -w 0 release.keystore > release.b64
```

ثم في GitHub → Settings → Secrets and variables → Actions → **New repository secret** أضف:

- `ANDROID_KEYSTORE_BASE64` = محتوى `release.b64`
- `KEYSTORE_PASSWORD` = كلمة مرور المتجر
- `KEY_ALIAS` = `sawti`
- `KEY_PASSWORD` = كلمة مرور المفتاح

ثم شغّل الـ Workflow يدوياً: Actions → Build Android APK → **Run workflow** → فعّل `Build signed release` → Run. سيُرفع `sawti-ai-release-aab`.

---

## 8. ماذا يفعل التطبيق على الهاتف

- **تحميل الأصوات** من `GET SAWTI_API_BASE_URL/api/voices` مع fallback للقائمة المدمجة عند فشل الاتصال.
- **تحويل النص** عبر `POST SAWTI_API_BASE_URL/api/tts` (timeout 120ث لمراعاة استيقاظ Render المجاني)، عرض مؤشر تحميل بالعربية ومعالجة أخطاء مثل `timeout`, عدم وجود إنترنت, أو خطأ 400.
- **التشغيل:** يعرض `<audio controls>` ويمكن إعادة التشغيل.
- **الحفظ/المشاركة:** يكتب MP3 إلى `Directory.Data` عبر Filesystem ثم يشاركه عبر Share (لا يحتاج إذن تخزين). على الويب يستخدم تنزيل عادي.
- **تجربة أندرويد:** أيقونة احترافية، شاشة بداية أصلية، شريط حالة داكن (`#0b1020`), زر الرجوع (يوقف الصوت/يغلق النتيجة/يخرج), لافتة عدم اتصال, إخفاء لوحة المفاتيح عند الإرسال, وتنظيف الملفات المؤقتة و object URLs.

الأذونات: `INTERNET` فقط (لا حاجة لأذونات تخزين مع Filesystem + Share).

---

## 9. حالة التحقق (بأمانة)

تم التحقق **محلياً** في بيئة لا تحتوي على Android SDK/Java:

- ✅ استيراد `app.py` يعمل ومسارات `['/api/voices','/api/tts','/']` موجودة.
- ✅ الخادم يبدأ ويرد على `GET /api/voices` بـ 8 أصوات صحيحة (أمينة, إسماعيل, زارية, حامد, سلمى, شاكر, فاطمة, حمدان).
- ✅ التحقق من صحة الإدخال يعمل: نص فارغ → `يرجى كتابة نص أولاً.`, صوت غير موجود → `الصوت المختار غير مدعوم.`, rate خارج النطاق → خطأ تحقق.
- ✅ CORS للسماح لأصل `https://localhost` يعمل (preflight يرد `access-control-allow-origin: https://localhost` وطلب فعلي ينجح)، بينما أصل شرير مثل `https://evil.example.com` لا يحصل على ترويسة (محجوب).
- ✅ `npm install` نجح (172 حزمة) و`npm run build` بنى `www/` و`npx cap sync android` و`npx @capacitor/assets generate --android` ولّد 87 ملف أيقونة/شاشة بداية.
- ✅ فحص صحة `capacitor.config.json` و`.github/workflows/build-android.yml` (YAML صالح, مهام build-debug/build-release موجودة).
- ⏳ طلب TTS الحقيقي محلياً أعاد HTTP 502 (متوقع لأن بيئة الاختبار لا تملك اتصال Edge TTS الخارجي، و`edge_tts` يحتاج إنترنت. الكود يحوّل الاستثناء إلى رسالة عربية `تعذر إنشاء الصوت حالياً.`).
- ⚠️ **بناء APK محلياً لم يُجرّب** — لا يوجد Java/Android SDK في هذه البيئة ( `java: command not found`). البناء المقصود أن يحدث عبر GitHub Actions التي تثبت JDK 21 و`platforms;android-36` و`build-tools;36.0.0`.
- ⚠️ **اختبار على هاتف حقيقي لم يُجرّب** هنا — يتطلب تثبيت APK المبني من Actions على جهاز أندرويد وربطه بخادم Render الحقيقي بعد ضبط `SAWTI_API_BASE_URL`.

لم يُدّعَ أي نجاح بناء غير مثبت بتشغيل فعلي.

---

## 10. استكشاف الأخطاء

- **`الصوت المختار غير مدعوم.`** — تأكد أن `voice` هو أحد الثمانية المحددة.
- **`تعذر الاتصال بالخادم.`** — تحقق من الإنترنت وتأكد أن `SAWTI_API_BASE_URL` صحيح بدون `/` نهائية وأن خدمة Render تعمل (`/api/voices` يرد 200).
- **انتهت مهلة الطلب** — انتظر دقيقة ثم أعد المحاولة (خطة Render المجانية تنام وتحتاج ~30-60ث للاستيقاظ).
- **AAPT/gradle خطأ في Actions** — تأكد أنك دفعت مجلد `android/` كاملاً وأنك تستخدم Node 22 وJDK 21 كما في سير العمل.
