import "server-only";

import { readWebServerConfig } from "./config";

export function getWebServerConfig() {
  return readWebServerConfig(process.env);
}
