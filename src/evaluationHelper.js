import { PDFDocument, rgb, StandardFonts, breakTextIntoLines, PageSizes } from 'pdf-lib'

export class EvaluationHelper {
    static ColorBlue = rgb(120 / 255, 165 / 255, 182 / 255)
    static ColorGray = rgb(106 / 255, 97 / 255, 91 / 255)
    static ColorBlue1 = rgb(120 / 255, 159 / 255, 155 / 255)
    static ColorGray1 = rgb(165 / 255, 159 / 255, 155 / 255)
    static ColorGray2 = rgb(0.9, 0.9, 0.9)
    static ColorGray3 = rgb(0.98, 0.98, 0.98)
    static ColorGray4 = rgb(202 / 255, 200 / 255, 198 / 255)

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
    }

    gotoPage(index) {
        //eslint-disable-next-line no-plusplus
        for (let i = index - this.doc.getPageCount(); i >= 0; --i) this.doc.addPage(PageSizes.A4)
        return this.doc.getPage(index)
    }

    moveDown(delta) {
        this.y += delta
    }

    calculateTextRectangle(text, options) {
        if (options.computed) return options

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
        const lines = breakTextIntoLines(text, [' '], textWidth, (t) => this.font.widthOfTextAtSize(t, size)).map(
            (t) => ({
                text: t,
                width: this.font.widthOfTextAtSize(t, size),
            })
        )
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
            return lines.map((line, i) => ({
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
        }

        let ny = y + (centered ? height * 0.5 - textHeight * 0.5 : 0.0)
        pageIndex = (ny * EvaluationHelper.InvContentHeight) | 0

        for (let presentedLines = 0; presentedLines < lines.length; ) {
            const oy = ny - pageIndex * EvaluationHelper.ContentHeight
            const currentHeight = EvaluationHelper.ContentHeight - oy
            const fragPresentLines = currentHeight / lineHeight
            const presentLines = fragPresentLines | 0
            const restLineHeight = lineHeight - (fragPresentLines - presentLines) * lineHeight
            const maxPresentLines = Math.min(presentLines, lines.length - presentedLines)
            const restLineHeightFrag = restLineHeight / maxPresentLines

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

            ny += currentHeight + restLineHeight + descender
            presentedLines += maxPresentLines

            //eslint-disable-next-line no-plusplus
            ++pageIndex
        }

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
        const computed = this.calculateTextRectangle(text, options)
        this.drawSplittedText(this.splitText(text, computed))
        this.y = options.y + computed.height
    }

    drawTextBlock(text, options) {
        const computed = this.calculateTextRectangle(text, options)
        const splittedText = this.splitText(text, computed)
        const { x, y, width, background } = computed
        const height = computed.height + splittedText.reduce((s, l) => s + l.advance, 0)

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

    generate(participantCount, results, struct, session) {
        const statistics = results.reduce((acc, result) => {
            //eslint-disable-next-line no-plusplus
            for (const key in result.result) if (acc[key]) ++acc[key][result.result[key]]
            return acc
        }, Object.fromEntries(struct.filter((block) => block.type === 'notes').map((block) => [block.identifier, Object.fromEntries(block.notes.map((note) => [note, 0]))])))

        const styles = {
            h1: { size: 24, color: EvaluationHelper.ColorGray },
            h2: { size: 20, color: EvaluationHelper.ColorBlue },
            h3: { size: 18, color: EvaluationHelper.ColorBlue },
            h4: { size: 16, color: EvaluationHelper.ColorLightBlue },
            h5: { size: 14, color: EvaluationHelper.ColorBlue },
            h6: { size: 12, color: EvaluationHelper.ColorBlue },
        }

        this.drawText(`Date de création: ${new Date().toLocaleString('fr', { timeZone: 'Europe/Zurich' })}`, {
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
        this.drawText(session.course_name, {
            x: 0,
            y: this.y,
            size: 24,
            color: EvaluationHelper.ColorGray1,
        })
        this.moveDown(24)

        for (const block of struct) {
            const { type } = block

            //eslint-disable-next-line eqeqeq
            if (type == 'title') {
                const style = styles[block.tag]
                this.drawText(block.text, {
                    x: 0,
                    y: this.y,
                    size: style.size,
                    color: style.color,
                })
                this.moveDown(style.size)
                //eslint-disable-next-line eqeqeq
            } else if (type == 'paragraph') {
                this.drawText(block.text, {
                    x: 0,
                    y: this.y,
                    lineHeight: 1.5,
                })
                this.moveDown(24)
                //eslint-disable-next-line eqeqeq
            } else if (type == 'notes') {
                const headers = [...block.notes.map((n) => n.toString()), 'Total réponses', 'Nbr participants'].map(
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
                    participantCount.toString(),
                    Object.values(statistics[block.identifier])
                        .reduce((sum, n) => sum + n, 0)
                        .toString(),
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
                const columnsWidth = headers.map((h, i) => Math.max(h.computed.width, bodies[i].computed.width))
                const deltaWidth =
                    (EvaluationHelper.ContentWidth - columnsWidth.reduce((s, w) => s + w)) / headers.length

                this.drawText(block.text, {
                    x: 0,
                    y: this.y,
                })
                this.moveDown(12)

                const y = this.y

                //eslint-disable-next-line no-plusplus
                for (let i = 0, x = 0; i < headers.length; ++i) {
                    const header = headers[i]
                    const body = bodies[i]
                    const width = columnsWidth[i] + deltaWidth

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

                    x += width
                }

                this.y = y + headerHeight + bodyHeight + 24
                //eslint-disable-next-line eqeqeq
            } else if (type == 'remark') {
                this.drawText(block.text, {
                    x: 0,
                    y: this.y,
                })
                this.moveDown(12)
                this.drawTextBlock(
                    results
                        .filter(({ result }) => result[block.identifier])
                        .map(({ result }) => ` -\t${result[block.identifier]}`)
                        .join('\n'),
                    {
                        x: 0,
                        y: this.y,
                        width: EvaluationHelper.ContentWidth,
                        padding: 15,
                        lineHeight: 1.5,
                        background: {
                            color: EvaluationHelper.ColorGray3,
                        },
                    }
                )
                this.moveDown(24)
            }
        }
    }

    save() {
        return this.doc.save()
    }
}
