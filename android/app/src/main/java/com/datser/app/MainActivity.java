package com.datser.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.text.TextUtils;
import android.text.InputType;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.EditText;
import android.widget.LinearLayout;

import androidx.appcompat.app.AlertDialog;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final String TEST_PACKAGE_SUFFIX = ".memberv2test";
    private static final String TEST_PREFS = "datser_member_v2_test";
    private static final String URL_KEY = "url";
    private static final String ANON_KEY = "anon_key";
    private static final String WEB_STORAGE_KEY = "datser.member-v2.android-test.local-supabase";
    private static final String URL_EXTRA = "datser_member_v2_local_supabase_url";
    private static final String ANON_KEY_EXTRA = "datser_member_v2_local_supabase_anon_key";
    private boolean configurationPromptShown = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        acceptTestConfiguration(getIntent());
        showConfigurationPromptIfNeeded();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        acceptTestConfiguration(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        injectStoredTestConfiguration();
    }

    private boolean isMemberV2ValidationApp() {
        return getPackageName().endsWith(TEST_PACKAGE_SUFFIX);
    }

    private void acceptTestConfiguration(Intent intent) {
        if (!isMemberV2ValidationApp() || intent == null) return;
        String url = intent.getStringExtra(URL_EXTRA);
        String anonKey = intent.getStringExtra(ANON_KEY_EXTRA);
        saveTestConfiguration(url, anonKey);
    }

    private boolean saveTestConfiguration(String url, String anonKey) {
        if (!isMemberV2ValidationApp() || TextUtils.isEmpty(url) || TextUtils.isEmpty(anonKey) || !isAllowedLocalUrl(url)) return false;
        getSharedPreferences(TEST_PREFS, MODE_PRIVATE)
            .edit()
            .putString(URL_KEY, url)
            .putString(ANON_KEY, anonKey)
            .apply();
        injectStoredTestConfiguration();
        return true;
    }

    private void showConfigurationPromptIfNeeded() {
        if (!isMemberV2ValidationApp() || configurationPromptShown) return;
        SharedPreferences preferences = getSharedPreferences(TEST_PREFS, MODE_PRIVATE);
        if (!TextUtils.isEmpty(preferences.getString(URL_KEY, null)) && !TextUtils.isEmpty(preferences.getString(ANON_KEY, null))) return;
        configurationPromptShown = true;
        new Handler().postDelayed(() -> {
            if (isFinishing() || isDestroyed()) return;
            LinearLayout form = new LinearLayout(this);
            int padding = (int) (20 * getResources().getDisplayMetrics().density);
            form.setPadding(padding, 0, padding, 0);
            form.setOrientation(LinearLayout.VERTICAL);
            EditText url = new EditText(this);
            url.setHint("Local API URL");
            url.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
            url.setText("http://10.0.2.2:54321");
            EditText anonKey = new EditText(this);
            anonKey.setHint("Local public anon key");
            anonKey.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
            form.addView(url, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            form.addView(anonKey, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Set up local Member V2 test")
                .setMessage("Enter only the local Supabase API URL and its public anon key. Do not enter a password or service key here.")
                .setView(form)
                .setNegativeButton("Later", null)
                .setPositiveButton("Save", null)
                .create();
            dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
                if (saveTestConfiguration(url.getText().toString().trim(), anonKey.getText().toString().trim())) {
                    dialog.dismiss();
                } else {
                    anonKey.setError("Use a local http URL and a public anon key.");
                }
            }));
            dialog.show();
        }, 700);
    }

    private boolean isAllowedLocalUrl(String value) {
        Uri uri = Uri.parse(value);
        if (!"http".equals(uri.getScheme())) return false;
        String host = uri.getHost();
        return "127.0.0.1".equals(host) || "localhost".equals(host) || "10.0.2.2".equals(host);
    }

    private void injectStoredTestConfiguration() {
        if (!isMemberV2ValidationApp() || getBridge() == null) return;
        SharedPreferences preferences = getSharedPreferences(TEST_PREFS, MODE_PRIVATE);
        String url = preferences.getString(URL_KEY, null);
        String anonKey = preferences.getString(ANON_KEY, null);
        if (TextUtils.isEmpty(url) || TextUtils.isEmpty(anonKey) || !isAllowedLocalUrl(url)) return;

        try {
            JSONObject config = new JSONObject();
            config.put("url", url);
            config.put("anonKey", anonKey);
            String script = "(function(){const key=" + JSONObject.quote(WEB_STORAGE_KEY)
                + ";const value=" + JSONObject.quote(config.toString())
                + ";if(localStorage.getItem(key)!==value){localStorage.setItem(key,value);location.reload();}})();";
            WebView webView = getBridge().getWebView();
            webView.post(() -> webView.evaluateJavascript(script, null));
        } catch (Exception ignored) {
            // Configuration failure only leaves the isolated test app unconfigured.
        }
    }
}
