import { logger } from '../utils/index.js';

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
}

export interface Plugin<T> {
  manifest: PluginManifest;
  factory: (config: Record<string, unknown>) => T;
}

export class PluginRegistry<T> {
  private readonly plugins = new Map<string, Plugin<T>>();
  private readonly category: string;

  constructor(category: string) {
    this.category = category;
  }

  register(plugin: Plugin<T>): void {
    const key = plugin.manifest.name.toLowerCase();
    if (this.plugins.has(key)) {
      logger.warn(
        { category: this.category, plugin: key },
        'Plugin already registered – overwriting'
      );
    }
    this.plugins.set(key, plugin);
    logger.info({ category: this.category, plugin: key }, 'Plugin registered');
  }

  resolve(name: string, config: Record<string, unknown>): T {
    const key = name.toLowerCase();
    const plugin = this.plugins.get(key);
    if (!plugin) {
      throw new Error(
        `[PluginRegistry:${this.category}] Unknown plugin "${name}". ` +
        `Available: ${this.list().join(', ')}`
      );
    }
    return plugin.factory(config);
  }

  has(name: string): boolean {
    return this.plugins.has(name.toLowerCase());
  }

  list(): string[] {
    return Array.from(this.plugins.keys());
  }

  manifests(): PluginManifest[] {
    return Array.from(this.plugins.values()).map((p) => p.manifest);
  }
}
