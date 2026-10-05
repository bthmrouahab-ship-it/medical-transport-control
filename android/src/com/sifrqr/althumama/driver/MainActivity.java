package com.sifrqr.althumama.driver;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.List;

/**
 * تطبيق السائق لشاشة السيارة: صفحة السائق من الموقع داخل WebView (تتحدث مع كل نشر للموقع بلا تحديث التطبيق).
 * الروابط الخارجية (الاتصال وواتساب وخرائط جوجل وWaze) تفتح في تطبيقاتها، والشاشة تبقى مضاءة،
 * وعند تشغيل الموقع في الصفحة تبدأ LocationService فيستمر إرسال الموقع أثناء استعمال تطبيق الملاحة.
 */
public class MainActivity extends Activity {
    static final String SITE = "https://althumamacar.sifr-qr.com/";
    static final String HOST = "althumamacar.sifr-qr.com";
    static final String EXTRA_TRIP = "trip";
    /** علامة في وكيل المتصفح تعرف بها الصفحة أنها داخل التطبيق */
    static final String USER_AGENT_TOKEN = "AlthumamaDriverApp/";
    private static final int REQUEST_PERMISSIONS = 1;

    /** الصفحة ظاهرة: صفحة السائق ترسل الموقع بنفسها، والخدمة ترسله فقط والتطبيق في الخلفية. */
    static volatile boolean visible;
    private static MainActivity current;

    private WebView web;
    private View offline;
    private boolean failed;
    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        current = this;
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        offline = offlineView();
        offline.setVisibility(View.GONE);
        root.addView(offline, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        setupWebView();
        askPermissions();
        web.loadUrl(urlFor(getIntent()));
    }

    private void setupWebView() {
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(true);
        // صوت تنبيه الرحلة الجديدة بلا لمس الشاشة
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setAllowFileAccess(false);
        settings.setUserAgentString(settings.getUserAgentString() + " " + USER_AGENT_TOKEN + versionName());
        CookieManager.getInstance().setAcceptCookie(true);

        web.addJavascriptInterface(new Bridge(), "AlthumamaApp");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
                if (!failed) offline.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                failed = true;
                offline.setVisibility(View.VISIBLE);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (!HOST.equalsIgnoreCase(Uri.parse(origin).getHost())) {
                    callback.invoke(origin, false, false);
                    return;
                }
                if (hasLocation()) {
                    callback.invoke(origin, true, false);
                    return;
                }
                geoOrigin = origin;
                geoCallback = callback;
                requestPermissions(new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, REQUEST_PERMISSIONS);
            }
        });
    }

    /** صفحات الموقع داخل التطبيق، وكل رابط آخر في تطبيقه. */
    private boolean handleUrl(Uri uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        if ((scheme.equals("https") || scheme.equals("http")) && HOST.equalsIgnoreCase(uri.getHost())) return false;
        if (scheme.equals("about") || scheme.equals("data") || scheme.equals("blob") || scheme.equals("javascript")) return false;
        openExternal(uri);
        return true;
    }

    private void openExternal(Uri uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        try {
            if (scheme.equals("intent")) {
                Intent intent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                intent.setComponent(null);
                intent.setSelector(null);
                try {
                    startActivity(intent);
                } catch (ActivityNotFoundException missing) {
                    String fallback = intent.getStringExtra("browser_fallback_url");
                    if (fallback != null) openExternal(Uri.parse(fallback));
                    else noApp();
                }
                return;
            }
            Intent intent = new Intent(scheme.equals("tel") ? Intent.ACTION_DIAL : Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (ActivityNotFoundException | URISyntaxException error) {
            noApp();
        }
    }

    private void noApp() {
        Toast.makeText(this, "لا يوجد تطبيق يفتح هذا الرابط على هذا الجهاز\nNo app on this device can open this link", Toast.LENGTH_LONG).show();
    }

    /** يُطلب إذن الموقع (والإشعارات في أندرويد 13 وأحدث) عند أول فتح. */
    private void askPermissions() {
        List<String> missing = new ArrayList<>();
        if (!hasLocation()) {
            missing.add(Manifest.permission.ACCESS_FINE_LOCATION);
            missing.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (!missing.isEmpty()) requestPermissions(missing.toArray(new String[0]), REQUEST_PERMISSIONS);
    }

    boolean hasLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (geoCallback != null) {
            geoCallback.invoke(geoOrigin, hasLocation(), false);
            geoCallback = null;
            geoOrigin = null;
        }
    }

    /** شاشة «لا يوجد اتصال» عند فشل فتح الموقع، مع «إعادة المحاولة». */
    private View offlineView() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.rgb(0xF4, 0xF6, 0xF9));
        int pad = dp(24);
        box.setPadding(pad, pad, pad, pad);
        box.setClickable(true);

        TextView title = new TextView(this);
        title.setText("لا يوجد اتصال بالإنترنت\nNo internet connection");
        title.setTextColor(Color.rgb(0x0B, 0x25, 0x45));
        title.setTextSize(22);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER);
        box.addView(title);

        TextView hint = new TextView(this);
        hint.setText("تحقق من الإنترنت في السيارة ثم أعد المحاولة\nCheck the internet in the vehicle and try again");
        hint.setTextColor(Color.rgb(0x47, 0x55, 0x69));
        hint.setTextSize(16);
        hint.setGravity(Gravity.CENTER);
        hint.setPadding(0, dp(12), 0, dp(20));
        box.addView(hint);

        Button retry = new Button(this);
        retry.setText("إعادة المحاولة · Retry");
        retry.setTextSize(18);
        retry.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                failed = false;
                offline.setVisibility(View.GONE);
                if (web.getUrl() == null || !web.getUrl().startsWith("http")) web.loadUrl(SITE);
                else web.reload();
            }
        });
        box.addView(retry, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(64)));
        return box;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException error) {
            return "1";
        }
    }

    /** الضغط على إشعار رحلة يفتح الصفحة على الرحلة (?trip= كما في إشعارات الموقع). */
    private static String urlFor(Intent intent) {
        String trip = intent == null ? null : intent.getStringExtra(EXTRA_TRIP);
        return trip == null ? SITE : SITE + "?trip=" + Uri.encode(trip);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String trip = intent.getStringExtra(EXTRA_TRIP);
        if (trip != null) dispatch("althumama-open", JSONObject.quote(trip));
    }

    /** حدث للصفحة (window) يحمل قيمة JSON. */
    private void dispatch(String event, String detailJson) {
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('" + event + "', { detail: " + detailJson + " }))", null);
    }

    /** من الخدمة: أوقف مشاركة الموقع في الصفحة أيضًا (زر الإيقاف في الإشعار أو انتهاء الجلسة). */
    static void sharingStopped() {
        final MainActivity activity = current;
        if (activity == null) return;
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (activity.web != null) activity.dispatch("althumama-sharing", "false");
            }
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        visible = true;
        web.onResume();
    }

    @Override
    protected void onPause() {
        visible = false;
        web.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        // لا يُغلق التطبيق: يبقى في الخلفية ومعه مشاركة الموقع
        else moveTaskToBack(true);
    }

    @Override
    protected void onDestroy() {
        if (current == this) current = null;
        visible = false;
        web.destroy();
        super.onDestroy();
    }

    /** ما تستدعيه صفحة السائق: window.AlthumamaApp */
    public final class Bridge {
        /** تشغيل مشاركة الموقع في الصفحة أو إيقافها (والسيارة ولغة الإشعارات). */
        @JavascriptInterface
        public void setSharing(final boolean on, final String plate, final String lang) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (on && hasLocation()) LocationService.start(MainActivity.this, plate, lang);
                    else if (!on) LocationService.stop(MainActivity.this);
                }
            });
        }

        /** المشاركة تعمل في الخدمة: تعود الصفحة إليها بعد إعادة تحميلها. */
        @JavascriptInterface
        public boolean isSharing() {
            return LocationService.running;
        }

        @JavascriptInterface
        public String version() {
            return versionName();
        }
    }
}
