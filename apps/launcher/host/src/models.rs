//! The model snapshot the UI selects from.
//!
//! The snapshot comes from Jouzu's `available-models` control action: the runtime
//! projection is joined with the active catalog's limits/prices, and thinking levels
//! come from pi-ai's `getSupportedThinkingLevels`. The host never reads
//! `cache/model-catalog/**`; the adapter returns already-joined rows and the host
//! keeps that answer in memory so a page reload costs no process.
//!
//! The answer depends on sign-ins, keys, providers and catalogs, which change through
//! Settings, through saved environment variables, or through Jouzu in a terminal that
//! shares the data folder. It is therefore never kept across host starts, and every
//! successful change through the host drops it (issue #84): a snapshot written once
//! and reused for days kept offering models of a signed-out account and never listed
//! providers added later.

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde_json::{json, Value};

use crate::{
    control::ControlManager,
    session::ApiError,
};

pub struct Models {
    path: PathBuf,
    cached: Mutex<Option<Value>>,
}

/// Bump when the adapter projection changes shape or filtering semantics.
const SCHEMA_VERSION: u64 = 3;

impl Models {
    pub fn new(host_home: &Path) -> Self {
        let path = host_home.join("host-state").join("models.json");
        // Older hosts kept the snapshot on disk; it may describe another account.
        let _ = std::fs::remove_file(&path);
        Self {
            path,
            cached: Mutex::new(None),
        }
    }

    fn load(&self) -> Option<Value> {
        self.cached
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    /// Settings changed: the next request lists the models again.
    pub fn invalidate(&self) {
        *self
            .cached
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
        let _ = std::fs::remove_file(&self.path);
    }

    fn store(&self, value: Value) -> Value {
        *self
            .cached
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(value.clone());
        value
    }

    /// The snapshot, built once from the adapter when nothing is cached yet.
    pub async fn get(&self, control: &ControlManager) -> Result<Value, ApiError> {
        if let Some(value) = self.load() {
            return Ok(annotate(value));
        }
        self.enumerate(control).await.map(annotate)
    }

    /// Refresh through Jouzu, then re-enumerate. A failure keeps the previous snapshot.
    pub async fn refresh(&self, control: &ControlManager) -> Result<Value, ApiError> {
        if let Err(error) = control
            .request(json!({ "action": "refresh-catalogs" }))
            .await
        {
            return match self.load() {
                Some(mut previous) => {
                    previous["stale"] = Value::Bool(true);
                    previous["warning"] = Value::String(error.message.clone());
                    Ok(annotate(previous))
                }
                None => Err(error),
            };
        }
        self.enumerate(control).await.map(annotate)
    }

    async fn enumerate(&self, control: &ControlManager) -> Result<Value, ApiError> {
        // The configuration service runs one operation at a time. At startup the UI's
        // status read and catalog refresh run beside this listing; wait for them
        // instead of answering "no models" while they finish.
        let mut answer = control.request(json!({ "action": "available-models" })).await;
        for _ in 0..120 {
            match &answer {
                Err(error) if error.code == "control-busy" => {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    answer = control.request(json!({ "action": "available-models" })).await;
                }
                _ => break,
            }
        }
        let status = answer
            .map_err(|error| {
                ApiError::new(
                    axum::http::StatusCode::SERVICE_UNAVAILABLE,
                    "models-unavailable",
                    error.message,
                    true,
                )
            })?;
        let models = status
            .get("models")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if models.is_empty() {
            return Err(ApiError::new(
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                "models-unavailable",
                "No usable model is configured yet",
                true,
            ));
        }
        Ok(self.store(json!({
            "schemaVersion": SCHEMA_VERSION,
            "source": "control.available-models",
            "generatedAt": status
                .get("generatedAt")
                .and_then(Value::as_str)
                .map(ToString::to_string)
                .unwrap_or_else(now),
            "models": models,
            "defaultProvider": status.get("defaultProvider").cloned().unwrap_or(Value::Null),
            "defaultModel": status.get("defaultModel").cloned().unwrap_or(Value::Null),
            "stale": false,
        })))
    }

}

/// Why the runtime cannot use a listed model, if it cannot. Jouzu registers a
/// catalog offering with Pi only when the catalog gives its output limit; the
/// control listing still shows such offerings, and choosing one used to fail
/// later with "Model not found" while the session went on with another model.
fn unusable_reason(model: &Value) -> Option<&'static str> {
    let catalog = model
        .get("provider")
        .and_then(Value::as_str)
        .is_some_and(|provider| provider.starts_with("catalog:"));
    let no_limit = model.get("maxTokens").map(Value::is_null).unwrap_or(true);
    (catalog && no_limit).then_some(
        "Not a chat model: the catalog gives it no output limit, so the runtime does not offer it for chat.",
    )
}

/// Mark each row `available`, with the reason when it is not.
fn annotate(mut snapshot: Value) -> Value {
    if let Some(models) = snapshot.get_mut("models").and_then(Value::as_array_mut) {
        for model in models {
            let reason = unusable_reason(model);
            model["available"] = Value::Bool(reason.is_none());
            model["unavailableReason"] = reason.map(Value::from).unwrap_or(Value::Null);
        }
    }
    snapshot
}

impl Models {
    /// Whether a session may switch to this model: `Err` with the reason when the
    /// runtime cannot use it. Models the listing does not know are left to the
    /// runtime to judge.
    pub fn check_usable(&self, provider: &str, id: &str) -> Result<(), String> {
        let Some(snapshot) = self.load() else {
            return Ok(());
        };
        let row = snapshot
            .get("models")
            .and_then(Value::as_array)
            .and_then(|models| {
                models.iter().find(|model| {
                    model.get("provider").and_then(Value::as_str) == Some(provider)
                        && model.get("id").and_then(Value::as_str) == Some(id)
                })
            });
        match row.and_then(unusable_reason) {
            Some(reason) => Err(reason.to_string()),
            None => Ok(()),
        }
    }
}

impl Models {
    /// Whether the pair exists in the current snapshot.
    pub fn allows(&self, provider: &str, id: &str) -> bool {
        let Some(snapshot) = self.load() else {
            return false;
        };
        snapshot
            .get("models")
            .and_then(Value::as_array)
            .map(|models| {
                models.iter().any(|model| {
                    model.get("provider").and_then(Value::as_str) == Some(provider)
                        && model.get("id").and_then(Value::as_str) == Some(id)
                })
            })
            .unwrap_or(false)
    }

    /// The runtime's default model, which a new session uses until the user
    /// picks another. A session that has not started its runtime yet reports
    /// this, so the user can send without picking a model first.
    pub fn default_model(&self) -> Option<Value> {
        let snapshot = self.load()?;
        let provider = snapshot.get("defaultProvider").and_then(Value::as_str)?;
        let id = snapshot.get("defaultModel").and_then(Value::as_str)?;
        if !self.allows(provider, id) || self.check_usable(provider, id).is_err() {
            return None;
        }
        let name = self.display_name(provider, id).unwrap_or_else(|| id.to_string());
        Some(json!({ "provider": provider, "id": id, "name": name }))
    }

    /// The name for a pair, for the session model state.
    pub fn display_name(&self, provider: &str, id: &str) -> Option<String> {
        let snapshot = self.load()?;
        snapshot
            .get("models")
            .and_then(Value::as_array)?
            .iter()
            .find(|model| {
                model.get("provider").and_then(Value::as_str) == Some(provider)
                    && model.get("id").and_then(Value::as_str) == Some(id)
            })
            .and_then(|model| model.get("name").and_then(Value::as_str))
            .map(ToString::to_string)
    }
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
mod default_model_tests {
    use super::*;

    fn write(home: &Path, default_model: &str) -> Models {
        let models = Models::new(home);
        models.store(json!({
            "schemaVersion": SCHEMA_VERSION,
            "models": [{ "provider": "shisa", "id": "qwen", "name": "Qwen 3.8" }],
            "defaultProvider": "shisa",
            "defaultModel": default_model,
        }));
        models
    }

    /// Issue #84: a snapshot an older host left on disk may describe a signed-out
    /// account or miss a provider added since; it is never served.
    #[test]
    fn a_snapshot_left_on_disk_is_not_served() {
        let home = tempfile::tempdir().unwrap();
        let directory = home.path().join("host-state");
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(
            directory.join("models.json"),
            json!({ "schemaVersion": SCHEMA_VERSION, "models": [{ "provider": "shisa", "id": "old" }] }).to_string(),
        )
        .unwrap();
        let models = Models::new(home.path());
        assert!(models.load().is_none());
        assert!(!directory.join("models.json").exists());
    }

    /// Issue #84: a settings change drops the snapshot, so the next listing is new.
    #[test]
    fn a_settings_change_drops_the_snapshot() {
        let home = tempfile::tempdir().unwrap();
        let models = write(home.path(), "qwen");
        assert!(models.load().is_some());
        models.invalidate();
        assert!(models.load().is_none());
        assert_eq!(models.default_model(), None);
    }

    #[test]
    fn a_new_session_starts_from_the_listed_default() {
        let home = tempfile::tempdir().unwrap();
        let models = write(home.path(), "qwen");
        assert_eq!(
            models.default_model(),
            Some(json!({ "provider": "shisa", "id": "qwen", "name": "Qwen 3.8" }))
        );
    }

    #[test]
    fn a_default_missing_from_the_list_is_not_offered() {
        let home = tempfile::tempdir().unwrap();
        let models = write(home.path(), "gone");
        assert_eq!(models.default_model(), None);
    }

    #[test]
    fn a_catalog_offering_without_an_output_limit_is_marked_unusable() {
        let home = tempfile::tempdir().unwrap();
        let models = Models::new(home.path());
        models.store(json!({
                "schemaVersion": SCHEMA_VERSION,
                "models": [
                    { "provider": "catalog:x", "id": "chotto", "name": "Shisa Translate", "maxTokens": null },
                    { "provider": "catalog:x", "id": "qwen", "name": "Qwen", "maxTokens": 32768 },
                    { "provider": "capy", "id": "other", "name": "Other" }
                ],
                "defaultProvider": "catalog:x",
                "defaultModel": "chotto",
        }));
        assert!(models.check_usable("catalog:x", "chotto").is_err());
        assert!(models.check_usable("catalog:x", "qwen").is_ok());
        assert!(models.check_usable("capy", "other").is_ok());
        assert_eq!(models.default_model(), None, "an unusable default is not offered");
        let listed = annotate(models.load().unwrap());
        assert_eq!(listed["models"][0]["available"], false);
        assert!(listed["models"][0]["unavailableReason"].is_string());
        assert_eq!(listed["models"][1]["available"], true);
    }
}
