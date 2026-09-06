package com.bhoomidwellers.crm;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CallRecordingPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
