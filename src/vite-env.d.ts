/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Branch of an MCP test instance, empty everywhere else (vite.config.ts). */
  readonly VITE_EMERALD_INSTANCE_BRANCH: string;
}
