package com.sifrqr.althumama.driver;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * مشاركة موقع السيارة والتطبيق في الخلفية (مثل فتح خرائط جوجل أو Waze للملاحة): خدمة ظاهرة بإشعار ثابت
 * تأخذ الموقع من GPS الجهاز وترسله إلى api/index.php?r=location بجلسة السائق نفسها (كوكي الصفحة)،
 * وتسأل عن رحلات السيارة كل 30 ثانية فتنبّه السائق بإشعار عند رحلة جديدة أو إلغاء أو نفي مشرف المبنى.
 * والصفحة ظاهرة ترسل الموقع وتنبّه بنفسها، فلا ترسل الخدمة شيئًا.
 */
public class LocationService extends Service implements LocationListener {
    static final String ACTION_STOP = "com.sifrqr.althumama.driver.STOP";
    static volatile boolean running;

    private static final int NOTIFY_SHARING = 1;
    private static final int NOTIFY_TRIPS = 2;
    private static final int NOTIFY_ARRIVED = 3;
    private static final int NOTIFY_STOPPED = 4;
    private static final String CHANNEL_SHARING = "sharing";
    private static final String CHANNEL_TRIPS = "trips";
    /** مثل صفحة السائق: كل 20 ثانية، أو أسرع إذا تحركت السيارة 50 م، وبين إرسالين 5 ثوانٍ على الأقل */
    private static final long SEND_EVERY_MS = 20000;
    private static final long MIN_GAP_MS = 5000;
    private static final float MIN_MOVE_M = 50;
    private static final long POLL_MS = 30000;
    /** موقع الشبكة لا يُستعمل ما دام موقع GPS حديثًا */
    private static final long GPS_FRESH_MS = 30000;
    private static final String[] ACTIVE = { "تم إرسال السيارة", "وصلت السيارة", "تم استلام المريض" };

    private LocationManager locations;
    private Handler main;
    private ExecutorService network;
    private String plate = "";
    private String lang = "ar";
    private Location lastSent;
    private long lastSentAt;
    private long lastGpsAt;
    private boolean sending;
    /** رحلات السيارة الجارية ونفي مشرف المبنى في آخر سؤال (null قبل أول سؤال) */
    private Set<String> knownActive;
    private Set<String> knownDenials;

    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            if (!running) return;
            final String cookie = cookies();
            network.execute(new Runnable() {
                @Override
                public void run() {
                    final Response response = request("GET", "driver-trips", null, cookie);
                    main.post(new Runnable() {
                        @Override
                        public void run() {
                            onTrips(response);
                        }
                    });
                }
            });
            main.postDelayed(this, POLL_MS);
        }
    };

    static void start(Context context, String plate, String lang) {
        Intent intent = new Intent(context, LocationService.class).putExtra("plate", plate).putExtra("lang", lang);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
            else context.startService(intent);
        } catch (RuntimeException notAllowed) {
            // أندرويد يمنع تشغيلها الآن (التطبيق في الخلفية): تبدأ عند تشغيل الموقع التالي
        }
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, LocationService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        locations = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        main = new Handler(Looper.getMainLooper());
        network = Executors.newSingleThreadExecutor();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences prefs = getSharedPreferences("driver", MODE_PRIVATE);
        if (intent != null && intent.getStringExtra("plate") != null) {
            plate = intent.getStringExtra("plate");
            lang = intent.getStringExtra("lang") == null ? "ar" : intent.getStringExtra("lang");
            prefs.edit().putString("plate", plate).putString("lang", lang).apply();
        } else {
            plate = prefs.getString("plate", "");
            lang = prefs.getString("lang", "ar");
        }
        createChannels();
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFY_SHARING, sharingNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            else startForeground(NOTIFY_SHARING, sharingNotification());
        } catch (RuntimeException notAllowed) {
            shutdown();
            return START_NOT_STICKY;
        }
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            // زر «إيقاف المشاركة» في الإشعار
            final String cookie = cookies();
            network.execute(new Runnable() {
                @Override
                public void run() {
                    request("POST", "location", "{\"sharing\":false}", cookie);
                }
            });
            MainActivity.sharingStopped();
            shutdown();
            return START_NOT_STICKY;
        }
        if (!hasLocation()) {
            shutdown();
            return START_NOT_STICKY;
        }
        if (!running) {
            running = true;
            listen();
            main.postDelayed(poll, 3000);
        }
        return START_STICKY;
    }

    private boolean hasLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void listen() {
        List<String> providers = locations.getAllProviders();
        try {
            if (providers.contains(LocationManager.GPS_PROVIDER)) {
                locations.requestLocationUpdates(LocationManager.GPS_PROVIDER, 5000, 0, this, Looper.getMainLooper());
            }
            if (providers.contains(LocationManager.NETWORK_PROVIDER)) {
                locations.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 15000, 0, this, Looper.getMainLooper());
            }
        } catch (SecurityException | IllegalArgumentException error) {
            // لا إذن أو لا مزوّد: الصفحة تبقى ترسل وهي ظاهرة
        }
    }

    @Override
    public void onLocationChanged(Location location) {
        if (!running) return;
        long now = System.currentTimeMillis();
        if (LocationManager.GPS_PROVIDER.equals(location.getProvider())) lastGpsAt = now;
        else if (now - lastGpsAt < GPS_FRESH_MS) return;
        if (MainActivity.visible || sending || plate.isEmpty()) return;
        if (lastSent != null) {
            long since = now - lastSentAt;
            if (since < MIN_GAP_MS) return;
            if (since < SEND_EVERY_MS && lastSent.distanceTo(location) < MIN_MOVE_M) return;
        }
        lastSent = location;
        lastSentAt = now;
        send(location);
    }

    private void send(Location location) {
        final String body;
        try {
            JSONObject json = new JSONObject();
            json.put("sharing", true);
            json.put("lat", location.getLatitude());
            json.put("lng", location.getLongitude());
            json.put("accuracy", location.hasAccuracy() ? Math.round(location.getAccuracy()) : JSONObject.NULL);
            json.put("speed", location.hasSpeed() ? Math.round(location.getSpeed() * 3.6f) : JSONObject.NULL);
            json.put("heading", location.hasBearing() ? Math.round(location.getBearing()) : JSONObject.NULL);
            body = json.toString();
        } catch (JSONException error) {
            return;
        }
        final String cookie = cookies();
        sending = true;
        network.execute(new Runnable() {
            @Override
            public void run() {
                final Response response = request("POST", "location", body, cookie);
                main.post(new Runnable() {
                    @Override
                    public void run() {
                        sending = false;
                        onSent(response);
                    }
                });
            }
        });
    }

    private void onSent(Response response) {
        if (!running) return;
        if (response.status == 401) {
            stopped(Texts.signedOutText(lang));
            return;
        }
        JSONObject json = response.json();
        if (response.status == 400 && json != null && "no_vehicle".equals(json.optString("code"))) {
            stopped(Texts.noVehicleText(lang));
            return;
        }
        // الخادم اكتشف وصول السيارة إلى وجهة رحلة جارية
        if (response.status == 200 && json != null && json.optInt("arrived", 0) > 0 && !MainActivity.visible) {
            notify(NOTIFY_ARRIVED, CHANNEL_TRIPS, Texts.arrived(lang), Texts.arrivedText(lang), null);
        }
    }

    /** رحلات السيارة: تنبيه بما تغيّر منذ السؤال السابق، والتطبيق في الخلفية فقط. */
    private void onTrips(Response response) {
        if (!running) return;
        if (response.status == 401) {
            stopped(Texts.signedOutText(lang));
            return;
        }
        JSONObject json = response.json();
        if (response.status != 200 || json == null) return;
        JSONArray requests = json.optJSONArray("requests");
        if (requests == null) return;
        Set<String> all = new HashSet<>();
        Set<String> active = new HashSet<>();
        Set<String> denials = new HashSet<>();
        List<String> fresh = new ArrayList<>();
        for (int index = 0; index < requests.length(); index++) {
            JSONObject request = requests.optJSONObject(index);
            if (request == null) continue;
            String id = request.optString("id", "");
            String status = request.optString("status", "");
            if (id.isEmpty()) continue;
            all.add(id);
            if (isActive(status)) {
                active.add(id);
                if (knownActive != null && !knownActive.contains(id) && ACTIVE[0].equals(status)) fresh.add(id);
            }
            if ("denied".equals(request.optString("arrivalCheck"))) denials.add(id + ":arrival:" + request.optString("arrivalCheckAt"));
            if ("denied".equals(request.optString("pickupCheck"))) denials.add(id + ":pickup:" + request.optString("pickupCheckAt"));
        }
        if (knownActive != null && !MainActivity.visible) {
            int cancelled = 0;
            for (String id : knownActive) if (!all.contains(id)) cancelled++;
            boolean denied = false;
            for (String key : denials) if (!knownDenials.contains(key)) denied = true;
            if (!fresh.isEmpty()) notify(NOTIFY_TRIPS, CHANNEL_TRIPS, Texts.newTrips(lang, fresh.size()), Texts.newTripText(lang), fresh.get(0));
            else if (denied) notify(NOTIFY_TRIPS, CHANNEL_TRIPS, Texts.denied(lang), Texts.deniedText(lang), null);
            else if (cancelled > 0) notify(NOTIFY_TRIPS, CHANNEL_TRIPS, Texts.cancelledTrips(lang, cancelled), Texts.newTripText(lang), null);
        }
        knownActive = active;
        knownDenials = denials;
    }

    private static boolean isActive(String status) {
        for (String item : ACTIVE) if (item.equals(status)) return true;
        return false;
    }

    /** توقفت المشاركة لسبب من الخادم: إشعار بالسبب، وتتوقف في الصفحة أيضًا. */
    private void stopped(String reason) {
        notify(NOTIFY_STOPPED, CHANNEL_TRIPS, Texts.signedOut(lang), reason, null);
        MainActivity.sharingStopped();
        shutdown();
    }

    private void shutdown() {
        running = false;
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        running = false;
        try {
            locations.removeUpdates(this);
        } catch (SecurityException error) {
            // لا شيء
        }
        main.removeCallbacksAndMessages(null);
        network.shutdown();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // أندرويد 10 وأقدم يستدعي هذه أيضًا (لا قيمة افتراضية لها هناك)
    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {}

    @Override
    public void onProviderEnabled(String provider) {}

    @Override
    public void onProviderDisabled(String provider) {}

    // ————— الإشعارات —————

    private void createChannels() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel sharing = new NotificationChannel(CHANNEL_SHARING, Texts.sharingChannel(lang), NotificationManager.IMPORTANCE_LOW);
        sharing.setShowBadge(false);
        manager.createNotificationChannel(sharing);
        NotificationChannel trips = new NotificationChannel(CHANNEL_TRIPS, Texts.tripsChannel(lang), NotificationManager.IMPORTANCE_HIGH);
        trips.enableVibration(true);
        trips.setVibrationPattern(new long[] { 0, 400, 150, 400, 150, 400 });
        manager.createNotificationChannel(trips);
    }

    private Notification.Builder builder(String channel) {
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, channel) : new Notification.Builder(this);
        return builder.setSmallIcon(R.drawable.ic_notification).setColor(0xFF0B2545);
    }

    private PendingIntent openApp(String trip, int code) {
        Intent intent = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (trip != null) intent.putExtra(MainActivity.EXTRA_TRIP, trip);
        return PendingIntent.getActivity(this, code, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification sharingNotification() {
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, LocationService.class).setAction(ACTION_STOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return builder(CHANNEL_SHARING)
            .setContentTitle(Texts.sharingTitle(lang, plate))
            .setContentText(Texts.sharingText(lang))
            .setOngoing(true)
            .setContentIntent(openApp(null, 1))
            .addAction(new Notification.Action.Builder(Icon.createWithResource(this, R.drawable.ic_notification), Texts.stopSharing(lang), stop).build())
            .build();
    }

    private void notify(int id, String channel, String title, String text, String trip) {
        Notification.Builder builder = builder(channel)
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true)
            .setContentIntent(openApp(trip, id + 10));
        if (Build.VERSION.SDK_INT < 26) {
            builder.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        }
        getSystemService(NotificationManager.class).notify(id, builder.build());
    }

    // ————— الاتصال بالخادم بجلسة الصفحة —————

    /** كوكي جلسة السائق من الصفحة (يُقرأ على الخيط الرئيسي). */
    private static String cookies() {
        try {
            return CookieManager.getInstance().getCookie(MainActivity.SITE);
        } catch (RuntimeException error) {
            return null;
        }
    }

    private Response request(String method, String route, String body, String cookie) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(MainActivity.SITE + "api/index.php?r=" + route).openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(20000);
            connection.setUseCaches(false);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("X-Requested-With", "fetch");
            if (cookie != null) connection.setRequestProperty("Cookie", cookie);
            if (body != null) {
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setFixedLengthStreamingMode(bytes.length);
                OutputStream output = connection.getOutputStream();
                output.write(bytes);
                output.close();
            }
            int status = connection.getResponseCode();
            keepCookies(connection);
            InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            return new Response(status, input == null ? "" : read(input));
        } catch (IOException error) {
            return new Response(0, "");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    /** كوكي جديد من الخادم يُحفظ للصفحة أيضًا. */
    private void keepCookies(HttpURLConnection connection) {
        Map<String, List<String>> headers = connection.getHeaderFields();
        if (headers == null) return;
        for (Map.Entry<String, List<String>> header : headers.entrySet()) {
            if (header.getKey() == null || !header.getKey().equalsIgnoreCase("Set-Cookie")) continue;
            for (final String value : header.getValue()) {
                main.post(new Runnable() {
                    @Override
                    public void run() {
                        CookieManager.getInstance().setCookie(MainActivity.SITE, value);
                        CookieManager.getInstance().flush();
                    }
                });
            }
        }
    }

    private static String read(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        input.close();
        return new String(output.toByteArray(), StandardCharsets.UTF_8);
    }

    private static final class Response {
        final int status;
        final String body;

        Response(int status, String body) {
            this.status = status;
            this.body = body;
        }

        JSONObject json() {
            try {
                return new JSONObject(body);
            } catch (JSONException error) {
                return null;
            }
        }
    }
}
