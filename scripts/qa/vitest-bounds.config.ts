import { mergeConfig } from "vitest/config";
import config from "../../vitest.config.js";

export default mergeConfig(config, { cacheDir: "/tmp/home/vite" });
