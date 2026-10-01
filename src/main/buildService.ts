// Guarda as duas builds (a do guia e a do jogador) e baixa códigos dos sites de build.

import { ApiError, type HttpClient } from '../core/http/client'
import { BuildImportError, looksLikeUrl, parseBuildLink, type Build, type BuildKind, type BuildPair } from '../core/build/model'
import { ninjaCharacter } from '../core/build/ninja'
import { importPobCode, MAX_CODE_LENGTH } from '../core/build/pob'
import type { BuildImportResult } from '../shared/ipc'
import type { DiskCache } from './diskCache'

export class BuildService {
  private builds: BuildPair = { guide: null, mine: null }

  constructor(
    private readonly store: DiskCache<BuildPair>,
    private readonly http: HttpClient,
    private readonly onChange: (builds: BuildPair) => void,
  ) {}

  async load(): Promise<void> {
    this.builds = (await this.store.read()) ?? { guide: null, mine: null }
    this.onChange(this.builds)
  }

  all(): BuildPair {
    return this.builds
  }

  get(kind: BuildKind): Build | null {
    return this.builds[kind]
  }

  async import(input: string, kind: BuildKind): Promise<BuildImportResult> {
    try {
      const build = await this.parse(input.trim())
      await this.save({ ...this.builds, [kind]: build })
      return { ok: true, build }
    } catch (error) {
      if (error instanceof BuildImportError) return { ok: false, code: error.code }
      if (error instanceof ApiError) {
        // Perfil privado/inexistente no poe.ninja volta sem o código (resposta inválida).
        const missing = (error.code === 'http' && (error.status === 404 || error.status === 400)) || error.code === 'invalid-response'
        return { ok: false, code: missing ? 'not-found' : 'network' }
      }
      return { ok: false, code: 'invalid-code' }
    }
  }

  async clear(kind: BuildKind): Promise<BuildPair> {
    await this.save({ ...this.builds, [kind]: null })
    return this.builds
  }

  private async save(next: BuildPair): Promise<void> {
    this.builds = next
    if (next.guide || next.mine) await this.store.write(next)
    else await this.store.remove()
    this.onChange(next)
  }

  private async parse(input: string): Promise<Build> {
    if (!looksLikeUrl(input)) return importPobCode(input, { kind: 'code' })
    const link = parseBuildLink(input)
    if (!link) throw new BuildImportError('unsupported-link')
    // O endereço vem de uma tabela fixa por site; só o id (validado) vem do usuário.
    const source = { kind: 'link' as const, site: link.site, id: link.id }
    if (link.site === 'poeninja-character') {
      const character = await ninjaCharacter(this.http, link)
      const build = importPobCode(character.code.trim(), source)
      if (character.extras) build.extras = character.extras
      if (character.useSecondWeaponSet !== null) build.activeWeaponSet = character.useSecondWeaponSet ? 2 : 1
      return build
    }
    const code = await this.http.requestText(link.rawUrl, MAX_CODE_LENGTH + 1024)
    return importPobCode(code.trim(), source)
  }
}
