/// Typed wrappers around the Rust commands. Centralizing the IPC here keeps the
/// command names in one place and gives tests a clean seam to mock (see
/// client.test.ts + @tauri-apps/api/mocks).

import { invoke } from "@tauri-apps/api/core";

export type Block = { index: number; text: string; matters: boolean };

export type ProviderStatus = {
  online: boolean;
  provider: string;
  model: string;
};

export type Ingested =
  | { kind: "text"; name: string; text: string }
  | { kind: "image"; name: string; media_type: string; base64: string }
  | { kind: "file"; name: string; path: string; mime: string; size: number };

export type UiConfig = { dim: number; locale: string };

export const wiggleText = (text: string) => invoke<Block[]>("wiggle", { text });

export const wiggleImage = (mime: string, data: string) =>
  invoke<Block[]>("wiggle_image", { mime, data });

export const ingestPath = (path: string) =>
  invoke<Ingested>("ingest_path", { path });

export const providerStatus = () => invoke<ProviderStatus>("provider_status");

export const listModels = () => invoke<string[]>("list_models");

export const setModel = (model: string) => invoke("set_model", { model });

export const getConfig = () => invoke<UiConfig>("get_config");

export const settingsPath = () => invoke<string>("settings_path");

export const dismiss = () => invoke("dismiss");

export const summon = () => invoke("summon");

export const setTrayLabels = (labels: {
  summon: string;
  update: string;
  quit: string;
}) => invoke("set_tray_labels", labels);
