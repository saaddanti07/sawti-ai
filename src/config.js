/**
 * إعدادات التطبيق — NABRA AI (نَبْرَة AI)
 *
 * SAWTI_API_BASE_URL
 * ------------------
 * رابط الخادم (Render) الذي يستضيف واجهات API:
 *   - GET  /api/voices  (قائمة الأصوات)
 *   - POST /api/tts     (تحويل النص إلى MP3)
 *
 * رابط الإنتاج الحالي:
 *   https://sawti-ai.onrender.com
 *
 * يجب أن تكون القيمة بدون شرطة مائلة (/) في النهاية.
 *
 *     مثال صحيح:
 *       export const SAWTI_API_BASE_URL = 'https://sawti-ai.onrender.com';
 *
 *     مثال خاطئ (شرطة في النهاية):
 *       export const SAWTI_API_BASE_URL = 'https://sawti-ai.onrender.com/';
 *
 * هذا الملف هو المكان الوحيد لتغيير رابط الخادم — كل طلبات
 * التطبيق (GET /api/voices و POST /api/tts) تستخدمه.
 */
export const SAWTI_API_BASE_URL = 'https://sawti-ai.onrender.com';
