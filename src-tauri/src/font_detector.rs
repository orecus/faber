//! Cross-platform font detection using font-kit.
//!
//! Detects available monospace and terminal fonts on the user's system,
//! with special handling for Nerd Font variants.

use font_kit::source::SystemSource;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Information about an available font on the system.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailableFont {
    /// The font family name (e.g., "JetBrains Mono")
    pub family: String,
    /// Whether this is a Nerd Font variant
    pub is_nerd_font: bool,
    /// Whether this font is monospace (suitable for terminals)
    pub is_monospace: bool,
}

/// Priority list of terminal fonts to detect.
/// Order matters - higher priority fonts appear first.
const PREFERRED_FONTS: &[&str] = &[
    // Nerd Font variants (highest priority for terminal use)
    "JetBrainsMono Nerd Font",
    "JetBrainsMono NF",
    "FiraCode Nerd Font",
    "FiraCode NF",
    "CaskaydiaCove Nerd Font",
    "CaskaydiaCove NF",
    "Hack Nerd Font",
    "Hack NF",
    "MesloLGS Nerd Font",
    "MesloLGS NF",
    "Meslo LG S",
    "SourceCodePro Nerd Font",
    "SauceCodePro Nerd Font",
    "DejaVuSansMono Nerd Font",
    "RobotoMono Nerd Font",
    "UbuntuMono Nerd Font",
    "Inconsolata Nerd Font",
    "DroidSansMono Nerd Font",
    // Standard monospace fonts
    "JetBrains Mono",
    "Fira Code",
    "Cascadia Code",
    "Cascadia Mono",
    "Source Code Pro",
    "SF Mono",
    "Monaco",
    "Menlo",
    "Consolas",
    "DejaVu Sans Mono",
    "Ubuntu Mono",
    "Roboto Mono",
    "Inconsolata",
    "Droid Sans Mono",
    "Liberation Mono",
    "Courier New",
];

/// Check if a font name indicates it's a Nerd Font variant.
fn is_nerd_font(family: &str) -> bool {
    let lower = family.to_lowercase();
    lower.contains("nerd font")
        || lower.contains(" nf")
        || lower.ends_with("nf")
        || lower.contains("nerd")
}

/// Check if a font name suggests it's monospace.
fn is_likely_monospace(family: &str) -> bool {
    let lower = family.to_lowercase();
    lower.contains("mono")
        || lower.contains("code")
        || lower.contains("console")
        || lower.contains("terminal")
        || lower.contains("courier")
        || lower.contains("nerd font")
        || lower.contains(" nf")
        || lower.ends_with("nf")
        || PREFERRED_FONTS
            .iter()
            .any(|pf| pf.to_lowercase() == lower)
}

/// Detect available fonts on the system.
///
/// Returns a list of available fonts, sorted by priority (Nerd Fonts first,
/// then standard monospace fonts).
pub fn detect_available_fonts() -> Vec<AvailableFont> {
    let source = SystemSource::new();
    let mut found_fonts: Vec<AvailableFont> = Vec::new();
    let mut seen_families: HashSet<String> = HashSet::new();

    // First, check preferred fonts in priority order
    for font_name in PREFERRED_FONTS {
        if seen_families.contains(*font_name) {
            continue;
        }

        if let Ok(handle) = source.select_family_by_name(font_name) {
            if !handle.fonts().is_empty() {
                let family = font_name.to_string();
                seen_families.insert(family.clone());
                found_fonts.push(AvailableFont {
                    family,
                    is_nerd_font: is_nerd_font(font_name),
                    is_monospace: true,
                });
            }
        }
    }

    // Then, scan all system fonts for additional monospace fonts
    if let Ok(families) = source.all_families() {
        for family in families {
            if seen_families.contains(&family) {
                continue;
            }

            if is_likely_monospace(&family) {
                seen_families.insert(family.clone());
                found_fonts.push(AvailableFont {
                    family: family.clone(),
                    is_nerd_font: is_nerd_font(&family),
                    is_monospace: true,
                });
            }
        }
    }

    found_fonts
}

/// Check if a specific font family is available on the system.
pub fn is_font_available(family: &str) -> bool {
    let source = SystemSource::new();
    if let Ok(handle) = source.select_family_by_name(family) {
        return !handle.fonts().is_empty();
    }
    false
}
