
import { getFetch, escapeFilename } from './utils'

export abstract class ScoreInfo {
  private readonly RADIX = 20;

  abstract id: number;
  abstract title: string;

  public store = new Map<symbol, any>();

  get idLastDigit (): number {
    return (+this.id) % this.RADIX
  }

  get fileName (): string {
    return escapeFilename(this.title)
  }

  public getMsczIpfsRef (mainCid: string): string {
    return `/ipfs/${mainCid}/${this.idLastDigit}/${this.id}.mscz`
  }

  public getMsczCidUrl (mainCid: string): string {
    return `https://ipfs.infura.io:5001/api/v0/block/stat?arg=${this.getMsczIpfsRef(mainCid)}`
  }
}

export class ScoreInfoObj extends ScoreInfo {
  constructor (public id: number = 0, public title: string = '') { super() }
}

export class ScoreInfoInPage extends ScoreInfo {
  constructor (private document: Document) { super() }

  get id (): number {
    const el = this.document.querySelector("meta[property='al:ios:url']") as HTMLMetaElement
    const m = el.content.match(/(\d+)$/) as RegExpMatchArray
    return +m[1]
  }

  get title (): string {
    const el = this.document.querySelector("meta[property='og:title']") as HTMLMetaElement
    return el.content
  }

  get baseUrl (): string {
    const el = this.document.querySelector("meta[property='og:image']") as HTMLMetaElement
    const m = el.content.match(/^(.+\/)score_/) as RegExpMatchArray
    return m[1]
  }
}

export class ScoreInfoHtml extends ScoreInfo {
  private readonly ID_REG = /<meta property="al:ios:url" content="musescore:\/\/score\/(\d+)">/
  private readonly TITLE_REG = /<meta property="og:title" content="(.*)">/
  private readonly BASEURL_REG = /<meta property="og:image" content="(.+\/)score_.*">/

  constructor (private html: string) { super() }

  get id (): number {
    const m = this.html.match(this.ID_REG)
    if (!m) return 0
    return +m[1]
  }

  get title (): string {
    const m = this.html.match(this.TITLE_REG)
    if (!m) return ''
    return m[1]
  }

  get baseUrl (): string {
    const m = this.html.match(this.BASEURL_REG)
    if (!m) return ''
    return m[1]
  }

  static async request (url: string, _fetch = getFetch()): Promise<ScoreInfoHtml> {
    const r = await _fetch(url)
    if (!r.ok) return new ScoreInfoHtml('')

    const html = await r.text()
    return new ScoreInfoHtml(html)
  }
}

export abstract class SheetInfo {
  abstract pageCount: number;
  abstract thumbnailUrl: string;

  get imgType (): 'svg' | 'png' {
    const thumbnail = this.thumbnailUrl
    const imgtype = thumbnail.match(/score_0\.(\w+)/)![1]
    return imgtype as 'svg' | 'png'
  }
}

export class SheetInfoInPage extends SheetInfo {
  constructor (private document: Document) { super() }

  get pageCount (): number {
    return this.document.querySelectorAll('.gXB83').length
  }

  get thumbnailUrl (): string {
    // url to the image of the first page
    const el = this.document.querySelector('link[as=image]') as HTMLLinkElement
    const url = el.href
    return url.split('@')[0]
  }
}

export const getActualId = async (scoreinfo: ScoreInfoInPage | ScoreInfoHtml, _fetch = getFetch()): Promise<number> => {
  if (scoreinfo.id <= 1000000000000) {
    // actual id already
    return scoreinfo.id
  }

  const jsonPUrl = new URL(`${scoreinfo.baseUrl}space.jsonp`)
  jsonPUrl.hostname = 's.musescore.com'

  const r = await _fetch(jsonPUrl.href)
  const text = await r.text()

  const m = text.match(/^jsonp(\d+)/) as RegExpMatchArray
  const id = +m[1]

  Object.defineProperty(scoreinfo, 'id', {
    get () { return id },
  })

  return id
}
