import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

/** Cache simples em JSON com validade. Arquivo corrompido ou vencido = sem cache. */
export class DiskCache<T> {
  constructor(
    private readonly file: string,
    private readonly ttlMs: number,
    private readonly validate: (value: unknown) => value is T,
  ) {}

  async read(): Promise<T | null> {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as { savedAt?: unknown; value?: unknown }
      if (typeof raw.savedAt !== 'number' || Date.now() - raw.savedAt > this.ttlMs) return null
      return this.validate(raw.value) ? raw.value : null
    } catch {
      return null
    }
  }

  async write(value: T): Promise<void> {
    try {
      await fs.mkdir(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      await fs.writeFile(tmp, JSON.stringify({ savedAt: Date.now(), value }), 'utf8')
      await fs.rename(tmp, this.file)
    } catch {
      // Sem cache em disco não é erro: na próxima vez baixa de novo.
    }
  }

  async remove(): Promise<void> {
    await fs.rm(this.file, { force: true }).catch(() => undefined)
  }
}
