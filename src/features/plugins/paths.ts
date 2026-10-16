export const PluginPath = {
  /** The config of one plugin, written in the notes screen: <plugin id>/config */
  Config: ":pluginId/config",
  config: (id: string) => `${encodeURIComponent(id)}/config`,
} as const;

