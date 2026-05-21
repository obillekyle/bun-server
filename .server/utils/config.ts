export let serverConfig: AppConfig = {
  port: 3000,
  host: '0.0.0.0',
};

export function updateConfig(newConfig: AppConfig) {
  serverConfig = newConfig;
}
