// Detecta quando um item do PoE2 é copiado (Ctrl+C / Ctrl+Alt+C no jogo).
// O conteúdo da área de transferência só é usado se for um item do jogo;
// qualquer outra coisa é ignorada e não sai do computador.

import { clipboard } from 'electron'
import { looksLikeItemText } from '../core/item/parser'

const POLL_MS = 250

export class ClipboardWatcher {
  private last: string | null = null
  private lastSeq: number | null = null
  private timer: NodeJS.Timeout | null = null
  private polling = false

  /**
   * `sequence` (opcional) devolve o contador de cópias do Windows. Com ele,
   * copiar o MESMO item duas vezes conta duas vezes (pilhas iguais no modo
   * lista). Sem ele, só textos diferentes disparam.
   */
  constructor(
    private readonly onItem: (text: string) => void,
    private readonly sequence: () => number | null = () => null,
  ) {}

  async start(): Promise<void> {
    if (this.timer) return
    // Ignora o que já estava copiado antes de começar a observar.
    this.last = await this.read()
    this.lastSeq = this.sequence()
    this.timer = setInterval(() => void this.poll(), POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async read(): Promise<string> {
    try {
      return await clipboard.readText()
    } catch {
      return ''
    }
  }

  private async poll(): Promise<void> {
    // Evita leituras sobrepostas se o sistema demorar a responder.
    if (this.polling) return
    this.polling = true
    try {
      const seq = this.sequence()
      if (seq !== null) {
        if (seq === this.lastSeq) return
        this.lastSeq = seq
        const text = await this.read()
        this.last = text
        if (looksLikeItemText(text)) this.onItem(text)
        return
      }
      const text = await this.read()
      if (text === this.last) return
      this.last = text
      if (looksLikeItemText(text)) this.onItem(text)
    } finally {
      this.polling = false
    }
  }
}
