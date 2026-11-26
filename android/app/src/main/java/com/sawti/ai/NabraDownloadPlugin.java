package com.sawti.ai;

import android.content.ContentValues;
import android.content.Context;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NabraDownload")
public class NabraDownloadPlugin extends Plugin {

    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        String data = call.getString("data");
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType", "audio/mpeg");

        if (data == null || fileName == null) {
            call.reject("Missing data or fileName");
            return;
        }

        // Basic validation: ensure not empty and not JSON/HTML error
        if (data.length() < 100) {
            // Very small file likely error, but still try to save? Reject to avoid saving HTML
            // Check if decoded bytes look like JSON/HTML (starts with { or <)
            try {
                byte[] probe = Base64.decode(data, Base64.DEFAULT);
                String head = new String(probe, 0, Math.min(probe.length, 20), "UTF-8");
                if (head.trim().startsWith("{") || head.trim().startsWith("<") || head.trim().startsWith("\"")) {
                    call.reject("Response is not audio (JSON/HTML), not saving");
                    return;
                }
            } catch (Exception ignored) {}
        }

        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            if (bytes.length == 0) {
                call.reject("Empty audio data");
                return;
            }
            // Additional check: ensure not JSON error (first byte { )
            if (bytes.length > 0 && bytes[0] == '{') {
                String maybeJson = new String(bytes, 0, Math.min(bytes.length, 200), "UTF-8");
                if (maybeJson.contains("\"detail\"")) {
                    call.reject("Server error response, not audio: " + maybeJson.substring(0, Math.min(150, maybeJson.length())));
                    return;
                }
            }

            Context ctx = getContext();
            String savedUri = null;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                values.put(MediaStore.Downloads.IS_PENDING, 1);

                Uri collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                Uri itemUri = ctx.getContentResolver().insert(collection, values);
                if (itemUri == null) {
                    call.reject("Failed to create MediaStore entry");
                    return;
                }
                try (java.io.OutputStream out = ctx.getContentResolver().openOutputStream(itemUri)) {
                    if (out == null) {
                        call.reject("Failed to open output stream");
                        return;
                    }
                    out.write(bytes);
                }
                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                ctx.getContentResolver().update(itemUri, values, null, null);
                savedUri = itemUri.toString();
            } else {
                // Legacy Android 9 and below: direct file write to public Downloads
                java.io.File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!downloadsDir.exists() && !downloadsDir.mkdirs()) {
                    Log.w("NabraDownload", "Failed to create Downloads dir, trying alternative");
                }
                java.io.File file = new java.io.File(downloadsDir, fileName);
                try (java.io.FileOutputStream fos = new java.io.FileOutputStream(file)) {
                    fos.write(bytes);
                }
                // Notify media scanner so file appears in file manager
                MediaScannerConnection.scanFile(ctx, new String[]{file.getAbsolutePath()}, new String[]{mimeType}, null);
                savedUri = Uri.fromFile(file).toString();
            }

            JSObject ret = new JSObject();
            ret.put("uri", savedUri);
            ret.put("fileName", fileName);
            ret.put("size", bytes.length);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e("NabraDownload", "saveToDownloads failed", e);
            call.reject("save failed: " + e.getMessage(), e);
        }
    }
}
