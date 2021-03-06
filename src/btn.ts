
import { ScoreInfo } from './scoreinfo'
import { loadMscore, WebMscore } from './mscore'
import { useTimeout, windowOpenAsync, console, attachShadow } from './utils'
import i18n from './i18n'
// @ts-ignore
import btnListCss from './btn.css'

type BtnElement = HTMLButtonElement

const getBtnContainer = (): HTMLDivElement => {
  const els = [...document.querySelectorAll('*')].reverse()
  const el = els.find(b => {
    const text = b?.textContent?.replace(/\s/g, '') || ''
    return text.includes('Download') || text.includes('Print')
  }) as HTMLDivElement | null
  const btnParent = el?.parentElement?.parentElement as HTMLDivElement | undefined
  if (!btnParent) throw new Error('btn parent not found')
  return btnParent
}

const buildDownloadBtn = () => {
  const btn = document.createElement('button')
  btn.type = 'button'

  // build icon svg element
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  const svgPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  svgPath.setAttribute('d', 'M9.6 2.4h4.8V12h2.784l-5.18 5.18L6.823 12H9.6V2.4zM19.2 19.2H4.8v2.4h14.4v-2.4z')
  svgPath.setAttribute('fill', '#fff')
  svg.append(svgPath)

  const textNode = document.createElement('span')
  btn.append(svg, textNode)

  return btn
}

const cloneBtn = (btn: HTMLButtonElement) => {
  const n = btn.cloneNode(true) as HTMLButtonElement
  n.onclick = btn.onclick
  return n
}

interface BtnOptions {
  readonly name: string;
  readonly action: BtnAction;
  readonly disabled?: boolean;
  readonly tooltip?: string;
}

export enum BtnListMode {
  InPage,
  ExtWindow,
}

export class BtnList {
  private readonly list: BtnElement[] = [];

  constructor (private getBtnParent: () => HTMLDivElement = getBtnContainer) { }

  add (options: BtnOptions): BtnElement {
    const btnTpl = buildDownloadBtn()
    const setText = (btn: BtnElement) => {
      const textNode = btn.querySelector('span')
      return (str: string): void => {
        if (textNode) textNode.textContent = str
      }
    }

    setText(btnTpl)(options.name)

    btnTpl.onclick = function () {
      const btn = this as BtnElement
      options.action(options.name, btn, setText(btn))
    }

    this.list.push(btnTpl)

    if (options.disabled) {
      btnTpl.disabled = options.disabled
    }

    if (options.tooltip) {
      btnTpl.title = options.tooltip
    }

    return btnTpl
  }

  private _commit () {
    const btnParent = document.querySelector('div') as HTMLDivElement
    const shadow = attachShadow(btnParent)

    // style the shadow DOM
    const style = document.createElement('style')
    style.innerText = btnListCss
    shadow.append(style)

    // hide buttons using the shadow DOM
    const slot = document.createElement('slot')
    shadow.append(slot)

    const newParent = document.createElement('div')
    newParent.append(...this.list.map(e => cloneBtn(e)))
    shadow.append(newParent)

    try {
      const anchorDiv = this.getBtnParent()
      const { width, top, left } = anchorDiv.getBoundingClientRect()
      newParent.style.width = `${width}px`
      newParent.style.top = `${top}px`
      newParent.style.left = `${left}px`
    } catch (err) {
      console.error(err)
    }

    return btnParent
  }

  /**
   * replace the template button with the list of new buttons
   */
  async commit (mode: BtnListMode = BtnListMode.InPage): Promise<void> {
    switch (mode) {
      case BtnListMode.InPage: {
        let el: Element
        try {
          el = this._commit()
        } catch {
          // fallback to BtnListMode.ExtWindow
          return this.commit(BtnListMode.ExtWindow)
        }
        const observer = new MutationObserver(() => {
          // check if the buttons are still in document when dom updates 
          if (!document.contains(el)) {
            // re-commit
            // performance issue?
            el = this._commit()
          }
        })
        observer.observe(document, { childList: true, subtree: true })
        break
      }

      case BtnListMode.ExtWindow: {
        const div = this._commit()
        const w = await windowOpenAsync(undefined, '', undefined, 'resizable,width=230,height=270')
        // eslint-disable-next-line no-unused-expressions
        w?.document.body.append(div)
        window.addEventListener('unload', () => w?.close())
        break
      }

      default:
        throw new Error('unknown BtnListMode')
    }
  }
}

type BtnAction = (btnName: string, btnEl: BtnElement, setText: (str: string) => void) => any

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace BtnAction {

  type Promisable<T> = T | Promise<T>
  type UrlInput = Promisable<string> | (() => Promisable<string>)

  const normalizeUrlInput = (url: UrlInput) => {
    if (typeof url === 'function') return url()
    else return url
  }

  export const download = (url: UrlInput, fallback?: () => Promisable<void>, timeout?: number): BtnAction => {
    return process(async (): Promise<void> => {
      const _url = await normalizeUrlInput(url)
      const a = document.createElement('a')
      a.href = _url
      a.dispatchEvent(new MouseEvent('click'))
    }, fallback, timeout)
  }

  export const mscoreWindow = (scoreinfo: ScoreInfo, fn: (w: Window, score: WebMscore, processingTextEl: ChildNode) => any): BtnAction => {
    return async (btnName, btn, setText) => {
      const _onclick = btn.onclick
      btn.onclick = null
      setText(i18n('PROCESSING')())

      const w = await windowOpenAsync(btn, '') as Window
      const txt = document.createTextNode(i18n('PROCESSING')())
      w.document.body.append(txt)

      // set page hooks
      // eslint-disable-next-line prefer-const
      let score: WebMscore
      const destroy = (): void => {
        score && score.destroy()
        w.close()
      }
      window.addEventListener('unload', destroy)
      w.addEventListener('beforeunload', () => {
        score && score.destroy()
        window.removeEventListener('unload', destroy)
        setText(btnName)
        btn.onclick = _onclick
      })

      score = await loadMscore(scoreinfo, w)

      fn(w, score, txt)
    }
  }

  export const process = (fn: () => any, fallback?: () => Promisable<void>, timeout = 10 * 60 * 1000 /* 10min */): BtnAction => {
    return async (name, btn, setText): Promise<void> => {
      const _onclick = btn.onclick

      btn.onclick = null
      setText(i18n('PROCESSING')())

      try {
        await useTimeout(fn(), timeout)
        setText(name)
      } catch (err) {
        console.error(err)
        if (fallback) {
          // use fallback
          await fallback()
          setText(name)
        } else {
          setText(i18n('BTN_ERROR')())
        }
      }

      btn.onclick = _onclick
    }
  }

  export const deprecate = (action: BtnAction): BtnAction => {
    return (name, btn, setText) => {
      alert(i18n('DEPRECATION_NOTICE')(name))
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return action(name, btn, setText)
    }
  }

}
