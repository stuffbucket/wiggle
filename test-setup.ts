// Registers a DOM (happy-dom ships WebCrypto) so Tauri's IPC mocks have a
// `window`/`crypto` to patch. Preloaded for every test via bunfig.toml.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
