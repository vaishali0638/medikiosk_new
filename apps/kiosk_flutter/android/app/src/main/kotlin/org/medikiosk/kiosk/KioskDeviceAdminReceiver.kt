package org.medikiosk.kiosk

import android.app.admin.DeviceAdminReceiver

/**
 * Device-owner receiver.
 *
 * Registered so the app can be provisioned as device owner through Android Enterprise.
 * Device-owner status is what makes lock-task mode non-dismissable; it must be set at
 * provisioning time (QR enrolment or `dpm set-device-owner` on a factory-reset device)
 * and cannot be acquired later on a device that already has accounts configured.
 */
class KioskDeviceAdminReceiver : DeviceAdminReceiver()
