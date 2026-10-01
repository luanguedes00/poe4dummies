import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { applySettingsPatch, readSettings, type Settings } from '../core/settings'

/** Guarda as configurações em JSON na pasta de dados do usuário, com escrita atômica. */
export class SettingsStore {
  private current: Settings
  private writing: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<(s: Settings) => void>()

  private constructor(
    private readonly file: string,
    initial: Settings,
  ) {
    this.current = initial
  }

  static async open(dir: string): Promise<SettingsStore> {
    const file = join(dir, 'settings.json')
    let raw: unknown = null
    try {
      raw = JSON.parse(await fs.readFile(file, 'utf8'))
    } catch {
      // Primeira execução ou arquivo corrompido: começa com o padrão.
    }
    return new SettingsStore(file, readSettings(raw))
  }

  get(): Settings {
    return this.current
  }

  onChange(listener: (s: Settings) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** `patch` vem da interface: é validado de forma estrita (lança se inválido). */
  async update(patch: unknown): Promise<Settings> {
    return this.replace(applySettingsPatch(this.current, patch))
  }

  /** Para mudanças feitas pelo próprio processo principal (já validadas). */
  async replace(next: Settings): Promise<Settings> {
    this.current = next
    const data = JSON.stringify(next, null, 2)
    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        const tmp = `${this.file}.tmp`
        await fs.writeFile(tmp, data, 'utf8')
        await fs.rename(tmp, this.file)
      })
    await this.writing
    for (const listener of this.listeners) listener(next)
    return next
  }
}
