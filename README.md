# PoE4Dummies II

Preços, price check e guia de campanha para **Path of Exile 2**.

[![Baixar o instalador](https://img.shields.io/badge/BAIXAR-Instalador-d8b25e?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/luanguedes00/poe4dummies/releases/download/v0.3.0/PoE4Dummies-II-0.3.0-setup.exe)
&nbsp;
[![Baixar a versão portátil](https://img.shields.io/badge/BAIXAR-Port%C3%A1til-555?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/luanguedes00/poe4dummies/releases/download/v0.3.0/PoE4Dummies-II-0.3.0-portable.exe)

Se o Windows avisar "O Windows protegeu o computador": **Mais informações → Executar assim mesmo**.

![Mercado](docs/screenshots/mercado.png)

## O que tem

- **Mercado** com preço, gráfico e variação de todas as categorias.
- **Price check no jogo:** `Ctrl+C` num item mostra preço, nota e tier dos mods. Clique fora para fechar.
- **Lista de loot:** `F3` sobre o item soma o valor do mapa.
- **Campanha e mapas:** nível da área, dicas por zona, mapas por hora e resumo da sessão.
- **Builds** *(beta)*: compara a sua build com a de um guia.
- **Farm** *(beta)*: custo dos tablets e regex para achar tablets no baú.

<p>
  <img src="docs/screenshots/sobreposicao.png" alt="Price check" width="320">
</p>

## Requisitos

Windows 10 ou 11, jogo em inglês e em Windowed Fullscreen.

Sem login e sem coleta de dados. O app só lê o log do jogo no seu PC e respeita o limite de buscas da trade.

## Para quem programa

```bash
npm install
npm run build
npx electron .
```

`npm run check` roda tipos e testes. `npm run dist` gera o instalador e o portátil.

---

Projeto feito em vibe coding, com IA (Claude). This product isn't affiliated with or endorsed by Grinding Gear Games in any way. Licença [MIT](LICENSE).
