fn main() {
  // `sqlx::migrate!()` embeds the migration files at compile time. Without this, adding a new
  // file to the folder does not make cargo recompile, and the new migration is silently skipped.
  println!("cargo:rerun-if-changed=migrations");
  tauri_build::build();
}
