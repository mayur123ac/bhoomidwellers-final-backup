package com.bhoomidwellers.crm;

import android.Manifest;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.provider.CallLog;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

@CapacitorPlugin(
    name = "CallRecordingPlugin",
    permissions = {
        @Permission(
            alias = "callLog",
            strings = { Manifest.permission.READ_CALL_LOG }
        ),
        @Permission(
            alias = "audio",
            strings = {
                Manifest.permission.READ_MEDIA_AUDIO
            }
        )
    }
)
public class CallRecordingPlugin extends Plugin {

    private static final int MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

    @PluginMethod
    public void getRecentCalls(PluginCall call) {
        String phoneNumber = call.getString("phoneNumber", "");
        long afterTimestamp = call.getLong("afterTimestamp", 0L);
        int limit = call.getInt("limit", 10);

        // Extract last 10 digits for matching
        String digits = phoneNumber.replaceAll("\\D", "");
        String matchSuffix = digits.length() > 10 ? digits.substring(digits.length() - 10) : digits;

        JSArray calls = new JSArray();

        try {
            String selection = CallLog.Calls.DATE + " > ?";
            String[] selectionArgs = { String.valueOf(afterTimestamp) };
            String sortOrder = CallLog.Calls.DATE + " DESC LIMIT " + limit;

            Cursor cursor = getContext().getContentResolver().query(
                CallLog.Calls.CONTENT_URI,
                new String[]{
                    CallLog.Calls.NUMBER,
                    CallLog.Calls.DURATION,
                    CallLog.Calls.DATE,
                    CallLog.Calls.TYPE
                },
                selection,
                selectionArgs,
                sortOrder
            );

            if (cursor != null) {
                while (cursor.moveToNext()) {
                    String number = cursor.getString(0);
                    String numberDigits = number != null ? number.replaceAll("\\D", "") : "";

                    // Match by last 10 digits
                    if (matchSuffix.length() > 0 && numberDigits.endsWith(matchSuffix)) {
                        JSObject entry = new JSObject();
                        entry.put("number", number);
                        entry.put("duration", cursor.getInt(1));
                        entry.put("date", cursor.getLong(2));

                        int type = cursor.getInt(3);
                        String typeStr;
                        switch (type) {
                            case CallLog.Calls.OUTGOING_TYPE: typeStr = "OUTGOING"; break;
                            case CallLog.Calls.INCOMING_TYPE: typeStr = "INCOMING"; break;
                            case CallLog.Calls.MISSED_TYPE: typeStr = "MISSED"; break;
                            case CallLog.Calls.REJECTED_TYPE: typeStr = "REJECTED"; break;
                            default: typeStr = "UNKNOWN"; break;
                        }
                        entry.put("type", typeStr);
                        calls.put(entry);
                    }
                }
                cursor.close();
            }
        } catch (SecurityException e) {
            call.reject("READ_CALL_LOG permission not granted", e);
            return;
        } catch (Exception e) {
            call.reject("Failed to query call log", e);
            return;
        }

        JSObject result = new JSObject();
        result.put("calls", calls);
        call.resolve(result);
    }

    @PluginMethod
    public void findRecordings(PluginCall call) {
        long afterTimestamp = call.getLong("afterTimestamp", 0L);
        long beforeTimestamp = call.getLong("beforeTimestamp", System.currentTimeMillis() + 60000);
        String phoneNumber = call.getString("phoneNumber", "");

        String digits = phoneNumber.replaceAll("\\D", "");
        // Convert ms to seconds for MediaStore DATE_MODIFIED
        long afterSeconds = afterTimestamp / 1000;
        long beforeSeconds = beforeTimestamp / 1000;

        JSArray recordings = new JSArray();

        try {
            Uri audioUri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
            String selection = MediaStore.Audio.Media.DATE_MODIFIED + " >= ? AND " +
                               MediaStore.Audio.Media.DATE_MODIFIED + " <= ?";
            String[] selectionArgs = { String.valueOf(afterSeconds), String.valueOf(beforeSeconds) };
            String sortOrder = MediaStore.Audio.Media.DATE_MODIFIED + " DESC";

            String[] projection = {
                MediaStore.Audio.Media._ID,
                MediaStore.Audio.Media.DISPLAY_NAME,
                MediaStore.Audio.Media.SIZE,
                MediaStore.Audio.Media.MIME_TYPE,
                MediaStore.Audio.Media.DATE_MODIFIED,
                MediaStore.Audio.Media.DURATION
            };

            Cursor cursor = getContext().getContentResolver().query(
                audioUri, projection, selection, selectionArgs, sortOrder
            );

            if (cursor != null) {
                while (cursor.moveToNext()) {
                    long id = cursor.getLong(0);
                    String name = cursor.getString(1);
                    long size = cursor.getLong(2);
                    String mimeType = cursor.getString(3);
                    long dateModified = cursor.getLong(4) * 1000; // back to ms
                    long duration = cursor.getLong(5); // ms in MediaStore

                    // Heuristic: check if filename or path contains phone digits
                    String matchReason = "timestamp_proximity";
                    if (digits.length() >= 10 && name != null && name.contains(digits.substring(digits.length() - 10))) {
                        matchReason = "filename_match";
                    }

                    Uri contentUri = Uri.withAppendedPath(audioUri, String.valueOf(id));

                    // Try MediaMetadataRetriever for more accurate duration
                    if (duration <= 0) {
                        try {
                            MediaMetadataRetriever mmr = new MediaMetadataRetriever();
                            mmr.setDataSource(getContext(), contentUri);
                            String durationStr = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
                            if (durationStr != null) {
                                duration = Long.parseLong(durationStr);
                            }
                            mmr.release();
                        } catch (Exception ignored) {}
                    }

                    JSObject rec = new JSObject();
                    rec.put("uri", contentUri.toString());
                    rec.put("name", name != null ? name : "recording");
                    rec.put("size", size);
                    rec.put("duration", duration / 1000); // convert to seconds
                    rec.put("mimeType", mimeType != null ? mimeType : "audio/mpeg");
                    rec.put("dateModified", dateModified);
                    rec.put("matchReason", matchReason);
                    recordings.put(rec);
                }
                cursor.close();
            }
        } catch (SecurityException e) {
            call.reject("READ_MEDIA_AUDIO permission not granted", e);
            return;
        } catch (Exception e) {
            call.reject("Failed to query recordings", e);
            return;
        }

        JSObject result = new JSObject();
        result.put("recordings", recordings);
        call.resolve(result);
    }

    @PluginMethod
    public void pickAudioFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.setType("audio/*");
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        startActivityForResult(call, intent, "handleAudioPick");
    }

    @ActivityCallback
    private void handleAudioPick(PluginCall call, ActivityResult result) {
        if (call == null) return;

        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) {
            JSObject res = new JSObject();
            res.put("recording", JSObject.NULL);
            call.resolve(res);
            return;
        }

        Uri uri = result.getData().getData();
        if (uri == null) {
            JSObject res = new JSObject();
            res.put("recording", JSObject.NULL);
            call.resolve(res);
            return;
        }

        try {
            ContentResolver cr = getContext().getContentResolver();
            String mimeType = cr.getType(uri);
            if (mimeType == null) mimeType = "audio/mpeg";

            // Get file name and size
            String name = "recording";
            long size = 0;
            Cursor cursor = cr.query(uri, null, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int nameIdx = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                int sizeIdx = cursor.getColumnIndex(android.provider.OpenableColumns.SIZE);
                if (nameIdx >= 0) name = cursor.getString(nameIdx);
                if (sizeIdx >= 0) size = cursor.getLong(sizeIdx);
                cursor.close();
            }

            // Get duration via MediaMetadataRetriever
            long duration = 0;
            try {
                MediaMetadataRetriever mmr = new MediaMetadataRetriever();
                mmr.setDataSource(getContext(), uri);
                String durationStr = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
                if (durationStr != null) {
                    duration = Long.parseLong(durationStr) / 1000; // to seconds
                }
                mmr.release();
            } catch (Exception ignored) {}

            JSObject rec = new JSObject();
            rec.put("uri", uri.toString());
            rec.put("name", name);
            rec.put("size", size);
            rec.put("duration", duration);
            rec.put("mimeType", mimeType);
            rec.put("dateModified", System.currentTimeMillis());
            rec.put("matchReason", "user_picked");

            JSObject res = new JSObject();
            res.put("recording", rec);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Failed to read picked file", e);
        }
    }

    @PluginMethod
    public void readFileAsBase64(PluginCall call) {
        String uriStr = call.getString("uri", "");
        if (uriStr.isEmpty()) {
            call.reject("uri is required");
            return;
        }

        try {
            Uri uri = Uri.parse(uriStr);
            ContentResolver cr = getContext().getContentResolver();
            String mimeType = cr.getType(uri);
            if (mimeType == null) mimeType = "audio/mpeg";

            InputStream is = cr.openInputStream(uri);
            if (is == null) {
                call.reject("Could not open file");
                return;
            }

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int len;
            long total = 0;
            while ((len = is.read(buf)) != -1) {
                if (total + len > MAX_FILE_SIZE) {
                    is.close();
                    call.reject("File exceeds 50MB limit");
                    return;
                }
                baos.write(buf, 0, len);
                total += len;
            }
            is.close();

            byte[] bytes = baos.toByteArray();
            String base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);

            JSObject result = new JSObject();
            result.put("base64", base64);
            result.put("mimeType", mimeType);
            result.put("size", bytes.length);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Failed to read file", e);
        }
    }

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        JSObject result = new JSObject();
        result.put("callLog", getPermissionState("callLog"));
        result.put("audio", getPermissionState("audio"));
        call.resolve(result);
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        requestAllPermissions(call, "handlePermissionResult");
    }

    @PermissionCallback
    private void handlePermissionResult(PluginCall call) {
        JSObject result = new JSObject();
        result.put("callLog", getPermissionState("callLog"));
        result.put("audio", getPermissionState("audio"));
        call.resolve(result);
    }
}
