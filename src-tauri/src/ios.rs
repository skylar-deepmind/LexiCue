use tauri::WebviewWindow;

#[link(name = "AVFAudio", kind = "framework")]
unsafe extern "C" {}

/// Activate only for an explicit playback request; never interrupt other audio at launch.
pub fn prepare_audio_session() -> Result<(), String> {
    unsafe {
        let session: *mut objc2::runtime::AnyObject =
            objc2::msg_send![objc2::class!(AVAudioSession), sharedInstance];
        let mut error: *mut objc2_foundation::NSError = std::ptr::null_mut();
        let category = objc2_foundation::ns_string!("AVAudioSessionCategoryPlayback");
        let ok: bool = objc2::msg_send![session, setCategory: category, error: &mut error];
        if !ok {
            return Err("audio_session_category".into());
        }
        let ok: bool = objc2::msg_send![session, setActive: true, error: &mut error];
        if !ok {
            return Err("audio_session_activation".into());
        }
        Ok(())
    }
}

/// Fill the native window and prevent UIKit from also subtracting safe areas.
/// CSS owns content insets, including when the keyboard changes the viewport.
pub fn fit_webview(window: &WebviewWindow) {
    let _ = window.with_webview(|webview| unsafe {
        let view = &*(webview.inner() as *mut objc2_ui_kit::UIView);
        let scroll: *mut objc2_ui_kit::UIScrollView = objc2::msg_send![view, scrollView];
        let scroll = &*scroll;
        scroll.setContentInsetAdjustmentBehavior(
            objc2_ui_kit::UIScrollViewContentInsetAdjustmentBehavior::Never,
        );
        scroll.setContentInset(objc2_ui_kit::UIEdgeInsets {
            top: 0.0,
            left: 0.0,
            bottom: 0.0,
            right: 0.0,
        });
        if let Some(window) = view.window() {
            let bounds = window.bounds();
            if let Some(parent) = view.superview() {
                parent.setFrame(bounds);
            }
            view.setFrame(bounds);
        }
    });
}
