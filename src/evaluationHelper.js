import { PDFDocument, rgb, StandardFonts, breakTextIntoLines, PageSizes } from 'pdf-lib'

export class EvaluationHelper {
    static ColorBlue = rgb(120 / 255, 165 / 255, 182 / 255)
    static ColorGray = rgb(106 / 255, 97 / 255, 91 / 255)
    static ColorBlue1 = rgb(120 / 255, 159 / 255, 155 / 255)
    static ColorGray1 = rgb(165 / 255, 159 / 255, 155 / 255)
    static ColorGray2 = rgb(0.9, 0.9, 0.9)
    static ColorGray3 = rgb(0.98, 0.98, 0.98)
    static ColorGray4 = rgb(202 / 255, 200 / 255, 198 / 255)
    static Debug = false

    static PageMarginX = 50
    static PageMarginY = 30
    static PageWidth = PageSizes.A4[0]
    static PageHeight = PageSizes.A4[1]
    static ContentWidth = this.PageWidth - (this.PageMarginX << 1)
    static ContentHeight = this.PageHeight - (this.PageMarginY << 1)
    static InvContentHeight = 1.0 / this.ContentHeight
    static ContentTop = this.ContentHeight + this.PageMarginY

    static async create() {
        const doc = await PDFDocument.create({})
        const font = await doc.embedFont(StandardFonts.Helvetica)
        return new EvaluationHelper(doc, font)
    }

    constructor(doc, font) {
        this.doc = doc
        this.font = font
        this.y = 0
        this.supportedCodePoints = new Set(font.getCharacterSet())
    }

    cleanText(text) {
        let cleaned = ''

        for (const char of String(text ?? '')) {
            const codePoint = char.codePointAt(0)

            if (char === '\n') {
                cleaned += '\n'
                continue
            }
            if (char === '\r') continue
            if (char === '\t') {
                cleaned += ' '
                continue
            }

            cleaned += this.supportedCodePoints.has(codePoint) ? char : ' '
        }

        return cleaned
    }

    gotoPage(index) {
        //eslint-disable-next-line no-plusplus
        for (let i = index - this.doc.getPageCount(); i >= 0; --i) this.doc.addPage(PageSizes.A4)
        return this.doc.getPage(index)
    }

    moveDown(delta) {
        this.y += delta
    }

    ensurePageSpace(height) {
        const pageIndex = (this.y * EvaluationHelper.InvContentHeight) | 0
        const pageEndY = (pageIndex + 1) * EvaluationHelper.ContentHeight
        if (this.y + height > pageEndY) {
            this.y = pageEndY
        }
    }

    remainingPageSpace() {
        const pageIndex = (this.y * EvaluationHelper.InvContentHeight) | 0
        const pageEndY = (pageIndex + 1) * EvaluationHelper.ContentHeight
        return pageEndY - this.y
    }

    pageBreak() {
        const pageIndex = (this.y * EvaluationHelper.InvContentHeight) | 0
        this.y = (pageIndex + 1) * EvaluationHelper.ContentHeight
    }

    calculateTextRectangle(text, options) {
        if (options.computed) return options

        const safeText = this.cleanText(text)

        const {
            x,
            y,
            size = 12,
            color = EvaluationHelper.ColorGray,
            lineHeight = 1.0,
            width = EvaluationHelper.ContentWidth,
            height = 0,
            padding = 0,
            centered = false,
            background,
        } = options
        const padding2 = padding << 1
        const textWidth = width - padding2
        const lineHeightPixel = this.font.heightAtSize(size * lineHeight)
        const lines = breakTextIntoLines(safeText, [' '], textWidth, (t) => this.font.widthOfTextAtSize(t, size)).map(
            (t) => ({
                text: t,
                width: this.font.widthOfTextAtSize(t, size),
            })
        )
        if (!lines.length) lines.push({ text: '', width: 0 })
        const textHeight = lineHeightPixel * lines.length
        const maxHeight = Math.max(height, textHeight + padding2)

        return {
            computed: true,
            x,
            y,
            size,
            color,
            width: Math.min(Math.max(...lines.map((line) => line.width)) + padding2, width),
            padding,
            textHeight,
            lines,
            background,
            centered,
            descender: this.font.heightAtSize(size) - this.font.heightAtSize(size, { descender: false }),
            lineHeight: lineHeightPixel,
            height: maxHeight,
        }
    }

    splitText(text, options) {
        const computed = this.calculateTextRectangle(text, options)
        const { x, y, width, height, size, color, lines, lineHeight, textHeight, descender, centered, background } =
            computed
        const bottomPageIndex = ((y + height) * EvaluationHelper.InvContentHeight) | 0
        let pageIndex = (y * EvaluationHelper.InvContentHeight) | 0

        //eslint-disable-next-line eqeqeq
        if (pageIndex == bottomPageIndex) {
            const py =
                EvaluationHelper.ContentTop -
                (y - pageIndex * EvaluationHelper.ContentHeight) -
                lineHeight -
                (centered ? height * 0.5 - textHeight * 0.5 : 0.0) +
                descender
            const mappedLines = lines.map((line, i) => ({
                ...line,
                pageIndex,
                advance: 0,
                options: {
                    x: EvaluationHelper.PageMarginX + x + (centered ? width * 0.5 - line.width * 0.5 : 0.0),
                    y: py - i * lineHeight,
                    size,
                    lineHeight,
                    color,
                    background,
                },
            }))
            mappedLines.endY = y + height
            return mappedLines
        }

        let ny = y + (centered ? height * 0.5 - textHeight * 0.5 : 0.0)
        pageIndex = (ny * EvaluationHelper.InvContentHeight) | 0

        let endY = y
        for (let presentedLines = 0; presentedLines < lines.length; ) {
            const oy = ny - pageIndex * EvaluationHelper.ContentHeight
            const currentHeight = EvaluationHelper.ContentHeight - oy
            const fragPresentLines = currentHeight / lineHeight
            const presentLines = fragPresentLines | 0
            const restLineHeight = lineHeight - (fragPresentLines - presentLines) * lineHeight
            const maxPresentLines = Math.min(presentLines, lines.length - presentedLines)
            const restLineHeightFrag = maxPresentLines > 0 ? restLineHeight / maxPresentLines : 0

            //eslint-disable-next-line no-plusplus
            for (let i = 0; i < maxPresentLines; ++i) {
                const j = presentedLines + i
                const line = lines[j]
                const py = EvaluationHelper.ContentTop - oy - lineHeight + descender
                lines[j] = {
                    ...line,
                    pageIndex,
                    advance: restLineHeightFrag,
                    options: {
                        x: EvaluationHelper.PageMarginX + x + (centered ? width * 0.5 - line.width * 0.5 : 0.0),
                        y: py - i * lineHeight,
                        size,
                        lineHeight,
                        color,
                    },
                }
            }

            endY = pageIndex * EvaluationHelper.ContentHeight + oy + maxPresentLines * lineHeight
            ny += currentHeight + restLineHeight + descender
            presentedLines += maxPresentLines

            //eslint-disable-next-line no-plusplus
            ++pageIndex
        }

        lines.endY = endY
        return lines
    }

    drawRectangle(options) {
        const { x, y, height } = options
        const topPageIndex = (y * EvaluationHelper.InvContentHeight) | 0
        const bottomPageIndex = ((y + height) * EvaluationHelper.InvContentHeight) | 0
        const oy = y - topPageIndex * EvaluationHelper.ContentHeight
        const px = EvaluationHelper.PageMarginX + x
        const py = EvaluationHelper.ContentTop - oy

        const page = this.gotoPage(topPageIndex)

        //eslint-disable-next-line eqeqeq
        if (topPageIndex == bottomPageIndex) {
            this.y = y + height
            return page.drawRectangle({
                ...options,
                x: px,
                y: py - height,
            })
        }

        const currentHeight = EvaluationHelper.ContentHeight - oy
        page.drawRectangle({
            ...options,
            x: px,
            y: py - currentHeight,
            height: currentHeight,
        })

        this.drawRectangle({
            ...options,
            y: y + currentHeight,
            height: height - currentHeight,
        })
    }

    drawSplittedText(splittedText) {
        for (const text of splittedText) {
            const { x, y, size, color } = text.options
            this.gotoPage(text.pageIndex).drawText(text.text, {
                x,
                y,
                size,
                color,
            })
        }
    }

    drawText(text, options) {
        const txt = this.cleanText(text)
        const computed = this.calculateTextRectangle(txt, options)
        const splittedText = this.splitText(txt, computed)
        this.drawSplittedText(splittedText)
        const endY = typeof splittedText.endY === 'number' ? splittedText.endY : options.y + computed.height
        this.y = endY
    }

    drawTextBlock(text, options) {
        const txt = this.cleanText(text)
        const computed = this.calculateTextRectangle(txt, options)
        const splittedText = this.splitText(txt, computed)
        const { x, y, width, background } = computed
        const endY = typeof splittedText.endY === 'number' ? splittedText.endY : y + computed.height
        const height = endY - y

        if (background) {
            this.drawRectangle({
                x,
                y,
                width,
                height,
                color: background.color,
                opacity: background.opacity,
                borderWidth: background.borderWidth,
                borderColor: background.borderColor,
                borderOpacity: background.borderOpacity,
            })
        }

        this.y = y + height
        this.drawSplittedText(splittedText)
    }

    drawHorizontalLine(y, options) {
        const pageIndex = (y * EvaluationHelper.InvContentHeight) | 0
        const page = this.gotoPage(pageIndex)
        const py = EvaluationHelper.ContentTop - (y - pageIndex * EvaluationHelper.ContentHeight)
        page.drawLine({
            ...options,
            start: { x: EvaluationHelper.PageMarginX, y: py },
            end: { x: EvaluationHelper.PageMarginX + EvaluationHelper.ContentWidth, y: py },
        })
        this.y += options.thickness
    }

    generate(title, participantCount, results, struct) {
        const statistics = results.reduce((acc, result) => {
            for (const key in result.result)
                if (acc[key] && acc[key][result.result[key]] !== undefined) acc[key][result.result[key]] += 1
            return acc
        }, Object.fromEntries(struct.filter((block) => block.type === 'notes').map((block) => [block.identifier, Object.fromEntries(block.notes.map((note) => [note, 0]))])))

        const styles = {
            h1: { size: 24, color: EvaluationHelper.ColorGray },
            h2: { size: 20, color: EvaluationHelper.ColorBlue },
            h3: { size: 18, color: EvaluationHelper.ColorBlue },
            h4: { size: 16, color: EvaluationHelper.ColorBlue1 },
            h5: { size: 14, color: EvaluationHelper.ColorBlue },
            h6: { size: 12, color: EvaluationHelper.ColorBlue },
        }

        this.drawText(`Date de creation: ${new Date().toLocaleString('fr', { timeZone: 'Europe/Zurich' })}`, {
            x: 0,
            y: 0,
        })
        this.moveDown(16.65)

        this.drawHorizontalLine(this.y, {
            thickness: 1,
            color: EvaluationHelper.ColorBlue,
            opacity: 1,
        })

        this.moveDown(24)
        this.drawText(title, {
            x: 0,
            y: this.y,
            size: 24,
            color: EvaluationHelper.ColorGray1,
        })
        this.moveDown(24)

        for (let i = 0; i < struct.length; i += 1) {
            const block = struct[i]
            const { type } = block

            //eslint-disable-next-line eqeqeq
            if (type == 'title') {
                const style = styles[block.tag]
                const titleRect = this.calculateTextRectangle(block.text, {
                    x: 0,
                    y: this.y,
                    size: style.size,
                    color: style.color,
                })
                if (
                    typeof block.text === 'string' &&
                    /^[BCD]\./.test(block.text.trim()) &&
                    this.remainingPageSpace() < 260
                ) {
                    this.pageBreak()
                }
                this.ensurePageSpace(titleRect.height + style.size)
                this.drawText(block.text, {
                    x: 0,
                    y: this.y,
                    size: style.size,
                    color: style.color,
                })
                this.moveDown(style.size)
                //eslint-disable-next-line eqeqeq
            } else if (type == 'paragraph') {
                const paragraphRect = this.calculateTextRectangle(block.text, {
                    x: 0,
                    y: this.y,
                    lineHeight: 1.5,
                })
                this.ensurePageSpace(paragraphRect.height + 24)
                this.drawText(block.text, {
                    x: 0,
                    y: this.y,
                    lineHeight: 1.5,
                })
                this.moveDown(24)
                //eslint-disable-next-line eqeqeq
            } else if (type == 'notes') {
                const questionRect = this.calculateTextRectangle(block.text, {
                    x: 0,
                    y: this.y,
                })
                const headers = [...block.notes.map((n) => n.toString()), 'Total reponses', 'Nbr participants'].map(
                    (header) => ({
                        text: header,
                        computed: this.calculateTextRectangle(header, {
                            width: EvaluationHelper.ContentWidth / (block.notes.length + 2),
                            padding: 5,
                            centered: true,
                            background: {
                                color: EvaluationHelper.ColorGray2,
                                borderColor: EvaluationHelper.ColorGray4,
                                borderWidth: 1,
                            },
                        }),
                    })
                )
                const bodies = [
                    ...block.notes.map((n) => statistics[block.identifier][n].toString()),
                    Object.values(statistics[block.identifier])
                        .reduce((sum, n) => sum + n, 0)
                        .toString(),
                    participantCount.toString(),
                ].map((body) => ({
                    text: body,
                    computed: this.calculateTextRectangle(body, {
                        padding: 10,
                        centered: true,
                        background: {
                            borderColor: EvaluationHelper.ColorGray4,
                            borderWidth: 1,
                        },
                    }),
                }))
                const headerHeight = Math.max(...headers.map((h) => h.computed.height))
                const bodyHeight = Math.max(...bodies.map((b) => b.computed.height))
                const tableHeight = Math.max(headerHeight + bodyHeight, 60)
                const columnsWidth = headers.map((h, j) => Math.max(h.computed.width, bodies[j].computed.width))
                const deltaWidth =
                    (EvaluationHelper.ContentWidth - columnsWidth.reduce((s, w) => s + w)) / headers.length

                this.ensurePageSpace(questionRect.height + 12 + tableHeight + 24)

                this.drawText(block.text, {
                    x: 0,
                    y: this.y,
                })
                this.moveDown(12)

                const y = this.y
                let maxY = y

                //eslint-disable-next-line no-plusplus
                for (let j = 0, x = 0; j < headers.length; ++j) {
                    const header = headers[j]
                    const body = bodies[j]
                    const width = columnsWidth[j] + deltaWidth

                    this.drawTextBlock(header.text, {
                        ...header.computed,
                        x,
                        y,
                        width,
                        height: headerHeight,
                    })
                    this.drawTextBlock(body.text, {
                        ...body.computed,
                        x,
                        y: y + headerHeight,
                        width,
                        height: bodyHeight,
                    })

                    if (this.y > maxY) maxY = this.y
                    x += width
                }

                this.y = maxY + 24
                //eslint-disable-next-line eqeqeq
            } else if (type == 'remark') {
                const questionRect = this.calculateTextRectangle(block.text, {
                    x: 0,
                    y: this.y,
                })
                const remarkText = results
                    .filter(({ result }) => result[block.identifier])
                    .map(({ result }) => ` -\t${result[block.identifier]}`)
                    .join('\n')
                const hasRemark = remarkText.trim().length > 0
                const remarkRect = hasRemark
                    ? this.calculateTextRectangle(remarkText, {
                          x: 0,
                          y: this.y,
                          width: EvaluationHelper.ContentWidth,
                          padding: 15,
                          lineHeight: 1.5,
                          background: {
                              color: EvaluationHelper.ColorGray3,
                          },
                      })
                    : { height: 0 }
                this.ensurePageSpace(questionRect.height + 12 + remarkRect.height + 24)
                this.drawText(block.text, {
                    x: 0,
                    y: this.y,
                })
                this.moveDown(12)
                if (hasRemark) {
                    this.drawTextBlock(remarkText, {
                        x: 0,
                        y: this.y,
                        width: EvaluationHelper.ContentWidth,
                        padding: 15,
                        lineHeight: 1.5,
                        background: {
                            color: EvaluationHelper.ColorGray3,
                        },
                    })
                    this.moveDown(24)
                } else {
                    this.moveDown(12)
                }
            }
        }
    }

    save() {
        return this.doc.save()
    }
}
