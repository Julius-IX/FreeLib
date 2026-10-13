//! Grouped Tauri commands + generated TypeScript bindings.
//!
//! - `#[command(group)]` / `#[group]` register commands in a link-time registry.
//! - `#[derive(TsType)]` does the same for your data types (DB tables etc).
//! - [`handler`] builds the `invoke_handler` from the registry.
//! - [`export_ts`] writes `commands.ts` (the invoke wrappers) and `types.ts`
//!   (the `TsType` declarations) from the registry.

mod registry;
mod ts_type;

pub use registry::{
  export_ts, handler, render_commands_ts, render_types_ts, Arg, CommandEntry, Sig, TypeEntry,
};
pub use tauri_groups_macros::{command, group, TsType};
pub use ts_type::TsType;

#[doc(hidden)]
pub mod __private {
  pub use inventory;
}
