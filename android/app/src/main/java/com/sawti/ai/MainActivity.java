package com.sawti.ai;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register custom native plugins before super.onCreate loads the bridge
        registerPlugin(NabraDownloadPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
