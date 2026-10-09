package com.sifrqr.althumama.driver;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;

/**
 * تنبيه الرحلة بصوت قوي من أول تثبيت (رحلة جديدة، إلغاء، نفي مشرف المبنى، الوصول): صوت الإشعار على قناة المنبّه
 * بأعلى مستوى، فلا يضعف بخفض صوت الإشعارات ولا بالوضع الصامت في أغلب الأجهزة، ويتكرر PLAYS مرات مع اهتزاز.
 * يعود مستوى صوت المنبّه كما كان بعد التنبيه. لا يتجاوز «عدم الإزعاج» إن فعّله السائق.
 */
final class Alarm {
    private static final int PLAYS = 3;
    private static final long[] VIBRATION = { 0, 500, 200, 500, 200, 500 };
    private static MediaPlayer player;
    private static int restoreVolume = -1;

    private Alarm() {}

    static void play(final Context context) {
        new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override
            public void run() {
                start(context.getApplicationContext());
            }
        });
    }

    private static void start(Context context) {
        vibrate(context);
        stop(context);
        AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        try {
            if (audio != null) {
                restoreVolume = audio.getStreamVolume(AudioManager.STREAM_ALARM);
                audio.setStreamVolume(AudioManager.STREAM_ALARM, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0);
            }
        } catch (SecurityException blocked) {
            // «عدم الإزعاج» يمنع تغيير المستوى: يبقى كما هو
            restoreVolume = -1;
        }
        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (sound == null) {
            restore(context);
            return;
        }
        try {
            final MediaPlayer media = new MediaPlayer();
            media.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
            media.setDataSource(context, sound);
            final Context app = context;
            final int[] left = { PLAYS };
            media.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
                @Override
                public void onCompletion(MediaPlayer finished) {
                    left[0]--;
                    if (left[0] > 0 && finished == player) {
                        finished.seekTo(0);
                        finished.start();
                    } else {
                        stop(app);
                    }
                }
            });
            media.setOnErrorListener(new MediaPlayer.OnErrorListener() {
                @Override
                public boolean onError(MediaPlayer failed, int what, int extra) {
                    stop(app);
                    return true;
                }
            });
            media.prepare();
            player = media;
            media.start();
        } catch (Exception error) {
            stop(context);
        }
    }

    private static void stop(Context context) {
        if (player != null) {
            try {
                player.release();
            } catch (RuntimeException ignored) {
                // انتهى من قبل
            }
            player = null;
        }
        restore(context);
    }

    private static void restore(Context context) {
        if (restoreVolume < 0) return;
        AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        try {
            if (audio != null) audio.setStreamVolume(AudioManager.STREAM_ALARM, restoreVolume, 0);
        } catch (SecurityException blocked) {
            // «عدم الإزعاج»
        }
        restoreVolume = -1;
    }

    private static void vibrate(Context context) {
        Vibrator vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator == null || !vibrator.hasVibrator()) return;
        if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createWaveform(VIBRATION, -1));
        else vibrator.vibrate(VIBRATION, -1);
    }
}
