/**
 * إعدادات التطبيق — صوتي AI
 *
 * SAWTI_API_BASE_URL
 * ------------------
 * رابط الخادم (Render) الذي يستضيف واجهات API:
 *   - GET  /api/voices  (قائمة الأصوات)
 *   - POST /api/tts     (تحويل النص إلى MP3)
 *
 * ⚠️  قبل بناء التطبيق، استبدل القيمة التالية برابط خدمة Render الفعلي
 *     الخاص بك، بدون شرطة مائلة (/) في النهاية.
 *
 *     مثال صحيح:
 *       export const SAWTI_API_BASE_URL = 'https://sawti-ai-arabic.onrender.com';
 *
 *     مثال خاطئ (شرطة في النهاية):
 *       export const SAWTI_API_BASE_URL = 'https://sawti-ai-arabic.onrender.com/';
 *
 * ملاحظة: لا تستخدم هذا التطبيق مع رابط تجريبي — يجب أن يكون الرابط
 * هو رابط خدمة Render الحقيقي حيث يعمل الخادم (app.py).
 */
export const SAWTI_API_BASE_URL = 'https://YOUR-RENDER-URL.onrender.com';
