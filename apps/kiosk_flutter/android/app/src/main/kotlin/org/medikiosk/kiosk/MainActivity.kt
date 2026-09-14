package org.medikiosk.kiosk

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Kiosk host activity.
 *
 * Three separate protections, which are often confused:
 *
 *  - Immersive mode hides the system bars. Presentation only; a swipe brings them back.
 *  - Lock-task mode stops the patient leaving the app at all. This is the real control.
 *  - Device-owner provisioning is what makes lock-task mode non-dismissable. Without it,
 *    Android shows a "pinned" screen the user can exit by holding Back and Overview.
 *
 * Only the combination is a locked-down kiosk, which is why [buildState] reports all
 * three separately and never collapses them into a single boolean.
 */
class MainActivity : FlutterActivity() {

    private companion object {
        const val CHANNEL = "org.medikiosk/kiosk_lock"
    }

    private var audioGuidance: AudioGuidanceHandler? = null

    private val devicePolicyManager: DevicePolicyManager
        get() = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager

    private val adminComponent: ComponentName
        get() = ComponentName(this, KioskDeviceAdminReceiver::class.java)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applyScreenshotBlock()
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        // Spoken guidance. Registered here because the Dart side has expected this channel
        // since Phase 3 and nothing answered it, which made Audio Guidance a button that
        // did nothing on every device the app has ever run on.
        audioGuidance = AudioGuidanceHandler(this).also { handler ->
            MethodChannel(flutterEngine.dartExecutor.binaryMessenger, AudioGuidanceHandler.CHANNEL)
                .setMethodCallHandler(handler)
        }

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler {
            call, result ->
            when (call.method) {
                "engage" -> {
                    applyScreenshotBlock()
                    engageLockTask()
                    result.success(buildState())
                }
                "state" -> result.success(buildState())
                else -> result.notImplemented()
            }
        }
    }

    /**
     * FLAG_SECURE blocks screenshots, screen recording and the recents-list thumbnail.
     * The thumbnail matters most: without it, the previous patient's screen can be shown
     * to the next person by the system itself.
     */
    private fun applyScreenshotBlock() {
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
    }

    private fun engageLockTask() {
        val isOwner = devicePolicyManager.isDeviceOwnerApp(packageName)

        if (isOwner) {
            // Whitelist ourselves so lock-task starts without the "screen pinned" prompt.
            devicePolicyManager.setLockTaskPackages(adminComponent, arrayOf(packageName))

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                // Suppress the system UI a patient could otherwise use to leave: no home,
                // no overview, no notifications, no global actions (power menu).
                devicePolicyManager.setLockTaskFeatures(
                    adminComponent,
                    DevicePolicyManager.LOCK_TASK_FEATURE_KEYGUARD,
                )
            }
        }

        // Starting lock-task without device-owner still pins the screen, which is weaker
        // but better than nothing on a device pending MDM enrolment.
        if (!isInLockTaskMode()) {
            startLockTask()
        }
    }

    private fun isInLockTaskMode(): Boolean {
        val activityManager =
            getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
        return activityManager.lockTaskModeState !=
            android.app.ActivityManager.LOCK_TASK_MODE_NONE
    }

    private fun buildState(): Map<String, Any> = mapOf(
        "lockTaskActive" to isInLockTaskMode(),
        "isDeviceOwner" to devicePolicyManager.isDeviceOwnerApp(packageName),
        // Read back from the window rather than assuming the call above took effect.
        "screenshotsBlocked" to
            ((window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE) != 0),
    )

    /**
     * Back is inert while a patient is inside the workflow.
     *
     * Navigation is Exit, and Exit is explicit and confirmed. An accidental Back that
     * dropped a patient out of a half-finished intake would either lose their answers or,
     * worse, leave them visible to the next person.
     */
    @Deprecated("Required while targeting API levels below 33")
    override fun onBackPressed() {
        // Intentionally does nothing.
    }

    /**
     * The TTS engine holds a system service connection. Left open it survives the activity,
     * and on a kiosk that restarts into the same app all day that is a slow leak — and,
     * worse, audio from a previous patient's session that can still be resumed.
     */
    override fun onDestroy() {
        audioGuidance?.dispose()
        audioGuidance = null
        super.onDestroy()
    }
}
