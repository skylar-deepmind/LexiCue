//! The same alias evidence is used for the bundled index and installed packs.
pub const PACK_ALIAS_EVIDENCE: &str =
    "SELECT a.surface_id,min(e.surface_id),max(e.surface_id),max(a.kind IN (1,3))
    FROM aliases a CROSS JOIN entries e ON e.source_line=a.entry_line GROUP BY a.surface_id";
